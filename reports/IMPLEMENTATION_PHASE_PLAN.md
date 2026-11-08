# Implementation Phase Plan & Acceptance Criteria

**Audit Date:** 2026-11-08  
**Revised:** 2026-11-08 (Incorporating Human Architecture Authority Review)  
**Auditor:** Antigravity (AI Coding Assistant)  
**Authority:** Human Architecture Authority  
**Task Reference:** Task 8 (`agent/INITIALIZATION_AGENT_TASK.md`)  
**Status:** Implementation Plan Reconciled — Awaiting Human Architecture Authority Approval

---

## 1. Executive Summary

This phased implementation plan provides an executable roadmap strictly aligned with `governance/PHASE_GATES.md` (Gate 0 through Gate 9) and the Human Architecture Authority's guidance:
1. **No Implementation Without Explicit Authorization:** Gate 0 is the current stopping point. Implementation begins only after the Human Architecture Authority explicitly names the authorized phase.
2. **Dedicated Leaf Diagnostics Package in Gate 1:** `@mix/diagnostics` is scaffolded as the zero-dependency leaf package for error types and diagnostic codes, preventing any package dependency inversion.
3. **Atomic Duplicate-Update Rejection in Gate 7:** Keyed reconciliation diffing validates the complete incoming collection upfront and rejects invalid updates atomically without partial DOM or owner mutations.
4. **Application-Controlled Sanitizer Authority in Gate 6:** Resolves the caller-supplied sanitizer loophole; direct HTML sinks accept only instances sanitized through the application-controlled `SanitizerProvider`.
5. **Unmocked Vertical Slice in Gate 5:** Unlike the previous simulated test, Gate 5 enforces genuine end-to-end execution of dynamically imported compiled code in a real DOM environment.

---

## 2. Phase-by-Phase Implementation Specifications

### Phase 1 — Foundation & Canonical Specification Import (Gate 1)
- **Task ID:** `P1-01`
- **Objective:** Establish the clean monorepo workspace, evaluate Node 26 Active LTS / Node 24/22 compatibility and TypeScript 6.0.3, scaffold `@mix/diagnostics`, import canonical specifications with recorded provenance, and establish the CI verification pipeline.
- **Input Contracts:** Approved audit reports, toolchain recommendation (Node 26 / TS 6.0.3), and canonical v3.2.1 source text ratified by the Human Architecture Authority.
- **Expected Output / Files:**
  - `package.json` (evaluated devDependencies, workspaces, engine: `node: ">=22.12.0"`)
  - `package-lock.json` (clean reproducible lockfile with verified `typescript-eslint` peer compatibility)
  - `tsconfig.base.json` (strict, NodeNext, erasableSyntaxOnly, composite)
  - `packages/diagnostics/` (new leaf package: `MixError`, `DiagnosticCode`, `DiagnosticSeverity`, spans)
  - `packages/*/package.json` (clean manifests with zero dependency inversions)
  - `packages/*/tsconfig.json` (composite project references)
  - `spec/*.md` (10 imported canonical specifications)
  - `spec/SOURCE_PROVENANCE.md` (provenance records for each imported document)
  - `.github/workflows/ci.yml` (CI matrix for Node 22, 24, 26)
- **Dependencies:** None.
- **Tests:** `npm run build` (`tsc -b`), `npm run lint`, `npm test` execute cleanly across empty package skeletons.
- **Acceptance Criteria:**
  - Clean `npm ci` succeeds without peer dependency errors or warnings.
  - All package skeletons build with zero errors.
  - No placeholder specification remains in `spec/`.
  - Provenance ledger explicitly records origin, hash, and author for every specification.
- **Risks:** Delay in obtaining canonical v3.2.1 text from project authority.
- **Stop Condition:** Stop immediately upon CI passing. Request human approval for Gate 2.

---

### Phase 2 — Minimal Language Frontend & Parser (Gate 2)
- **Task ID:** `P2-01`
- **Objective:** Build `@mix/ast` and `@mix/compiler-frontend` to lex and parse `.mix` and `.tix` files into immutable ASTs with exact source spans.
- **Input Contracts:** `spec/LANGUAGE.md`, `spec/AST.md`, Charter §4 (dynamic element `<{~expr}>`).
- **Expected Output / Files:**
  - `packages/ast/src/nodes.ts` (immutable AST node interfaces, including `ComponentCallNode`)
  - `packages/ast/src/spans.ts` (SourceLocation, SourceSpan)
  - `packages/compiler-frontend/src/lexer.ts` (token stream)
  - `packages/compiler-frontend/src/scanner.ts` (balanced delimiter state machine)
  - `packages/compiler-frontend/src/parser.ts` (markup and template parsing)
