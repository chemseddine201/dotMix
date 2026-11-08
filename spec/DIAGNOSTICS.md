# Diagnostics Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Diagnostics Specification (Reconciled Phase Gate 1 & Gate 2)  
**Package:** `@mix/diagnostics` and `@mix/compiler-semantic`  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Diagnostic Data Model

Defined in the dedicated zero-dependency leaf package `@mix/diagnostics`:

```ts
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly code: DiagnosticCode | string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly span: SourceSpan;
  readonly notes?: readonly string[];
}
```

---

## 2. `.tix` Virtual Projection & `SourceMapSpanTable` (`D-106`, `R-SP-01`..`R-SP-05`)

When `@mix/compiler-semantic` projects a `.tix` component into a virtual `.tix.ts` file for verification by the TypeScript `6.0.3` Compiler API:

```ts
export type SpanKind = "verbatim" | "origin" | "internal";

export interface SpanEntry {
  readonly genStart: number;
  readonly genEnd: number;
  readonly srcStart: number;
  readonly srcEnd: number;
  readonly kind: SpanKind;
}
```

1. **`verbatim` (`R-SP-01`):** User code copied verbatim with identical byte/character length (`genEnd - genStart === srcEnd - srcStart`). Diagnostics map with character-exact precision: `srcOffset = srcStart + (genOffset - genStart)`.
2. **`origin` (`R-SP-02`):** Compiler-emitted verification code (such as `VerifyProps` or `VerifyRef` calls) tied to a specific template element, component call, or attribute span `[srcStart, srcEnd]`.
3. **`internal` (`R-SP-03`, `R-SP-04`):** Synthetic preamble/wrapper code with no user source origin. If a TypeScript diagnostic ever falls purely within an `internal` span, it is reported as `MIX_INTERNAL_TYPECHECK` rather than blaming user source coordinates.
4. **Full Coverage Invariant (`R-SP-05`):** Every character offset in `[0, projectedSource.length)` is covered by exactly one non-overlapping `SpanEntry`.

---

## 3. Canonical Diagnostic Codes Registry

| Diagnostic Code | Severity | Description | Reconciled Contract |
|---|---|---|---|
| `MIX_ERR_PARSE_SYNTAX` | Error | Lexical, expression boundary, or syntax error in `.mix` / `.tix` | `D-105`, `R-SYN-01` |
| `MIX_ERR_UNCLOSED_TAG` | Error | Mismatched or unclosed HTML, component, or `<{~expr}>` tag | `D-105`, `R-SYN-02` |
| `MIX_ERR_CSS_FORBIDDEN_IMPORT` | Error | `@import` rule detected in component `<style>` | `D-108` |
| `MIX_ERR_CSS_FORBIDDEN_CHARSET` | Error | `@charset` rule detected in component `<style>` | `D-108` |
| `MIX_ERR_DUPLICATE_KEY` | Error | Duplicate key encountered during keyed reconciliation | `D-110` / `HAA-02` |
| `MIX_ERR_UNRESOLVED_IDENTIFIER`| Error | Variable or function reference cannot be resolved in scope | Core Semantics |
| `MIX_ERR_INVALID_PROP_TYPE` | Error | `.tix` prop, ref, or import extension violates typecheck contract | `D-106`, `R-TC-01..03` |
| `MIX_INTERNAL_TYPECHECK` | Error | Internal `.tix` projection diagnostic fell in synthetic wrapper | `D-106`, `R-SP-04` |
| `MIX_ERR_REACTIVE_CYCLE` | Error | Runaway reactive cycle or illegal signal write inside `computed` | `D-101`, `I-5` |
| `MIX_SEC_FOREIGN_TRUSTED_HTML` | Error | Raw or unverified HTML object passed to `mix-html` sink | `D-109` / `HAA-03` |
| `MIX_SEC_HTML_CONTEXT` | Error | Trusted HTML injected into forbidden element (`<script>`, `<iframe>`) | `D-109`, `R-HTML-04` |
| `MIX_SEC_CSS_PROPERTY` | Error | Dynamic style property/value or URL violates security policy | `D-108`, `R-CSS-01..05` |
| `MIX_SEC_UNSAFE_URL` | Error | Unsafe URL protocol (`javascript:`, `vbscript:`, `data:image/svg+xml`) | `D-107`, `R-URL-01` |
| `MIX_WARN_HMR_STALE_CLOSURE` | Warning | Method detected capturing unstabilized lexical closure | `D-111` |
