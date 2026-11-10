/**
 * @mix/compiler-codegen/types — Public codegen options, result interfaces, runtime import list, and string helpers.
 */

import type { SourceMapV3 } from "@mix/compiler-semantic";

export interface CodegenOptions {
  filename?: string;
  componentName?: string;
  runtimeImportPath?: string;
  sourceMap?: boolean;
  hmr?: boolean;
  scopeId?: string;
  resolveStyle?: (src: string, fromFile: string) => string;
}

export interface CodegenResult {
  readonly js: string;
  readonly code: string;
  readonly css?: string;
  readonly scopeId?: string;
  readonly scopeAttribute?: string;
  readonly map?: SourceMapV3;
  readonly styleDependencies?: readonly string[];
}

export const AUTO_IMPORTABLE_RUNTIME_PRIMITIVES = [
  "signal",
  "computed",
  "createEffect",
  "batch",
  "onCleanup",
  "createRoot",
  "createRef",
  "defineProps",
  "createCancellationSource",
  "createResource",
  "createContext",
  "useContext",
  "provideContext",
  "setContext",
  "getContext",
  "createTrustedHtml",
  "setSanitizerProvider"
] as const;

export function sanitizeComponentIdentifier(rawName: string): string {
  const base = rawName
    .replace(/^.*[/\\]/, "")
    .replace(/\.(mix|tix|js|ts)$/i, "")
    .replace(/[^A-Za-z0-9_$]/g, "_");
  if (!base || /^[0-9]/.test(base)) {
    return `MixComponent_${base || "Anonymous"}`;
  }
  return base[0]!.toUpperCase() + base.slice(1);
}

export function indentLines(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim().length > 0 ? pad + line : ""))
    .join("\n");
}
