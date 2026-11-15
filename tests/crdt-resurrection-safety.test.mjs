/**
 * Phase 4 Permanent Regression Test Suite: CRDT Tombstone Resurrection Safety (D-136 / FINDING-CRDT-01)
 *
 * Verifies:
 * 1. Stale-client resurrection fencing prevents deleted items from reviving after compaction
 * 2. Multi-peer vector stability horizon prevents purging tombstones while active peers lag behind
 * 3. Legitimate offline insertions after compaction horizon are preserved
 * 4. Legitimate offline updates to active records are preserved
 * 5. Snapshot restoration preserves compaction horizon and fences stale merges across restarts
 * 6. Compaction idempotency across repeated calls
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ReplicableArray } from "../node_modules/@dotmix/sync/dist/index.js";

describe("Phase 4: CRDT Tombstone Resurrection Safety (D-136 / FINDING-CRDT-01)", () => {
  test("1. Stale reconnecting peer cannot resurrect deleted item after compaction", () => {
    const replicaA = new ReplicableArray();
    const replicaB = new ReplicableArray();

    // 1. Replica A inserts item-X at timestamp 10
    replicaA.insert("item-X", { title: "Buy milk" }, { timestamp: 10, clientId: "repA", sequence: 1 });
    assert.strictEqual(replicaA.get("item-X")?.title, "Buy milk");

    // 2. Replica B syncs and receives item-X
    replicaB.merge(replicaA.toJSON());
    assert.strictEqual(replicaB.get("item-X")?.title, "Buy milk");

    // 3. Replica B goes offline. Replica A deletes item-X at timestamp 20
    replicaA.delete("item-X", { timestamp: 20, clientId: "repA", sequence: 2 });
    assert.strictEqual(replicaA.get("item-X"), null);

    // 4. Replica A compacts tombstones at watermark 25
    const purged = replicaA.compact(25);
    assert.strictEqual(purged, 1, "Replica A should purge exactly 1 tombstone");
    assert.strictEqual(replicaA.getCompactionHorizon(), 25);
    assert.strictEqual(replicaA.toJSON().length, 0);

    // 5. Replica B (stale, offline) reconnects and sends its state to Replica A
    const staleMergeResult = replicaA.merge(replicaB.toJSON());
    assert.strictEqual(staleMergeResult.rejectedStale, 1, "Replica A must fence the stale resurrection attempt");

    // 6. Assert item-X is NOT resurrected on Replica A
    assert.strictEqual(replicaA.get("item-X"), null, "Item-X must remain deleted");
    assert.strictEqual(replicaA.length, 0);
  });

  test("2. Multi-peer vector stability horizon holds tombstones until all peers acknowledge", () => {
    const repA = new ReplicableArray();

    // Register active mesh peers
    repA.registerPeer("peerB", 10);
    repA.registerPeer("peerC", 20);

    assert.strictEqual(repA.getStabilityHorizon(), 10, "Stability horizon must be the minimum peer watermark");

    // Insert and delete item at timestamp 15
    repA.insert("task-1", { title: "Task 1" }, { timestamp: 12, clientId: "repA", sequence: 1 });
    repA.delete("task-1", { timestamp: 15, clientId: "repA", sequence: 2 });

    // Attempt compaction with watermark 20
    // Because peerB has only acknowledged up to 10, effective watermark is min(20, 10) = 10
    // task-1 tombstone was created at 15 (> 10), so it MUST NOT be purged!
    const purged1 = repA.compact(20);
    assert.strictEqual(purged1, 0, "Compaction must not purge tombstone unacknowledged by peerB");
    assert.ok(repA.getEntry("task-1")?.deleted, "Tombstone must remain safely retained");

    // peerB witnesses/acknowledges up to timestamp 18
    repA.witnessPeer("peerB", 18);
    assert.strictEqual(repA.getStabilityHorizon(), 18);

    // Now compact with watermark 20: effective watermark is min(20, 18) = 18 >= 15
    const purged2 = repA.compact(20);
    assert.strictEqual(purged2, 1, "Tombstone should now be safely purged once all peers passed 15");
    assert.strictEqual(repA.getEntry("task-1"), null);
  });

  test("3. Legitimate offline insertions created after compaction horizon are preserved", () => {
    const repA = new ReplicableArray();
    const repB = new ReplicableArray();

    repA.insert("item-old", { title: "Old item" }, { timestamp: 10, clientId: "repA", sequence: 1 });
    repB.merge(repA.toJSON());

    repA.delete("item-old", { timestamp: 20, clientId: "repA", sequence: 2 });
    repA.compact(25); // Compaction horizon = 25

    // While offline, Replica B creates a brand new item at timestamp 30 (> 25)
    repB.insert("item-new", { title: "New item" }, { timestamp: 30, clientId: "repB", sequence: 1 });

    // When B merges into A:
    // item-old (ts 10 <= 25) is fenced as stale resurrection
    // item-new (ts 30 > 25) is accepted as legitimate new write
    const result = repA.merge(repB.toJSON());
    assert.strictEqual(result.rejectedStale, 1, "item-old must be fenced");
    assert.strictEqual(result.merged, 1, "item-new must be accepted");
    assert.strictEqual(repA.get("item-old"), null);
    assert.strictEqual(repA.get("item-new")?.title, "New item");
  });

  test("4. Legitimate offline updates to active items are preserved across sync", () => {
    const repA = new ReplicableArray();
    const repB = new ReplicableArray();

    repA.insert("item-active", { title: "Initial Title", count: 1 }, { timestamp: 10, clientId: "repA", sequence: 1 });
    repA.insert("item-dead", { title: "To Be Deleted" }, { timestamp: 10, clientId: "repA", sequence: 2 });
    repB.merge(repA.toJSON());

    // repA deletes item-dead and compacts
    repA.delete("item-dead", { timestamp: 20, clientId: "repA", sequence: 3 });
    repA.compact(25);

    // repB (offline) updates item-active with ts 15
    repB.update("item-active", { title: "Updated Title", count: 2 }, { timestamp: 15, clientId: "repB", sequence: 1 });

    // Sync B to A
    repA.merge(repB.toJSON());

    // item-active was updated cleanly
    assert.strictEqual(repA.get("item-active")?.title, "Updated Title");
    assert.strictEqual(repA.get("item-active")?.count, 2);
    // item-dead remains deleted
    assert.strictEqual(repA.get("item-dead"), null);
  });

  test("5. Snapshot persistence and restart restores compaction horizon and prevents resurrection", () => {
    const repA = new ReplicableArray();
    repA.insert("task-del", { title: "Temp" }, { timestamp: 10, clientId: "repA", sequence: 1 });
    repA.delete("task-del", { timestamp: 15, clientId: "repA", sequence: 2 });
    repA.compact(20);

    // Serialize snapshot (e.g. into storage)
    const snapshotState = repA.toSnapshotState();
    assert.strictEqual(snapshotState.compactionHorizon, 20);
    assert.ok(snapshotState.purgedTombstoneIds?.includes("task-del"));

    // Restore into a freshly restarted instance
    const restartedRepA = ReplicableArray.fromJSON(snapshotState);
    assert.strictEqual(restartedRepA.getCompactionHorizon(), 20);
    assert.ok(restartedRepA.getPurgedTombstoneIds().includes("task-del"));

    // Stale peer arrives with task-del (ts 10)
    const stalePeerEntries = [
      { id: "task-del", indexKey: "a", value: { title: "Temp" }, deleted: false, mutationId: { timestamp: 10, clientId: "peer", sequence: 1 } }
    ];
    const res = restartedRepA.merge(stalePeerEntries);
    assert.strictEqual(res.rejectedStale, 1);
    assert.strictEqual(restartedRepA.get("task-del"), null, "Restarted replica must maintain fencing");
  });

  test("6. Compaction is idempotent across repeated calls", () => {
    const rep = new ReplicableArray();
    rep.insert("x", { val: 1 }, { timestamp: 5, clientId: "c", sequence: 1 });
    rep.delete("x", { timestamp: 10, clientId: "c", sequence: 2 });

    const p1 = rep.compact(15);
    assert.strictEqual(p1, 1);
    const p2 = rep.compact(15);
    assert.strictEqual(p2, 0);
    const p3 = rep.compact(15);
    assert.strictEqual(p3, 0);
    assert.strictEqual(rep.getCompactionHorizon(), 15);
  });
});

