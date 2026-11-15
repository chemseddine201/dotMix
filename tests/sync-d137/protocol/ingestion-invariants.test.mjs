/**
 * D137-v33-reference: Ingestion Invariants Test Suite (T-31.6)
 *
 * Verifies S80, S81, S94, remote size limits, gap buffer bounds,
 * and replicaId character set validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D137Engine,
  computeOperationDigest,
  computeOperationSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

async function createCluster() {
  const keyA = await generateSigningKeyPair("Ed25519", true);
  const keyB = await generateSigningKeyPair("Ed25519", true);
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
    },
    baselineStableFrontier: { "1:A": 0, "1:B": 0 },
    coordinatorSignature: "sig",
  };
  const engineA = new D137Engine("items", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
  const engineB = new D137Engine("items", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);
  const channelB = {
    channelId: "chan-b",
    channelAuthenticated: true,
    transportSenderReplicaId: "B",
  };
  return { engineA, engineB, keyA, keyB, cert, channelB };
}

describe("T-31.6: Ingestion Invariants (S80, S81, S94, Bounds)", () => {
  it("S80: state failure blocks origin stream and evicts gap-buffered successors", async () => {
    const { engineA, engineB, channelB, keyB } = await createCluster();

    const op1 = (await engineB.allocateLocalMutation({
      kind: "insert",
      externalId: "item-1",
      initialFields: { partA: "a".repeat(40 * 1024) },
    })).op;
    await engineA.ingestRemoteOperation(op1, channelB);

    const op2Raw = (await engineB.allocateLocalMutation({
      kind: "update",
      targetIncarnation: op1.opDot,
      externalId: "item-1",
      partialFields: { partB: "b" },
    })).op;

    const tamperedPayload = {
      ...op2Raw,
      partialFields: { partB: "b".repeat(40 * 1024) },
    };
    const payloadDigest = computeOperationDigest(tamperedPayload);
    const signingPayload = computeOperationSigningPayload({ ...tamperedPayload, payloadDigest });
    const authorSignature = await signPayloadAsync(signingPayload, keyB.privateKeyHex, "Ed25519");
    const op2 = { ...tamperedPayload, payloadDigest, authorSignature };

    const op3 = (await engineB.allocateLocalMutation({
      kind: "update",
      targetIncarnation: op1.opDot,
      externalId: "item-1",
      partialFields: { title: "Item 1 v3" },
    })).op;

    const r3 = await engineA.ingestRemoteOperation(op3, channelB);
    assert.equal(r3.ok, true);
    assert.equal(r3.disposition, "BUFFERED_OUT_OF_ORDER");
    assert.equal(engineA.inboundGapBuffer.size, 1);

    const r2 = await engineA.ingestRemoteOperation(op2, channelB);
    assert.equal(r2.ok, false);

    assert.ok(engineA.meta.activeEpochEquivocations["1:B"]);
    assert.equal(engineA.meta.activeEpochEquivocations["1:B"].reason, "BLOCKING_UNRESOLVED_STREAM_POSITION");
    assert.equal(engineA.inboundGapBuffer.size, 0);
    const dig3 = engineA.operationDigests.get(`items:${op3.opDot.epochNumber}:${op3.opDot.replicaId}:${op3.opDot.sequence}`);
    assert.equal(dig3?.status, "EVICTED_STREAM_BLOCKED_SUCCESSOR");
  });

  it("S81: late op below pruned digest horizon without digest record is rejected", async () => {
    const { engineA, engineB, channelB } = await createCluster();
    const ops = [];
    for (let i = 1; i <= 3; i++) {
      const op = (await engineB.allocateLocalMutation({
        kind: "insert",
        externalId: `item-${i}`,
        initialFields: { title: `Item ${i}` },
      })).op;
      ops.push(op);
      await engineA.ingestRemoteOperation(op, channelB);
    }

    engineA.meta.frontiers.digestPrunedFrontier["1:B"] = 2;
    const opKey2 = `items:1:B:2`;
    engineA.operationDigests.delete(opKey2);

    const res = await engineA.ingestRemoteOperation(ops[1], channelB);
    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON");
  });

  it("S94: gap buffer capacity is bounded by MAX_GAP_BUFFER_OPS_PER_COLLECTION", async () => {
    const { engineA, engineB, channelB } = await createCluster();

    await engineB.allocateLocalMutation({
      kind: "insert",
      externalId: "item-withheld-1",
      initialFields: {},
    });

    for (let i = 2; i <= 1001; i++) {
      const op = (await engineB.allocateLocalMutation({
        kind: "insert",
        externalId: `item-${i}`,
        initialFields: {},
      })).op;
      const res = await engineA.ingestRemoteOperation(op, channelB);
      assert.equal(res.ok, true);
    }
    assert.equal(engineA.inboundGapBuffer.size, 1000);

    const opOverflow = (await engineB.allocateLocalMutation({
      kind: "insert",
      externalId: "item-overflow",
      initialFields: {},
    })).op;
    const resOverflow = await engineA.ingestRemoteOperation(opOverflow, channelB);
    assert.equal(resOverflow.ok, false);
    assert.equal(resOverflow.code, "D137_GAP_BUFFER_OVERFLOW");
  });

  it("Character set: replicaId containing ':' is rejected", async () => {
    const { engineA, channelB } = await createCluster();
    const badOp = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "items",
      epochNumber: 1,
      epochCertificateId: "cert-epoch-1",
      opDot: { epochNumber: 1, replicaId: "B:evil", sequence: 1 },
      targetIncarnation: { epochNumber: 1, replicaId: "B:evil", sequence: 1 },
      externalId: "item-bad",
      stamp: { lamport: 1, epochNumber: 1, replicaId: "B:evil", sequence: 1 },
      authorKeyId: "key:B:v1",
      payloadDigest: "0".repeat(64),
      authorSignature: "0".repeat(128),
      kind: "insert",
      indexKey: "a0",
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: {},
    };
    const res = await engineA.ingestRemoteOperation(badOp, channelB);
    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_INVALID_REPLICA_ID");
  });
});

