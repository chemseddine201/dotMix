import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeSnapshotDigestSync,
  persistEngineToStore,
  recoverFromStoreOnBoot,
  IndexedDbStoreBackend,
} from "../../../packages/sync/dist/storage/idb-tx.js";
import { ReplicationEngine } from "../../../packages/sync/dist/protocol/engine.js";
import { MemoryStoreBackend } from "../../../packages/sync/dist/storage/memory-backend.js";
import { createMockIDBFactory } from "../../../packages/sync/dist/storage/idb-schema.js";
import { generateSigningKeyPair } from "../../../packages/sync/dist/protocol/signing.js";
import { createSelfSignedFoundingCertificateAsync } from "../../../packages/sync/dist/adapter/compensation.js";

const BACKENDS = [
  { name: "MemoryStoreBackend", create: () => new MemoryStoreBackend() },
  {
    name: "IndexedDbStoreBackend",
    create: () => new IndexedDbStoreBackend("test_boot_db", createMockIDBFactory()),
  },
];

for (const { name, create } of BACKENDS) {
  describe(`Boot recovery and snapshot fallback (${name})`, () => {
    function makeSnapshot(seq, collectionId, state, tampered = false) {
      const snap = {
        snapshotSeq: seq,
        collectionId,
        epochCertificate: {
          collectionId,
          epochNumber: 1,
          coordinatorSignature: "valid-sig-ed25519",
          tampered,
        },
        state,
        snapshotDigest: "",
      };
      snap.snapshotDigest = computeSnapshotDigestSync(snap);
      return snap;
    }

    it("recovers snapshot N when valid", async () => {
      const backend = create();
      await backend.open();

      const snap0 = makeSnapshot(0, "coll-1", { count: 0 });
      const snap1 = makeSnapshot(1, "coll-1", { count: 10 });

      await backend.runTransaction(["snapshots"], "readwrite", async (tx) => {
        await tx.put("snapshots", 0, snap0);
        await tx.put("snapshots", 1, snap1);
      });

      const recovery = await recoverFromStoreOnBoot(backend, "coll-1");
      assert.equal(recovery.ok, true);
      assert.equal(recovery.acceptedSnapSeq, 1);
      assert.equal(recovery.fallbackUsed, false);
      assert.deepEqual(recovery.snapshot?.state, { count: 10 });

      await backend.close();
    });

    it("S59: falls back to N-1 when snapshot N digest is corrupted", async () => {
      const backend = create();
      await backend.open();

      const snap0 = makeSnapshot(0, "coll-s59", { count: 0 });
      const snap1 = makeSnapshot(1, "coll-s59", { count: 100 });
      const corruptedSnap2 = {
        ...makeSnapshot(2, "coll-s59", { count: 200 }),
        snapshotDigest: "badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb",
      };

      await backend.runTransaction(["snapshots"], "readwrite", async (tx) => {
        await tx.put("snapshots", 0, snap0);
        await tx.put("snapshots", 1, snap1);
        await tx.put("snapshots", 2, corruptedSnap2);
      });

      const recovery = await recoverFromStoreOnBoot(backend, "coll-s59");
      assert.equal(recovery.ok, true);
      assert.equal(recovery.acceptedSnapSeq, 1);
      assert.equal(recovery.fallbackUsed, true);
      assert.deepEqual(recovery.snapshot?.state, { count: 100 });

      await backend.close();
    });

    it("S91: throws CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED when both N and N-1 are corrupted", async () => {
      const backend = create();
      await backend.open();

      const corruptedSnap0 = {
        ...makeSnapshot(0, "coll-s91", { count: 0 }),
        snapshotDigest: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      };
      const corruptedSnap1 = {
        ...makeSnapshot(1, "coll-s91", { count: 50 }),
        snapshotDigest: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      };

      await backend.runTransaction(["snapshots"], "readwrite", async (tx) => {
        await tx.put("snapshots", 0, corruptedSnap0);
        await tx.put("snapshots", 1, corruptedSnap1);
      });

      await assert.rejects(
        async () => recoverFromStoreOnBoot(backend, "coll-s91"),
        (err) => {
          assert(err.message.includes("CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED"));
          return true;
        }
      );

      await backend.close();
    });

    it("rejects snapshot with tampered epoch certificate and falls back to clean N-1", async () => {
      const backend = create();
      await backend.open();

      const cleanSnap0 = makeSnapshot(0, "coll-cert", { clean: true });
      const tamperedSnap1 = makeSnapshot(1, "coll-cert", { clean: false }, true); // tampered cert

      await backend.runTransaction(["snapshots"], "readwrite", async (tx) => {
        await tx.put("snapshots", 0, cleanSnap0);
        await tx.put("snapshots", 1, tamperedSnap1);
      });

      const recovery = await recoverFromStoreOnBoot(backend, "coll-cert");
      assert.equal(recovery.ok, true);
      assert.equal(recovery.acceptedSnapSeq, 0);
      assert.equal(recovery.fallbackUsed, true);
      assert.deepEqual(recovery.snapshot?.state, { clean: true });

      await backend.close();
    });

    it("persists production engine and reconstructs engine on boot", async () => {
      const backend = create();
      await backend.open();

      // A real self-signed founding certificate: boot recovery verifies its signature.
      const keyPair = await generateSigningKeyPair("ECDSA_P256", false);
      const cert = await createSelfSignedFoundingCertificateAsync("coll-engine", "A", keyPair);

      const engine = new ReplicationEngine("coll-engine", "A", 1, cert, "key:A:v1");
      await persistEngineToStore(backend, engine);

      const recovery = await recoverFromStoreOnBoot(backend, "coll-engine", "A");
      assert.equal(recovery.ok, true);
      assert(recovery.engine);
      assert.equal(recovery.engine.meta.collectionId, "coll-engine");
      assert.equal(recovery.engine.meta.replicaId, "A");

      await backend.close();
    });
  });
}
