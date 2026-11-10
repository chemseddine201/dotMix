/**
 * @mix/vite-plugin — Vite / Rollup plugin for Mix/Tix compiler
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@mix/compiler-frontend";
import { analyze } from "@mix/compiler-semantic";
import { generate, type CodegenResult } from "@mix/compiler-codegen";

export interface MixPluginOptions {
  runtimeImportPath?: string;
  hmr?: boolean;
}

export function mix(options: MixPluginOptions = {}) {
  const cssMap = new Map<string, string>();
  const normPath = (p: string): string => p.replace(/\\/g, "/");

  return {
    name: "mix",
    enforce: "pre" as const,

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

      const result: CodegenResult = generate(descriptor, {
        filename,
        runtimeImportPath: options.runtimeImportPath ?? "@mix/runtime",
        hmr,
        resolveStyle: (src: string, fromFile: string) => readExternalStyle(src, fromFile)
      });

      let finalCode = result.code;

      // Extract Scoped CSS into virtual CSS module
      if (result.css) {
        cssMap.set(filename, result.css);
        finalCode = `import ${JSON.stringify(`${filename}?mix-css=1`)};\n` + finalCode;
      }

      // HMR acceptance block (D-111)
      if (hmr) {
        finalCode += `
if (import.meta.hot) {
  import.meta.hot.accept();
}
`;
      }

      return {
        code: finalCode,
        map: result.map,
      };
    },
  };
}

export default mix;

