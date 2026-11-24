/**
 * @dotmix/vite-plugin — Vite / Rollup plugin for Mix/Tix compiler
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@dotmix/compiler-frontend";
import { analyze, shiftMapThroughEdits } from "@dotmix/compiler-semantic";
import { generate, type CodegenOptions, type CodegenResult } from "@dotmix/compiler-codegen";

export interface MixPluginOptions {
  runtimeImportPath?: string;
  hmr?: boolean;
  mode?: string;
}

export function mix(options: MixPluginOptions = {}) {
  const cssMap = new Map<string, string>();
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
        return normPath(id.split("?")[0]!) + "?mix-css=1";
      }
      return null;
    },

    load(id: string): string | null {
      if (id.includes("?mix-css")) {
        const file = normPath(id.split("?")[0]!);
        const css = cssMap.get(file);
        return css ?? "";
      }
      return null;
    },

    invalidate(file: string): void {
      cssMap.delete(normPath(file));
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

      // Extract Scoped CSS into virtual CSS module (composing source map line offset)
      if (result.css) {
        cssMap.set(filename, result.css);
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

