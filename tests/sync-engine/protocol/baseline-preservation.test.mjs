/**
 * Sync-v33-reference: Baseline Snapshot Retention & Excision Rebuild Preservation
 *
 * Proves that rebuild(baseline + journal) === incremental for arbitrary
 * certified-op counts after multiple compactions and an excision above the floor.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ReplicationEngine,
  computeCertificateSigningPayload,
  computeOperationDigest,
  computeOperationSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  commitCheckpoint,
  rebuildEntriesState,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

describe("R: Baseline Snapshot Retention & Excision Rebuild Preservation", () => {
  it("rebuild(baseline + journal) preserves all certified ops <= floor after compaction and excision above floor", async () => {
    const keyA = await generateSigningKeyPair("Ed25519", true);
    const keyB = await generateSigningKeyPair("Ed25519", true);
    const keyC = await generateSigningKeyPair("Ed25519", true);

    const cert = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "items",
      epochNumber: 1,
      epochCertificateId: "cert-epoch-1",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
        B: { role: "WRITER_REPLICA", authorKeyId: "key:B:v1", authorPublicKeyHex: keyB.publicKeyHex, signingAlgorithm: "Ed25519" },
        C: { role: "WRITER_REPLICA", authorKeyId: "key:C:v1", authorPublicKeyHex: keyC.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 0, "1:B": 0, "1:C": 0 },
      coordinatorSignature: "initial-sig",
    };

    const engineA = new ReplicationEngine("items", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
    const engineB = new ReplicationEngine("items", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);
    const channelB = {
      channelId: "chan-b",
      channelAuthenticated: true,
      transportSenderReplicaId: "B",
    };

    // 1. Ingest certified operations 1:B:1..5
    const certifiedCount = 5;
    for (let i = 1; i <= certifiedCount; i++) {
      const mutRes = await engineB.allocateLocalMutation({
        kind: "insert",
        externalId: `item-b-${i}`,
        initialFields: { title: `Certified Item ${i}` },
      });
      assert.ok(mutRes.ok && mutRes.op);
      const ingestRes = await engineA.ingestRemoteOperation(mutRes.op, channelB);
      assert.ok(ingestRes.ok);
    }

    // 2. Raise certified floor to 5 via coordinator epoch-2 transition certificate
    const epoch2CertDraft = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 0, "1:B": certifiedCount, "1:C": 0 },
      coordinatorSignature: "",
    };
    const signingPayload = computeCertificateSigningPayload(epoch2CertDraft);
    const sig = await signPayloadAsync(signingPayload, keyA.privateKeyHex, "Ed25519");
    const epoch2Cert = { ...epoch2CertDraft, coordinatorSignature: sig };

    const transA = await engineA.ingestEpochTransitionCertificate(epoch2Cert);
    assert.equal(transA.ok, true);
    const transB = await engineB.ingestEpochTransitionCertificate(epoch2Cert);
    assert.equal(transB.ok, true);

    // Mark stable up to 5 across cluster
    engineA.meta.clusterAcks["A"] = { "1:B": certifiedCount };
    engineA.meta.clusterAcks["B"] = { "1:B": certifiedCount };
    engineA.meta.clusterAcks["C"] = { "1:B": certifiedCount };
    engineA.meta.frontiers.stableFrontier["1:B"] = certifiedCount;

    // 3. Commit multiple checkpoints to trigger compaction and journal truncation
    commitCheckpoint(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    commitCheckpoint(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);

    assert.equal(engineA.meta.frontiers.compactionFrontier["1:B"], certifiedCount);

    // 4. Ingest uncertified op 2:B:1 ALPHA in epoch 2
    const op1A = (await engineB.allocateLocalMutation({
      kind: "insert",
      externalId: "item-b-6",
      initialFields: { title: "Item 6 ALPHA" },
    })).op;
    await engineA.ingestRemoteOperation(op1A, channelB);

    // 5. Create authentic conflicting op 2:B:1 BETA
    const draft1B = { ...op1A, initialFields: { title: "Item 6 BETA" } };
    const payloadDigest1B = computeOperationDigest(draft1B);
    const sigPayload1B = computeOperationSigningPayload({ ...draft1B, payloadDigest: payloadDigest1B });
    const authorSignature1B = await signPayloadAsync(sigPayload1B, keyB.privateKeyHex, "Ed25519");
    const op1B = { ...draft1B, payloadDigest: payloadDigest1B, authorSignature: authorSignature1B };

    // 6. Ingest conflicting op to trigger equivocation and excision above floor
    const eqRes = await engineA.ingestRemoteOperation(op1B, channelB);
    assert.equal(eqRes.ok, false);
    assert.equal(eqRes.code, "SYNC_EQUIVOCATION_DETECTED");

    // 7. Verify rebuild(baseline + journal) preserves ALL certified ops 1..5
    for (let i = 1; i <= certifiedCount; i++) {
      assert.ok(engineA.entriesState.has(`1:B:${i}`), `Certified op 1:B:${i} must survive excision rebuild without data loss`);
    }

    assert.ok(!engineA.entriesState.has("2:B:1"), "Uncertified op 2:B:1 must be excised");
    assert.equal(engineA.meta.frontiers.localDurableFrontier["1:B"], certifiedCount);
    assert.equal(engineA.meta.frontiers.compactionFrontier["1:B"], certifiedCount);
    assert.equal(engineA.meta.frontiers.localDurableFrontier["2:B"], 0);

    const reconstructedState = new Map(engineA.entriesState);
    rebuildEntriesState(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    assert.equal(engineA.entriesState.size, reconstructedState.size);
    for (const [k, v] of reconstructedState) {
      assert.deepEqual(engineA.entriesState.get(k), v);
    }
  });
});

