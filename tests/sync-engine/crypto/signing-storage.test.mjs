import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateSigningKeyPair,
  signPayloadAsync,
  verifySignatureAsync,
  cloneNonExtractableKey,
  computeOperationSigningPayload,
  computeOperationDigest,
  computeCertificateSigningPayload,
} from "../../../packages/sync/dist/protocol/signing.js";
import {
  validateEpochMembershipCertificate,
  checkCertificateMonotonicity,
} from "../../../packages/sync/dist/protocol/certificates.js";
import { PROTOCOL_VERSION } from "../../../packages/sync/dist/protocol/index.js";

describe(": Signing and Non-Extractable Key Storage", () => {
  it("generates non-extractable ECDSA P-256 key, signs IEEE P1363, survives structured clone, and validates", async () => {
    // 0. Default zero-argument invocation yields non-extractable private key and undefined privateKeyHex
    const defaultKeyPair = await generateSigningKeyPair();
    assert.equal(defaultKeyPair.algorithm, "ECDSA_P256");
    assert.equal(defaultKeyPair.privateKey.extractable, false, "Default private key MUST NOT be extractable");
    assert.equal(defaultKeyPair.privateKeyHex, undefined, "Default privateKeyHex MUST be undefined");

    // 1. Generate mandatory ECDSA P-256 key pair with extractable = false
    const keyPair = await generateSigningKeyPair("ECDSA_P256", false);
    assert.equal(keyPair.algorithm, "ECDSA_P256");

    // 2. Assert extractable === false
    assert.equal(keyPair.privateKey.extractable, false, "Private key MUST NOT be extractable");

    // 3. Assert exportKey fails closed
    await assert.rejects(
      async () => {
        await globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
      },
      /key is not extractable|not extractable|OperationError|InvalidAccessError/i,
      "exportKey on non-extractable key must throw"
    );

    // 4. Public key is exportable as raw hex
    assert.equal(typeof keyPair.publicKeyHex, "string");
    // P-256 raw uncompressed EC point is 65 bytes = 130 hex characters
    assert.equal(keyPair.publicKeyHex.length, 130);

    // 5. Sign an operation payload
    const sampleOp = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "docs",
      epochNumber: 1,
      epochCertificateId: "cert-genesis",
      opDot: { epochNumber: 1, replicaId: "rep-alice", sequence: 1 },
      targetIncarnation: { epochNumber: 1, replicaId: "rep-alice", sequence: 1 },
      externalId: "doc-1",
      stamp: { lamport: 1, epochNumber: 1, replicaId: "rep-alice", sequence: 1 },
      authorKeyId: "key-alice-1",
      payloadDigest: "placeholder",
      authorSignature: "placeholder",
      kind: "insert",
      indexKey: "idx-001",
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: { title: "Title 1" },
    };

    const payloadDigest = computeOperationDigest(sampleOp);
    assert.equal(payloadDigest.length, 64, "SHA-256 digest must be 64 hex characters");

    const signingPayload = computeOperationSigningPayload({
      ...sampleOp,
      payloadDigest,
    });

    const signatureHex = await signPayloadAsync(signingPayload, keyPair.privateKey, "ECDSA_P256");
    // IEEE P1363 raw signature for P-256 is r (32 bytes) + s (32 bytes) = 64 bytes = 128 hex characters
    assert.equal(signatureHex.length, 128, "Raw IEEE P1363 signature must be 128 hex chars");

    // 6. Verify signature against public key hex
    const verifyValid = await verifySignatureAsync(
      signingPayload,
      signatureHex,
      keyPair.publicKeyHex,
      "ECDSA_P256"
    );
    assert.equal(verifyValid, true, "Valid signature must verify successfully");

    // 7. Verify corrupted signature or payload fails
    const corruptedPayload = signingPayload.replace("Title 1", "Title 2");
    const verifyCorrupted = await verifySignatureAsync(
      corruptedPayload,
      signatureHex,
      keyPair.publicKeyHex,
      "ECDSA_P256"
    );
    assert.equal(verifyCorrupted, false, "Corrupted payload must fail verification");

    // 8. Structured clone emulation (IDB persistence of non-extractable CryptoKey)
    const clonedKey = cloneNonExtractableKey(keyPair.privateKey);
    assert.equal(clonedKey.extractable, false, "Cloned key MUST remain non-extractable");

    // 9. Sign with cloned key and verify
    const clonedSignature = await signPayloadAsync(signingPayload, clonedKey, "ECDSA_P256");
    assert.equal(clonedSignature.length, 128);

    const verifyCloned = await verifySignatureAsync(
      signingPayload,
      clonedSignature,
      keyPair.publicKeyHex,
      "ECDSA_P256"
    );
    assert.equal(verifyCloned, true, "Signature from cloned non-extractable key must verify");

    // 10. Coordinator Epoch Membership Certificate creation & validation
    const certPayload = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "docs",
      epochNumber: 1,
      epochCertificateId: "cert-epoch-1",
      coordinatorReplicaId: "coord-1",
      coordinatorKeyId: "key-coord-1",
      memberBindings: {
        "coord-1": {
          role: "WRITER_REPLICA",
          authorKeyId: "key-coord-1",
          authorPublicKeyHex: keyPair.publicKeyHex,
          signingAlgorithm: "ECDSA_P256",
        },
      },
      baselineStableFrontier: { "1:coord-1": 0 },
    };

    const certSigningPayload = computeCertificateSigningPayload(certPayload);
    const coordSignature = await signPayloadAsync(certSigningPayload, keyPair.privateKey, "ECDSA_P256");

    const fullCert = {
      ...certPayload,
      coordinatorSignature: coordSignature,
    };

    const certValidation = await validateEpochMembershipCertificate(fullCert, "docs");
    assert.equal(certValidation.ok, true, "Certificate validation must succeed");

    // 11. G32-1 Non-cumulative transition certificate monotonicity check
    const nextCert = {
      ...fullCert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "2:coord-1": 10 }, // Only lists epoch 2 streams
    };
    const monoCheck = checkCertificateMonotonicity(fullCert, nextCert);
    assert.equal(monoCheck.ok, true, "Non-cumulative transition check must succeed per G32-1");
  });
});
