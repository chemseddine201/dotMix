/**
 * Module hooks that `mix test` loads into the Node test runner.
 *
 * Project tests import TypeScript modules with NodeNext `.js` specifiers
 * (`import { x } from "../src/x.js"` for `src/x.ts`). Node cannot run those on its own, so:
 * - `resolve` maps a missing `.js` / `.mjs` file to the `.ts` / `.mts` source next to it;
 * - `load` compiles `.ts` / `.mts` sources with the toolchain's TypeScript transpiler.
 * No extra package is involved; the transpiler comes from `@dotmix/compiler-semantic`.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { LoadHook, ResolveHook } from "node:module";

const COMPILED_EXTENSION_TO_SOURCE: ReadonlyArray<readonly [string, string]> = [
  [".js", ".ts"],
  [".mjs", ".mts"]
];

type TranspileSourceModule = (sourceCode: string, isTypeScript: boolean) => string;
let transpilerPromise: Promise<TranspileSourceModule> | null = null;

/** The TypeScript transpiler is loaded on the first `.ts` module only, so plain JS test runs stay fast. */
function loadTranspiler(): Promise<TranspileSourceModule> {
  transpilerPromise ??= import("@dotmix/compiler-semantic").then((semantic) => semantic.transpileSourceModule);
  return transpilerPromise;
}

function isModuleNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND";
}

function isFileSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/") || specifier.startsWith("file:");
}

/** Returns the URL of the TypeScript source for a compiled-file URL that does not exist, or null. */
export function findTypeScriptSource(compiledUrl: URL): URL | null {
  if (compiledUrl.protocol !== "file:") return null;
  for (const [compiledExtension, sourceExtension] of COMPILED_EXTENSION_TO_SOURCE) {
    if (!compiledUrl.pathname.endsWith(compiledExtension)) continue;
    const sourceUrl = new URL(compiledUrl.href);
    sourceUrl.pathname = `${compiledUrl.pathname.slice(0, -compiledExtension.length)}${sourceExtension}`;
    return fs.existsSync(fileURLToPath(sourceUrl)) ? sourceUrl : null;
  }
  return null;
}

export function isTypeScriptSourceUrl(url: string): boolean {
  if (!url.startsWith("file:")) return false;
  const pathname = new URL(url).pathname;
  return pathname.endsWith(".ts") || pathname.endsWith(".mts");
}

export const resolve: ResolveHook = async (specifier, context, nextResolve) => {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!isModuleNotFound(error) || !isFileSpecifier(specifier) || context.parentURL === undefined) throw error;
    const sourceUrl = findTypeScriptSource(new URL(specifier, context.parentURL));
    if (sourceUrl === null) throw error;
    return { url: sourceUrl.href, format: "module", shortCircuit: true };
  }
};

export const load: LoadHook = async (url, context, nextLoad) => {
  if (!isTypeScriptSourceUrl(url)) return nextLoad(url, context);
  const transpileSourceModule = await loadTranspiler();
  const source = fs.readFileSync(fileURLToPath(url), "utf-8");
  return { format: "module", source: transpileSourceModule(source, true), shortCircuit: true };
};
