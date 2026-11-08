# Language Semantics — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Semantics Specification (Reconciled Phase Gate 1 & Gate 2)  
**Applies to:** Compiler Semantics (`@mix/compiler-semantic`) and Runtime (`@mix/runtime`)  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Fine-Grained Reactivity (Pull-Push Model)

Mix / Tix employs fine-grained reactivity where components execute once to construct the DOM and bind reactive signals directly to DOM nodes and effects.

- **Signals (`Signal<T>`):** State containers holding a value. Reads register the active computation as an observer. Writes notify observers.
- **Computed / Memos (`Computed<T>`):** Pure derivative computations that evaluate lazily on pull and notify on push. Writing to a `Signal` inside a `Computed` is strictly forbidden (`I-5`).
- **Effects (`Effect`):** Side-effect computations that execute automatically upon dependency mutations.

---

## 2. Effect Writes, Scheduling, and Deferred Reruns (`D-101`)

### 2.1 Scheduler Policy: Deferred Rerun
When an effect writes to a reactive dependency (either its own dependency or another node feeding back into it), the scheduler enforces a **Deferred Rerun** policy:

1. **State Independence:** The flag `pendingRerun: boolean` is tracked independently from `computation.state` (`CLEAN | CHECK | DIRTY | RUNNING | DISPOSED`).
2. **Immediate First-Read Subscription (`R-RX-05`):** Dependencies read during `RUNNING` are subscribed immediately upon first read (so writes later in the same run notify the effect), and stale dependencies not read in the current run are unsubscribed in `finally`.
3. **Non-Nested Execution:** If an effect is currently `RUNNING`, it **never** executes re-entrantly. The current execution frame must finish completely before any rerun begins.
4. **Deduplication & Coalescing:** Multiple dependency writes during a single effect run set `pendingRerun = true` only once. Duplicate notifications are coalesced into a single deferred rerun scheduled in the flush queue.
5. **Cycle Detection (`R-RX-06`):** To prevent infinite runaway loops, the scheduler tracks the iteration count of consecutive reruns within a flush cycle (`runsInFlush`).
   - If iterations exceed `SchedulerOptions.maxEffectIterations` (default: `1000`), the scheduler resets the offending effect to `CLEAN`, aborts further reruns of that effect in the current flush, preserves the rest of the queue, and throws/delivers a deterministic `MixError` (`MIX_ERR_REACTIVE_CYCLE`).
6. **Deterministic Error Handling:** If an effect throws during execution or rerun:
   - Its `state` is reset to `CLEAN` and `pendingRerun` is cleared.
   - Cleanups registered prior to the throw execute deterministically.
   - The global scheduler queue remains uncorrupted, and remaining scheduled effects continue processing before the error is surfaced.

---

## 3. Owner and Computation Lifecycle Decoupling (`D-102`)

Owner lifecycles and Computation states are orthogonal concepts using `as const` objects (never TypeScript `enum`):

### 3.1 Owner Lifecycle
```text
OwnerState: ACTIVE (0) ──────> DISPOSED (1)
```
- An `Owner` manages resource cleanup callbacks (`onCleanup`), context values, a cancellation source (`D-104`), and child owners.
- When an owner is disposed, it recursively disposes all child owners, cancels its `CancellationToken`, and executes registered teardown callbacks.

### 3.2 Computation State Machine
```text
ComputationState: CLEAN (0) <──> CHECK (1) <──> DIRTY (2)
                     │                             │
                     └────────> RUNNING (3) <──────┘
                                   │
                                   ▼
                              DISPOSED (4)
```
- Both `Effect` and `Computed` nodes transition to `DISPOSED (4)` upon owner teardown, immediately unlinking all `sources` and `observers` and purging themselves from scheduler queues.

---

## 4. Keyed Reconciliation & Atomic Duplicate Rejection Policy (`D-110` / `HAA-02` Option A)

Keyed list blocks (`{#each items as item, index (item.id)}...{/each}`) reconcile dynamic collections using strict unique keys (`SameValueZero` semantics, `R-KEY-01`).

### 4.1 Prohibition of Surrogate Keys (Architecture Guardrail §H)
Key uniqueness is a mandatory contract. Synthetic, index-based, or random surrogate fallback keys (such as `(k, n)`) to conceal duplicates are **strictly prohibited** in all environments (development and production).

### 4.2 Ratified Atomic Duplicate-Update Rejection Policy (`HAA-02` Option A — Strict)
When a collection update contains duplicate keys, the reconciler enforces atomic rejection:

1. **Pre-reconciliation Validation:** Before any DOM diffing, element moving, or child owner creation/disposal occurs, the incoming collection of keys is validated in its entirety.
2. **Deterministic Detection:** Duplicate keys are detected deterministically during the initial key-collection pass.
3. **Atomic Rejection:** The invalid collection update is rejected atomically. No partial application of items is permitted.
4. **State & DOM Preservation:** The previously rendered DOM collection and its associated child `Owner` trees remain mounted, intact, and completely unchanged.
5. **Zero Allocation:** Zero DOM nodes and zero child `Owner` instances are allocated for items in the rejected update.
6. **Strict Error Delivery:** The runtime emits and synchronously **throws** a deterministic `MixError` (`MIX_ERR_DUPLICATE_KEY`) in **both development and production**, while guaranteeing that reactive scheduler and queue invariants remain uncorrupted (`D-101`).