- **Dependencies:** `P1-01`
- **Tests:**
  - `tests/compiler/parser-syntax.test.mjs`
  - Extraction of nested expressions across strings, comments, and regex literals.
  - Parsing `<{~expr}> ... </{~expr}>` dynamic elements and preserving attributes.
  - Detection of unclosed tags and syntax errors with line/column carets.
- **Acceptance Criteria:**
  - Valid fixtures parse into deeply frozen ASTs.
  - Source spans match exact 1-based line and column positions.
  - Zero regex-based heuristic expression splitting.
- **Risks:** Unhandled edge cases in embedded JavaScript expression scanning.
- **Stop Condition:** Stop after all parser tests pass. Request human approval for Gate 3.

---

### Phase 3 — Semantic Analysis & `.tix` Projection (Gate 3)
- **Task ID:** `P3-01`
- **Objective:** Build `@mix/compiler-semantic` to analyze scope trees, resolve signal/variable bindings, and generate `.tix.ts` virtual TypeScript projections with bidirectional source maps.
- **Input Contracts:** `spec/SEMANTICS.md`, `spec/DIAGNOSTICS.md`, D-106.
- **Expected Output / Files:**
  - `packages/compiler-semantic/src/scope.ts` (lexical scope tree)
  - `packages/compiler-semantic/src/symbols.ts` (symbol resolution)
  - `packages/compiler-semantic/src/projection.ts` (virtual TypeScript generator)
  - `packages/compiler-semantic/src/sourcemap.ts` (VLQ source map generator)
  - `packages/compiler-semantic/src/adapters/ts-adapter.ts` (TypeScript Compiler API adapter)
- **Dependencies:** `P2-01`
- **Tests:**
  - `tests/compiler/typecheck-projection.test.mjs`
  - `tests/diagnostics/diagnostics.test.mjs`
  - Scope resolution and undeclared variable error emission.
  - Source map delta accuracy (verifying token offsets map back to original source).
- **Acceptance Criteria:**
  - Symbol table resolves all signal references without using regex word boundaries.
  - TypeScript Compiler API diagnostics map 1:1 back to original `.tix` source spans.
  - TypeScript Compiler API is evaluated on TS 6.0.3 and isolated behind an internal adapter.
- **Risks:** Performance overhead of in-memory TypeScript Compiler API invocations.
- **Stop Condition:** Stop after semantic and projection tests pass. Request human approval for Gate 4.

---

### Phase 4 — Reactive Runtime Core (Gate 4)
- **Task ID:** `P4-01`
- **Objective:** Build `@mix/runtime/core` implementing platform-neutral push-pull reactivity, 5-state scheduler, owner lifecycles, and cancellation tokens.
- **Input Contracts:** `spec/RUNTIME_API.md`, `spec/SEMANTICS.md`, D-101, D-102, D-103, D-104.
- **Expected Output / Files:**
  - `packages/runtime/src/core/types.ts` (ComputationState, OwnerState)
  - `packages/runtime/src/core/reactivity.ts` (signal, computed, createEffect, batch)
  - `packages/runtime/src/core/scheduler.ts` (5-state push-pull queue, independent `pendingRerun`, cycle ceiling)
  - `packages/runtime/src/core/owner.ts` (Owner, onCleanup, createRoot, detachedParent)
  - `packages/runtime/src/core/cancellation.ts` (CancellationToken, generation counter)
- **Dependencies:** `P1-01` (Independent from compiler packages).
- **Tests:**
  - `tests/runtime/rx-reference.test.mjs` (all 12 Appendix C tests)
  - `tests/runtime/scheduler.test.mjs` (diamond graph, non-nested rerun, cycle error)
  - `tests/runtime/owner.test.mjs` (lifecycle, detached roots, cleanup ordering)
  - `tests/runtime/cancellation.test.mjs` (generation tokens, stale async result suppression)
- **Acceptance Criteria:**
  - Zero references to browser DOM types (`Node`, `HTMLElement`, `AbortSignal`) in core.
  - Diamond dependency graph executes exactly once per pull without redundant evaluation.
  - Write during effect schedules non-nested deferred rerun with independent `pendingRerun` flag.
  - Exceeding iteration ceiling throws deterministic `ReactiveCycleError`.
  - Disposed owner unlinks all descendant computations and disposes tokens.
