/**
 * @mix/compiler-semantic/types — Public semantic analysis, scope, sourcemap, projection, and typecheck types.
 */

import type { ComponentNode, SourceSpan } from "@mix/ast";
import type { Diagnostic } from "@mix/diagnostics";

export type BindingKind =
  | "signal"
  | "computed"
  | "prop"
  | "ref"
  | "function"
  | "import"
  | "const"
  | "let"
  | "param"
  | "loop";

export interface SymbolBinding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly span: SourceSpan;
  readonly importSource?: string;
}

export interface Scope {
  readonly parent: Scope | null;
  readonly bindings: ReadonlyMap<string, SymbolBinding>;
}

export type SpanKind = "verbatim" | "origin" | "internal";

export interface SpanEntry {
  readonly genStart: number;
  readonly genEnd: number;
  readonly srcStart: number;
  readonly srcEnd: number;
  readonly kind: SpanKind;
}

export interface SourceMapV3 {
  readonly version: 3;
  readonly file: string;
  readonly sources: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

export interface TypeProjectionResult {
  readonly code: string;
  readonly virtualFilename: string;
  readonly spanTable: readonly SpanEntry[];
  readonly sourceMap: SourceMapV3;
}

export interface ComponentDescriptor {
  readonly ast: ComponentNode;
  readonly filename: string;
  readonly rootScope: Scope;
  readonly signals: readonly string[];
  readonly computeds: readonly string[];
  readonly props: readonly string[];
  readonly refs: readonly string[];
  readonly functions: readonly string[];
  readonly imports: ReadonlyMap<string, string>;
  readonly cssImports?: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly warnings?: readonly Diagnostic[];
}

export interface AnalyzeOptions {
  filename?: string;
  source?: string;
  throwOnError?: boolean;
  warnLegacyControlFlow?: boolean;
}

export interface TypecheckOptions {
  filename?: string;
  baseDir?: string;
  virtualFiles?: Readonly<Record<string, string>>;
  throwOnError?: boolean;
}

export interface TypecheckResult {
  readonly projection: TypeProjectionResult;
  readonly diagnostics: readonly Diagnostic[];
}

export interface SeparatedScriptResult {
  readonly importsCode: string;
  readonly bodyCode: string;
}
