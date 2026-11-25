/**
 * @dotmix/vite-plugin — Vite / Rollup plugin for Mix/Tix compiler
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@dotmix/compiler-frontend";
import {
  analyze,
  applyTextEdits,
  listOrderedImportSpecifiers,
  shiftMapThroughEdits,
  STYLE_EXTENSION_REGEX,
  type TextEdit
} from "@dotmix/compiler-semantic";
import { generate, isComponentStylesheet, type CodegenOptions, type CodegenResult } from "@dotmix/compiler-codegen";

export interface MixPluginOptions {
  runtimeImportPath?: string;
  hmr?: boolean;
  mode?: string;
}

function normalizeSpecForOrderMatch(spec: string): string {
  return spec.replace(/\.(tix|mix)\.js$/i, ".$1");
}

function buildDevGlobalStyleImportEdits(
  finalCode: string,
  orderedScriptSpecs: readonly string[]
): TextEdit[] {
  const globalStyleIndices: Array<{ readonly spec: string; readonly orderIdx: number }> = [];
  const moduleOrderBySpec = new Map<string, number[]>();

  for (let i = 0; i < orderedScriptSpecs.length; i++) {
    const spec = orderedScriptSpecs[i]!;
    if (STYLE_EXTENSION_REGEX.test(spec)) {
      if ((spec.startsWith("./") || spec.startsWith("../")) && !isComponentStylesheet(spec)) {
        globalStyleIndices.push({ spec, orderIdx: i });
      }
    } else {
      const key = normalizeSpecForOrderMatch(spec);
      const list = moduleOrderBySpec.get(key) ?? [];
      list.push(i);
      moduleOrderBySpec.set(key, list);
    }
  }
  if (globalStyleIndices.length === 0) return [];

  const importLines: Array<{ readonly start: number; readonly end: number; readonly orderIdx: number }> = [];
  const lines = finalCode.split("\n");
  let offset = 0;
  let lastImportEnd = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const lineEnd = offset + line.length + (idx < lines.length - 1 ? 1 : 0);
    const trimmed = line.trim();
    if (trimmed.startsWith("import ")) {
      lastImportEnd = lineEnd;
      if (idx > 0) {
        const quoteIdx = Math.max(line.lastIndexOf('"'), line.lastIndexOf("'"));
        if (quoteIdx > 0) {
          const quoteChar = line[quoteIdx]!;
          const openQuoteIdx = line.lastIndexOf(quoteChar, quoteIdx - 1);
          if (openQuoteIdx >= 0) {
            const rawSpec = line.slice(openQuoteIdx + 1, quoteIdx);
            const bucket = moduleOrderBySpec.get(normalizeSpecForOrderMatch(rawSpec));
            const orderIdx = bucket && bucket.length > 0 ? bucket.shift()! : Number.MAX_SAFE_INTEGER;
            importLines.push({ start: offset, end: lineEnd, orderIdx });
          }
        }
      }
    } else if (trimmed.length > 0) {
      break;
    }
    offset = lineEnd;
  }

  const editsByPos = new Map<number, string[]>();
  for (const styleEntry of globalStyleIndices) {
    const nextModule = importLines.find((m) => m.orderIdx > styleEntry.orderIdx);
    const insertAt = nextModule ? nextModule.start : lastImportEnd;
    const list = editsByPos.get(insertAt) ?? [];
    list.push(`import ${JSON.stringify(styleEntry.spec)};\n`);
    editsByPos.set(insertAt, list);
  }

  return [...editsByPos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pos, stmts]) => ({ start: pos, end: pos, text: stmts.join("") }));
}

export function mix(options: MixPluginOptions = {}) {
  const cssMap = new Map<string, string>();
  const scopedCssMap = new Map<string, string>();
  const normPath = (p: string): string => {
    let clean = p.replace(/\\/g, "/");
    if (/^[a-zA-Z]:\//.test(clean)) {
      clean = clean[0]!.toUpperCase() + clean.slice(1);
    } else if (/^file:\/\/\/[a-zA-Z]:\//i.test(clean)) {
      clean = "file:///" + clean[8]!.toUpperCase() + clean.slice(9);
    }
    return clean;
  };
  let resolvedMode = options.mode ?? (process.env.NODE_ENV === "production" ? "production" : "development");

  return {
    name: "mix",
    enforce: "pre" as const,

    configResolved(config: { mode?: string }): void {
      if (!options.mode && typeof config.mode === "string" && config.mode.length > 0) {
        resolvedMode = config.mode;
      }
    },

    resolveId(id: string): string | null {
      if (id.includes("?mix-css")) {
        const wantScoped = id.includes("scoped=1");
        return normPath(id.split("?")[0]!) + (wantScoped ? "?mix-css=1&scoped=1" : "?mix-css=1");
      }
      return null;
    },

    load(id: string): string | null {
      if (id.includes("?mix-css")) {
        const file = normPath(id.split("?")[0]!);
        const css = id.includes("scoped=1") ? scopedCssMap.get(file) : cssMap.get(file);
        return css ?? "";
      }
      return null;
    },

    invalidate(file: string): void {
      const normalized = normPath(file);
      cssMap.delete(normalized);
      scopedCssMap.delete(normalized);
    },

    handleHotUpdate(ctx: {
      file: string;
      server: {
        moduleGraph: {
          getModuleById: (id: string) => unknown;
          invalidateModule: (mod: unknown) => void;
        };
      };
      modules: readonly unknown[];
    }) {
      const file = normPath(ctx.file);
      if (file.endsWith(".mix") || file.endsWith(".tix")) {
        cssMap.delete(file);
        scopedCssMap.delete(file);
        const virtualCssId = normPath(file) + "?mix-css=1";
        const cssMod = ctx.server.moduleGraph.getModuleById(virtualCssId);
        if (cssMod) {
          ctx.server.moduleGraph.invalidateModule(cssMod);
          return [...ctx.modules, cssMod];
        }
      }
      return ctx.modules;
    },

    transform(code: string, id: string, transformOptions?: { ssr?: boolean }) {
      const [rawFilename] = id.split("?");
      if (!rawFilename || (!rawFilename.endsWith(".mix") && !rawFilename.endsWith(".tix"))) {
        return null;
      }
      const filename = normPath(rawFilename);

      const readExternalStyle = (relPath: string, fromFile?: string): string => {
        const baseDir =
          fromFile && path.isAbsolute(fromFile)
            ? path.dirname(fromFile)
            : fromFile
              ? path.dirname(path.resolve(path.dirname(filename), fromFile))
              : path.dirname(filename);
        const resolved = path.resolve(baseDir, relPath);
        return fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf-8") : "";
      };

      const ast = parse(code, { filename, readFile: (rel) => readExternalStyle(rel) });
      const descriptor = analyze(ast, { filename, source: code });
      const isDev = process.env.NODE_ENV !== "production";
      const hmr = options.hmr ?? (isDev && !transformOptions?.ssr);

      const codegenOptions: CodegenOptions & { mode?: string } = {
        filename,
        source: code,
        runtimeImportPath: options.runtimeImportPath ?? "@dotmix/runtime",
        hmr,
        mode: resolvedMode,
        resolveStyle: (src: string, fromFile: string) => readExternalStyle(src, fromFile)
      };
      const result: CodegenResult = generate(descriptor, codegenOptions);

      let finalCode = result.code;
      let finalMap = result.map;

      // Extract Scoped CSS into virtual CSS module (composing source map line offset).
      // In dev/HMR mode, emit global stylesheet imports as real ES module imports in their exact
      // source order so browser DFS evaluation deduplicates them at their first import position (D-190 B1).
      const componentScopedCss =
        result.css !== undefined && result.globalCss !== undefined
          ? result.css.slice(result.globalCss.length).trim()
          : result.globalCss !== undefined
            ? ""
            : (result.css ?? "");

      if (result.css) {
        cssMap.set(filename, result.css);
        scopedCssMap.set(filename, componentScopedCss);
      }

      if (hmr) {
        const orderedSpecs = ast.script
          ? listOrderedImportSpecifiers(ast.script.content, ast.script.lang === "ts" || filename.endsWith(".tix"))
          : [];
        const styleEdits = buildDevGlobalStyleImportEdits(finalCode, orderedSpecs);
        if (styleEdits.length > 0) {
          if (finalMap) {
            finalMap = shiftMapThroughEdits(finalMap, finalCode, styleEdits);
          }
          finalCode = applyTextEdits(finalCode, styleEdits);
        }
        if (componentScopedCss.length > 0) {
          const hasGlobal = result.globalCss !== undefined && result.globalCss.length > 0;
          const scopedQuery = hasGlobal ? "?mix-css=1&scoped=1" : "?mix-css=1";
          const scopedImportPrefix = `import ${JSON.stringify(`${filename}${scopedQuery}`)};\n`;
          if (finalMap) {
            finalMap = shiftMapThroughEdits(finalMap, finalCode, [
              { start: 0, end: 0, text: scopedImportPrefix }
            ]);
          }
          finalCode = scopedImportPrefix + finalCode;
        }
      } else if (result.css) {
        const cssImportPrefix = `import ${JSON.stringify(`${filename}?mix-css=1`)};\n`;
        if (finalMap) {
          finalMap = shiftMapThroughEdits(finalMap, finalCode, [
            { start: 0, end: 0, text: cssImportPrefix }
          ]);
        }
        finalCode = cssImportPrefix + finalCode;
      }

      return {
        code: finalCode,
        map: finalMap,
      };
    },
  };
}

export default mix;

