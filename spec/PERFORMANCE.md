# Performance Requirements & Benchmarks — Mix & Tix

**Status:** Canonical Performance Specification (Reconciled Phase 1)  
**Applies to:** Compiler Output and Runtime Benchmarks (Phases 3-5)

---

## 1. Core Performance Invariants

1. **Direct DOM Operations:** The compiled output must directly invoke browser DOM APIs (`createElement`, `appendChild`, `textContent`) without an intermediary Virtual DOM or synthetic reconciliation diff tree for static elements.
2. **Fine-Grained Updates:** Mutating a signal must only re-evaluate the specific effects observing that signal. Unrelated components and DOM branches must not re-render.
3. **Zero Allocation in Passive Flushes:** Computing derived values that have not changed must produce zero unnecessary memory allocations.
4. **Reproducible Measurement Discipline:** No performance or optimization claims are valid unless supported by committed, reproducible benchmark scripts running against pinned datasets.

---

## 2. Targeted Performance Baselines

- **Keyed Reconciliation (js-framework-benchmark equivalent):**
  - Create 1,000 rows: Target < 40ms.
  - Clear 1,000 rows: Target < 15ms.
  - Partial update (every 10th row): Target < 10ms.
  - Swap rows: Target < 12ms.
- **Memory Footprint:**
  - Base reactive signal memory overhead: < 128 bytes per signal node.
  - Active computation node: < 256 bytes per effect/memo.
  - Teardown: Disposed nodes must release references immediately to allow garbage collection.
