# Diagnostics Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Diagnostics Specification (Reconciled Phase Gate 1)  
**Package:** `@mix/diagnostics` and `@mix/compiler-semantic`  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Diagnostic Data Model

Defined in the dedicated leaf package `@mix/diagnostics`:

```ts
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly span: SourceSpan;
  readonly notes?: readonly string[];
}
```

---

## 2. 1:1 Bidirectional Source Span Mapping (D-106)

When the compiler generates intermediate TypeScript code for `.tix` type verification (e.g. `VerifyProps`, `VerifyRef` projections):

1. **Mapping Invariant:** Every token in the projected TypeScript virtual file maintains an exact bidirectional span mapping back to the original `.tix` template.
2. **Diagnostic Translation:** TypeScript compiler diagnostics emitted on projected virtual files are translated to point directly to the user's template attribute, tag, or interpolation. Errors must **never** silently point to synthetic wrapper code or fake line numbers.

---

## 3. Canonical Diagnostic Codes Registry

| Diagnostic Code | Severity | Description | Reconciled Contract |
|---|---|---|---|
| `MIX_ERR_PARSE_SYNTAX` | Error | Lexical or syntax error in `.mix` / `.tix` template markup | D-105 |
| `MIX_ERR_UNCLOSED_TAG` | Error | Mismatched or unclosed element/dynamic element tag | D-105 |
| `MIX_ERR_CSS_FORBIDDEN_IMPORT` | Error | `@import` rule detected in component `<style>` | D-108 |
| `MIX_ERR_CSS_FORBIDDEN_CHARSET` | Error | `@charset` rule detected in component `<style>` | D-108 |
| `MIX_ERR_DUPLICATE_KEY` | Error | Duplicate key encountered during keyed reconciliation | D-110 / HAA-02 |
| `MIX_ERR_UNRESOLVED_IDENTIFIER`| Error | Variable or function reference cannot be resolved in scope | Core |
| `MIX_ERR_INVALID_PROP_TYPE` | Error | Component prop passed does not match interface contract | D-106 |
| `MIX_ERR_REACTIVE_CYCLE` | Error | Runaway reactive cycle exceeds iteration ceiling | D-101 |
| `MIX_SEC_FOREIGN_TRUSTED_HTML` | Error | Raw unverified HTML passed to `mix-html` sink | D-109 / HAA-03 |
| `MIX_SEC_HTML_CONTEXT` | Error | Trusted HTML injected into forbidden context (`<script>`, `<iframe>`)| D-109 |
| `MIX_SEC_CSS_PROPERTY` | Error | Dynamic style property name violates identifier grammar | D-108 |
| `MIX_WARN_HMR_STALE_CLOSURE` | Warning | Method detected capturing unstabilized lexical closure | D-111 |
