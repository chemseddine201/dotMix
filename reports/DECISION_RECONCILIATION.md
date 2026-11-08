# Decision Reconciliation — Accepted Baseline vs Project State

**Audit Date:** 2026-11-08  
**Revised:** 2026-11-08 (Incorporating Human Architecture Authority Review)  
**Auditor:** Antigravity (AI Coding Assistant)  
**Authority:** Human Architecture Authority  
**Task Reference:** Task 3 (`agent/INITIALIZATION_AGENT_TASK.md`)  
**Status:** Decisions Audited & Reconciled — Awaiting Human Architecture Decision Sign-off

---

## 1. Executive Summary

This report performs an item-by-item comparison of architectural decisions **D-101 through D-111** between the authoritative governance baseline (`governance/DECISION_REGISTER.md`, `governance/ARCHITECTURE_GUARDRAILS.md`, `governance/PROJECT_CHARTER.md`), the historical documentation (`DECISIONS.md`, `spec/*`, `spec/MIX_SPEC_v3.2.2.md`), and the actual pre-initialization codebase in Git commit `b95110e` (preserved on branch/tag `archive/pre-initialization-b95110e`).

### Status Breakdown & Core Insights
- **Specification Documentation Status:**
  - **MATCH on paper (5 decisions):** D-102 (Lifecycles), D-103 (`createRoot`), D-104 (Cancellation), D-107 (`srcset`), D-111 (HMR).
  - **PARTIAL / CONFLICTING (4 decisions):** D-101 (Scheduler state flag), D-105 (Dynamic Element attributes dropped in codegen), D-106 (TS projection source map faking), D-108 (CSS validation pulled tokenizer into runtime).
  - **REQUIRING HUMAN ARCHITECTURE RATIFICATION (2 decisions):** D-109 (Trusted HTML public boundary), D-110 (Atomic duplicate-update rejection policy).
- **Pre-initialization Codebase Audit in `HEAD` (`b95110e`):**
  - **Split-Brain Dual Runtime (D-101, D-102):** `packages/runtime/src/index.ts` (1,219 lines) contained an entire legacy reactive engine running in parallel with `src/core/*`. Codegen imported `index.ts` while keyed lists imported `src/core/*`. `flushSync` wiped the queue on uncaught error.
  - **Reactive Destruction (D-102, D-110):** `ComputedNode` disposal subscribed observers to disposed nodes; `updateEntry` mutated `itemSignal.value = item` directly without calling `set()`, breaking reactivity; LIS had an `arr[0] === 0` corruption bug.
  - **Security Bypasses (D-107, D-108, D-109):** `src/index.ts` permitted `data:image/svg+xml` in `srcset`; codegen emitted raw attributes on `href`/`src`/`style` without calling runtime validators; `src/index.ts` checked `constructor.name === "TrustedHTML"`, permitting trivial prototype forgery.
  - **Surrogate Keys in Production (D-110):** `src/dom/reconcile.ts` synthesized surrogate keys `(k, n)`, violating D-110 and Guardrail §H.
  - **Memory Leaks (D-111):** `src/hmr/index.ts` created dummy components and leaked memory on reload.

---

## 2. Decision Reconciliation Ledger (D-101 through D-111)

### D-101 — Reactive Scheduler, Effect Writes, and Reruns
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"Deferred rerun; `pendingRerun` independent of computation state; coalesced notifications; non-nested effect execution; configurable scheduler iteration safety ceiling and deterministic cycle error."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 17-31)
  - `spec/SEMANTICS.md` §2
  - `spec/MIX_SPEC_v3.2.2.md` §2.3, §2.4 (R-RX-03, R-RX-04)
