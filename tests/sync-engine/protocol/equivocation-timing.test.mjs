/**
 * AUD-CONV-5: Equivocation with random, replica-independent checkpoint timing
 * Verifies that under Option A (certified baseline excision floor),
 * replica-independent checkpoint cadence never causes observer divergence.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commitCheckpoint } from "../../../packages/sync/dist/protocol/index.js";
import {
  alloc,
  deliver,
  entriesDigest,
  makeCluster,
  newObserver,
  resign,
  visibleDigest,
} from "./helpers.mjs";

describe("AUD-CONV-5: Equivocation under replica-independent checkpoint timing", () => {
  it("converges to 0 divergence across observers checkpointing at arbitrary intervals", async (t) => {
    const SEED_COUNT = 20;
    let totalDivergent = 0;
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const c = await makeCluster(["A", "B", "C"]);
      const { A, B } = c.e;

      const opsA = [];
      const opsB = [];
      for (let i = 1; i <= 4; i++) {
        opsA.push(await alloc(A, { kind: "insert", externalId: `a_${seed}_${i}`, initialFields: { v: i } }));
      }
      for (let i = 1; i <= 4; i++) {
        opsB.push(await alloc(B, { kind: "insert", externalId: `b_${seed}_${i}`, initialFields: { v: i } }));
      }

      const b2Fork = await resign(opsB[1], { initialFields: { v: 9999, fork: true } }, c.keys.B.privateKeyHex);

      const observers = [
        newObserver(c, `R1_${seed}`),
        newObserver(c, `R2_${seed}`),
        newObserver(c, `R3_${seed}`),
        newObserver(c, `R4_${seed}`),
      ];

      await deliver(observers[0], opsA);
      commitCheckpoint(observers[0].meta, observers[0].entriesState, observers[0].snapshotsV2, observers[0].mutationJournal);
      await deliver(observers[0], [opsB[0], opsB[1], opsB[2], opsB[3], b2Fork]);

      await deliver(observers[1], [...opsA, opsB[0], opsB[1]]);
      commitCheckpoint(observers[1].meta, observers[1].entriesState, observers[1].snapshotsV2, observers[1].mutationJournal);
      await deliver(observers[1], [opsB[2], opsB[3], b2Fork]);

      await deliver(observers[2], [...opsA, ...opsB]);
      commitCheckpoint(observers[2].meta, observers[2].entriesState, observers[2].snapshotsV2, observers[2].mutationJournal);
      commitCheckpoint(observers[2].meta, observers[2].entriesState, observers[2].snapshotsV2, observers[2].mutationJournal);
      await deliver(observers[2], [b2Fork]);

      await deliver(observers[3], [...opsA, ...opsB, b2Fork]);

      const baseVisible = visibleDigest(observers[0]);
      const baseEntries = entriesDigest(observers[0]);
      for (let i = 1; i < observers.length; i++) {
        const obs = observers[i];
        if (visibleDigest(obs) !== baseVisible || entriesDigest(obs) !== baseEntries) {
          totalDivergent++;
          t.diagnostic(`Seed ${seed} divergence: obs ${i} entries=${entriesDigest(obs)} vs obs 0 entries=${baseEntries}`);
        }
      }
    }
    t.diagnostic(`AUD-CONV-5 completed: ${totalDivergent} divergent observers across ${SEED_COUNT} seeds`);
    assert.equal(totalDivergent, 0, "Divergence detected under replica-independent checkpoint timing");
  });
});