- **Risks:** Memory leaks from un-unlinked observers in complex dynamic computation graphs.
- **Stop Condition:** Stop after all core runtime tests pass. Request human approval for Gate 5.

---

### Phase 5 — Direct DOM Code Generation & Vertical Slice (Gate 5)
- **Task ID:** `P5-01`
- **Objective:** Build `@mix/compiler-codegen` and DOM adapter in `@mix/runtime/dom`, delivering a genuine, unmocked end-to-end vertical slice from `.mix` source to browser DOM operations.
- **Input Contracts:** `governance/PHASE_GATES.md` Gate 5, Architecture Guardrails §F, D-105, D-111.
- **Expected Output / Files:**
  - `packages/compiler-codegen/src/emitter.ts` (direct DOM JS emitter)
  - `packages/runtime/src/dom/adapter.ts` (createElement, createTextNode, setAttribute)
  - `tests/conformance/vertical-slice.test.mjs` (UNMOCKED end-to-end integration test)
- **Dependencies:** `P2-01`, `P3-01`, `P4-01`
- **Tests:**
  - Compile real `.mix` component (illustrative syntax pending canonical `spec/LANGUAGE.md` ratification):
    ```mix
    <script>
      let count = signal(0);
    </script>
    <button @click={() => count.set(c => c + 1)}>Count: {count()}</button>
    ```
  - Dynamically import and execute emitted JavaScript in `happy-dom`.
  - Assert initial mount renders `Count: 0`.
  - Dispatch click event; assert existing text node data updates to `Count: 1` without recreating static DOM.
  - Assert calling owner `dispose()` removes listeners and stops reactivity.
- **Acceptance Criteria (Mandatory 10 Gate 5 Assertions):**
  1. Source compiles through real parser, analyzer, and codegen.
  2. AST inspected and verified.
  3. Signal bindings resolved to symbols.
  4. Generated JS is readable direct DOM calls (no Virtual DOM).
  5. DOM created directly via DOM APIs.
  6. Signal update mutates existing text node (`text.data = ...`).
  7. Static DOM elements are preserved across updates.
  8. Disposal unlinks subscriptions.
  9. Subsequent writes do not execute disposed effects.
  10. Integration test executes actual compiled JS module dynamically.
- **Risks:** Codegen output syntax errors when evaluated by Node ESM loader.
- **Stop Condition:** Stop immediately after vertical slice passes all 10 assertions. Request human review.

---

### Phase 6 — CSS Compilation & Security Subsystem (Gate 6)
- **Task ID:** `P6-01`
- **Objective:** Build `@mix/compiler-css` and security modules in `@mix/runtime/security`, validating CSS scoping, WHATWG `srcset` parsing, zero-dependency CSS escape decoding, and application-controlled Trusted HTML boundaries (D-109).
- **Input Contracts:** `spec/CSS_SCOPING.md`, `spec/SECURITY.md`, D-107, D-108, D-109.
- **Expected Output / Files:**
  - `packages/compiler-css/src/scoper.ts` (CSS AST scoping, :global, :deep)
  - `packages/compiler-css/src/validator.ts` (@import and @charset rejection)
  - `packages/runtime/src/security/srcset.ts` (WHATWG §4.8.4.3.7 parser)
  - `packages/runtime/src/security/style.ts` (zero-dependency escape decoder & property validator)
  - `packages/runtime/src/security/trusted-html.ts` (WeakSet registry, application `SanitizerProvider` authority, Native Trusted Types integration)
- **Dependencies:** `P5-01`
- **Tests:**
  - `tests/security/srcset.test.mjs` (data URLs with commas, irregular whitespace)
  - `tests/security/style.test.mjs` (hex escape sequences `\3b`, unsafe schemes)
  - `tests/security/trusted-html.test.mjs` (unregistered HTML injection throwing security error; verification that arbitrary caller sanitizers cannot bypass authority)
- **Acceptance Criteria:**
  - `@mix/runtime` retains zero external dependencies (no `@csstools/css-tokenizer`).
  - WHATWG srcset parser passes 100% of standard conformance vectors.
  - Direct HTML injection accepts only instances sanitized through the application-controlled `SanitizerProvider` authority or native Trusted Types.