- **Document Status:** **PARTIAL**
  `DECISION_REGISTER.md` mandates `pendingRerun: boolean` independent of `ComputationState`. However, `MIX_SPEC_v3.2.2.md` R-RX-04 directly reuses computation state (`state = CHECK` / `state = DIRTY`), coupling the execution state machine with the deferred queue.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **CRITICAL DEFECT (F-07)**
  A split-brain dual runtime existed in `packages/runtime`: `src/index.ts` (1,219 lines) contained an entire monolithic reactive implementation with its own queue and owner tree, completely separate from `src/core/*`. Codegen called `src/index.ts`, while `renderKeyedList` called `src/core/*`. Furthermore, `flushSync` in `src/index.ts` wiped the entire pending queue whenever an effect threw an uncaught error.
- **Required Implementation Tests (Gate 4):**
  1. Self-mutating effect write triggers deferred rerun without synchronous recursion.
  2. Multiple writes to separate dependencies in a single run coalesce into exactly one rerun.
  3. Iteration ceiling (> `maxEffectIterations`) throws deterministic `ReactiveCycleError`.
  4. Errors thrown during effect execution reset running state and preserve scheduler queue integrity.

---

### D-102 — Owner and Computation Lifecycle Decoupling
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"Owner lifecycle state is separate from computation state. Verify all state transitions, disposal, unlinking, and scheduling behavior—not only type declarations."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 33-43)
  - `spec/SEMANTICS.md` §3
  - `spec/MIX_SPEC_v3.2.2.md` §2.1
- **Document Status:** **MATCH**
  Both baselines agree that `OwnerState` (`ACTIVE = 0, DISPOSED = 1`) and `ComputationState` (`CLEAN = 0, CHECK = 1, DIRTY = 2, RUNNING = 3, DISPOSED = 4`) are decoupled enums/types. Computed nodes explicitly transition to `DISPOSED` on owner teardown.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **CRITICAL DEFECT (F-07)**
  In `packages/runtime/src/core/reactivity.ts`, `ComputedNode` disposal subscribed observers to the disposed node itself, corrupting dependency graph unlinking. Furthermore, `packages/runtime/src/index.ts` never unlinked sources upon owner disposal, keeping stale nodes alive in memory.
- **Required Implementation Tests (Gate 4):**
  1. Disposing parent owner recursively disposes child owners and cleanups.
  2. Disposed computation nodes immediately unlink from sources and observers.
  3. Disposed computed memo throws or returns undefined; does not re-evaluate.

---

### D-103 — `createRoot` Contract and `detachedParent`
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"Preserve `createRoot` with optional `detachedParent?: Owner | null`. Verify context inheritance is distinct from automatic disposal ownership."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 45-57)
  - `spec/RUNTIME_API.md` §2
  - `spec/MIX_SPEC_v3.2.2.md` §2.5
- **Document Status:** **MATCH**
  All sources preserve the signature `export function createRoot<T>(fn: (dispose: () => void) => T, detachedParent?: Owner | null): T;`. Providing `detachedParent` establishes context and diagnostics linkage without binding root lifecycle to parent automatic disposal.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **PARTIAL (F-08)**
  While `packages/runtime/src/core/owner.ts` declared `createRoot(fn, detachedParent)`, the legacy monolithic `src/index.ts` had a coupled context table where disposing parent scopes could invalidate root context registries.
- **Required Implementation Tests (Gate 4):**
  1. Disposing `detachedParent` leaves root and its effects intact.
  2. Root accesses context values registered on `detachedParent`.
  3. Invoking root's `dispose()` callback tears down root and all descendant effects.

---

### D-104 — Platform-Neutral Cancellation & Generation Tokens
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"Platform-neutral cancellation token in core; adapters may bridge to platform cancellation; generation checks prevent stale results."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 59-71)
  - `spec/RUNTIME_API.md` §3
  - `spec/MIX_SPEC_v3.2.2.md` §3
