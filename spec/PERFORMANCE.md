# Performance Requirements & Benchmarks — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Performance Specification (Reconciled Phase Gate 1)  
**Applies to:** Compiler Output and Runtime Benchmarks  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Core Performance Invariants

1. **Direct DOM Operations:** The compiled output must directly invoke browser DOM APIs (`createElement`, `appendChild`, `textContent`) without an intermediary Virtual DOM or synthetic reconciliation diff tree for static elements.
2. **Fine-Grained Updates:** Mutating a signal must only re-evaluate the specific effects observing that signal. Unrelated components and DOM branches must not re-render.
3. **Zero Allocation in Passive Flushes:** Computing derived values that have not changed must produce zero unnecessary memory allocations.
4. **Reproducible Measurement Discipline:** No performance or optimization claims are valid unless supported by committed, reproducible benchmark scripts running against pinned datasets in real browser environments.

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

---

## 3. Physical State-to-Presentation Execution Model

To avoid conflating in-memory JavaScript execution with physical browser rendering and display presentation, dotMix performance measurements must distinguish six distinct execution layers:

1. **State Mutation:** Synchronous JavaScript execution that writes signal or store state (`sig.set(val)`). (Target: $< 0.2\text{ ms}$).
2. **Reactive Propagation & Scheduling:** Downstream derived computations evaluate and schedule effect execution. (Target: $< 0.3\text{ ms}$).
3. **DOM Commit:** Direct, fine-grained text node and attribute assignments (`__setText`, `__setAttribute`, `__insertNode`). (Target: $< 0.8\text{ ms}$).
4. **Style Recalculation & Layout:** Browser engine geometry calculations and cascade resolution performed on dirty subtrees.
5. **Paint, Raster & Compositing:** Browser rendering engine drawing operations and GPU texture tile compositing.
6. **Frame Presentation Opportunity:** Physical presentation to the display backbuffer, gated by hardware VSync cadence (e.g. $\sim 16.67\text{ ms}$ at 60 Hz, $\sim 8.33\text{ ms}$ at 120 Hz).

### Measurement Integrity Rules
- Microbenchmarking a direct DOM assignment (such as `textNode.data = value`) reflects only the DOM commit layer and must never be cited as "full end-to-end signal-to-screen presentation latency."
- An executed `requestAnimationFrame` callback demonstrates frame scheduling readiness, not proof of photons emitted from a physical monitor.
- A 60 Hz display refresh cycle ($\approx 16.67\text{ ms}$) represents the display presentation opportunity cadence, not a universal lower bound on synchronous JavaScript execution time.
- All benchmark reporting must publish p50, p95, sample size, and hardware environment parameters.

---

## 4. Superseded Performance Budget Notes (Phase 4 Changelog)

| Historical Term / Claim | Location | Superseded Assessment | Corrected Baseline |
|---|---|---|---|
| `"0ms reactive latency"` | README / Gates | Inaccurate; real state propagation has measurable execution duration ($>0$). | Replaced with fine-grained synchronous signal propagation and direct DOM commit. |
| `"Sub-microsecond (<1µs) surgical DOM updates"` | README.md | Conflates isolated V8 microbenchmarks with full DOM commit / engine execution. | Clarified as direct DOM mutation committing without Virtual DOM reconciliation. |
| `"Full update-to-frame presentation <5ms"` | Phase 2 Draft Budgets | Physically unachievable on 60 Hz display hardware where VSync is locked to $16.67\text{ ms}$. | Separated into JavaScript main-thread work ($<1.5\text{ ms}$) and 60 FPS VSync presentation ($16.67\text{ ms}$). |
| `"0ms perceived latency"` | PHASE_GATES.md | Ambiguous colloquialism. | Replaced with "applied synchronously to local signal/DOM without awaiting network confirmation." |
| `"0ms microtask fast-path"` | PHASE_GATES.md | Colloquial phrasing. | Replaced with "synchronous microtask dispatch." |

