/* global process */
/**
 * Seeded simulation test runner for D-137 protocol on production core (T-33.8)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "./scenario.mjs";
import { shrinkFailingTrace } from "./shrink.mjs";
import { checkCrashRestartCapability, checkDropRecoveryCapability } from "./capabilities.mjs";

const TOTAL_SEEDS = parseInt(process.env.SIM_SEEDS ?? "300", 10);
const BATCH_SIZE = 50;

describe(`T-33.8: Seeded D-137 Simulation Harness (${TOTAL_SEEDS} seeds)`, () => {
  it("verifies capability gates are enabled (T-31.12, T-31.13)", (t) => {
    const crashCap = checkCrashRestartCapability();
    t.diagnostic(`Crash/restart capability: ${crashCap.reason}`);
    assert.equal(crashCap.supported, true);

    const dropCap = checkDropRecoveryCapability();
    t.diagnostic(`Drop recovery capability: ${dropCap.reason}`);
    assert.equal(dropCap.supported, true);
  });

  it(`executes ${TOTAL_SEEDS} seeded simulation runs with invariant and convergence checks`, async (t) => {
    let failedCount = 0;
    const failures = [];

    const startTime = Date.now();
    const passedSeeds = [];
    const failedSeeds = [];

    for (let batchStart = 1; batchStart <= TOTAL_SEEDS; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, TOTAL_SEEDS);

      for (let seed = batchStart; seed <= batchEnd; seed++) {
        // Vary replicas between 3 and 7 deterministically
        const numReplicas = 3 + (seed % 5);
        // Include Byzantine writer in ~33% of runs
        const withByzantine = seed % 3 === 0;
        // Every 10th seed runs a long scenario (200 events)
        const steps = seed % 10 === 0 ? 200 : 24;

        const config = { seed, numReplicas, steps, withByzantine };
        const result = await runSimulation(config);

        assert.equal(result.skippedEvents.length, 0, `Seed ${seed} had skipped events: ${result.skippedEvents.join(", ")}`);

        if (!result.passed) {
          failedCount++;
          failedSeeds.push(seed);
          t.diagnostic(`Seed ${seed} FAILED at step ${result.stepsExecuted}: ${result.violation?.detail}`);

          if (failures.length < 25) {
            const minimalTrace = await shrinkFailingTrace(config, result.eventTrace);
            failures.push({ seed, config, result, minimalTrace });
          } else {
            failures.push({ seed, config, result, minimalTrace: result.eventTrace });
          }
        } else {
          passedSeeds.push(seed);
        }
      }

      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      t.diagnostic(`Progress: ${batchEnd}/${TOTAL_SEEDS} seeds completed (${elapsedSec}s elapsed, ${failedCount} failures)`);
    }

    const totalElapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    t.diagnostic(`Simulation complete: ${passedSeeds.length}/${TOTAL_SEEDS} passed, ${failedCount} failed in ${totalElapsedSec}s`);

    assert.equal(failedCount, 0, `${failedCount}/${TOTAL_SEEDS} seeds failed simulation invariants`);
  });
});

