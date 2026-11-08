# Implementation Roadmap

## Phase 0 — Foundation and readiness
Repository scaffold, spec inventory, decision register, and agent audit. No compiler/runtime implementation.  
**Status: ACCEPTED** by Human Architecture Authority (2026-11-08).

## Phase 1 — Contracts, Toolchain, and Minimal End-to-End Vertical Slice
- Reconcile and import canonical specification text into `spec/*.md` based on approved decisions D-101 through D-111 in `DECISIONS.md`.
- Establish toolchain baseline: Node.js 24 LTS baseline, verified compatibility with Node.js 26 LTS, and Compiler API evaluation for TypeScript 7.0.2.
- Implement the minimal, genuinely end-to-end vertical slice spanning the complete pipeline:
  `source -> parser -> AST -> semantic binding -> codegen -> runtime -> DOM update -> disposal`.
- The vertical slice tests the smallest viable component (single element with one reactive signal and text interpolation) to prove architectural integrity without implementing the full language surface prematurely.

**Phase 1 Gate:** Human approval of corrected specifications, toolchain compatibility report, and explicit vertical-slice acceptance test plan.

## Phase 2 — Core language and compiler pipeline
- Implement comprehensive AST nodes and visitor infrastructure in `@mix/ast`.
- Lexical and markup frontend (`@mix/compiler-frontend`) for full `.mix` and `.tix` grammar, including `<{~expr}>` DynamicElement and embedded expression boundary extraction.
- Semantic analysis (`@mix/compiler-semantic`): Scope trees, symbol resolution, component props inference, type projection, and bidirectional diagnostic span mapping.
- CSS compiler (`@mix/compiler-css`): Scoped CSS transform, at-rule rejection (`@import`), and dynamic style analysis.
- Deterministic direct-DOM code generator (`@mix/compiler-codegen`).

**Phase 2 Gate:** Conformance suite for all supported syntax and explicit diagnostics for unsupported syntax.

## Phase 3 — Runtime and DOM integration
- Reactive core (`@mix/runtime`): Pull-Push reactivity, signal graph, deferred rerun scheduler with cycle detection, owner/computation lifecycle separation, and `createRoot` with `detachedParent`.
- Platform-neutral resource cancellation and generation tokens.
- Keyed list reconciliation with deterministic duplicate-key handling and atomic batching.
- Browser DOM adapter: Direct DOM ops, event delegation, and lifecycle unmount hooks.

**Phase 3 Gate:** Runtime and integration test suite demonstrating zero memory leaks and clean disposal across all lifecycles.

## Phase 4 — CSS, security, and production hardening
- Dynamic CSS validation: Property allowlists, CSS escape decoding, and safe URL protocol validation.
- Normative WHATWG `srcset` parsing implementation and test vectors.
- Trusted HTML security boundary: `SanitizerProvider` interface and native Trusted Types policy integration.

**Phase 4 Gate:** Security test suite passing with full threat model coverage.

## Phase 5 — Developer experience
- Compiler CLI and bundler plugins.
- Stable scope HMR method dispatch with verified live-state preservation.
- Source maps and rich diagnostic formatting.
- Performance benchmarks and reproducible metrics.

**Phase 5 Gate:** Reproducible build/test workflows, verified benchmarks, and complete diagnostic coverage.

## Phase 6 — Stabilization
- Ecosystem compatibility and browser conformance matrix.
- Documentation, API surface freeze, release candidate packaging.

## Phase discipline
- One phase at a time.
- No automatic phase advancement.
- Keep pull requests/changes small, isolated, and reviewable.
- No performance claims without reproducible benchmark data.
- Do not implement features ahead of their designated phase.
