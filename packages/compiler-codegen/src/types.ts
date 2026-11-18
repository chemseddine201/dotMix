/**
 * @dotmix/compiler-codegen/types — Public codegen options, result interfaces, runtime import list, and string helpers.
 */

import type { SourceMapV3 } from "@dotmix/compiler-semantic";

export interface CodegenOptions {
  filename?: string;
  componentName?: string;
  /**
   * Module specifier of the runtime in the emitted imports, written exactly as given (default
   * "@dotmix/runtime"). Node and browsers identify a module by its resolved URL, so compiled code
   * shares one runtime instance with the host only when this resolves to the same URL the host uses.
   * Keep the bare default for bundlers, import maps and installed projects. To run compiled code
   * from a folder without node_modules, pass the URL Node itself resolves:
   * `import.meta.resolve("@dotmix/runtime")`. Never build it from a file path by hand: path casing
   * (Windows drive letters), symlinks and junctions would give a different URL, and a second runtime.
   */
  runtimeImportPath?: string;
  sourceMap?: boolean;
  source?: string;
  hmr?: boolean;
  mode?: "development" | "production" | string;
  scopeId?: string;
  resolveStyle?: (src: string, fromFile: string) => string;
}

export interface CodegenResult {
  readonly js: string;
  readonly code: string;
  readonly css?: string;
  /**
   * The unscoped part of `css`: stylesheets the component imports other than its own sibling
   * stylesheet (for example `./styles/global.scss`). A build that already ships those files can
   * leave this part out of its merged stylesheet.
   */
  readonly globalCss?: string;
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
  "onMount",
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
