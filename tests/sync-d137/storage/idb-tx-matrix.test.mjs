import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryStoreBackend,
} from "../../../packages/sync/dist/storage/memory-backend.js";
import {
  IndexedDbStoreBackend,
  computeDigestSync,
  runTx1LocalAllocation,
  runTx2RemoteDrain,
  runTx3TabLeaseRenewal,
  runTx4DurableAckReceipt,
  runTx5ServerAcceptanceAck,
  runTx6CheckpointCommit,
  runTx7Compaction,
  runTx8EpochTransition,
  runTx9OfflineQuarantine,
  runTx10ReplayBatch,
  runTx11LegacyMigration,
  runTx12AntiEntropyPull,
  runTx13EquivocationExcision,
  TX1_LOCAL_ALLOCATION_STORES,
  TX2_REMOTE_DRAIN_STORES,
  TX3_TAB_LEASE_RENEWAL_STORES,
  TX4_DURABLE_ACK_RECEIPT_STORES,
  TX5_SERVER_ACCEPTANCE_ACK_STORES,
  TX6_CHECKPOINT_COMMIT_STORES,
  TX7_COMPACTION_STORES,
  TX8_EPOCH_TRANSITION_STORES,
  TX9_OFFLINE_QUARANTINE_STORES,
  TX10_REPLAY_BATCH_STORES,
  TX11_LEGACY_MIGRATION_STORES,
  TX12_ANTI_ENTROPY_PULL_STORES,
  TX13_EQUIVOCATION_EXCISION_STORES,
} from "../../../packages/sync/dist/storage/idb-tx.js";
import { createMockIDBFactory } from "../../../packages/sync/dist/storage/idb-schema.js";

const BACKENDS = [
  { name: "MemoryStoreBackend", create: () => new MemoryStoreBackend() },
  {
    name: "IndexedDbStoreBackend",
    create: () => new IndexedDbStoreBackend("test_tx_matrix", createMockIDBFactory()),
  },
];

