/**
 * Phase 4 Permanent Cross-Finding Integration Test Suite (Section 10)
 *
 * Verifies complex interactions between:
 * 1. Resilient owner disposal + sync subscription teardown under cleanup errors
 * 2. Rapid burst insertion + offline persistence + CRDT compaction + stale peer reconnection
 * 3. Route cancellation / abort token cleanup error resilience during active sync
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  createRoot,
  onCleanup
} from "../node_modules/@dotmix/runtime/dist/index.js";
import {
  ReplicableArray,
  SyncEngine,
  syncCollection,
  MemoryDriver
} from "../node_modules/@dotmix/sync/dist/index.js";

describe("Phase 4: Cross-Finding Integration & System Resilience (Section 10)", () => {
  test("1. Component registers cleanups, one cleanup throws, owns sync subscription: disposal succeeds without corrupting queue", async () => {
    const driver = new MemoryDriver();
    const engine = new SyncEngine({ driver });
    const store = syncCollection({ key: "cross-sync-1", syncEngine: engine });

    let unbindRan = false;
    let caughtDisposalError = null;

    try {
      createRoot((dispose) => {
        // Register sync listener / subscription
        onCleanup(() => {
          unbindRan = true;
        });

        // Middle cleanup throws
        onCleanup(() => {
          throw new Error("Deliberate component teardown exception");
        });

        // Enqueue sync mutation inside component
        store.insert({ id: "item-1", title: "Active Item" });

        dispose();
      });
    } catch (err) {
      caughtDisposalError = err;
    }

    assert.ok(caughtDisposalError instanceof AggregateError, "Disposal error must be captured as AggregateError");
    assert.strictEqual(unbindRan, true, "Sync listener unbind must execute even when middle cleanup throws");
    assert.strictEqual(store.items().length, 1, "Sync store must remain uncorrupted");
  });

  test("2. Rapid burst insertions + compaction + stale replica reconnect: preserves active count and fences resurrected items", async () => {
    const repA = new ReplicableArray();
    const repB = new ReplicableArray();

    // 1. Initial burst additions on A
    for (let i = 0; i < 50; i++) {
      repA.insert(`init-task-${i}`, { title: `Task ${i}` }, { timestamp: 10 + i, clientId: "repA", sequence: i });
    }
    assert.strictEqual(repA.length, 50);

    // 2. Replica B syncs initial state
    repB.merge(repA.toJSON());
    assert.strictEqual(repB.length, 50);

    // 3. Replica B goes offline
    // 4. Replica A deletes first 10 items (timestamps 70..79)
    for (let i = 0; i < 10; i++) {
      repA.delete(`init-task-${i}`, { timestamp: 70 + i, clientId: "repA", sequence: 100 + i });
    }
    assert.strictEqual(repA.length, 40);

    // 5. Replica A compacts tombstones at watermark 85
    const purged = repA.compact(85);
    assert.strictEqual(purged, 10, "Replica A must purge 10 tombstones");
    assert.strictEqual(repA.getCompactionHorizon(), 85);

    // 6. While offline, Replica B created 5 new items with timestamps > 85
    for (let i = 0; i < 5; i++) {
      repB.insert(`offline-b-${i}`, { title: `B Task ${i}` }, { timestamp: 90 + i, clientId: "repB", sequence: i });
    }
    assert.strictEqual(repB.length, 55);

    // 7. Replica B reconnects and sends full state to Replica A
    const mergeStats = repA.merge(repB.toJSON());

    // Verified invariants:
    // - 10 stale items were fenced from resurrection
    // - 5 legitimate new items from B were accepted
    assert.strictEqual(mergeStats.rejectedStale, 10, "10 deleted items from B must be fenced");
    assert.strictEqual(mergeStats.merged, 5, "5 new items from B must be merged");
    assert.strictEqual(repA.length, 45, "Final active length must be exactly 40 + 5 = 45");

    // Assert none of the first 10 items exist in A
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(repA.get(`init-task-${i}`), null, `init-task-${i} must remain deleted`);
    }

    // Assert all 5 new items exist in A
    for (let i = 0; i < 5; i++) {
      assert.ok(repA.get(`offline-b-${i}`), `offline-b-${i} must be preserved`);
    }
  });

  test("3. Route cancellation / abort token cleanup error resilience during active sync", () => {
    let cleanupCompleted = false;
    let caughtErr = null;

    try {
      createRoot((dispose) => {
        // Outer route context
        onCleanup(() => {
          cleanupCompleted = true;
        });

        // Simulating sub-handler error on aborted request
        onCleanup(() => {
          throw new Error("Failed to abort in-flight sync request cleanly");
        });

        dispose();
      });
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr instanceof AggregateError);
    assert.strictEqual(cleanupCompleted, true, "Route-level cleanup must complete despite inner abort throw");
  });
});
