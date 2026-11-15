/**
 * T-31.16: D-157 Epoch Close Rule & Certificate-Governed Key Revocation
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D137Engine,
  computeCertificateSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  materializeVisibleArray,
  canonicalizeValue,
  sha256Hex,
  planClusterExportReplay,
  resumeActivation,
  commitCheckpoint,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

function visibleDigest(engine) {
  return sha256Hex(canonicalizeValue(materializeVisibleArray(engine.entriesState).items));
}

async function createTwoNodeCluster() {
  const keyA = await generateSigningKeyPair("Ed25519", true);
  const keyB = await generateSigningKeyPair("Ed25519", true);
  const certDraft = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: "todos",
    epochNumber: 1,
    epochCertificateId: "cert-epoch-1",
    coordinatorReplicaId: "A",
    coordinatorKeyId: "key:A:v1",
    memberBindings: {
      A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      B: { role: "WRITER_REPLICA", authorKeyId: "key:B:v1", authorPublicKeyHex: keyB.publicKeyHex, signingAlgorithm: "Ed25519" },
    },
    baselineStableFrontier: { "1:A": 0, "1:B": 0 },
  };
  const sigA = await signPayloadAsync(computeCertificateSigningPayload(certDraft), keyA.privateKeyHex, "Ed25519");
  const cert = { ...certDraft, coordinatorSignature: sigA };
  const engineA = new D137Engine("todos", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
  const engineB = new D137Engine("todos", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);
  const chanA = { channelId: "c-A", channelAuthenticated: true, transportSenderReplicaId: "A" };
  const chanB = { channelId: "c-B", channelAuthenticated: true, transportSenderReplicaId: "B" };
  return { engineA, engineB, keyA, keyB, cert, chanA, chanB };
}

describe("T-31.16: D-157 Epoch Close Rule & Certificate-Governed Key Revocation", () => {
  it("Test 1: An in-flight op at transition converges on all replicas", async () => {
    const { engineA, engineB, keyA, chanA } = await createTwoNodeCluster();
    const op1 = (await engineA.allocateLocalMutation({ kind: "insert", externalId: "x1", initialFields: { v: 1 } })).op;
    const resB1 = await engineB.ingestRemoteOperation(op1, chanA);
    assert.equal(resB1.ok, true);

    const op2 = (await engineA.allocateLocalMutation({ kind: "insert", externalId: "x2", initialFields: { v: 2 } })).op;
    assert.equal(op2.opDot.sequence, 2);

    const cert2Draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 1, "1:B": 0 },
    };
    const sig2 = await signPayloadAsync(computeCertificateSigningPayload(cert2Draft), keyA.privateKeyHex, "Ed25519");
    const cert2 = { ...cert2Draft, coordinatorSignature: sig2 };

    const transA = await engineA.ingestEpochTransitionCertificate(cert2);
    assert.equal(transA.ok, true);
    const transB = await engineB.ingestEpochTransitionCertificate(cert2);
    assert.equal(transB.ok, true);

    assert.equal(engineA.meta.epochNumber, 2);
    const reissuedOp = engineA.mutationJournal.get("todos:2:A:1")?.operation;
    assert.ok(reissuedOp, "Re-issued op must exist in epoch 2");
    assert.equal(reissuedOp.externalId, "x2");
    assert.equal(reissuedOp.opDot.epochNumber, 2);
    assert.equal(reissuedOp.opDot.sequence, 1);

    const resB2 = await engineB.ingestRemoteOperation(reissuedOp, chanA);
    assert.equal(resB2.ok, true);
    assert.equal(resB2.disposition, "APPLIED");

    assert.equal(visibleDigest(engineA), visibleDigest(engineB));
    const itemsA = materializeVisibleArray(engineA.entriesState).items.map((i) => i.id);
    assert.deepEqual(itemsA.sort(), ["x1", "x2"]);
  });

  it("Test 2: A late epoch-E op is rejected identically everywhere", async () => {
    const { engineA, engineB, keyA, chanA } = await createTwoNodeCluster();
    const op1 = (await engineA.allocateLocalMutation({ kind: "insert", externalId: "x1", initialFields: { v: 1 } })).op;
    await engineB.ingestRemoteOperation(op1, chanA);

    const op2 = (await engineA.allocateLocalMutation({ kind: "insert", externalId: "x2", initialFields: { v: 2 } })).op;

    const cert2Draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 1, "1:B": 0 },
    };
    const sig2 = await signPayloadAsync(computeCertificateSigningPayload(cert2Draft), keyA.privateKeyHex, "Ed25519");
    const cert2 = { ...cert2Draft, coordinatorSignature: sig2 };
    await engineA.ingestEpochTransitionCertificate(cert2);
    await engineB.ingestEpochTransitionCertificate(cert2);

    const rejA = await engineA.ingestRemoteOperation(op2, chanA);
    assert.equal(rejA.ok, false);
    assert.equal(rejA.code, "D137_EPOCH_CLOSED");
    assert.equal(rejA.disposition, "D137_EPOCH_CLOSED");

    const rejB = await engineB.ingestRemoteOperation(op2, chanA);
    assert.equal(rejB.ok, false);
    assert.equal(rejB.code, "D137_EPOCH_CLOSED");
    assert.equal(rejB.disposition, "D137_EPOCH_CLOSED");

    assert.equal(engineA.operationDigests.get("todos:1:A:2")?.status, "D137_EPOCH_CLOSED");
    assert.equal(engineB.operationDigests.get("todos:1:A:2")?.status, "D137_EPOCH_CLOSED");
  });

  it("Test 3: The author's discarded op reappears in E+1", async () => {
    const { engineA, keyA } = await createTwoNodeCluster();
    engineA.meta.remoteSyncEnabled = true;
    await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-keep", initialFields: { v: 1 } });
    await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-discarded", initialFields: { v: 2 } });

    const cert2Draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 1 },
    };
    const sig2 = await signPayloadAsync(computeCertificateSigningPayload(cert2Draft), keyA.privateKeyHex, "Ed25519");
    const cert2 = { ...cert2Draft, coordinatorSignature: sig2 };
    await engineA.ingestEpochTransitionCertificate(cert2);

    assert.equal(engineA.meta.epochNumber, 2);
    assert.ok(engineA.mutationJournal.has("todos:2:A:1"));
    assert.ok(engineA.syncOutbox.has("todos:2:A:1"));
    const items = materializeVisibleArray(engineA.entriesState).items.map((i) => i.id);
    assert.ok(items.includes("item-discarded"), "Author's intent must not be lost");
  });

  it("Test 4: Revocation via a certificate converges", async () => {
    const { engineA, engineB, keyA } = await createTwoNodeCluster();
    const cert2Draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
        B: { role: "WRITER_REPLICA", authorKeyId: "key:B:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 0, "1:B": 0 },
      revokedKeyIds: ["key:B:v1"],
    };
    const sig2 = await signPayloadAsync(computeCertificateSigningPayload(cert2Draft), keyA.privateKeyHex, "Ed25519");
    const cert2 = { ...cert2Draft, coordinatorSignature: sig2 };
    const transA = await engineA.ingestEpochTransitionCertificate(cert2);
    assert.equal(transA.ok, true);
    const transB = await engineB.ingestEpochTransitionCertificate(cert2);
    assert.equal(transB.ok, true);

    assert.deepEqual(engineA.meta.revokedKeyIds, ["key:B:v1"]);
    assert.deepEqual(engineB.meta.revokedKeyIds, ["key:B:v1"]);

    const opByRevokedKey = await engineB.allocateLocalMutation({ kind: "insert", externalId: "b-attack", initialFields: {} });
    assert.equal(opByRevokedKey.ok, false);
    assert.equal(opByRevokedKey.code, "D137_REVOKED_AUTHOR_KEY");
  });

  it("Test 5: Insert + update + delete by one author all above the floor produces clean final intent without orphaned ops", async () => {
    const { engineA, engineB, keyA, chanA } = await createTwoNodeCluster();
    engineA.meta.remoteSyncEnabled = true;

    const op0 = (await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-stable", initialFields: { v: 0 } })).op;
    await engineB.ingestRemoteOperation(op0, chanA);

    const ins = (await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-ephemeral", initialFields: { v: 1 } })).op;
    await engineA.allocateLocalMutation({ kind: "update", targetIncarnation: ins.opDot, externalId: "item-ephemeral", partialFields: { v: 2 } });
    await engineA.allocateLocalMutation({ kind: "delete", targetIncarnation: ins.opDot, externalId: "item-ephemeral" });

    const cert2Draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 1, "1:B": 0 },
    };
    const sig2 = await signPayloadAsync(computeCertificateSigningPayload(cert2Draft), keyA.privateKeyHex, "Ed25519");
    const cert2 = { ...cert2Draft, coordinatorSignature: sig2 };
    await engineA.ingestEpochTransitionCertificate(cert2);
    await engineB.ingestEpochTransitionCertificate(cert2);

    const visA = materializeVisibleArray(engineA.entriesState).items.map((i) => i.id);
    const visB = materializeVisibleArray(engineB.entriesState).items.map((i) => i.id);
    assert.deepEqual(visA, ["item-stable"]);
    assert.deepEqual(visB, ["item-stable"]);
  });

  it("Test 6: Crash between transition and re-issue resumes re-issue plan cleanly", async () => {
    const { engineA, keyA } = await createTwoNodeCluster();
    engineA.meta.remoteSyncEnabled = true;

    await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-1", initialFields: { v: 1 } });
    await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-2", initialFields: { v: 2 } });

    const cert2Draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 1 },
    };
    const sig2 = await signPayloadAsync(computeCertificateSigningPayload(cert2Draft), keyA.privateKeyHex, "Ed25519");
    const cert2 = { ...cert2Draft, coordinatorSignature: sig2 };

    await engineA.ingestEpochTransitionCertificate(cert2);
    assert.ok(engineA.mutationJournal.has("todos:2:A:1"));

    const baseSnap = engineA.snapshotsV2.get(engineA.meta.activeSnapshotSeq);
    const syntheticPlan = planClusterExportReplay(
      new Map([
        [
          "crash-inc",
          {
            targetBirthDot: { epochNumber: 1, replicaId: "A", sequence: 99 },
            externalId: "item-resumed",
            pos: { indexKey: "a0", stamp: { lamport: 99, epochNumber: 1, replicaId: "A", sequence: 99 }, leftNeighbor: null, rightNeighbor: null },
            fields: { title: { value: "Crash Resumed", stamp: { lamport: 99, epochNumber: 1, replicaId: "A", sequence: 99 }, present: true } },
            deleted: false,
            deleteDots: [],
          },
        ],
      ]),
      baseSnap,
      "todos",
      2
    );
    engineA.meta.activeReplayPlan = syntheticPlan;

    await resumeActivation(engineA);

    assert.equal(engineA.meta.activeReplayPlan, undefined);
    const items = materializeVisibleArray(engineA.entriesState).items.map((i) => i.id);
    assert.ok(items.includes("item-resumed"), "Crash-resumed replay plan must apply mutations");
  });

  it("Test 7: Local checkpoint above floor followed by transition clamps snapshotIncludedFrontier and knownProducedFrontier", async () => {
    const { engineA, keyA } = await createTwoNodeCluster();

    for (let i = 1; i <= 5; i++) {
      await engineA.allocateLocalMutation({ kind: "insert", externalId: `item-${i}`, initialFields: { v: i } });
    }

    commitCheckpoint(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    assert.equal(engineA.meta.frontiers.snapshotIncludedFrontier["1:A"], 5);
    assert.equal(engineA.meta.frontiers.knownProducedFrontier["1:A"], 5);

    const cert2Draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 3, "1:B": 0 },
    };
    const sig2 = await signPayloadAsync(computeCertificateSigningPayload(cert2Draft), keyA.privateKeyHex, "Ed25519");
    const cert2 = { ...cert2Draft, coordinatorSignature: sig2 };
    await engineA.ingestEpochTransitionCertificate(cert2);

    assert.equal(engineA.meta.frontiers.localDurableFrontier["1:A"], 3);
    assert.equal(engineA.meta.frontiers.snapshotIncludedFrontier["1:A"], 3);
    assert.equal(engineA.meta.frontiers.knownProducedFrontier["1:A"], 3);
    assert.ok(engineA.meta.frontiers.snapshotIncludedFrontier["1:A"] <= engineA.meta.frontiers.localDurableFrontier["1:A"]);
  });
});