for (const { name, create } of BACKENDS) {
  describe(`T-33.5 / Tx #1..#13 Scope Matrix & Invariants (${name})`, () => {
    it("Tx #1 (Local Allocation) permits declared stores and rejects out-of-scope store", async () => {
      const backend = create();
      await backend.open();

      await runTx1LocalAllocation(backend, async (tx) => {
        await tx.put("replica_meta", "meta1", { key: "val" });
        await tx.put("entries_state", "entry1", { field: 1 });
        await tx.put("mutation_journal", "op1", { op: "ins" });
        await tx.put("sync_outbox", "out1", { payload: "abc" });
        await tx.put("operation_digests", "dig1", { hash: "0123" });

        // snapshots is NOT in Tx #1 scope -> must reject
        await assert.rejects(
          async () => tx.put("snapshots", 1, { corrupted: true }),
          /not included in transaction scope/
        );
      });

      await backend.close();
    });

    it("verifies exact declared store count for all 13 transaction scopes", () => {
      assert.deepEqual(TX1_LOCAL_ALLOCATION_STORES, [
        "replica_meta", "entries_state", "mutation_journal", "sync_outbox", "operation_digests"
      ]);
      assert.deepEqual(TX2_REMOTE_DRAIN_STORES, [
        "replica_meta", "entries_state", "mutation_journal", "operation_digests", "inbound_gap_buffer", "quarantine_journal", "cluster_acks"
      ]);
      assert.deepEqual(TX3_TAB_LEASE_RENEWAL_STORES, [
        "replica_meta", "tab_leases"
      ]);
      assert.deepEqual(TX4_DURABLE_ACK_RECEIPT_STORES, [
        "replica_meta", "cluster_acks"
      ]);
      assert.deepEqual(TX5_SERVER_ACCEPTANCE_ACK_STORES, [
        "replica_meta", "sync_outbox"
      ]);
      assert.deepEqual(TX6_CHECKPOINT_COMMIT_STORES, [
        "replica_meta", "snapshots", "mutation_journal", "operation_digests"
      ]);
      assert.deepEqual(TX7_COMPACTION_STORES, [
        "replica_meta", "entries_state", "mutation_journal"
      ]);
      assert.deepEqual(TX8_EPOCH_TRANSITION_STORES, [
        "replica_meta", "snapshots", "entries_state", "mutation_journal", "sync_outbox", "inbound_gap_buffer", "inbound_dependency_buffer", "quarantine_journal", "replay_state"
      ]);
      assert.deepEqual(TX9_OFFLINE_QUARANTINE_STORES, [
        "replica_meta", "quarantine_journal", "replay_state"
      ]);
      assert.deepEqual(TX10_REPLAY_BATCH_STORES, [
        "replica_meta", "entries_state", "mutation_journal", "sync_outbox", "replay_state"
      ]);
      assert.deepEqual(TX11_LEGACY_MIGRATION_STORES, [
        "replica_meta", "entries_state", "mutation_journal", "legacy_archive"
      ]);
      assert.deepEqual(TX12_ANTI_ENTROPY_PULL_STORES, [
        "replica_meta", "inbound_gap_buffer", "mutation_journal", "entries_state", "operation_digests"
      ]);
      assert.deepEqual(TX13_EQUIVOCATION_EXCISION_STORES, [
        "replica_meta", "entries_state", "mutation_journal", "snapshots", "quarantine_journal"
      ]);
    });

    it("runs Tx #2..Tx #13 successfully with declared stores", async () => {
      const backend = create();
      await backend.open();

      await runTx2RemoteDrain(backend, async (tx) => {
        await tx.put("inbound_gap_buffer", "drain-1", { gap: true });
      });

      await runTx3TabLeaseRenewal(backend, async (tx) => {
        await tx.put("tab_leases", "tab-1", { term: 1 });
      });

      await runTx4DurableAckReceipt(backend, async (tx) => {
        await tx.put("cluster_acks", "ack-1", { seq: 5 });
      });

      await runTx5ServerAcceptanceAck(backend, async (tx) => {
        await tx.put("sync_outbox", "ack-target", { acked: true });
      });

      await runTx6CheckpointCommit(backend, async (tx) => {
        await tx.put("snapshots", 1, { snapshotSeq: 1 });
      });

      await runTx7Compaction(backend, async (tx) => {
        await tx.put("mutation_journal", "compacted-1", { compacted: true });
      });

      await runTx8EpochTransition(backend, async (tx) => {
        await tx.put("replay_state", "epoch-transition", { epoch: 2 });
      });

      await runTx9OfflineQuarantine(backend, async (tx) => {
        await tx.put("quarantine_journal", "q-1", { reason: "test" });
      });

      await runTx10ReplayBatch(backend, async (tx) => {
        await tx.put("replay_state", "batch-1", { replayed: true });
      });

      await runTx11LegacyMigration(backend, async (tx) => {
        await tx.put("legacy_archive", "v1-arch", { migrated: true });
      });

      await runTx12AntiEntropyPull(backend, async (tx) => {
        await tx.put("inbound_gap_buffer", "gap-1", { gap: true });
      });

      await runTx13EquivocationExcision(backend, async (tx) => {
        await tx.put("quarantine_journal", "excision-1", { excised: true });
      });

      await backend.close();
    });

    it("computes rolling digests synchronously with zero async tick drift", () => {
      const d1 = computeDigestSync("operation:1:A:10");
      const d2 = computeDigestSync("operation:1:A:10");
      const d3 = computeDigestSync("operation:1:A:11");

      assert.equal(typeof d1, "string");
      assert.equal(d1.length, 64);
      assert.equal(d1, d2);
      assert.notEqual(d1, d3);
    });

    it("executes post-commit callbacks with subscriber isolation (I21)", async () => {
      const backend = create();
      await backend.open();

      let subscriber1Ran = false;
      let subscriber2Ran = false;

      await runTx1LocalAllocation(backend, async (tx) => {
        await tx.put("entries_state", "key1", { v: 100 });

        // Register post-commit callbacks
        tx.onCommit(() => {
          subscriber1Ran = true;
          throw new Error("Subscriber 1 exploded!");
        });

        tx.onCommit(() => {
          subscriber2Ran = true;
        });
      });

      // Both callbacks executed, and the transaction succeeded despite subscriber 1 throwing
      assert.equal(subscriber1Ran, true);
      assert.equal(subscriber2Ran, true);

      // Verify the write became durable
      await runTx1LocalAllocation(backend, async (tx) => {
        const val = await tx.get("entries_state", "key1");
        assert.deepEqual(val, { v: 100 });
      });

      await backend.close();
    });
  });
}
