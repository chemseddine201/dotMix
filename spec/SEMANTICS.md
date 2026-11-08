# Language Semantics — Mix & Tix

**Status:** Canonical Semantics Specification (Reconciled Phase 1)  
**Applies to:** Compiler Semantics (`@mix/compiler-semantic`) and Runtime (`@mix/runtime`)

---

## 1. Fine-Grained Reactivity (Pull-Push Model)

Mix / Tix employs fine-grained reactivity where components execute once to construct the DOM and bind reactive signals directly to DOM nodes and effects.

- **Signals (`Signal<T>`):** State containers holding a value. Reads register the active computation as an observer. Writes notify observers.
- **Computed / Memos (`Computed<T>`):** Pure derivative computations that evaluate lazily on pull and notify on push.
- **Effects (`Effect`):** Side-effect computations that execute automatically upon dependency mutations.

---

## 2. Effect Writes, Scheduling, and Deferred Reruns (D-101)

### 2.1 Scheduler Policy: Deferred Rerun
When an effect writes to a reactive dependency (either its own dependency or another node feeding back into it), the scheduler enforces a **Deferred Rerun** policy:

1. **State Independence:** The flag `pendingRerun: boolean` is tracked independently from `computation.state` (`CLEAN | CHECK | DIRTY | RUNNING | DISPOSED`).
2. **Non-Nested Execution:** If an effect is currently `RUNNING`, it **never** executes re-entrantly. The current execution frame must finish completely before any rerun begins.
3. **Deduplication & Coalescing:** Multiple dependency writes during a single effect run set `pendingRerun = true` only once. Duplicate notifications are coalesced into a single deferred rerun scheduled in the microtask/scheduler queue.
4. **Cycle Detection:** To prevent infinite runaway loops, the scheduler tracks the iteration count of consecutive reruns within a flush cycle.
   - If the iterations exceed `SchedulerOptions.maxEffectIterations` (engine default: 1000), the scheduler aborts the loop and throws a deterministic `ReactiveCycleError`.
   - Magic numbers (such as 100) are explicitly forbidden as language-level semantic rules; the threshold is engine-configurable.
5. **Deterministic Error Handling:** If an effect throws during execution or rerun:
   - Its `state` is reset to `CLEAN`.
   - Cleanups registered prior to the throw execute deterministically.
   - The error is forwarded to the nearest active error boundary (`catchError` / `ErrorBoundary`).
   - The global scheduler queue remains uncorrupted, and unrelated scheduled effects continue processing.

---

## 3. Owner and Computation Lifecycle Decoupling (D-102)

Owner lifecycles and Computation states are orthogonal concepts:

### 3.1 Owner Lifecycle
```text
Owner: ACTIVE ──────> DISPOSED
```
- An `Owner` manages resource cleanup callbacks (`onCleanup`) and child owners.
- When an owner is disposed, it recursively disposes all child owners and executes registered teardown callbacks.

### 3.2 Computation State Machine
```text
Computation: CLEAN <─────> CHECK <─────> DIRTY
               │                          │
               └─────────> RUNNING <──────┘
                              │
                              ▼
                           DISPOSED
```
- States: `CLEAN`, `CHECK`, `DIRTY`, `RUNNING`, `DISPOSED`.
- Both `Effect` and `Computed` nodes have an explicit `DISPOSED` state.
- **Disposal Guarantee:** When an owner is disposed, all descendant computations immediately transition to `DISPOSED`. They unbind all sources (dependencies) and observers (dependents), are purged from pending scheduler queues, and will never re-execute.

---

## 4. Keyed List Reconciliation (D-110)

Keyed list blocks (`<each items as item (item.id)>`) reconcile dynamic collections using strict unique keys.

### 4.1 Duplicate Key Handling
- Key uniqueness is a mandatory contract. Fallback surrogate keys are **forbidden**.
- **First Occurrence Wins:** The first item encountered with a given key is retained and reconciled into the DOM.
- **Duplicate Treatment:** Subsequent items with identical keys are treated as an error condition:
  1. A diagnostic error is emitted (`MIX_ERR_DUPLICATE_KEY`).
  2. The duplicate entries are omitted from the reconciled DOM.
  3. The child `Owner` trees instantiated for duplicate entries are immediately and cleanly disposed.

### 4.2 Key Evaluation and Batching
- **Timing:** Key functions `(item, index) => key` are evaluated exactly once per item before diffing begins.
- **Atomic Batching:** All signal mutations and DOM node insertions/moves within a reconciliation cycle are batched atomically. Effects cannot observe intermediate, partially committed states.
