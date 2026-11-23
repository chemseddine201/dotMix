/**
 * @dotmix/diagnostics — Common zero-dependency diagnostic error classes, codes, and spans.
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
  MIX_ERR_JSX_LOGICAL_EXPRESSION: "MIX_ERR_JSX_LOGICAL_EXPRESSION",
  MIX_ERR_DIRECTIVE_ORPHAN_BRANCH: "MIX_ERR_DIRECTIVE_ORPHAN_BRANCH",
  MIX_ERR_DIRECTIVE_BRANCH_ORDER: "MIX_ERR_DIRECTIVE_BRANCH_ORDER",
  MIX_ERR_DIRECTIVE_ELSE_CONFLICT: "MIX_ERR_DIRECTIVE_ELSE_CONFLICT",
  MIX_ERR_DIRECTIVE_NOT_COMPILED: "MIX_ERR_DIRECTIVE_NOT_COMPILED",
  MIX_ERR_SWITCH_CASE_FORM: "MIX_ERR_SWITCH_CASE_FORM",
  MIX_ERR_SWITCH_STRAY_CONTENT: "MIX_ERR_SWITCH_STRAY_CONTENT",
  MIX_ERR_SWITCH_DEFAULT_ORDER: "MIX_ERR_SWITCH_DEFAULT_ORDER",
  MIX_ERR_LOOP_CONTROL_POSITION: "MIX_ERR_LOOP_CONTROL_POSITION",
  MIX_ERR_FOR_STEP_ZERO: "MIX_ERR_FOR_STEP_ZERO",
  MIX_ERR_FOR_RANGE_TOO_LARGE: "MIX_ERR_FOR_RANGE_TOO_LARGE",
  MIX_ERR_AUTH_PROVIDER_MISSING: "MIX_ERR_AUTH_PROVIDER_MISSING",
  MIX_ERR_AUTH_ROLE_UNSUPPORTED: "MIX_ERR_AUTH_ROLE_UNSUPPORTED",
  MIX_ERR_ENV_NOT_STATIC: "MIX_ERR_ENV_NOT_STATIC",
  MIX_ERR_FORM_FIELD_UNKNOWN: "MIX_ERR_FORM_FIELD_UNKNOWN",
  MIX_WARN_MEMO_EMPTY_DEPS: "MIX_WARN_MEMO_EMPTY_DEPS",
  MIX_ERR_ONCE_WRITE: "MIX_ERR_ONCE_WRITE",
  MIX_ERR_CONDITIONAL_WITHOUT_BASE: "MIX_ERR_CONDITIONAL_WITHOUT_BASE",
  MIX_ERR_CONDITIONAL_CONFLICT: "MIX_ERR_CONDITIONAL_CONFLICT",
  MIX_ERR_CONDITIONAL_ELSE_ALONE: "MIX_ERR_CONDITIONAL_ELSE_ALONE",
  MIX_WARN_INERT_INTERACTIVE: "MIX_WARN_INERT_INTERACTIVE",
  MIX_ERR_CONFIG_INVALID: "MIX_ERR_CONFIG_INVALID",
  MIX_ERR_IMAGE_PROCESSOR_MISSING: "MIX_ERR_IMAGE_PROCESSOR_MISSING",
  MIX_ERR_STATIC_BUILD: "MIX_ERR_STATIC_BUILD"
} as const;

export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];

export interface DiagnosticMetadata {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly hint: string;
}

export const DIRECTIVE_DIAGNOSTIC_METADATA: Readonly<Record<string, DiagnosticMetadata>> = Object.freeze({
  [DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
    severity: "error",
    message: "Directive branch marker or component used outside its enclosing parent directive.",
    hint: "Place branch directives (<ElseIf>, <Else>, <Empty>, <Case>, <Default>, <ElseCan>) directly inside their matching parent directive."
  }),
  [DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER,
    severity: "error",
    message: "Invalid directive branch ordering: <Else> must appear after all <ElseIf> branches and at most once.",
    hint: "Move <Else> / {else} to the end of the conditional chain and remove duplicate <Else> branches."
  }),
  [DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT,
    severity: "error",
    message: "Directive alternative cannot be specified as both a prop (else/fallback) and a child (<Else>/<Empty>/<ElseCan>).",
    hint: "Keep either the prop form (e.g. else={...} or fallback={...}) or the child branch element, not both."
  }),
  [DiagnosticCodes.MIX_ERR_DIRECTIVE_NOT_COMPILED]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_DIRECTIVE_NOT_COMPILED,
    severity: "error",
    message: "Compile-time directive component from @dotmix/runtime/directives was invoked at runtime without compiler lowering.",
    hint: "Use directive components inside .tix/.mix templates compiled by the Mix compiler, and avoid calling them directly in plain JS/TS."
  }),
  [DiagnosticCodes.MIX_ERR_SWITCH_CASE_FORM]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_SWITCH_CASE_FORM,
    severity: "error",
    message: "Invalid <Case> form: specify exactly one of `is` or `condition`, and do not use `is` when <Switch> has no `on` subject.",
    hint: "Use either <Case is={...}> with <Switch on={...}> or <Case condition={...}>."
  }),
  [DiagnosticCodes.MIX_ERR_SWITCH_STRAY_CONTENT]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_SWITCH_STRAY_CONTENT,
    severity: "error",
    message: "Unexpected content inside switch directive before the first case branch.",
    hint: "Move all template content inside a {case}/{default} or <Case>/<Default> branch."
  }),
  [DiagnosticCodes.MIX_ERR_SWITCH_DEFAULT_ORDER]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_SWITCH_DEFAULT_ORDER,
    severity: "error",
    message: "Switch default branch must be the last branch in the switch directive.",
    hint: "Move {default} / <Default> after all {case} / <Case> branches."
  }),
  [DiagnosticCodes.MIX_ERR_LOOP_CONTROL_POSITION]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_LOOP_CONTROL_POSITION,
    severity: "error",
    message: "{continue if ...} and {break if ...} must appear at the start of an {each} body before any markup.",
    hint: "Move {continue if} and {break if} statements above all elements and text inside {each}."
  }),
  [DiagnosticCodes.MIX_ERR_FOR_STEP_ZERO]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_FOR_STEP_ZERO,
    severity: "error",
    message: "{for} / <For> step value cannot be 0.",
    hint: "Provide a non-zero step value or omit `step` to use the default (+1 or -1)."
  }),
  [DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE,
    severity: "error",
    message: "{for} / <For> range exceeds the maximum allowed 100,000 iterations.",
    hint: "Reduce the loop range or paginate the rendered items."
  }),
  [DiagnosticCodes.MIX_ERR_AUTH_PROVIDER_MISSING]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_AUTH_PROVIDER_MISSING,
    severity: "error",
    message: "Auth directive requires an enclosing <AuthProvider value={auth}>.",
    hint: "Wrap your application root with <AuthProvider value={createAuth(...)}>."
  }),
  [DiagnosticCodes.MIX_ERR_AUTH_ROLE_UNSUPPORTED]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_AUTH_ROLE_UNSUPPORTED,
    severity: "error",
    message: "Auth `role` check requires `hasRole` to be configured on the AuthContract.",
    hint: "Add `hasRole(user, role)` to your `createAuth({ guards, hasRole })` configuration."
  }),
  [DiagnosticCodes.MIX_ERR_ENV_NOT_STATIC]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_ENV_NOT_STATIC,
    severity: "error",
    message: "{env} / <Env is> requires a static string literal or static array of string literals.",
    hint: "Replace dynamic expressions in `is` with static string literals (e.g. is=\"staging\" or is={[\"staging\", \"preview\"]})."
  }),
  [DiagnosticCodes.MIX_ERR_FORM_FIELD_UNKNOWN]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_FORM_FIELD_UNKNOWN,
    severity: "error",
    message: "Form field name does not exist on the referenced FormController schema.",
    hint: "Check the field `name` against the keys defined in `createForm(...)`."
  }),
  [DiagnosticCodes.MIX_WARN_MEMO_EMPTY_DEPS]: Object.freeze({
    code: DiagnosticCodes.MIX_WARN_MEMO_EMPTY_DEPS,
    severity: "warning",
    message: "Memo directive has an empty dependency list.",
    hint: "Use `{once}` or `<Once>` for a static snapshot that never updates."
  }),
  [DiagnosticCodes.MIX_ERR_ONCE_WRITE]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_ONCE_WRITE,
    severity: "error",
    message: "Writing to a reactive signal inside `{once}` / `<Once>` is not allowed.",
    hint: "Move signal writes into event handlers or effects outside `{once}`."
  }),
  [DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE,
    severity: "error",
    message: "Conditional `:if` / `:unless` modifier requires a base attribute or event binding.",
    hint: "Provide the base attribute or event handler alongside the modifier (e.g. title=\"...\" title:if={cond})."
  }),
  [DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT,
    severity: "error",
    message: "Conflicting `:if` and `:unless` modifiers on the same attribute or event.",
    hint: "Use either `:if` or `:unless` (with optional `:else`), not both."
  }),
  [DiagnosticCodes.MIX_ERR_CONDITIONAL_ELSE_ALONE]: Object.freeze({
    code: DiagnosticCodes.MIX_ERR_CONDITIONAL_ELSE_ALONE,
    severity: "error",
    message: "`:else` modifier requires a matching `:if`, `:unless`, or `:match` modifier on the same attribute or event.",
    hint: "Add `:if`, `:unless`, or `:match` for the same name, or remove `:else`."
  }),
  [DiagnosticCodes.MIX_WARN_INERT_INTERACTIVE]: Object.freeze({
    code: DiagnosticCodes.MIX_WARN_INERT_INTERACTIVE,
    severity: "warning",
    message: "Conditional click handler on interactive element without `disabled` or `aria-disabled:unless`.",
    hint: "Add `disabled={!cond}` or `aria-disabled:unless={cond}` so assistive technologies reflect the inactive state."
  })
});

export function getDiagnosticMetadata(code: string): DiagnosticMetadata | undefined {
  return DIRECTIVE_DIAGNOSTIC_METADATA[code];
}

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
  const lineNumStr = String(line);
  const pad = " ".repeat(lineNumStr.length);
  const caret = " ".repeat(Math.max(0, col - 1)) + "^".repeat(width);
  return `  ${lineNumStr} | ${lineText}\n  ${pad} | ${caret}`;
}

export function formatCliDiagnostic(diagnostic: Diagnostic, source?: string): string {
  const prefix =
    diagnostic.severity === "error"
      ? "ERROR"
      : diagnostic.severity === "warning"
        ? "WARN"
        : "INFO";
  const file = diagnostic.span.file || "<anonymous>";
  const loc = `${file}:${diagnostic.span.start.line}:${diagnostic.span.start.column}`;
  const parts: string[] = [
    `[${prefix}] ${diagnostic.code} at ${loc}: ${diagnostic.message}`
  ];

  if (source && diagnostic.span.start.line >= 1) {
    parts.push(formatDiagnosticCodeFrame(source, diagnostic.span));
  }

  if (diagnostic.notes && diagnostic.notes.length > 0) {
    for (const note of diagnostic.notes) {
      parts.push(`  Hint: ${note}`);
    }
  }

  parts.push(`  Docs: https://dotmix.dev/docs/errors#${diagnostic.code}`);
  return parts.join("\n");
}
