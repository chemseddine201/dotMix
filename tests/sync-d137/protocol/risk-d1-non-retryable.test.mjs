/**
 * Gate 33 / Gate 32 Risk D-1: Permanent Non-Retryable Error Codes
 *
 * Verifies that the two permanent transition failure cases return non-retryable error codes:
 * 1. D137_CERTIFICATE_FLOOR_REGRESSION (lowered baseline stable floor)
 * 2. D137_CERTIFICATE_NOT_A_MEMBER (receiving replica omitted from member bindings)
 * While temporary lack of durable data retains retryable D137_EPOCH_TRANSITION_NOT_READY.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D137Engine,
  generateSigningKeyPair,
  signPayloadAsync,
  computeCertificateSigningPayload,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

async function createCluster() {
  const keyA = await generateSigningKeyPair("Ed25519", true);
  const keyB = await generateSigningKeyPair("Ed25519", true);

  const cert = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: "todos",
    epochNumber: 1,
    epochCertificateId: "cert-init-1",
    coordinatorReplicaId: "A",
    coordinatorKeyId: "key:A:v1",
    memberBindings: {
      "A": {
        role: "WRITER_REPLICA",
        authorKeyId: "key:A:v1",
        authorPublicKeyHex: keyA.publicKeyHex,
        signingAlgorithm: "Ed25519",
      },
      "B": {
        role: "WRITER_REPLICA",
        authorKeyId: "key:B:v1",
        authorPublicKeyHex: keyB.publicKeyHex,
        signingAlgorithm: "Ed25519",
      },
    },
    baselineStableFrontier: { "1:A": 2, "1:B": 0 },
    coordinatorSignature: "sig",
  };

  const engineA = new D137Engine("todos", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
  const engineB = new D137Engine("todos", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);

  return { engineA, engineB, keyA, keyB, cert };
}

describe("Gate 32 Risk D-1 Non-Retryable Error Codes", () => {
  it("Permanent Case 1: lowered floor is rejected with D137_CERTIFICATE_FLOOR_REGRESSION", async () => {
    const { engineB, keyA, cert } = await createCluster();

    const metaBefore = JSON.stringify(engineB.meta);
    const snapKeysBefore = [...engineB.snapshotsV2.keys()].sort();

    // Floor regression: "1:A" decreased from 2 to 1
    const draftRegression = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 1, "1:B": 0 },
      coordinatorSignature: "",
    };
    const sig = await signPayloadAsync(computeCertificateSigningPayload(draftRegression), keyA.privateKeyHex, "Ed25519");
    const certRegression = { ...draftRegression, coordinatorSignature: sig };

    const res = await engineB.ingestEpochTransitionCertificate(certRegression);

    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_CERTIFICATE_FLOOR_REGRESSION");
    assert.match(res.detail ?? "", /decreased from 2 to 1/);
    assert.equal(JSON.stringify(engineB.meta), metaBefore, "State must not be mutated on floor regression");
    assert.deepEqual([...engineB.snapshotsV2.keys()].sort(), snapKeysBefore);
  });

  it("Permanent Case 2: replica omitted from certificate is rejected with D137_CERTIFICATE_NOT_A_MEMBER", async () => {
    const { engineB, keyA, cert } = await createCluster();

    // Receiving replica B is omitted from its current certificate
    engineB.meta.epochCertificate = {
      ...cert,
      memberBindings: {
        "A": cert.memberBindings["A"],
      },
    };

    const metaBefore = JSON.stringify(engineB.meta);
    const snapKeysBefore = [...engineB.snapshotsV2.keys()].sort();

    const draftTransition = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 2, "1:B": 0 },
      coordinatorSignature: "",
    };
    const sig = await signPayloadAsync(computeCertificateSigningPayload(draftTransition), keyA.privateKeyHex, "Ed25519");
    const certTransition = { ...draftTransition, coordinatorSignature: sig };

    const res = await engineB.ingestEpochTransitionCertificate(certTransition);

    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_CERTIFICATE_NOT_A_MEMBER");
    assert.match(res.detail ?? "", /not a member of current certificate/);
    assert.equal(JSON.stringify(engineB.meta), metaBefore, "State must not be mutated when replica is not a member");
    assert.deepEqual([...engineB.snapshotsV2.keys()].sort(), snapKeysBefore);
  });

  it("Temporary Case: floor above durable frontier retains retryable D137_EPOCH_TRANSITION_NOT_READY", async () => {
    const { engineB, keyA, cert } = await createCluster();

    const metaBefore = JSON.stringify(engineB.meta);

    // Floor claims "1:A" at 5, but durable is 0
    const draftAbove = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 5, "1:B": 0 },
      coordinatorSignature: "",
    };
    const sig = await signPayloadAsync(computeCertificateSigningPayload(draftAbove), keyA.privateKeyHex, "Ed25519");
    const certAbove = { ...draftAbove, coordinatorSignature: sig };

    const res = await engineB.ingestEpochTransitionCertificate(certAbove);

    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_EPOCH_TRANSITION_NOT_READY");
    assert.match(res.detail ?? "", /exceeds local durable frontier/);
    assert.equal(JSON.stringify(engineB.meta), metaBefore);
  });
});
