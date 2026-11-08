# Architecture Decision Register

This register preserves the settled architecture direction and records the approved contracts following the Phase 0 audit and human authority review.

## Settled direction

| ID | Decision | Status |
|---|---|---|
| D-001 | `.mix` and `.tix` share one AST and compiler pipeline. | Accepted |
| D-002 | TypeScript is the compiler bootstrap language. | Accepted |
| D-003 | AOT code generation targets direct DOM operations. | Accepted |
| D-004 | Fine-grained reactivity follows Pull-Push semantics. | Accepted |
| D-005 | Browser SPA is the MVP; renderer adapter keeps future SSR possible. | Accepted |
| D-006 | No React/Virtual DOM as foundational architecture. | Accepted |
| D-007 | Standard TypeScript parser/compiler APIs should be reused; do not reimplement TypeScript type checking. | Accepted |
| D-008 | Runtime correctness/security outrank minimal size. | Accepted |

---

## Approved Contracts and Implementation Specifications

### D-101 — Effect Writes, Scheduler Policy, and Reruns

- **Policy:** Adopt **Deferred Rerun** as the canonical scheduler policy.
- **State Representation:** `pendingRerun: boolean` is tracked independently from `ComputationState` (`CLEAN | CHECK | DIRTY | RUNNING | DISPOSED`).
- **Deduplication:** Multiple writes to dependencies during a single effect run set `pendingRerun = true` exactly once; duplicate notifications are coalesced into a single scheduled deferred job.
- **Non-Nested Execution:** An effect execution must run to completion (`RUNNING` finishes) before any rerun can be dispatched. Synchronous re-entrant effect invocations are strictly forbidden.
- **Cycle Detection:** Configurable scheduler iteration ceiling (`SchedulerOptions.maxEffectIterations`, with an engine default such as 1000). The scheduler tracks consecutive reruns within a single flush cycle and throws a deterministic `ReactiveCycleError` if exceeded. A magic number (such as 100) must **not** be hardcoded as a language-level semantic rule.
- **Deterministic Error Handling:** If an effect throws during execution or deferred rerun, its running state is reset, cleanups registered prior to the throw execute deterministically, and the error is dispatched to the nearest error boundary / handler without corrupting the global scheduler queue.
- **Required Tests:** Self-write, write to another dependency, repeated writes in one run, non-nested deferred execution, error during rerun, and runaway cycle detection.
- **Status:** Approved for Phase 1 implementation.

### D-102 — Computation and Owner Lifecycle States

- **Decoupled Lifecycles:** Owner lifecycle and computation lifecycle are separate, orthogonal concepts:
  - **Owner State:** `ACTIVE | DISPOSED`.
  - **Computation State:** `CLEAN | CHECK | DIRTY | RUNNING | DISPOSED`.
  - **Computed Node:** Explicitly transitions to `DISPOSED` upon owner teardown.
- **Disposal Semantics:** When an owner is disposed, all descendant computations transition to `DISPOSED`, immediately unlink from their dependency sources and observers, and are removed from pending scheduler queues. Disposed computations cannot be re-executed.
- **Status:** Approved for Phase 1 implementation.

### D-103 — `createRoot` Contract and `detachedParent`

- **Contract Signature:**
  ```ts
  export function createRoot<T>(
    fn: (dispose: () => void) => T,
    detachedParent?: Owner | null
  ): T;
  ```
- **Semantics:**
  - `detachedParent` is explicitly preserved from the reviewed contract.
  - When `detachedParent` is provided, the new root inherits context lookup and diagnostics ownership from `detachedParent` without binding its lifecycle to the parent's automatic child disposal.
  - Teardown of the root remains explicit via the supplied `dispose()` callback.
  - Any proposal to alter or remove `detachedParent` must document the semantic impact and receive explicit human architecture approval.
- **Status:** Approved for Phase 1 implementation.

### D-104 — Cancellation and Resource Ownership

- **Platform-Neutral Tokens:** `@mix/runtime` defines a platform-neutral `CancellationToken` and monotonic generation counter. Browser-specific DOM types (such as `AbortSignal` or `AbortController`) must not leak into core runtime.
- **Ownership:** Each asynchronous resource request receives a fresh token tied to the current owner.
- **Disposal:** Owner disposal automatically cancels all pending tokens.
- **Stale Generation Rejection:** Asynchronous responses compare their captured generation against the current owner generation; stale resolutions are discarded before triggering reactivity.
- **Renderer Bridge:** The browser DOM adapter maps native `AbortSignal` to the platform-neutral `CancellationToken`.
- **Status:** Approved for Phase 1 implementation.

### D-105 — Canonical DynamicElement Syntax and Expression Boundaries

- **Canonical Syntax:** Preserve the v3.2.1 DynamicElement syntax:
  ```mix
  <{~expr}> ... </{~expr}>
  ```
  The language grammar remains strictly `<{~expr}>` and must not be altered without approval.
