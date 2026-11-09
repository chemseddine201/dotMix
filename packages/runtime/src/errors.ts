/**
 * @mix/runtime/errors — Self-contained runtime MixError class and diagnostic codes.
 *
 * Zero-Dependency Architecture Invariant (HAA-04):
 * Uses `import type` only from @mix/diagnostics. Under `verbatimModuleSyntax: true`,
 * all type references are completely erased at compile time, emitting zero runtime
 * import/require statements and requiring zero bundler.
 */

import type { DiagnosticCode as IDiagnosticCode } from "@mix/diagnostics";

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
} as const satisfies Record<string, IDiagnosticCode>;

export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];

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
