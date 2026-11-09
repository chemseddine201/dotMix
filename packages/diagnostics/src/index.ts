/**
 * @mix/diagnostics — Common zero-dependency diagnostic error classes, codes, and spans.
 */

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface SourceSpan {
  readonly start: SourceLocation;
  readonly end: SourceLocation;
  readonly file?: string;
}

export const DiagnosticCodes = {
  MIX_ERR_PARSE_SYNTAX: "MIX_ERR_PARSE_SYNTAX",
  MIX_ERR_UNCLOSED_TAG: "MIX_ERR_UNCLOSED_TAG",
  MIX_ERR_CSS_FORBIDDEN_IMPORT: "MIX_ERR_CSS_FORBIDDEN_IMPORT",
  MIX_ERR_CSS_FORBIDDEN_CHARSET: "MIX_ERR_CSS_FORBIDDEN_CHARSET",
  MIX_ERR_DUPLICATE_KEY: "MIX_ERR_DUPLICATE_KEY",
  MIX_ERR_UNRESOLVED_IDENTIFIER: "MIX_ERR_UNRESOLVED_IDENTIFIER",
  MIX_ERR_INVALID_PROP_TYPE: "MIX_ERR_INVALID_PROP_TYPE",
  MIX_INTERNAL_TYPECHECK: "MIX_INTERNAL_TYPECHECK",
  MIX_ERR_REACTIVE_CYCLE: "MIX_ERR_REACTIVE_CYCLE",
  MIX_SEC_FOREIGN_TRUSTED_HTML: "MIX_SEC_FOREIGN_TRUSTED_HTML",
  MIX_SEC_HTML_CONTEXT: "MIX_SEC_HTML_CONTEXT",
  MIX_SEC_CSS_PROPERTY: "MIX_SEC_CSS_PROPERTY",
  MIX_SEC_UNSAFE_URL: "MIX_SEC_UNSAFE_URL",
  MIX_WARN_HMR_STALE_CLOSURE: "MIX_WARN_HMR_STALE_CLOSURE",
  MIX_SSR_HYDRATION_MISMATCH: "MIX_SSR_HYDRATION_MISMATCH",
  MIX_ERR_PREPROCESSOR_MISSING: "MIX_ERR_PREPROCESSOR_MISSING",
  MIX_ERR_ASYNC_RULE_IN_SYNC_CHECK: "MIX_ERR_ASYNC_RULE_IN_SYNC_CHECK",
  MIX_WARN_LEGACY_CONTROL_FLOW: "MIX_WARN_LEGACY_CONTROL_FLOW",
  MIX_ERR_JSX_LOGICAL_EXPRESSION: "MIX_ERR_JSX_LOGICAL_EXPRESSION"
} as const;

export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];

export interface Diagnostic {
  readonly code: DiagnosticCode | string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly span: SourceSpan;
  readonly notes?: readonly string[];
}

export class MixError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = "MixError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class MixDiagnosticError extends MixError {
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.code, diagnostic.message);
    this.name = "MixDiagnosticError";
    this.diagnostic = diagnostic;
  }
}

export function formatDiagnosticCodeFrame(source: string, span: SourceSpan): string {
  const line = span.start.line;
  const col = span.start.column;
  const lines = source.split(/\r?\n/);
  const lineText = lines[line - 1] ?? "";
  const width =
    span.end.line === span.start.line
      ? Math.max(1, span.end.column - span.start.column)
      : 1;
  const caret = " ".repeat(Math.max(0, col - 1)) + "^".repeat(width);
  return `  ${line} | ${lineText}\n    | ${caret}`;
}
