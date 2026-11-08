// packages/runtime/src/core/errors.ts — FROZEN per MIX_SPEC_v3.2.2 §1.5

export const MIX_ERROR_CODES = [
  "MIX_RT_CYCLE",
  "MIX_RT_WRITE_IN_COMPUTED",
  "MIX_RT_EFFECT_LOOP",
  "MIX_RT_OWNER_IN_COMPUTED",
  "MIX_RT_NO_OWNER",
  "MIX_RT_ERROR_HANDLER_FAILED",
  "MIX_RT_ABORTED",
  "MIX_RT_DISPOSED",
  "MIX_RT_SUPERSEDED",
  "MIX_RT_DUPLICATE_KEY",
  "MIX_SYN_EXPR_INVALID",
  "MIX_SYN_EXPR_UNTERMINATED",
  "MIX_SYN_DYNAMIC_CLOSE_MISMATCH",
  "MIX_RES_TIX_EXTENSION_REQUIRED",
  "MIX_INTERNAL_TYPECHECK",
  "MIX_SEC_UNSAFE_URL",
  "MIX_SEC_INSECURE_STATIC_STYLE",
  "MIX_SEC_INSECURE_DYNAMIC_STYLE",
  "MIX_SEC_INVALID_STYLE_PROPERTY",
  "MIX_SEC_MISSING_SANITIZER",
  "MIX_SEC_SANITIZER_INVALID_RESULT",
  "MIX_SEC_SANITIZER_SUSPICIOUS",
  "MIX_SEC_HTML_CONTEXT",
  "MIX_SEC_TRUSTED_TYPES_POLICY",
  "MIX_SEC_FOREIGN_TRUSTED_HTML",
  "MIX_HMR_REMOUNT",
  "MIX_HMR_APPLY_FAILED"
] as const;

export type MixErrorCode = (typeof MIX_ERROR_CODES)[number];

export class MixError extends Error {
  readonly code: MixErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: MixErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    options?: { cause?: unknown }
  ) {
    super(message ? `${code}: ${message}` : code, options);
    this.name = "MixError";
    this.code = code;
    this.details = details ? Object.freeze({ ...details }) : undefined;
  }
}