- **Risks:** Missing obscure CSS escape sequences during runtime normalization.
- **Stop Condition:** Stop after security test suite passes. Request human approval for Gate 7.

---

### Phase 7 — Keyed Reconciliation with Atomic Duplicate Rejection (Gate 7)
- **Task ID:** `P7-01`
- **Objective:** Build surgical keyed list reconciliation in `@mix/runtime/dom/reconcile.ts` featuring Longest Increasing Subsequence (LIS) and the ratified **atomic duplicate-update rejection policy** (D-110).
- **Input Contracts:** D-110 ratified policy, `governance/ARCHITECTURE_GUARDRAILS.md` §H.
- **Expected Output / Files:**
  - `packages/runtime/src/dom/reconcile.ts` (LIS diffing, pre-reconciliation validation, atomic rejection)
  - `tests/runtime/dom-keyed.test.mjs` (insert, remove, move, reverse, duplicates)
- **Dependencies:** `P5-01`
- **Tests:**
  - Full permutation diffing (create 1k rows, partial update, swap rows, clear).
  - Pre-validation duplicate fixture: verifies incoming collection with duplicate keys is rejected atomically, previous DOM remains intact, zero DOM or owner nodes are allocated for the invalid collection, and `MIX_ERR_DUPLICATE_KEY` is emitted in both DEV and PROD.
  - Atomic batching: intermediate states are never visible to effects.
- **Acceptance Criteria:**
  - Zero synthetic surrogate fallback keys (`(k, n)`) in both DEV and PROD.
  - Minimal DOM moves via LIS $O(N \log N)$ algorithm.
- **Risks:** Edge cases in LIS index mapping during simultaneous insertions and deletions.
- **Stop Condition:** Stop after keyed reconciliation suite passes. Request human approval for Gate 8.

---

### Phase 8 — Full `.tix` Static Verification (Gate 8)
- **Task ID:** `P8-01`
- **Objective:** Implement complete `.tix` static type checking using the TypeScript Compiler API, verifying component props, ref bindings, and generic interfaces.
- **Input Contracts:** D-106, `spec/DIAGNOSTICS.md`, Project Charter §4.
- **Expected Output / Files:**
  - `packages/compiler-semantic/src/typecheck.ts` (TypeScript checker integration)
  - `packages/runtime/src/typecheck/index.d.ts` (VerifyProps, VerifyRef contracts)
  - `tests/compiler/typecheck-projection.test.mjs`
- **Dependencies:** `P3-01`, `P5-01`
- **Tests:**
  - Invalid prop type produces compile-time diagnostic.
  - Missing mandatory prop produces diagnostic.
  - Diagnostic error spans point directly to template markup tokens in original `.tix` file.
- **Acceptance Criteria:**
  - Real TypeScript Compiler API is used (no custom type checker).
  - TypeScript diagnostics accurately mapped back via bidirectional span table.
- **Risks:** Build time latency on large `.tix` component trees.
- **Stop Condition:** Stop after full `.tix` verification passes. Request human approval for Gate 9.

---

### Phase 9 — Hardening, Benchmarks & Genuine Showcase (Gate 9)
- **Task ID:** `P9-01`
- **Objective:** Execute comprehensive cross-browser test suites, run reproducible performance benchmarks against `spec/PERFORMANCE.md` baselines, and deliver a genuine Showcase compiling real `.mix`/`.tix` components without handwritten workarounds.
- **Input Contracts:** `spec/PERFORMANCE.md`, `governance/PHASE_GATES.md` Gate 9.
- **Expected Output / Files:**
  - `benchmarks/run-benchmarks.mjs` (unmocked js-framework-benchmark suite)
  - `examples/showcase/` (clean Showcase application compiling real components)
  - `tests/e2e/browser.test.mjs` (headless browser Playwright suite)
- **Dependencies:** All previous phases.
- **Tests:**
  - Real-browser E2E suite verifying reactivity, keyed list reconciliation, cancellation, and security.
  - Benchmark targets met: 1,000 rows create < 40ms; update < 10ms; swap < 12ms.
- **Acceptance Criteria:**
  - Showcase contains zero handwritten DOM assembly scripts (`main.js` replaced by compiled `<App />`).
  - No simulated capabilities: cancellation uses real tokens, diamond reactivity uses real computed nodes.
  - Real browser test suite passes cleanly.
- **Risks:** Browser-specific timing differences in headless CI runners.
- **Stop Condition:** Complete project sign-off.
