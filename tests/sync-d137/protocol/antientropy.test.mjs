import test from "node:test";
import assert from "node:assert/strict";
import {
  D137Engine,
  AntiEntropyRateLimiter,
  ANTI_ENTROPY_LIMITS,
  createStreamRangeRequest,
  handleStreamRangeRequest,
  ingestStreamRangeResponse,
  checkAntiEntropyNeeds,
  computeCertificateSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

async function createTwoNodeCluster(collectionId) {
  const keyA = await generateSigningKeyPair("Ed25519", true);
  const keyB = await generateSigningKeyPair("Ed25519", true);
  const certDraft = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId,
    epochNumber: 1,
    epochCertificateId: `cert:${collectionId}:1`,
    coordinatorReplicaId: "A",
    coordinatorKeyId: "key:A:v1",
    memberBindings: {
      A: {
        role: "WRITER_REPLICA",
        authorKeyId: "key:A:v1",
        authorPublicKeyHex: keyA.publicKeyHex,
        signingAlgorithm: "Ed25519",
      },
      B: {
        role: "WRITER_REPLICA",
        authorKeyId: "key:B:v1",
        authorPublicKeyHex: keyB.publicKeyHex,
        signingAlgorithm: "Ed25519",
      },
    },
    baselineStableFrontier: { "1:A": 0, "1:B": 0 },
  };
  const coordSig = await signPayloadAsync(computeCertificateSigningPayload(certDraft), keyA.privateKeyHex, "Ed25519");
  const cert = {
    ...certDraft,
    coordinatorSignature: coordSig,
  };
  const engineA = new D137Engine(collectionId, "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
  const engineB = new D137Engine(collectionId, "B", 1, cert, "key:B:v1", keyB.privateKeyHex);
  const chanA = {
    channelId: "c-A",
    channelAuthenticated: true,
    transportSenderReplicaId: "A",
  };
  return { engineA, engineB, keyA, keyB, cert, chanA };
}

test("T-31.13: A stalled stream with gap resolves cleanly by anti-entropy pull", async () => {
  const { engineA, engineB, chanA } = await createTwoNodeCluster("coll-ae-pull");
  await engineA.allocateLocalMutation({ kind: "insert", externalId: "x1", initialFields: { v: 1 } });
  await engineA.allocateLocalMutation({ kind: "insert", externalId: "x2", initialFields: { v: 2 } });
  const op3 = (await engineA.allocateLocalMutation({ kind: "insert", externalId: "x3", initialFields: { v: 3 } })).op;

  const resB3 = await engineB.ingestRemoteOperation(op3, chanA);
  assert.equal(resB3.ok, true);
  assert.equal(resB3.disposition, "BUFFERED_OUT_OF_ORDER");

  assert.equal(engineB.meta.frontiers.localDurableFrontier["1:A"] ?? 0, 0);
  assert.equal(engineB.inboundGapBuffer.size, 1);

  const pullRequests = checkAntiEntropyNeeds(engineB, "A");
  assert.equal(pullRequests.length, 1);
  assert.equal(pullRequests[0].fromSeq, 1);
  assert.equal(pullRequests[0].toSeq, 2);

  const handleRes = await handleStreamRangeRequest(engineA, pullRequests[0]);
  assert.equal(handleRes.ok, true);
  assert(handleRes.response);
  assert.equal(handleRes.response.operations.length, 2);

  const ingestAeRes = await ingestStreamRangeResponse(engineB, handleRes.response);
  assert.equal(ingestAeRes.ok, true);
  assert.equal(ingestAeRes.countApplied, 2);

  assert.equal(engineB.inboundGapBuffer.size, 0);
  assert.equal(engineB.meta.frontiers.localDurableFrontier["1:A"], 3);
  assert.equal(engineB.entriesState.size, 3);
});

test("T-31.13: Forged or truncated responses are rejected with D137_RANGE_RESPONSE_INVALID", async () => {
  const { engineA, engineB } = await createTwoNodeCluster("coll-ae-forged");
  await engineA.allocateLocalMutation({ kind: "insert", externalId: "x1", initialFields: { v: 1 } });
  await engineA.allocateLocalMutation({ kind: "insert", externalId: "x2", initialFields: { v: 2 } });
  const pullReq = createStreamRangeRequest(engineB, "1:A", 1, 2, "A");
  const handleRes = await handleStreamRangeRequest(engineA, pullReq);
  assert(handleRes.response);

  // 1. Forged signature on an op
  const forgedOps = [
    { ...handleRes.response.operations[0], authorSignature: "0000000000000000000000000000000000000000000000000000000000000000" },
    handleRes.response.operations[1],
  ];
  const forgedResponse = {
    ...handleRes.response,
    operations: forgedOps,
  };
  const rejectSig = await ingestStreamRangeResponse(engineB, forgedResponse);
  assert.equal(rejectSig.ok, false);
  assert.equal(rejectSig.code, "D137_RANGE_RESPONSE_INVALID");

  // 2. Tampered sequence / internal gap in response
  const gappedOps = [handleRes.response.operations[1]];
  const gappedResponse = {
    ...handleRes.response,
    operations: gappedOps,
  };
  const rejectGap = await ingestStreamRangeResponse(engineB, gappedResponse);
  assert.equal(rejectGap.ok, false);
  assert.equal(rejectGap.code, "D137_RANGE_RESPONSE_INVALID");

  // 3. Forged payload digest
  const tamperedPayloadOps = [
    { ...handleRes.response.operations[0], payloadDigest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
  ];
  const tamperedResponse = {
    ...handleRes.response,
    toSeq: 1,
    operations: tamperedPayloadOps,
  };
  const rejectDigest = await ingestStreamRangeResponse(engineB, tamperedResponse);
  assert.equal(rejectDigest.ok, false);
  assert.equal(rejectDigest.code, "D137_RANGE_RESPONSE_INVALID");
});

test("T-31.13: Anti-entropy flood is rate-limited with D137_RATE_LIMIT_EXCEEDED", async () => {
  const { engineA, engineB } = await createTwoNodeCluster("coll-ae-ratelimit");
  const rateLimiter = new AntiEntropyRateLimiter();
  const pullReq = createStreamRangeRequest(engineB, "1:A", 1, 1, "A");

  for (let i = 0; i < ANTI_ENTROPY_LIMITS.MAX_REQUESTS_PER_WINDOW; i++) {
    const res = await handleStreamRangeRequest(engineA, pullReq, rateLimiter);
    assert.equal(res.ok, true);
  }

  const floodRes = await handleStreamRangeRequest(engineA, pullReq, rateLimiter);
  assert.equal(floodRes.ok, false);
  assert.equal(floodRes.code, "D137_RATE_LIMIT_EXCEEDED");
});

