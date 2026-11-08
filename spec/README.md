# Specification Set

These documents contain the canonical language, compiler, runtime, and security contracts for Mix / Tix.

Following the Phase 0 audit and human architecture authority review, all open decisions (D-101 through D-111) have been formally reconciled into their corresponding specification documents:

- [`LANGUAGE.md`](./LANGUAGE.md): Grammar, `.mix` vs `.tix`, dynamic elements `<{~expr}>`, expression boundaries.
- [`AST.md`](./AST.md): AST node model, source spans, and immutability invariants.
- [`SEMANTICS.md`](./SEMANTICS.md): Pull-Push reactivity, deferred rerun scheduler, cycle detection, owner/computation lifecycles, keyed lists.
- [`RUNTIME_API.md`](./RUNTIME_API.md): Reactive primitives, `createRoot` with `detachedParent`, cancellation, sanitizer interface.
- [`CSS_SCOPING.md`](./CSS_SCOPING.md): Scoped CSS, static at-rule rejection, runtime dynamic CSS validation.
- [`DIAGNOSTICS.md`](./DIAGNOSTICS.md): Diagnostic codes, 1:1 bidirectional source span mapping, HMR method scope.
- [`SECURITY.md`](./SECURITY.md): Threat model, normative WHATWG `srcset` algorithm, CSS injection defense, trusted HTML boundary.
- [`TESTING.md`](./TESTING.md): Conformance test strategy, vertical-slice verification, edge-case test matrices.
- [`PERFORMANCE.md`](./PERFORMANCE.md): Benchmarking methodology, memory invariants, reconciliation performance targets.
- [`COMPATIBILITY.md`](./COMPATIBILITY.md): Supported engines (Node.js 24/26 LTS), browser baseline.
