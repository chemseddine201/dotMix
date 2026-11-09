/**
 * @mix/vite-plugin — Vite / Rollup plugin for Mix/Tix compiler
 */

import { parse } from "@mix/compiler-frontend";
import { analyze } from "@mix/compiler-semantic";
import { generate, type CodegenResult } from "@mix/compiler-codegen";

export interface MixPluginOptions {
  runtimeImportPath?: string;
  hmr?: boolean;
}

export function mix(options: MixPluginOptions = {}) {
  const cssMap = new Map<string, string>();

  return {
    name: "mix",
    enforce: "pre" as const,

    resolveId(id: string): string | null {
      if (id.includes("?mix-css")) {
        return id;
      }
      return null;
    },

    load(id: string): string | null {
      if (id.includes("?mix-css")) {
        const file = id.split("?")[0]!;
        const css = cssMap.get(file);
        return css ?? "";
      }
      return null;
    },

    transform(code: string, id: string, transformOptions?: { ssr?: boolean }) {
      const [filename] = id.split("?");
      if (!filename || (!filename.endsWith(".mix") && !filename.endsWith(".tix"))) {
        return null;
      }

      const ast = parse(code, { filename });
      const descriptor = analyze(ast, { filename, source: code });
      const isDev = process.env.NODE_ENV !== "production";
      const hmr = options.hmr ?? (isDev && !transformOptions?.ssr);

      const result: CodegenResult = generate(descriptor, {
        filename,
        runtimeImportPath: options.runtimeImportPath ?? "@mix/runtime",
        hmr,
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

