import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  migrateLegacyV1Store,
  materializeVisibleArray,
  generateSigningKeyPair,
} from "../../../packages/sync/dist/protocol/index.js";
import { makeCluster, chan } from "./helpers.mjs";

describe(": Legacy Migration & Local-Only Operations", () => {
  it("preserves entry order when raw indexKey is omitted and respects raw indexKey when provided", async () => {
    const cluster = await makeCluster(["A"]);
    const A = cluster.e.A;
    const migKey = await generateSigningKeyPair("Ed25519", true);
    const legacyEntries = [
      { id: "zebra", fields: { title: "Zebra" }, deleted: false },
      { id: "monkey", fields: { title: "Monkey" }, deleted: false },
      { id: "ant", fields: { title: "Ant" }, deleted: false },
    ];
    const res = await migrateLegacyV1Store(A.meta, A.entriesState, A.snapshotsV2, A.mutationJournal, A.operationDigests, legacyEntries, migKey);
    assert.equal(res.ok, true);
    assert.equal(res.migratedCount, 3);

    const visible = materializeVisibleArray(A.entriesState);
    assert.equal(visible.totalCount, 3);
    assert.deepEqual(visible.items.map((i) => i.id), ["zebra", "monkey", "ant"]);

    const cluster2 = await makeCluster(["A"]);
    const A2 = cluster2.e.A;
    const legacyEntriesWithKeys = [
      { id: "first-in-list", fields: { n: 1 }, deleted: false, indexKey: "b10" },
      { id: "second-in-list", fields: { n: 2 }, deleted: false, indexKey: "a10" },
    ];
    await migrateLegacyV1Store(A2.meta, A2.entriesState, A2.snapshotsV2, A2.mutationJournal, A2.operationDigests, legacyEntriesWithKeys, migKey);
    const visible2 = materializeVisibleArray(A2.entriesState);
    assert.deepEqual(visible2.items.map((i) => i.id), ["second-in-list", "first-in-list"]);
  });

  it("replays pending uncommitted v1 mutations accurately", async () => {
    const cluster = await makeCluster(["A"]);
    const A = cluster.e.A;
    const migKey = await generateSigningKeyPair("Ed25519", true);
    const baseEntries = [
      { id: "task-1", fields: { title: "Original Title", priority: 1 }, deleted: false },
      { id: "task-2", fields: { title: "To Delete" }, deleted: false },
    ];
    const pendingMutations = [
      { id: "task-1", op: "update", partial: { title: "Updated Title" } },
      { id: "task-2", op: "delete" },
      { id: "task-3", op: "insert", fields: { title: "Pending Insert" } },
    ];
    const res = await migrateLegacyV1Store(A.meta, A.entriesState, A.snapshotsV2, A.mutationJournal, A.operationDigests, baseEntries, migKey, pendingMutations);
    assert.equal(res.ok, true);
    assert.equal(res.migratedCount, 3);
    const visible = materializeVisibleArray(A.entriesState);
    assert.equal(visible.totalCount, 2);
    assert.deepEqual(visible.items.map((i) => i.id), ["task-1", "task-3"]);
    const task1 = visible.items.find((i) => i.id === "task-1");
    assert.equal(task1.title, "Updated Title");
    assert.equal(task1.priority, 1);

    let task2Tombstone = false;
    for (const e of A.entriesState.values()) {
      if (e.externalId === "task-2" && e.deleted) task2Tombstone = true;
    }
    assert.equal(task2Tombstone, true);
  });

  it("uses meta.epochNumber when epoch != 1", async () => {
    const cluster = await makeCluster(["A"], { epoch: 3 });
    const A = cluster.e.A;
    assert.equal(A.meta.epochNumber, 3);
    const migKey = await generateSigningKeyPair("Ed25519", true);
    await migrateLegacyV1Store(A.meta, A.entriesState, A.snapshotsV2, A.mutationJournal, A.operationDigests, [{ id: "e3-item", deleted: false }], migKey);
    const jOp = [...A.mutationJournal.values()][0];
    assert.equal(jOp.epochNumber, 3);
    assert.equal(jOp.operation.epochNumber, 3);
    assert.equal(A.meta.frontiers.localDurableFrontier["3:LEGACY_MIGRATION"], 1);
  });

  it("AUD-M2-LOCAL: migration ops are local-only and reach peers via SEED/JOIN export", async () => {
    const cluster = await makeCluster(["A", "B", "C"], { epoch: 1 });
    const { A, B, C } = cluster.e;
    const cert = cluster.cert;
    const migKey = await generateSigningKeyPair("Ed25519", true);
    await migrateLegacyV1Store(A.meta, A.entriesState, A.snapshotsV2, A.mutationJournal, A.operationDigests, [
      { id: "local-item-1", fields: { v: 100 }, deleted: false },
      { id: "local-item-2", fields: { v: 200 }, deleted: false },
    ], migKey);

    assert.equal(A.syncOutbox.size, 0, "Migration ops must never be placed in syncOutbox");

    const seedRes = await A.enableRemoteSync("SEED_NEW_REMOTE_EPOCH", cert);
    assert.equal(seedRes.ok, true);
    const snapA = A.snapshotsV2.get(A.meta.activeSnapshotSeq);
    assert.ok(snapA, "Active snapshot must exist on SEED replica");

    const joinRes = await B.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapA);
    assert.equal(joinRes.ok, true, `B must join from A snapshot: ${joinRes.code}`);

    const visA = materializeVisibleArray(A.entriesState);
    const visB = materializeVisibleArray(B.entriesState);
    assert.deepEqual(visA.items.map((i) => ({ id: i.id, v: i.v })), visB.items.map((i) => ({ id: i.id, v: i.v })));

    await migrateLegacyV1Store(C.meta, C.entriesState, C.snapshotsV2, C.mutationJournal, C.operationDigests, [{ id: "item-c", fields: { v: 300 }, deleted: false }], migKey);
    assert.equal(C.syncOutbox.size, 0);

    const joinCRes = await C.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapA);
    assert.equal(joinCRes.ok, true);

    assert.ok(C.syncOutbox.size >= 1, "JOIN export planning must cover migrated state into syncOutbox");
    for (const outboxRec of C.syncOutbox.values()) {
      assert.equal(outboxRec.operation.opDot.replicaId, "C");
      const preVer = await A.ingestRemoteOperation(outboxRec.operation, chan("C"));
      assert.equal(preVer.ok, true);
    }

    const visAAfterC = materializeVisibleArray(A.entriesState);
    assert.ok(visAAfterC.items.some((i) => i.id === "item-c"));
  });
});