- **Document Status:** **MATCH**
  Core defines pure ECMAScript `CancellationToken` and generation counter. Zero browser DOM types (`AbortSignal`, `AbortController`) leak into core runtime. Adapters bridge to `AbortSignal`.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **DEFECT (F-08)**
  `packages/runtime/src/core/cancellation.ts` implemented a primitive boolean flag lacking generation counter tracking and owner disposal unlinking, making stale asynchronous race rejection incomplete.
- **Required Implementation Tests (Gate 4):**
  1. Asynchronous resource resolution with mismatched generation is rejected.
  2. Disposing owner trips `token.isCancelled = true`.
  3. `toAbortSignal(token)` triggers DOM `abort` event upon owner disposal.

---

### D-105 — Canonical Dynamic Element Syntax & Boundaries
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"Preserve dynamic element syntax `<{~expr}>...</{~expr}>`; resolve identity once per element instance."*
- **Actual Documents & Paths:**
  - `governance/PROJECT_CHARTER.md` §4
  - `DECISIONS.md` (lines 73-89)
  - `spec/LANGUAGE.md` §2
  - `spec/MIX_SPEC_v3.2.2.md` §4.2
- **Status:** **PARTIAL**
- **Mismatch Explanation:**
  Grammar and charter agree on `<{~expr}>...</{~expr}>`. However, in the existing implementation (`packages/compiler-codegen/src/index.ts` lines 146-164):
  1. Codegen evaluated the tag expression once at mount, but emitted no reactive wrapper.
  2. Codegen completely ignored `dyn.attributes` (dynamic attributes on `<{~expr}>` were not compiled).
  3. In `reports/phase-0-audit.md`, the previous agent had proposed dropping `~`, which the Project Charter explicitly rejected.
- **Required Implementation Tests (Gate 2 & Gate 5):**
  1. Lexer/scanner extracts balanced curly expressions inside `<{~...}>`.
  2. Parser accepts valid tag expression and validates matching closing delimiter.
  3. Codegen compiles attributes, events, and children for dynamic elements.
  4. Tag resolution executes once per instance creation.

---

### D-106 — TypeScript Projection & Source Span Mapping
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"`.tix` uses TypeScript Compiler API for type verification; no competing type checker. Verify props/ref/generic model, source mapping, and API isolation."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 91-101)
  - `spec/DIAGNOSTICS.md` §2
  - `spec/MIX_SPEC_v3.2.2.md` §5
- **Status:** **PARTIAL**
- **Mismatch Explanation:**
  1. The concept of generating virtual `.tix.ts` files with `VerifyProps` and `VerifyRef` is approved.
  2. However, the existing implementation in `packages/compiler-semantic/src/index.ts` faked source maps using an artificial 1:1 line delta loop, violating the guardrail against faking line numbers.
  3. The repository pinned `typescript@7.0.2` and directly imported unstable subpath APIs (`typescript/unstable/sync`), breaking `typescript-eslint`.
- **Required Implementation Tests (Gate 3 & Gate 8):**
  1. Invalid prop type in `.tix` template produces TypeScript diagnostic.
  2. Diagnostic span maps accurately to original `.tix` line and column.
  3. TypeScript Compiler API is evaluated on TypeScript 6.0.3 and isolated behind an internal compiler adapter.

---

### D-107 — Normative WHATWG `srcset` Parser
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"`srcset` handling must follow the normative WHATWG algorithm or a reviewed implementation demonstrably conforming to it."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 103-113)
  - `spec/SECURITY.md` §2
  - `spec/MIX_SPEC_v3.2.2.md` §6.2
- **Document Status:** **MATCH**
  All documents agree on HTML Standard §4.8.4.3.7 position-based scanner. Simplified comma-splitting regex is strictly prohibited.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **SECURITY BYPASS (F-09)**
  While `packages/runtime/src/security/srcset.ts` adhered to WHATWG, the legacy runtime `packages/runtime/src/index.ts` used a naive regex parser that allowed `data:image/svg+xml` image candidates, introducing potential script injection vectors.
