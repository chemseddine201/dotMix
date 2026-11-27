import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { REPO_ROOT, collectC1Files } from "../fixtures/gate43/helpers.mjs";

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describe("Gate 43 T6 — Frontend Parse Speed Budget (R10)", () => {
  it("parses all C1 files within <= 1.25x baseline ratio vs ts.createSourceFile", (t) => {
    const baselinePath = path.join(REPO_ROOT, "tests", "fixtures", "gate43", "speed-baseline.json");
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

    const files = collectC1Files();
    const sources = files.map((filePath) => ({
      filePath,
      source: fs.readFileSync(filePath, "utf8")
    }));

    function runA() {
      const t0 = performance.now();
      for (const { filePath, source } of sources) {
        parse(source, { filename: filePath });
      }
      return performance.now() - t0;
    }

    function runB() {
      const t0 = performance.now();
      for (const { source } of sources) {
        ts.createSourceFile("c1.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      }
      return performance.now() - t0;
    }

    for (let w = 0; w < 3; w++) {
      runA();
      runB();
    }

    const timesA = [];
    const timesB = [];
    for (let r = 0; r < 9; r++) {
      if (r % 2 === 0) {
        timesA.push(runA());
        timesB.push(runB());
      } else {
        timesB.push(runB());
        timesA.push(runA());
      }
    }

    const medianA = median(timesA);
    const medianB = median(timesB);
    const ratio = medianA / medianB;
    const budget = baseline.ratio * 1.25;

    t.diagnostic(
      `T6 ratio=${ratio.toFixed(6)} (baseline=${baseline.ratio}, budget=${budget.toFixed(6)}, medianA=${medianA.toFixed(2)}ms, medianB=${medianB.toFixed(2)}ms)`
    );

    assert.ok(
      ratio <= budget,
      `Parse ratio ${ratio.toFixed(6)} exceeds budget ${budget.toFixed(6)} (baseline ${baseline.ratio} * 1.25; medianA=${medianA.toFixed(2)}ms, medianB=${medianB.toFixed(2)}ms)`
    );
  });
});
