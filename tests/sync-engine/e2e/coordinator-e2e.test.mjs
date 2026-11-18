/**
 * @dotmix/sync — Coordinator End-to-End Test
 *
 * Verifies two-client cluster onboarding, certificate issuance, operation
 * journaling, server ACKs, epoch close rejection with compensation, and
 * anti-entropy range pulls against SyncReferenceCoordinator.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SyncReferenceCoordinator } from "../../../tools/sync-coordinator/coordinator.js";
import {
  createWireEnvelope,
} from "../../../packages/sync/dist/transport/envelope.js";
import { createHttpPrincipal } from "../../../packages/sync/dist/transport/principal.js";
import {
  generateSigningKeyPair,
  signPayloadAsync,
} from "../../../packages/sync/dist/protocol/signing.js";
import {
  computeOperationDigest,
  computeOperationSigningPayload,
} from "../../../packages/sync/dist/protocol/preverify.js";
import { PROTOCOL_VERSION } from "../../../packages/sync/dist/protocol/types.js";

describe("Coordinator End-to-End Multi-Client Cluster", () => {
  it("coordinates two clients, verifies certificates, ACKs, epoch close rejection with compensation, and range pull", async () => {
    const collectionId = "col_coord_test";
    const coordinator = new SyncReferenceCoordinator({ collectionId });
    await coordinator.initialize();

    assert.equal(coordinator.getEpochNumber(), 1);
    const genesisCert = coordinator.getCertificate();
    assert.equal(genesisCert.epochNumber, 1);
    assert.equal(genesisCert.collectionId, collectionId);

    // 1. Two clients onboard: Alice and Bob
    const aliceKeys = await generateSigningKeyPair("ECDSA_P256", true);
    const bobKeys = await generateSigningKeyPair("ECDSA_P256", true);

    const aliceSession = await coordinator.registerClient(
      "key-alice",
      aliceKeys.publicKeyHex,
      "WRITER_REPLICA",
      "rep-alice"
    );
    const bobSession = await coordinator.registerClient(
      "key-bob",
      bobKeys.publicKeyHex,
      "WRITER_REPLICA",
      "rep-bob"
    );

    assert.equal(aliceSession.replicaId, "rep-alice");
    assert.equal(bobSession.replicaId, "rep-bob");

    const updatedCert = coordinator.getCertificate();
    assert.ok(updatedCert.memberBindings["rep-alice"]);
    assert.ok(updatedCert.memberBindings["rep-bob"]);

    // 2. Alice sets up authenticated principal and authors an insert operation
    const alicePrincipal = createHttpPrincipal("sess-alice-1", "rep-alice");

    const unsignedOp = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId,
      epochNumber: 1,
      epochCertificateId: updatedCert.epochCertificateId,
      opDot: { epochNumber: 1, replicaId: "rep-alice", sequence: 1 },
      targetIncarnation: { epochNumber: 1, replicaId: "rep-alice", sequence: 1 },
      externalId: "item-101",
      stamp: { lamport: 1, epochNumber: 1, replicaId: "rep-alice", sequence: 1 },
      authorKeyId: "key-alice",
      kind: "insert",
      indexKey: "a0",
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: { title: "Hello Distributed Mix" },
    };

    const aliceDigest = computeOperationDigest(unsignedOp);
    const aliceSigningPayload = computeOperationSigningPayload({
      ...unsignedOp,
      payloadDigest: aliceDigest,
    });
    const aliceSignature = await signPayloadAsync(
      aliceSigningPayload,
      aliceKeys.privateKey,
      "ECDSA_P256"
    );

    const fullAliceOp = {
      ...unsignedOp,
      payloadDigest: aliceDigest,
      authorSignature: aliceSignature,
    };

    const aliceEnvelope = createWireEnvelope(
      "op",
      collectionId,
      "rep-alice",
      fullAliceOp
    );

    // Listen on coordinator relays to verify Bob receives relayed envelope
    const relayedEnvelopes = [];
    const unsubscribeRelay = coordinator.subscribeRelay((envelope) => {
      relayedEnvelopes.push(envelope);
    });

    // 3. Alice transmits envelope to coordinator
    const coordinatorResponse = await coordinator.ingestEnvelope(aliceEnvelope, alicePrincipal);
    assert.ok(coordinatorResponse);
    assert.equal(coordinatorResponse.type, "serverAck");
    assert.equal(
      coordinatorResponse.payload.opKey,
      `${collectionId}:1:rep-alice:1`
    );

    // Verify Bob received relayed operation
    assert.equal(relayedEnvelopes.length, 1);
    assert.equal(relayedEnvelopes[0].type, "op");
    assert.equal(relayedEnvelopes[0].senderReplicaId, "rep-alice");
    assert.equal(relayedEnvelopes[0].payload.externalId, "item-101");

    // 4. Test Rejection with Compensation:
    // Coordinator transitions to Epoch 2
    const epoch2Cert = await coordinator.transitionToNextEpoch();
    assert.equal(coordinator.getEpochNumber(), 2);
    assert.equal(epoch2Cert.epochNumber, 2);

    // Alice attempts to send another operation under closed Epoch 1
    const lateOp = {
      ...fullAliceOp,
      opDot: { epochNumber: 1, replicaId: "rep-alice", sequence: 2 },
      externalId: "item-102",
      stamp: { lamport: 2, epochNumber: 1, replicaId: "rep-alice", sequence: 2 },
    };
    const lateDigest = computeOperationDigest(lateOp);
    const lateSigningPayload = computeOperationSigningPayload({
      ...lateOp,
      payloadDigest: lateDigest,
    });
    const lateSignature = await signPayloadAsync(
      lateSigningPayload,
      aliceKeys.privateKey,
      "ECDSA_P256"
    );
    const fullLateOp = {
      ...lateOp,
      payloadDigest: lateDigest,
      authorSignature: lateSignature,
    };

    const lateEnvelope = createWireEnvelope("op", collectionId, "rep-alice", fullLateOp);
    const rejectResponse = await coordinator.ingestEnvelope(lateEnvelope, alicePrincipal);

    assert.ok(rejectResponse);
    assert.equal(rejectResponse.type, "serverReject");
    assert.equal(rejectResponse.payload.errorCode, "SYNC_EPOCH_CLOSED");
    assert.equal(
      rejectResponse.payload.compensationAction,
      "DISCARD_AND_PULL_NEW_EPOCH"
    );

    // 5. Anti-Entropy Range Pull:
    // Bob requests range from coordinator for stream 1:rep-alice sequences 1..1
    const bobPrincipal = createHttpPrincipal("sess-bob-1", "rep-bob");
    const rangeRequest = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId,
      requesterReplicaId: "rep-bob",
      targetReplicaId: coordinator.coordinatorReplicaId,
      epochNumber: 1,
      streamKey: "1:rep-alice",
      fromSeq: 1,
      toSeq: 1,
      timestamp: Date.now(),
    };

    const rangeEnvelope = createWireEnvelope(
      "rangeRequest",
      collectionId,
      "rep-bob",
      rangeRequest
    );

    const rangeResponseEnvelope = await coordinator.ingestEnvelope(
      rangeEnvelope,
      bobPrincipal
    );

    assert.ok(rangeResponseEnvelope);
    assert.equal(rangeResponseEnvelope.type, "rangeResponse");
    const rangeResponse = rangeResponseEnvelope.payload;
    assert.equal(rangeResponse.operations.length, 1);
    assert.equal(rangeResponse.operations[0].externalId, "item-101");
    assert.equal(rangeResponse.operations[0].payloadDigest, aliceDigest);

    unsubscribeRelay();
  });
});