- **Required Implementation Tests (Gate 6):**
  1. Candidates with data URLs containing internal commas.
  2. URLs with query strings containing commas (`?format=jpg,webp`).
  3. Irregular ASCII whitespace characters (tabs, newlines, spaces).
  4. Malformed descriptor recovery without aborting subsequent candidates.

---

### D-108 — Dynamic CSS Validation & Sanitization
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"Dynamic CSS has compile-time and runtime validation, including escapes and URL policy."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 115-127)
  - `spec/CSS_SCOPING.md` §2, §3
  - `spec/MIX_SPEC_v3.2.2.md` §6.3
- **Document Status:** **PARTIAL**
  The specifications correctly mandate compile-time at-rule rejection (`@import`, `@charset`) and runtime escape decoding (`\3b`). However, previous plans pulled tokenizer libraries into runtime.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **SECURITY BYPASS & FORBIDDEN DEPENDENCY (F-09)**
  1. Runtime declared an external dependency on `@csstools/css-tokenizer`, violating the zero runtime dependency guardrail.
  2. In `packages/compiler-codegen/src/index.ts`, emitted code set `href`, `src`, and `style` attributes directly using raw DOM assignments (`node.href = ...`, `node.style = ...`) without calling runtime security validators (`setSafeStyleProperty`, `validateUrl`), completely bypassing URL and style sanitization at runtime.
- **Required Implementation Tests (Gate 6):**
  1. Component `<style>` with `@import` emits `MIX_ERR_CSS_FORBIDDEN_IMPORT`.
  2. Dynamic style property with hex escape sequence (`\3b`) is normalized and rejected.
  3. Dynamic style `url(...)` with `javascript:` or `vbscript:` scheme is rejected.
  4. Styles applied exclusively via `element.style.setProperty`.

---

### D-109 — Trusted HTML Boundary & Sanitizer Coexistence
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"Explicit trusted HTML boundary and defined SanitizerProvider/Trusted Types integration."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 129-140)
  - `spec/RUNTIME_API.md` §4
  - `spec/MIX_SPEC_v3.2.2.md` §6.4
- **Document Status:** **RECONCILED DESIGN — AWAITING HUMAN RATIFICATION (HAA-03)**
- **Architecture Clarification:**
  `SanitizerProvider` and a module-scoped `WeakSet` registry are not in conflict; they coexist synergistically:
  1. **`SanitizerProvider`** defines the application-level sanitization authority.
  2. **`createTrustedHtml(dirtyHtml)`** invokes that configured authority (or native Trusted Types).
  3. A private module-scoped **`WeakSet<object>`** records trusted instances.
  4. Direct DOM innerHTML sinks accept only registered objects from the `WeakSet`.
  5. Native W3C Trusted Types (`window.trustedTypes`) integration is used where supported.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **CRITICAL SECURITY BYPASS (F-10)**
  In `packages/runtime/src/index.ts`, trusted HTML validation checked `if (value && value.constructor && value.constructor.name === "TrustedHTML")`, allowing trivial security forgery via `{ constructor: { name: "TrustedHTML" }, toString: () => "<script>alert(1)</script>" }`. Furthermore, the draft API `createTrustedHtml(dirtyHtml, sanitizerFn)` allowed callers to pass an arbitrary identity function `x => x` to register malicious HTML.
- **Policy for Approval:**
  The sanitizer authority must be controlled strictly by the approved application-level security boundary (`setSanitizerProvider`), never freely supplied by component code.
- **Required Implementation Tests (Gate 6):**
  1. Raw string passed to `mix-html` sink throws `MIX_SEC_FOREIGN_TRUSTED_HTML`.
  2. `createTrustedHtml` invokes active `SanitizerProvider` and adds record to `WeakSet`.
  3. In DEV mode, canary payloads test active sanitizer against bypasses.
  4. Insertion into forbidden tags (`<script>`, `<iframe>`) throws `MIX_SEC_HTML_CONTEXT`.

