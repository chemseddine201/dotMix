# Specification Status

**Baseline:** Mix / Tix Language Specification & Architecture Review  
**Status:** All Specifications Implemented & Verified (1.0.0-rc.1 API Surface Freeze). All normative contracts for decisions D-101 through D-111 are implemented, tested, and validated.

| Document | Purpose | Implementation Status |
|---|---|---|
| [`LANGUAGE.md`](file:///G:/xampp-httpdocs/mix-framework/spec/LANGUAGE.md) | Syntax, grammar, `.mix` vs `.tix`, `<{~expr}>` DynamicElement grammar, expression boundaries | Implemented & Verified (D-105) |
| [`AST.md`](file:///G:/xampp-httpdocs/mix-framework/spec/AST.md) | AST node model, source spans, immutable tree invariants | Implemented & Verified (D-105, D-106) |
| [`SEMANTICS.md`](file:///G:/xampp-httpdocs/mix-framework/spec/SEMANTICS.md) | Evaluation, scopes, reactivity, deferred rerun scheduler, cycle detection, owner lifecycle, keyed lists | Implemented & Verified (D-101, D-102, D-106, D-110) |
| [`RUNTIME_API.md`](file:///G:/xampp-httpdocs/mix-framework/spec/RUNTIME_API.md) | Runtime contracts, reactive primitives, `createRoot` with `detachedParent`, platform-neutral cancellation, sanitizer interface | Implemented & Verified (D-101 to D-104, D-109, D-111) |
| [`CSS_SCOPING.md`](file:///G:/xampp-httpdocs/mix-framework/spec/CSS_SCOPING.md) | Scoped CSS, static at-rule rejection (`@import`), runtime dynamic style validation | Implemented & Verified (D-108) |
| [`DIAGNOSTICS.md`](file:///G:/xampp-httpdocs/mix-framework/spec/DIAGNOSTICS.md) | Diagnostic codes, 1:1 bidirectional source span mapping, HMR method scope | Implemented & Verified (D-106, D-110, D-111) |
| [`SECURITY.md`](file:///G:/xampp-httpdocs/mix-framework/spec/SECURITY.md) | Threat model, normative WHATWG `srcset` algorithm, CSS injection defense, trusted HTML boundary | Implemented & Verified (D-107 to D-109) |
| [`TESTING.md`](file:///G:/xampp-httpdocs/mix-framework/spec/TESTING.md) | Conformance test strategy, vertical-slice verification, edge-case test matrices | Implemented & Verified |
| [`PERFORMANCE.md`](file:///G:/xampp-httpdocs/mix-framework/spec/PERFORMANCE.md) | Benchmarking methodology, memory invariants, reconciliation performance targets | Implemented & Verified (100% Targets Met) |
| [`COMPATIBILITY.md`](file:///G:/xampp-httpdocs/mix-framework/spec/COMPATIBILITY.md) | Supported JS engines (Node.js 24 LTS baseline, Node.js 26 forward compatibility), browser baseline | Implemented & Verified |