- **Single Evaluation:** The dynamic tag expression `expr` is evaluated exactly once when the element is instantiated. Its resolved element identity/tag constructor is retained and reused for the closing tag boundary `</{~expr}>`. The closing tag does not re-evaluate `expr`.
- **Expression Boundary Extraction:** The markup lexer tracks embedded JS/TS expression boundaries while delegating expression parsing to the standard TypeScript parser. The boundary scanner correctly accounts for nested braces `{ ... }`, string literals (`"..."`, `'...'`), template literals with interpolations (`` `...${...}...` ``), regex literals (`/.../`), line comments (`//`), and block comments (`/* ... */`).
- **Status:** Approved for Phase 1 implementation.

### D-106 — TypeScript Projection Contracts

- **Unified Component Model:** Components are represented by `ComponentFactory<Props>` contracts.
- **Ref Target:** Formalize `RefTarget<T>` for DOM and component reference binding.
- **Props Inference:** Define strict generic props inference for components.
- **Bidirectional Source Mapping:** Generated TypeScript projection diagnostic spans map 1:1 back to the originating template source construct, ensuring compiler errors highlight the exact user-written markup span.
- **Status:** Approved for Phase 1 implementation.

### D-107 — Normative `srcset` Parsing Algorithm

- **Compliance Rule:** Do not use simplified regex splitting (such as comma-splitting, which breaks on data URLs). Specify the actual WHATWG HTML §4.8.4.3.7 parsing algorithm or pin a reviewed conforming implementation.
- **Algorithm Requirements:**
  1. Position-based scanner handling leading/trailing ASCII whitespace.
  2. Candidate URL extraction correctly parsing data URLs containing commas and URLs with comma-separated query parameters.
  3. Descriptor parsing: width descriptors (`<integer>w`), pixel density descriptors (`<number>x`), and error recovery rules for malformed candidates.
- **Mandatory Test Vectors:** Data URLs with commas, URLs with commas in query strings, multiple whitespace characters, single/multiple density descriptors, width descriptors, and invalid candidate recovery.
- **Status:** Approved for Phase 1 implementation.

### D-108 — Compile-Time and Runtime CSS Validation

- **Compile-Time Validation:**
  - Tokenizes static CSS in `<style>` blocks.
  - Strictly rejects forbidden at-rules: `@import` and `@charset` are disallowed.
  - Transforms static selectors with component-scoped data attributes.
- **Runtime Validation:**
  - Property names in dynamic bindings (`style={...}`) are validated against an allowlist of valid CSS properties / kebab-case identifiers (`/^[a-z][a-z0-9-]*$/i`).
  - Values are inspected for CSS escape sequences (e.g. `\3b` / `\7d`) to prevent property-breaking injection attacks.
  - URL values in dynamic styles validate the scheme against safe protocols (`http:`, `https:`, relative paths, safe image data URIs).
  - Renderer applies styles safely via `element.style.setProperty(name, value)` rather than raw HTML string concatenation.
- **Status:** Approved for Phase 1 implementation.

### D-109 — Trusted HTML Boundary and Sanitizer Contract

- **Security Boundary:** A TypeScript branded type (`type TrustedHTML = string & ...`) or arbitrary user callback is insufficient to establish trusted HTML.
- **Sanitizer Contract:** Define an explicit `SanitizerProvider` interface in `@mix/runtime`:
  ```ts
  export interface SanitizerProvider {
    sanitizeHtml(raw: string, context?: SanitizerContext): string;
  }
  ```
- **Runtime Enforcement:** Any unescaped HTML sink (`mix-html` / `trusted-html`) must route through an active `SanitizerProvider` or native W3C Trusted Types policy (`window.trustedTypes`). If no approved sanitizer is configured, raw HTML injection throws a runtime `MixSecurityError`.
- **Status:** Approved for Phase 1 implementation.

### D-110 — Keyed Reconciliation and Duplicate-Key Semantics

- **No Fallback Surrogate Keys:** The undefined fallback surrogate-key behavior is completely removed.
- **Deterministic Duplicate Handling:**
  - Key uniqueness within a keyed block is a strict invariant.
  - First occurrence wins: The first item with a given key is retained and reconciled.
  - Subsequent duplicate keys trigger a diagnostic (`MIX_ERR_DUPLICATE_KEY`), are omitted from reconciliation, and their child owner trees are immediately and cleanly disposed.
- **Ownership and Disposal:** Each item is encapsulated in its own child `Owner`. When an item is removed from the collection or excluded as a duplicate, its owner is recursively disposed.
- **Evaluation Timing:** Key functions `(item, index) => key` are evaluated once per collection item before reconciliation diffing.
- **Atomic Batching:** All signal updates and DOM operations for a list update are batched atomically so intermediate states cannot leak into observer effects.
- **Status:** Approved for Phase 1 implementation.

### D-111 — Stable Component Scope Access for HMR

- **Method Dispatch:** Codegen emits component methods that receive an explicit stable context record (`ctx`) or access state via an internal stable component instance scope pointer (`this.__scope`), rather than relying on `Function.prototype.bind()` which cannot update closed-over variables.
- **Live State Test:** A mandatory test must prove that when an HMR reload swaps method implementations, the updated method reads and mutates the existing component's live signal state.
- **Status:** Approved for Phase 1 implementation.
