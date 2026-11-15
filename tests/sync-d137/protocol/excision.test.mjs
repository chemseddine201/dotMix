/**
 * D137-v33-reference Test Suite: Equivocation Excision Defect Closure (T-31.11 / D-139 Option A)
 * Proves: a fork after an applied op leaves no APPLIED entry at or above the fork point,
 * and rebuild equivalence holds.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D137Engine,
  computeCertificateSigningPayload,
  computeOperationDigest,
  computeOperationSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  rebuildEntriesState,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

async function createTestCluster() {
  const keyA = await generateSigningKeyPair("Ed25519", true);
  const keyB = await generateSigningKeyPair("Ed25519", true);
  const keyC = await generateSigningKeyPair("Ed25519", true);
  const certDraft = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: "todos",
    epochNumber: 1,
    epochCertificateId: "cert-epoch-1",
    coordinatorReplicaId: "A",
    coordinatorKeyId: "key:A:v1",
    memberBindings: {
      "A": { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      "B": { role: "WRITER_REPLICA", authorKeyId: "key:B:v1", authorPublicKeyHex: keyB.publicKeyHex, signingAlgorithm: "Ed25519" },
      "C": { role: "WRITER_REPLICA", authorKeyId: "key:C:v1", authorPublicKeyHex: keyC.publicKeyHex, signingAlgorithm: "Ed25519" },
    },
    baselineStableFrontier: { "1:A": 0, "1:B": 0, "1:C": 0 },
  };
  const certPayload = computeCertificateSigningPayload(certDraft);
  const coordinatorSignature = await signPayloadAsync(certPayload, keyA.privateKeyHex, "Ed25519");
  const cert = { ...certDraft, coordinatorSignature };
  const engineA = new D137Engine("todos", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
  const engineB = new D137Engine("todos", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);
  const engineC = new D137Engine("todos", "C", 1, cert, "key:C:v1", keyC.privateKeyHex);
  const channel = {
    channelId: "chan-1",
    channelAuthenticated: true,
    transportSenderReplicaId: "B",
  };
  return { engineA, engineB, engineC, keyA, keyB, keyC, cert, channel };
}

describe("D-137 Equivocation Excision Suite", () => {
  it("A fork after an applied op leaves no APPLIED entry at or above fork point and preserves rebuild equivalence", async () => {
    const { engineA, engineB, keyB, channel } = await createTestCluster();
    const op1 = (await engineB.allocateLocalMutation({ kind: "insert", externalId: "b-item-1", initialFields: { v: 1 } })).op;
    const op2 = (await engineB.allocateLocalMutation({ kind: "insert", externalId: "b-item-2", initialFields: { v: 2 } })).op;

    const r1 = await engineA.ingestRemoteOperation(op1, channel);
    const r2 = await engineA.ingestRemoteOperation(op2, channel);
    assert.equal(r1.disposition, "APPLIED");
    assert.equal(r2.disposition, "APPLIED");
    assert.equal(engineA.entriesState.has("1:B:1"), true);
    assert.equal(engineA.entriesState.has("1:B:2"), true);

    const forkDraft = {
      ...op1,
      initialFields: { v: "forked-conflict" },
    };
    const payloadDigest = computeOperationDigest(forkDraft);
    const authorSignature = await signPayloadAsync(computeOperationSigningPayload({ ...forkDraft, payloadDigest }), keyB.privateKeyHex, "Ed25519");
    const forkOp = { ...forkDraft, payloadDigest, authorSignature };

    const forkRes = await engineA.ingestRemoteOperation(forkOp, channel);
    assert.equal(forkRes.ok, false);
    assert.equal(forkRes.code, "D137_EQUIVOCATION_DETECTED");

    const eqRec = engineA.meta.activeEpochEquivocations["1:B"];
    assert.ok(eqRec, "Stream 1:B must have activeEpochEquivocations record");
    assert.equal(eqRec.firstEquivocatedSeq, 1);
    for (const [opKey, digRec] of engineA.operationDigests.entries()) {
      if (digRec.replicaId === "B" && digRec.sequence >= 1) {
        assert.notEqual(digRec.status, "APPLIED", `Digest ${opKey} must not be APPLIED`);
      }
    }
    for (const [opKey, jRec] of engineA.mutationJournal.entries()) {
      if (jRec.replicaId === "B" && jRec.sequence >= 1) {
        assert.notEqual(jRec.disposition, "APPLIED", `Journal ${opKey} must not be APPLIED`);
      }
    }

    assert.equal(engineA.entriesState.has("1:B:1"), false, "1:B:1 must be excised from entriesState");
    assert.equal(engineA.entriesState.has("1:B:2"), false, "1:B:2 must be excised from entriesState");

    const preRebuildSize = engineA.entriesState.size;
    rebuildEntriesState(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    assert.equal(engineA.entriesState.size, preRebuildSize);
    assert.equal(engineA.entriesState.has("1:B:1"), false);
    assert.equal(engineA.entriesState.has("1:B:2"), false);
  });
});

