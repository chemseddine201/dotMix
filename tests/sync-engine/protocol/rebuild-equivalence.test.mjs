/**
 * Rebuild Equivalence Test Suite
 * Verifies that for 200 randomized operation workloads (including random checkpoints),
 * rebuildEntriesState from baseline snapshot + journal exactly reproduces incremental state.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  commitCheckpoint,
  rebuildEntriesState,
} from "../../../packages/sync/dist/protocol/index.js";
import {
  alloc,
  deliver,
  entriesDigest,
  makeCluster,
  newObserver,
  visibleDigest,
} from "./helpers.mjs";

function pseudoRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("Rebuild Equivalence Suite", () => {
  it("proves entriesDigest(rebuild(state)) === entriesDigest(incremental) across 200 randomized seeds", async (t) => {
    const SEED_COUNT = 200;
    let mismatches = 0;
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const rand = pseudoRandom(seed);
      const c = await makeCluster(["A", "B", "C"]);
      const { A, B } = c.e;
      const observer = newObserver(c, `Obs_${seed}`);

      const generatedOps = [];
      const itemIds = [];
      const incarnations = [];

      const opCount = 15 + Math.floor(rand() * 10);
      for (let i = 0; i < opCount; i++) {
        const producer = rand() < 0.5 ? A : B;
        for (const priorOp of generatedOps) {
          if (priorOp.opDot.replicaId !== producer.meta.replicaId) {
            await deliver(producer, [priorOp]);
          }
        }
        const r = rand();
        if (incarnations.length === 0 || r < 0.4) {
          const id = `item_${seed}_${i}`;
          const op = await alloc(producer, {
            kind: "insert",
            externalId: id,
            initialFields: { count: i, text: `val_${i}` },
          });
          generatedOps.push(op);
          itemIds.push(id);
          incarnations.push({ opDot: op.opDot, id });
        } else if (r < 0.7) {
          const target = incarnations[Math.floor(rand() * incarnations.length)];
          const op = await alloc(producer, {
            kind: "update",
            targetIncarnation: target.opDot,
            externalId: target.id,
            partialFields: { count: i * 10, note: `upd_${i}` },
          });
          generatedOps.push(op);
        } else if (r < 0.85) {
          const target = incarnations[Math.floor(rand() * incarnations.length)];
          const op = await alloc(producer, {
            kind: "move",
            targetIncarnation: target.opDot,
            externalId: target.id,
            newIndexKey: `a${i}`,
          });
          generatedOps.push(op);
        } else {
          const target = incarnations[Math.floor(rand() * incarnations.length)];
          const op = await alloc(producer, {
            kind: "delete",
            targetIncarnation: target.opDot,
            externalId: target.id,
          });
          generatedOps.push(op);
        }
      }

      for (const op of generatedOps) {
        await deliver(observer, [op]);
        if (rand() < 0.2) {
          commitCheckpoint(observer.meta, observer.entriesState, observer.snapshotsV2, observer.mutationJournal);
        }
      }

      const digestIncremental = entriesDigest(observer);
      const visibleIncremental = visibleDigest(observer);

      rebuildEntriesState(observer.meta, observer.entriesState, observer.snapshotsV2, observer.mutationJournal);
      const digestRebuild = entriesDigest(observer);
      const visibleRebuild = visibleDigest(observer);

      if (digestIncremental !== digestRebuild || visibleIncremental !== visibleRebuild) {
        mismatches++;
        t.diagnostic(`Seed ${seed} mismatch: inc=${digestIncremental} reb=${digestRebuild} | incVis=${visibleIncremental} rebVis=${visibleRebuild}`);
      }
    }
    t.diagnostic(`Rebuild equivalence completed: ${mismatches} mismatches across ${SEED_COUNT} seeds`);
    assert.equal(mismatches, 0, `${mismatches}/${SEED_COUNT} seeds diverged after rebuildEntriesState`);
  });
});

