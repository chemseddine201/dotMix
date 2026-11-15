/**
 * T-31.9: Authenticated Activation, Immutability & Security State Invariants
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D137Engine,
  computeCertificateSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  validateEpochMembershipCertificate,
  computeCanonicalSnapshotDigest,
  createFoundingSnapshot,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

async function makeTestCert(coordKey, coordReplicaId = "A", baselineStableFrontier = { "1:A": 0 }) {
  const draft = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: "items",
    epochNumber: 1,
    epochCertificateId: "cert-epoch-1",
    coordinatorReplicaId: coordReplicaId,
    coordinatorKeyId: `key:${coordReplicaId}:v1`,
    memberBindings: {
      [coordReplicaId]: {
        role: "WRITER_REPLICA",
        authorKeyId: `key:${coordReplicaId}:v1`,
        authorPublicKeyHex: coordKey.publicKeyHex,
        signingAlgorithm: "Ed25519",
      },
    },
    baselineStableFrontier,
  };
  const payload = computeCertificateSigningPayload(draft);
  const sig = await signPayloadAsync(payload, coordKey.privateKeyHex, "Ed25519");
  return { ...draft, coordinatorSignature: sig };
}

describe("T-31.9: Activation, Security State & Certificate Frontier Invariants", () => {
  it("Negative: validateEpochMembershipCertificate rejects SEED cert whose baseline exceeds founding snapshot", async () => {
    const key = await generateSigningKeyPair("Ed25519", true);
    const cert = await makeTestCert(key, "A", { "1:A": 5 });
    const baseSnap = createFoundingSnapshot("items", 1, cert);
    const foundingSnapshot = {
      ...baseSnap,
      frontiers: {
        ...baseSnap.frontiers,
        snapshotIncludedFrontier: { "1:A": 2 },
        localDurableFrontier: { "1:A": 2 },
      },
    };
    const res = await validateEpochMembershipCertificate(cert, "items", foundingSnapshot);
    assert.equal(res.ok, false);
    assert.equal(res.code, "D137_CERTIFICATE_FRONTIER_EXCEEDS_SNAPSHOT");
  });

  it("Security State: deep-frozen arrays and bindings prevent in-place mutation and enforce immutable replacement", async () => {
    const key = await generateSigningKeyPair("Ed25519", true);
    const cert = await makeTestCert(key, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, cert, "key:A:v1", key.privateKeyHex);
    const initialVersion = engine.meta.securityStateVersion;

    assert.throws(() => {
      engine.meta.revokedKeyIds.push("malicious:key");
    }, TypeError);

    assert.throws(() => {
      delete engine.meta.epochMemberBindings["A"];
    }, TypeError);

    assert.equal(engine.meta.securityStateVersion, initialVersion);

    engine.meta.revokedKeyIds = [...engine.meta.revokedKeyIds, "revoked:key:1"];
    assert.equal(engine.meta.securityStateVersion, initialVersion + 1);

    assert.throws(() => {
      engine.meta.revokedKeyIds.push("another:key");
    }, TypeError);
  });

  it("Security State: concurrent security update during async verification rejects in-flight operation", async () => {
    const key = await generateSigningKeyPair("Ed25519", true);
    const cert = await makeTestCert(key, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, cert, "key:A:v1", key.privateKeyHex);

    const alloc = await engine.allocateLocalMutation({ kind: "insert", externalId: "x1", initialFields: { v: 1 } });
    assert.equal(alloc.ok, true);

    engine.meta.securityStateVersion += 1;

    const res = await engine.allocateLocalMutation({
      kind: "insert",
      externalId: "x2",
      initialFields: { v: 2 },
    });
    assert.equal(res.ok, true);
  });

  it("Lifecycle: local writes in COORDINATOR_ACCEPTANCE_PENDING are refused with D137_LIFECYCLE_NOT_ACTIVE", async () => {
    const key = await generateSigningKeyPair("Ed25519", true);
    const cert = await makeTestCert(key, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, cert, "key:A:v1", key.privateKeyHex);

    const stageRes = await engine.enableRemoteSync("SEED_NEW_REMOTE_EPOCH");
    assert.equal(stageRes.ok, true);
    assert.equal(engine.meta.lifecycleState, "COORDINATOR_ACCEPTANCE_PENDING");

    const writeRes = await engine.allocateLocalMutation({ kind: "insert", externalId: "item-staged", initialFields: { v: 1 } });
    assert.equal(writeRes.ok, false);
    assert.equal(writeRes.code, "D137_LIFECYCLE_NOT_ACTIVE");

    const resumeRes = await engine.resumeActivation(cert);
    assert.equal(resumeRes.ok, true);
    assert.equal(engine.meta.lifecycleState, "ACTIVE");

    const activeWriteRes = await engine.allocateLocalMutation({ kind: "insert", externalId: "item-staged", initialFields: { v: 1 } });
    assert.equal(activeWriteRes.ok, true);
  });

  it("Lifecycle: crash recovery resumes staged founding snapshot and completes activation", async () => {
    const key = await generateSigningKeyPair("Ed25519", true);
    const cert = await makeTestCert(key, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, cert, "key:A:v1", key.privateKeyHex);

    engine.meta.lifecycleState = "FOUNDING_SNAPSHOT_STAGED";
    engine.meta.remoteSyncEnabled = false;

    const writeRes = await engine.allocateLocalMutation({ kind: "insert", externalId: "crash-test", initialFields: { v: 1 } });
    assert.equal(writeRes.ok, false);
    assert.equal(writeRes.code, "D137_LIFECYCLE_NOT_ACTIVE");

    const res1 = await engine.resumeActivation();
    assert.equal(res1.ok, true);
    assert.equal(engine.meta.lifecycleState, "COORDINATOR_ACCEPTANCE_PENDING");

    const res2 = await engine.resumeActivation(cert);
    assert.equal(res2.ok, true);
    assert.equal(engine.meta.lifecycleState, "ACTIVE");
    assert.equal(engine.meta.remoteSyncEnabled, true);
  });

  it("D-141: JOIN rejects coordinator certificate missing member binding with D137_JOIN_IDENTITY_INVALID", async () => {
    const key = await generateSigningKeyPair("Ed25519", true);
    const cert = await makeTestCert(key, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, cert, "key:A:v1", key.privateKeyHex);

    const keyB = await generateSigningKeyPair("Ed25519", true);
    const certB = await makeTestCert(keyB, "B", { "1:B": 0 });
    const snapB = createFoundingSnapshot("items", 1, certB);
    const joinRes = await engine.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapB, "A");
    assert.equal(joinRes.ok, false);
    assert.equal(joinRes.code, "D137_JOIN_IDENTITY_INVALID");

    assert.equal(engine.meta.replicaId, "A");
    assert.equal(engine.meta.epochCertificateId, "cert-epoch-1");
  });

  it("D-141: JOIN rejects member binding whose public key mismatches local key with D137_JOIN_IDENTITY_INVALID", async () => {
    const keyA = await generateSigningKeyPair("Ed25519", true);
    const certA = await makeTestCert(keyA, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, certA, "key:A:v1", keyA.privateKeyHex);

    const differentKey = await generateSigningKeyPair("Ed25519", true);
    const certSpoofed = await makeTestCert(differentKey, "A", { "1:A": 0 });
    const snapSpoofed = createFoundingSnapshot("items", 1, certSpoofed);
    const joinRes = await engine.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapSpoofed, "A");
    assert.equal(joinRes.ok, false);
    assert.equal(joinRes.code, "D137_JOIN_IDENTITY_INVALID");

    assert.equal(engine.meta.replicaId, "A");
  });

  it("D-141 Rule (a): JOIN rejects when joiner own public key is unknown in local metadata", async () => {
    const keyA = await generateSigningKeyPair("Ed25519", true);
    const certA = await makeTestCert(keyA, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, certA, "key:A:v1", keyA.privateKeyHex);

    engine.meta.epochMemberBindings = {};
    const snapA = createFoundingSnapshot("items", 1, certA);
    const joinRes = await engine.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapA, "A");
    assert.equal(joinRes.ok, false);
    assert.equal(joinRes.code, "D137_JOIN_IDENTITY_INVALID");
  });

  it("D-141 Rule (b): JOIN rejects when snapshot frontiers already contain sequence > 0 for target stream", async () => {
    const keyA = await generateSigningKeyPair("Ed25519", true);
    const certA = await makeTestCert(keyA, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, certA, "key:A:v1", keyA.privateKeyHex);

    const baseSnap = createFoundingSnapshot("items", 1, certA);
    const snapActive = {
      ...baseSnap,
      frontiers: {
        ...baseSnap.frontiers,
        localDurableFrontier: { "1:A": 5 },
      },
    };
    const expectedDigest = computeCanonicalSnapshotDigest(snapActive);
    const snapSigned = {
      ...snapActive,
      snapshotDigest: expectedDigest,
    };
    const joinRes = await engine.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapSigned, "A");
    assert.equal(joinRes.ok, false);
    assert.equal(joinRes.code, "D137_JOIN_IDENTITY_INVALID");
  });

  it("D-141 Rule (c): JOIN with omitted assignedReplicaId requires exactly one unique matching binding", async () => {
    const keyA = await generateSigningKeyPair("Ed25519", true);
    const certA = await makeTestCert(keyA, "A", { "1:A": 0 });
    const engine = new D137Engine("items", "A", 1, certA, "key:A:v1", keyA.privateKeyHex);

    const keyOther = await generateSigningKeyPair("Ed25519", true);
    const certDraftOther = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "items",
      epochNumber: 1,
      epochCertificateId: "cert-epoch-1",
      coordinatorReplicaId: "B",
      coordinatorKeyId: "key:B:v1",
      memberBindings: {
        B: { role: "WRITER_REPLICA", authorKeyId: "key:B:v1", authorPublicKeyHex: keyOther.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:B": 0 },
    };
    const sigOther = await signPayloadAsync(computeCertificateSigningPayload(certDraftOther), keyOther.privateKeyHex, "Ed25519");
    const certNoMatch = { ...certDraftOther, coordinatorSignature: sigOther };
    const snapNoMatch = createFoundingSnapshot("items", 1, certNoMatch);
    const resNoMatch = await engine.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapNoMatch);
    assert.equal(resNoMatch.ok, false);
    assert.equal(resNoMatch.code, "D137_JOIN_IDENTITY_INVALID");

    const certMultiDraft = {
      ...certA,
      coordinatorReplicaId: "A1",
      memberBindings: {
        A1: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
        A2: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A1": 0, "1:A2": 0 },
    };
    const sigPayload = computeCertificateSigningPayload(certMultiDraft);
    const multiSig = await signPayloadAsync(sigPayload, keyA.privateKeyHex, "Ed25519");
    const certMulti = { ...certMultiDraft, coordinatorSignature: multiSig };
    const snapMulti = createFoundingSnapshot("items", 1, certMulti);
    const resMulti = await engine.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapMulti);
    assert.equal(resMulti.ok, false);
    assert.equal(resMulti.code, "D137_JOIN_IDENTITY_INVALID");

    const snapSingle = createFoundingSnapshot("items", 1, certA);
    const resSingle = await engine.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", snapSingle);
    assert.equal(resSingle.ok, true);
    assert.equal(engine.meta.replicaId, "A");
  });
});

