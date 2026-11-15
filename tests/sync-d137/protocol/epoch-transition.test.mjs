/**
 * D137-v33-reference: Coordinator-Signed Epoch Transition & Invariant Tests (T-31.5R2)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D137Engine,
  computeCertificateSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  toOperationKey,
  commitCheckpoint,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

async function createCluster() {
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
    coordinatorSignature: "sig-1",
  };
  const engineA = new D137Engine("items", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
  const engineB = new D137Engine("items", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);
  const channelB = {
    channelId: "chan-b",
    channelAuthenticated: true,
    transportSenderReplicaId: "B",
  };
  return { engineA, engineB, keyA, keyB, keyC, cert, channelB };
}

describe("T-31.5R2: Coordinator-Signed Epoch Transition & Negative Invariants", () => {
  it("Negative: unsigned certificate is rejected with D137_CERTIFICATE_SIGNATURE_INVALID and leaves state unchanged", async () => {
    const { engineA, cert } = await createCluster();
    const unsignedCert = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 0, "1:B": 0, "1:C": 0 },
      coordinatorSignature: "",
    };
    const metaBefore = JSON.stringify(engineA.meta);
    const snapKeysBefore = [...engineA.snapshotsV2.keys()].sort();
    const activeSnapBefore = engineA.meta.activeSnapshotSeq;
    const journalSizeBefore = engineA.mutationJournal.size;
    const res = await engineA.ingestEpochTransitionCertificate(unsignedCert);
    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_CERTIFICATE_SIGNATURE_INVALID");
    assert.equal(JSON.stringify(engineA.meta), metaBefore);
    assert.deepEqual([...engineA.snapshotsV2.keys()].sort(), snapKeysBefore);
    assert.equal(engineA.meta.activeSnapshotSeq, activeSnapBefore);
    assert.equal(engineA.mutationJournal.size, journalSizeBefore);
  });

  it("Negative: certificate signed with wrong coordinator key is rejected with D137_CERTIFICATE_SIGNATURE_INVALID", async () => {
    const { engineA, keyB, cert } = await createCluster();
    const draftCert = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 0, "1:B": 0, "1:C": 0 },
      coordinatorSignature: "",
    };
    const payload = computeCertificateSigningPayload(draftCert);
    const forgedSig = await signPayloadAsync(payload, keyB.privateKeyHex, "Ed25519");
    const badCert = { ...draftCert, coordinatorSignature: forgedSig };
    const metaBefore = JSON.stringify(engineA.meta);
    const snapKeysBefore = [...engineA.snapshotsV2.keys()].sort();
    const activeSnapBefore = engineA.meta.activeSnapshotSeq;
    const journalSizeBefore = engineA.mutationJournal.size;
    const res = await engineA.ingestEpochTransitionCertificate(badCert);
    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_CERTIFICATE_SIGNATURE_INVALID");
    assert.equal(JSON.stringify(engineA.meta), metaBefore);
    assert.deepEqual([...engineA.snapshotsV2.keys()].sort(), snapKeysBefore);
    assert.equal(engineA.meta.activeSnapshotSeq, activeSnapBefore);
    assert.equal(engineA.mutationJournal.size, journalSizeBefore);
  });

  it("Negative: epoch not current + 1 is rejected with D137_EPOCH_TRANSITION_INVALID", async () => {
    const { engineA, keyA, cert } = await createCluster();
    const metaBefore = JSON.stringify(engineA.meta);
    const snapKeysBefore = [...engineA.snapshotsV2.keys()].sort();
    const activeSnapBefore = engineA.meta.activeSnapshotSeq;
    const journalSizeBefore = engineA.mutationJournal.size;

    const draftSame = {
      ...cert,
      epochNumber: 1,
      epochCertificateId: "cert-epoch-1-v2",
      coordinatorSignature: "",
    };
    const sigSame = await signPayloadAsync(computeCertificateSigningPayload(draftSame), keyA.privateKeyHex, "Ed25519");
    const certSame = { ...draftSame, coordinatorSignature: sigSame };
    const resSame = await engineA.ingestEpochTransitionCertificate(certSame);
    assert.equal(resSame.ok, false);
    assert.equal(resSame.code, "D137_EPOCH_TRANSITION_INVALID");
    assert.equal(JSON.stringify(engineA.meta), metaBefore);
    assert.deepEqual([...engineA.snapshotsV2.keys()].sort(), snapKeysBefore);
    assert.equal(engineA.meta.activeSnapshotSeq, activeSnapBefore);
    assert.equal(engineA.mutationJournal.size, journalSizeBefore);

    const draftSkip = {
      ...cert,
      epochNumber: 3,
      epochCertificateId: "cert-epoch-3",
      coordinatorSignature: "",
    };
    const sigSkip = await signPayloadAsync(computeCertificateSigningPayload(draftSkip), keyA.privateKeyHex, "Ed25519");
    const certSkip = { ...draftSkip, coordinatorSignature: sigSkip };
    const resSkip = await engineA.ingestEpochTransitionCertificate(certSkip);
    assert.equal(resSkip.ok, false);
    assert.equal(resSkip.code, "D137_EPOCH_TRANSITION_INVALID");
    assert.equal(JSON.stringify(engineA.meta), metaBefore);
    assert.deepEqual([...engineA.snapshotsV2.keys()].sort(), snapKeysBefore);
    assert.equal(engineA.meta.activeSnapshotSeq, activeSnapBefore);
    assert.equal(engineA.mutationJournal.size, journalSizeBefore);
  });

  it("Negative: lowered floor is rejected with D137_CERTIFICATE_FLOOR_REGRESSION (Gate 32 Risk D-1)", async () => {
    const { engineA, keyA, cert } = await createCluster();
    engineA.meta.epochCertificate = {
      ...cert,
      baselineStableFrontier: { "1:A": 2, "1:B": 0, "1:C": 0 },
    };
    const metaBefore = JSON.stringify(engineA.meta);
    const snapKeysBefore = [...engineA.snapshotsV2.keys()].sort();
    const activeSnapBefore = engineA.meta.activeSnapshotSeq;
    const journalSizeBefore = engineA.mutationJournal.size;
    const draftLower = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 1, "1:B": 0, "1:C": 0 },
      coordinatorSignature: "",
    };
    const sigLower = await signPayloadAsync(computeCertificateSigningPayload(draftLower), keyA.privateKeyHex, "Ed25519");
    const certLower = { ...draftLower, coordinatorSignature: sigLower };
    const res = await engineA.ingestEpochTransitionCertificate(certLower);
    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_CERTIFICATE_FLOOR_REGRESSION");
    assert.equal(JSON.stringify(engineA.meta), metaBefore);
    assert.deepEqual([...engineA.snapshotsV2.keys()].sort(), snapKeysBefore);
    assert.equal(engineA.meta.activeSnapshotSeq, activeSnapBefore);
    assert.equal(engineA.mutationJournal.size, journalSizeBefore);
  });

  it("Negative: floor above local durable frontier is rejected with D137_EPOCH_TRANSITION_NOT_READY", async () => {
    const { engineA, keyA, cert } = await createCluster();
    const metaBefore = JSON.stringify(engineA.meta);
    const snapKeysBefore = [...engineA.snapshotsV2.keys()].sort();
    const activeSnapBefore = engineA.meta.activeSnapshotSeq;
    const journalSizeBefore = engineA.mutationJournal.size;

    const draftAbove = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 0, "1:B": 5, "1:C": 0 },
      coordinatorSignature: "",
    };
    const sigAbove = await signPayloadAsync(computeCertificateSigningPayload(draftAbove), keyA.privateKeyHex, "Ed25519");
    const certAbove = { ...draftAbove, coordinatorSignature: sigAbove };
    const res = await engineA.ingestEpochTransitionCertificate(certAbove);
    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_EPOCH_TRANSITION_NOT_READY");
    assert.equal(JSON.stringify(engineA.meta), metaBefore);
    assert.deepEqual([...engineA.snapshotsV2.keys()].sort(), snapKeysBefore);
    assert.equal(engineA.meta.activeSnapshotSeq, activeSnapBefore);
    assert.equal(engineA.mutationJournal.size, journalSizeBefore);
  });

  it("Positive: valid coordinator-signed epoch transition commits baseline snapshot at new floor, advances epoch to 2, and resets nextLocalSequence to 1", async () => {
    const { engineA, engineB, keyA, cert, channelB } = await createCluster();
    for (let i = 1; i <= 3; i++) {
      const op = (await engineB.allocateLocalMutation({
        kind: "insert",
        externalId: `b-${i}`,
        initialFields: { val: i },
      })).op;
      await engineA.ingestRemoteOperation(op, channelB);
    }
    assert.equal(engineA.meta.frontiers.localDurableFrontier["1:B"], 3);

    await engineA.allocateLocalMutation({ kind: "insert", externalId: "a-1", initialFields: { v: 1 } });
    await engineA.allocateLocalMutation({ kind: "insert", externalId: "a-2", initialFields: { v: 2 } });
    assert.equal(engineA.meta.nextLocalSequence, 3);

    const draftTransition = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 2, "1:B": 3, "1:C": 0 },
      coordinatorSignature: "",
    };
    const sig = await signPayloadAsync(computeCertificateSigningPayload(draftTransition), keyA.privateKeyHex, "Ed25519");
    const validCert = { ...draftTransition, coordinatorSignature: sig };
    const res = await engineA.ingestEpochTransitionCertificate(validCert);
    assert.equal(res.ok, true);

    assert.equal(engineA.meta.epochNumber, 2);
    assert.equal(engineA.meta.epochCertificateId, "cert-epoch-2");
    assert.equal(engineA.meta.nextLocalSequence, 1);

    assert.ok(engineA.meta.baselineSnapshotSeq);
    const baseSnap = engineA.snapshotsV2.get(engineA.meta.baselineSnapshotSeq);
    assert.ok(baseSnap);
    assert.equal(baseSnap.frontiers.snapshotIncludedFrontier["1:B"], 3);
    assert.equal(baseSnap.frontiers.snapshotIncludedFrontier["1:A"], 2);

    for (const snap of engineA.snapshotsV2.values()) {
      assert.deepEqual(snap.baselineStableFrontier, snap.epochCertificate.baselineStableFrontier);
      assert.equal(snap.epochNumber, snap.epochCertificate.epochNumber);
      assert.equal(snap.epochCertificateId, snap.epochCertificate.epochCertificateId);
    }

    engineA.meta.frontiers.stableFrontier["1:B"] = 3;
    engineA.meta.frontiers.stableFrontier["1:A"] = 2;
    commitCheckpoint(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    commitCheckpoint(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    assert.equal(engineA.meta.frontiers.compactionFrontier["1:B"], 3);
    assert.equal(engineA.meta.frontiers.compactionFrontier["1:A"], 2);
  });

  it("Race Item 1: Lamport clock never regresses during concurrent remote ingestion (20 runs)", async () => {
    for (let run = 0; run < 20; run++) {
      const { engineA, engineB, channelB } = await createCluster();
      const remoteOps = [];
      for (let i = 1; i <= 40; i++) {
        const op = (await engineB.allocateLocalMutation({ kind: "insert", externalId: `b-${run}-${i}`, initialFields: { v: i } })).op;
        remoteOps.push(op);
      }
      const localAllocPromise = engineA.allocateLocalMutation({ kind: "insert", externalId: `a-race-${run}`, initialFields: { v: 1 } });
      const remoteIngestPromise = Promise.all(remoteOps.map(op => engineA.ingestRemoteOperation(op, channelB)));
      const [localRes] = await Promise.all([localAllocPromise, remoteIngestPromise]);
      assert.equal(localRes.ok, true);

      const maxObserved = Math.max(...remoteOps.map(op => op.stamp.lamport), localRes.op.stamp.lamport);
      assert.ok(engineA.meta.localLamport >= maxObserved);

      const nextLocal = await engineA.allocateLocalMutation({ kind: "insert", externalId: `a-next-${run}`, initialFields: { v: 2 } });
      assert.equal(nextLocal.ok, true);
      assert.ok(nextLocal.op.stamp.lamport > maxObserved);
    }
  });

  it("Race Item 2: Allocation across epoch transition never commits mismatched epoch (20 runs)", async () => {
    for (let run = 0; run < 20; run++) {
      const { engineA, keyA, cert } = await createCluster();
      const draft2 = {
        ...cert,
        epochNumber: 2,
        epochCertificateId: `cert-epoch-2-${run}`,
        baselineStableFrontier: { "1:A": 0, "1:B": 0, "1:C": 0 },
        coordinatorSignature: "",
      };
      const sig = await signPayloadAsync(computeCertificateSigningPayload(draft2), keyA.privateKeyHex, "Ed25519");
      const cert2 = { ...draft2, coordinatorSignature: sig };

      const allocPromise = engineA.allocateLocalMutation({ kind: "insert", externalId: `race-alloc-${run}`, initialFields: { v: 1 } });
      const transPromise = engineA.ingestEpochTransitionCertificate(cert2);
      const [allocRes, transRes] = await Promise.all([allocPromise, transPromise]);
      assert.equal(transRes.ok, true);

      if (allocRes.ok && allocRes.op) {
        const opKey = toOperationKey(engineA.meta.collectionId, allocRes.op.opDot);
        const committedOp = engineA.mutationJournal.get(opKey)?.operation;
        if (allocRes.op.opDot.epochNumber === 1 && (cert2.baselineStableFrontier["1:A"] ?? 0) < allocRes.op.opDot.sequence) {
          const reissuedOpKey = toOperationKey(engineA.meta.collectionId, { epochNumber: 2, replicaId: "A", sequence: 1 });
          const reissuedOp = engineA.mutationJournal.get(reissuedOpKey)?.operation;
          assert.ok(reissuedOp, "Discarded epoch-1 op must be reissued in epoch 2 under D-157");
          assert.equal(reissuedOp.opDot.epochNumber, 2);
        } else {
          assert.ok(committedOp);
          assert.equal(committedOp.opDot.epochNumber, allocRes.op.opDot.epochNumber);
        }
      }
      for (const jRec of engineA.mutationJournal.values()) {
        assert.equal(jRec.operation.opDot.epochNumber, jRec.epochNumber);
      }
    }
  });
});

