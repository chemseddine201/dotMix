import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryStoreBackend } from "../../../packages/sync/dist/storage/memory-backend.js";
import { ProductionV1MigrationRunner } from "../../../packages/sync/dist/migration/runner.js";
import { finalizeMigration } from "../../../packages/sync/dist/migration/finalize.js";
import { recoverFromStoreOnBoot } from "../../../packages/sync/dist/storage/boot-recovery.js";

describe("Production v1 -> v2 Migration Engine", () => {
  it("migrates real v1 data (active, deleted, reordered, pending) without data loss", async () => {
    const backend = new MemoryStoreBackend();
    await backend.open();

    const collectionIdentifier = "tasks_v1_production";

    // 1. Real v1 data: ArrayEntry records as the legacy engine stores them (crdt/array.ts)
    const legacySnapshot = [
      { id: "task-1", indexKey: "a000001", value: { text: "First legacy task", done: false }, deleted: false },
      { id: "task-2", indexKey: "a000002", value: { text: "Second legacy task", done: true }, deleted: false },
      { id: "task-3", indexKey: "a000003", value: { text: "Deleted legacy task" }, deleted: true },
      { id: "task-4", indexKey: "a000010", value: { text: "Reordered legacy task", done: false }, deleted: false },
    ];

    const legacyMutations = [
      {
        idStr: "1700000000000-client1-1",
        storeKey: collectionIdentifier,
        state: "committed",
        op: "insert",
        id: "task-1",
        value: { text: "First legacy task" },
      },
      {
        idStr: "1700000000100-client1-2",
        storeKey: collectionIdentifier,
        state: "pending",
        op: "insert",
        id: "task-5",
        value: { text: "Pending offline task", done: false },
        indexKey: "a000020",
      },
      {
        idStr: "1700000000200-client1-3",
        storeKey: collectionIdentifier,
        state: "pending",
        op: "update",
        id: "task-2",
        partial: { done: false, note: "Updated offline" },
      },
    ];

    const runner = new ProductionV1MigrationRunner();

    const requiresMigration = await runner.isMigrationRequired(collectionIdentifier, backend, true);
    assert.equal(requiresMigration, true, "Migration should be detected as required");

    // Execute migration
    const result = await runner.runV1Migration(collectionIdentifier, backend, {
      legacySnapshotPayload: legacySnapshot,
      legacyMutationsPayload: legacyMutations,
    });

    assert.equal(result.ok, true, "Migration must succeed");
    assert.equal(result.status, "completed");
    assert.equal(result.migratedCount, 4, "Should migrate all 4 snapshot entries");

    // The legacy database is separate and read-only; the archive records the committed checkpoint.
    const archiveRecord = await backend.runTransaction(["legacy_archive"], "readonly", async (transaction) => {
      return transaction.get("legacy_archive", collectionIdentifier);
    });
    assert.ok(archiveRecord, "legacy_archive record must exist");
    assert.equal(archiveRecord.stage, "checkpoint_committed");
    assert.equal(archiveRecord.rawPendingMutationsCount, 2);
    assert.equal(archiveRecord.replayPlan.length, 2);

    // Invariant 3: entries_state holds migrated and replayed entries
    const entries = await backend.runTransaction(["entries_state"], "readonly", async (transaction) => {
      return transaction.getAll("entries_state");
    });

    assert.ok(entries.length >= 5, "Must contain all entries including offline pending task-5");

    const task1 = entries.find((e) => e.externalId === "task-1");
    assert.ok(task1, "task-1 must be present");
    assert.equal(task1.deleted, false);

    const task3 = entries.find((e) => e.externalId === "task-3");
    assert.ok(task3, "task-3 tombstone must be present");
    assert.equal(task3.deleted, true);

    const task5 = entries.find((e) => e.externalId === "task-5");
    assert.ok(task5, "task-5 pending offline insert must be replayed into state");
    assert.equal(task5.deleted, false);

    const task2 = entries.find((e) => e.externalId === "task-2");
    assert.ok(task2, "task-2 must have pending update applied");
    assert.equal(task2.fields.note?.value, "Updated offline");

    // Invariant 4: First verified checkpoint committed
    const v2Snapshots = await backend.runTransaction(["snapshots"], "readonly", async (transaction) => {
      return transaction.getAll("snapshots");
    });
    const checkpoint = v2Snapshots.find((s) => s.collectionId === collectionIdentifier && s.snapshotSeq === 1);
    assert.ok(checkpoint, "First verified v2 checkpoint must be created");

    // Invariant 5: Re-running is a no-op (idempotent)
    const rerunResult = await runner.runV1Migration(collectionIdentifier, backend, {
      legacySnapshotPayload: legacySnapshot,
      legacyMutationsPayload: legacyMutations,
    });
    assert.equal(rerunResult.ok, true);
    assert.equal(rerunResult.status, "completed");

    const rerunRequired = await runner.isMigrationRequired(collectionIdentifier, backend);
    assert.equal(rerunRequired, false, "Migration should no longer be required after the checkpoint");

    // finalizeMigration() verifies the signed checkpoint like a normal boot, then finalizes.
    const finalizeOutcome = await finalizeMigration(collectionIdentifier, { store: backend });
    assert.equal(finalizeOutcome.ok, true, finalizeOutcome.detail);
    const finalizedArchive = await backend.runTransaction(["legacy_archive"], "readonly", async (transaction) => {
      return transaction.get("legacy_archive", collectionIdentifier);
    });
    assert.equal(finalizedArchive.stage, "finalized");
  });

  it("safely recovers from an interrupted migration idempotently without data loss", async () => {
    const backend = new MemoryStoreBackend();
    await backend.open();

    const collectionIdentifier = "tasks_interrupted";

    const legacySnapshot = [
      { id: "item-alpha", indexKey: "a0", value: { text: "Alpha task", done: false }, deleted: false },
      { id: "item-beta", indexKey: "a1", value: { text: "Beta task", done: true }, deleted: false },
    ];

    const legacyMutations = [
      {
        idStr: "mut-1",
        storeKey: collectionIdentifier,
        state: "pending",
        op: "insert",
        id: "item-gamma",
        value: { text: "Gamma offline task" },
      },
    ];

    const runner = new ProductionV1MigrationRunner();

    // Step 1: Simulate crash after archive_written stage
    const interruptedResult = await runner.runV1Migration(collectionIdentifier, backend, {
      legacySnapshotPayload: legacySnapshot,
      legacyMutationsPayload: legacyMutations,
      interruptAtStage: "archive_written",
    });

    assert.equal(interruptedResult.ok, false);
    assert.equal(interruptedResult.status, "pending");

    const partialArchive = await backend.runTransaction(["legacy_archive"], "readonly", async (transaction) => {
      return transaction.get("legacy_archive", collectionIdentifier);
    });
    assert.ok(partialArchive);
    assert.equal(partialArchive.stage, "archive_written");

    // Step 2: Resume migration on the same store
    const resumedResult = await runner.runV1Migration(collectionIdentifier, backend, {
      legacySnapshotPayload: legacySnapshot,
      legacyMutationsPayload: legacyMutations,
    });

    assert.equal(resumedResult.ok, true);
    assert.equal(resumedResult.status, "completed");

    // Verify all items exist cleanly without duplicates
    const entries = await backend.runTransaction(["entries_state"], "readonly", async (transaction) => {
      return transaction.getAll("entries_state");
    });

    const uniqueExternalIds = new Set(entries.map((e) => e.externalId));
    assert.equal(uniqueExternalIds.size, 3);
    assert.ok(uniqueExternalIds.has("item-alpha"));
    assert.ok(uniqueExternalIds.has("item-beta"));
    assert.ok(uniqueExternalIds.has("item-gamma"));

    const finalArchive = await backend.runTransaction(["legacy_archive"], "readonly", async (transaction) => {
      return transaction.get("legacy_archive", collectionIdentifier);
    });
    assert.equal(finalArchive.stage, "checkpoint_committed");
  });

  it("replays real legacy pending mutations, resumes after entries_migrated, and keeps new writes working", async () => {
    const backend = new MemoryStoreBackend();
    await backend.open();
    const collectionIdentifier = "tasks_payload_format";
    const legacySnapshot = [
      { id: "keep", indexKey: "a0", value: { id: "keep", title: "Keep" }, deleted: false },
      { id: "edit", indexKey: "a1", value: { id: "edit", title: "Before" }, deleted: false },
      { id: "remove", indexKey: "a2", value: { id: "remove", title: "Remove" }, deleted: false },
    ];
    // Exactly what the legacy engine writes to mutation_log: a MutationId object and a payload.
    const legacyMutation = (sequence, op, payload) => ({
      id: { clientId: "client-1", counter: sequence },
      idStr: `client-1:${sequence}`,
      storeKey: collectionIdentifier,
      op,
      payload,
      state: "pending",
      createdAt: 1700000000000 + sequence,
    });
    const legacyMutations = [
      legacyMutation(1, "insert", { id: "offline", value: { id: "offline", title: "Offline" }, indexKey: "a3" }),
      legacyMutation(2, "update", { id: "edit", partial: { title: "After" } }),
      legacyMutation(3, "delete", { id: "remove" }),
      legacyMutation(4, "move", { id: "offline", targetIndex: 0 }),
    ];
    const runner = new ProductionV1MigrationRunner();
    const migrationInput = { legacySnapshotPayload: legacySnapshot, legacyMutationsPayload: legacyMutations };

    const interrupted = await runner.runV1Migration(collectionIdentifier, backend, {
      ...migrationInput,
      interruptAtStage: "entries_migrated",
    });
    assert.equal(interrupted.ok, false);
    assert.equal(await runner.isMigrationRequired(collectionIdentifier, backend, true), true);

    const resumed = await runner.runV1Migration(collectionIdentifier, backend, migrationInput);
    assert.equal(resumed.ok, true);

    const recovery = await recoverFromStoreOnBoot(backend, collectionIdentifier);
    assert.equal(recovery.ok, true);
    const engine = recovery.engine;
    const liveEntries = [...engine.entriesState.values()].filter((entry) => !entry.deleted);
    const orderedIdentifiers = liveEntries
      .sort((leftEntry, rightEntry) => (leftEntry.pos.indexKey < rightEntry.pos.indexKey ? -1 : 1))
      .map((entry) => entry.externalId);
    assert.deepEqual(orderedIdentifiers, ["offline", "keep", "edit"], "insert, delete and move replayed once, in order");
    assert.equal(liveEntries.find((entry) => entry.externalId === "edit").fields.title.value, "After");
    assert.equal(engine.entriesState.size, 4, "the resumed run did not duplicate entries");

    // The local stream was advanced: a new write does not reuse a migrated dot.
    const newWrite = await engine.allocateLocalMutation({
      kind: "insert",
      externalId: "after-migration",
      indexKey: "a9",
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: { title: "New" },
    });
    assert.equal(newWrite.ok, true, newWrite.code);
  });
});
