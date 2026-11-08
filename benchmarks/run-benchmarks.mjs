/**
 * Mix / Tix Framework — Reproducible Performance Benchmarks (Phase 5)
 * Conforms to spec/PERFORMANCE.md baselines.
 */

import { performance } from "node:perf_hooks";
import { Window } from "happy-dom";

import {
  signal,
  computed,
  createEffect,
  batch,
  createRoot,
  reconcileKeyed,
  createElement,
  createTextNode,
  flushQueue
} from "../packages/runtime/dist/index.js";

// Setup mock DOM environment
const window = new Window();
globalThis.document = window.document;
globalThis.window = window;

const results = [];

function measure(name, targetMs, fn, notes = "") {
  const start = performance.now();
  fn();
  const duration = performance.now() - start;
  const passed = duration <= targetMs;

  results.push({
    name,
    targetMs,
    actualMs: Number(duration.toFixed(2)),
    passed,
    notes
  });

  return duration;
}

console.log("================================================================================");
console.log(" Mix / Tix Framework — Phase 5 Reproducible Performance Benchmarks");
console.log(" Baseline Source: spec/PERFORMANCE.md");
console.log("================================================================================\n");

// --- 1. Keyed List Reconciliation (1,000 rows) ---
let items = Array.from({ length: 1000 }, (_, i) => ({
  id: i + 1,
  label: `Row #${i + 1}`
}));

const container = createElement("div");
const anchor = createTextNode("");
container.appendChild(anchor);

function renderRow(itemSignal, _indexSignal) {
  const row = createElement("div");
  const text = createTextNode(itemSignal().label);
  row.appendChild(text);
  createEffect(() => {
    text.data = itemSignal().label;
  });
  return row;
}

// Warmup V8 JIT and happy-dom classes before timing
{
  const warmupContainer = createElement("div");
  const warmupAnchor = createTextNode("");
  warmupContainer.appendChild(warmupAnchor);
  const warmupItems = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `Row ${i}` }));
  reconcileKeyed(warmupContainer, warmupAnchor, warmupItems, (item) => item.id, renderRow);
  reconcileKeyed(warmupContainer, warmupAnchor, [], (item) => item.id, renderRow);
}

// 1.1 Create 1,000 rows (Target: < 40ms)
createRoot(() => {
  measure("Reconciliation: Create 1,000 rows", 40, () => {
    reconcileKeyed(container, anchor, items, (item) => item.id, renderRow);
    flushQueue();
  });
});

// 1.2 Partial update: every 10th row (Target: < 10ms)
measure("Reconciliation: Partial update (every 10th row)", 10, () => {
  const updated = items.map((item, idx) =>
    idx % 10 === 0 ? { ...item, label: `${item.label} [Updated]` } : item
  );
  items = updated;
  reconcileKeyed(container, anchor, items, (item) => item.id, renderRow);
  flushQueue();
});

// 1.3 Swap rows: swap row 4 with row 992 (Target: < 12ms)
measure("Reconciliation: Swap 2 rows (row 4 with row 992)", 12, () => {
  const swapped = [...items];
  const tmp = swapped[4];
  swapped[4] = swapped[992];
  swapped[992] = tmp;
  items = swapped;
  reconcileKeyed(container, anchor, items, (item) => item.id, renderRow);
  flushQueue();
});

// 1.4 Clear 1,000 rows (Target: < 15ms)
measure("Reconciliation: Clear 1,000 rows", 15, () => {
  reconcileKeyed(container, anchor, [], (item) => item.id, renderRow);
  flushQueue();
});

// --- 2. Fine-Grained Reactivity Microbenchmarks ---

// 2.1 Signal creation: 50,000 signals
measure("Reactivity: Create 50,000 signals", 50, () => {
  for (let i = 0; i < 50000; i++) {
    signal(i);
  }
}, "50k allocations");

// 2.2 Computed memo chain propagation
measure("Reactivity: Computed chain propagation (1,000 levels)", 15, () => {
  const source = signal(1);
  let current = source;
  for (let i = 0; i < 1000; i++) {
    const prev = current;
    current = computed(() => prev() + 1);
  }
  // Pull memo
  current();
  // Mutate source and re-pull
  source.set(2);
  current();
}, "1,000 lazy memo evaluations");

// 2.3 Atomic batching: 5,000 updates in single flush
measure("Reactivity: Atomic batching (5,000 signal writes)", 15, () => {
  const s = signal(0);
  let effectRuns = 0;
  createRoot(() => {
    createEffect(() => {
      s();
      effectRuns++;
    });
    batch(() => {
      for (let i = 0; i < 5000; i++) {
        s.set(i);
      }
    });
    flushQueue();
  });
}, "Coalesced to 2 runs");

// --- 3. Print Results Summary Table ---
console.log("| Benchmark Metric | Target | Actual | Status | Notes |");
console.log("|---|---|---|---|---|");
for (const r of results) {
  const statusStr = r.passed ? "✓ PASS" : "✗ FAIL";
  console.log(`| ${r.name.padEnd(46)} | < ${String(r.targetMs).padStart(2)}ms | ${String(r.actualMs).padStart(5)}ms | ${statusStr.padEnd(6)} | ${r.notes} |`);
}

const allPassed = results.every((r) => r.passed);
console.log("\n================================================================================");
if (allPassed) {
  console.log(" ALL BENCHMARK TARGETS MET (100% PASS)");
} else {
  console.error(" SOME BENCHMARK TARGETS WERE NOT MET");
  process.exitCode = 1;
}
console.log("================================================================================\n");