---

### D-110 — Keyed Reconciliation & Duplicate Key Policy
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"No surrogate fallback keys; deterministic duplicate-key diagnostics and atomic behavior. Verify duplicate item is rejected before DOM/Owner creation where feasible."*
- **Authoritative Guardrail (`governance/ARCHITECTURE_GUARDRAILS.md` §H):**
  > *"Stable keys and deterministic behavior. Duplicate keys produce deterministic diagnostics. **No synthetic/surrogate fallback keys to conceal duplicates.** Avoid creating DOM/Owner state for a duplicate item that is rejected."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 142-154)
  - `spec/SEMANTICS.md` §4
  - `spec/MIX_SPEC_v3.2.2.md` §7 (R-KEY-03)
- **Document Status:** **CRITICAL POLICY DECISION FOR HUMAN APPROVAL (HAA-02)**
- **Conflict Analysis:**
  `spec/MIX_SPEC_v3.2.2.md` R-KEY-03 introduced `(k, n)` surrogate keys for production resilience, which violates Guardrail §H and D-110. The initial audit proposed a "first occurrence wins, later duplicates discarded" rule, but this suffered from a technical contradiction (disposing owners never created) and risked partial DOM updates.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **REACTIVE BREAKAGE & SURROGATE KEYS (F-11)**
  1. `packages/runtime/src/dom/reconcile.ts` synthesized surrogate keys `(k, n)` in production when duplicates occurred, violating Guardrail §H.
  2. The LIS implementation had an `arr[0] === 0` corruption bug causing misordered DOM moves.
  3. In `updateEntry`, the code mutated `itemSignal.value = item` directly instead of calling `itemSignal.set(item)`, which bypassed reactive notifications and broke list row updates.
- **Proposed Authoritative Policy (Submitted for Human Approval):**
  1. **Pre-reconciliation Validation:** Validate the complete incoming collection of keys before executing reconciliation diffing.
  2. **Deterministic Detection:** Detect duplicate keys deterministically.
  3. **Atomic Rejection:** Reject the invalid update atomically.
  4. **State Preservation:** Preserve the previously rendered collection intact.
  5. **Zero Allocation:** Do not allocate DOM nodes or owner state for items in an invalid update.
  6. **Consistent Diagnostic:** Emit a deterministic diagnostic (`MIX_ERR_DUPLICATE_KEY`) in both development and production.
- **Required Implementation Tests (Gate 7):**
  1. Incoming collection with duplicate keys is rejected atomically; previous DOM remains mounted.
  2. Deterministic `MIX_ERR_DUPLICATE_KEY` emitted in both DEV and PROD.
  3. Zero child owners or DOM nodes allocated during duplicate detection.
  4. Subsequent valid collection update reconciles cleanly.

---

### D-111 — Stable Component Scope for HMR
- **Authoritative Clause (`governance/DECISION_REGISTER.md`):**
  > *"HMR method dispatch uses stable component scope/context; lexical closures must not be assumed rebindable."*
- **Actual Documents & Paths:**
  - `DECISIONS.md` (lines 156-166)
  - `spec/DIAGNOSTICS.md` §3
  - `spec/MIX_SPEC_v3.2.2.md` §8
- **Document Status:** **MATCH**
  Both baselines agree that component methods must access state through a stable instance context (`__scope` / trampolines) so that hot-reloading method bodies does not suffer from stale lexical closures.
- **`HEAD` Codebase Audit (`archive/pre-initialization-b95110e`):** **MEMORY LEAKS (F-12)**
  `packages/runtime/src/hmr/index.ts` created dummy component instances during module reload without disposing old instances or unlinking listeners, leaking memory across reloads.
- **Required Implementation Tests (Gate 9):**
  1. Component method swapped via HMR reads live state of existing signal.
  2. Mutating signal from updated method triggers dependent DOM update.
  3. Component does not unmount or recreate DOM nodes.
