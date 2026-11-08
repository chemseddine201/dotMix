# Diagnostics Specification — Mix & Tix

**Status:** Canonical Diagnostics Specification (Reconciled Phase 1)  
**Package:** `@mix/compiler-semantic`

---

## 1. Diagnostic Data Model

```ts
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly span: SourceSpan;
  readonly notes?: string[];
}
```

---

## 2. 1:1 Bidirectional Source Span Mapping (D-106)

When the compiler generates intermediate TypeScript code for type checking (e.g. `VerifyProps`, `VerifyRef` projections):

1. **Mapping Invariant:** Every token in the projected TypeScript virtual file maintains a bidirectional mapping back to the exact source span in the original `.mix` or `.tix` template.
2. **Diagnostic Translation:** TypeScript compiler diagnostics emitted on projected virtual files are translated to point directly to the user's template attribute, tag, or interpolation. Errors must **never** silently point to arbitrary line numbers or synthetic wrapper code.

---

## 3. Canonical Diagnostic Codes Registry

| Diagnostic Code | Severity | Description | Reconciled Contract |
|---|---|---|---|
| `MIX_ERR_PARSE_SYNTAX` | Error | Lexical or syntax error in `.mix` / `.tix` source | D-105 |
| `MIX_ERR_UNCLOSED_TAG` | Error | Mismatched or unclosed element/dynamic element tag | D-105 |
| `MIX_ERR_CSS_FORBIDDEN_IMPORT` | Error | `@import` rule detected in component `<style>` | D-108 |
| `MIX_ERR_CSS_FORBIDDEN_CHARSET` | Error | `@charset` rule detected in component `<style>` | D-108 |
| `MIX_ERR_DUPLICATE_KEY` | Error | Duplicate key encountered during keyed reconciliation | D-110 |
| `MIX_ERR_UNRESOLVED_IDENTIFIER`| Error | Variable or function reference cannot be resolved | Core |
| `MIX_ERR_INVALID_PROP_TYPE` | Error | Component prop passed does not match interface contract | D-106 |
| `MIX_WARN_HMR_STALE_CLOSURE` | Warning | Method detected capturing unstabilized lexical closure | D-111 |
