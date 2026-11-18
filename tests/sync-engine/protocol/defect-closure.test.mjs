/**
 * Sync-v33-reference Test Suite: Defect Closure Verification (Tests 1 through 10)
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
  migrateLegacyV1Store,
  commitCheckpoint,
  materializeVisibleArray,
  toIncarnationId,
  rebuildEntriesState,
  reconcileAllFrontiersPostExcision,
  preVerifyIncomingOperationAsync,
  sha256Hex,
  recordQuarantine,
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
  const engineA = new ReplicationEngine("todos", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
  const engineB = new ReplicationEngine("todos", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);
  const engineC = new ReplicationEngine("todos", "C", 1, cert, "key:C:v1", keyC.privateKeyHex);
  const channel = {
    channelId: "chan-1",
    channelAuthenticated: true,
    transportSenderReplicaId: "B",
  };
  return { engineA, engineB, engineC, keyA, keyB, keyC, cert, channel };
}

describe(" v3.3.1 Defect Closure Suite", () => {
  it("TEST 1: Equivocation after compaction preserves certified baseline and avoids frontier contradiction", async () => {
    const { engineA, engineB, keyA, keyB, cert, channel } = await createTestCluster();
    const op1 = (await engineB.allocateLocalMutation({ kind: "insert", externalId: "b1", initialFields: { title: "Item 1" } })).op;
    const op2 = (await engineB.allocateLocalMutation({ kind: "insert", externalId: "b2", initialFields: { title: "Item 2" } })).op;
    const op3 = (await engineB.allocateLocalMutation({ kind: "insert", externalId: "b3", initialFields: { title: "Item 3" } })).op;

    await engineA.ingestRemoteOperation(op1, channel);
    await engineA.ingestRemoteOperation(op2, channel);
    await engineA.ingestRemoteOperation(op3, channel);

    engineA.meta.clusterAcks["B"] = { "1:B": 3 };
    engineA.meta.clusterAcks["C"] = { "1:B": 3 };
    engineA.meta.clusterAcks["A"] = { "1:B": 3 };
    engineA.meta.frontiers.stableFrontier["1:B"] = 3;

    const epoch2CertDraft = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 0, "1:B": 3, "1:C": 0 },
      coordinatorSignature: "",
    };
    const certSigPayload = computeCertificateSigningPayload(epoch2CertDraft);
    const coordSig = await signPayloadAsync(certSigPayload, keyA.privateKeyHex, "Ed25519");
    const epoch2Cert = { ...epoch2CertDraft, coordinatorSignature: coordSig };
    const transA = await engineA.ingestEpochTransitionCertificate(epoch2Cert);
    assert.equal(transA.ok, true);
    const transB = await engineB.ingestEpochTransitionCertificate(epoch2Cert);
    assert.equal(transB.ok, true);

    commitCheckpoint(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    assert.equal(engineA.meta.frontiers.compactionFrontier["1:B"], 3);
    assert.equal(engineA.meta.activeSnapshotSeq, 2);

    const op2B1A = (await engineB.allocateLocalMutation({ kind: "insert", externalId: "b4", initialFields: { title: "Payload ALPHA" } })).op;
    const draft2B1B = { ...op2B1A, initialFields: { title: "Payload BETA" } };
    const payloadDigest2B1B = computeOperationDigest(draft2B1B);
    const sigPayload2B1B = computeOperationSigningPayload({ ...draft2B1B, payloadDigest: payloadDigest2B1B });
    const authorSignature2B1B = await signPayloadAsync(sigPayload2B1B, keyB.privateKeyHex, "Ed25519");
    const op2B1B = { ...draft2B1B, payloadDigest: payloadDigest2B1B, authorSignature: authorSignature2B1B };

    await engineA.ingestRemoteOperation(op2B1A, channel);
    const eqRes = await engineA.ingestRemoteOperation(op2B1B, channel);
    assert.equal(eqRes.ok, false);
    assert.equal(eqRes.code, "SYNC_EQUIVOCATION_DETECTED");

    assert.equal(engineA.meta.frontiers.localDurableFrontier["1:B"], 3);
    assert.equal(engineA.meta.frontiers.compactionFrontier["1:B"], 3);
    assert.equal(engineA.meta.frontiers.localDurableFrontier["2:B"], 0);
    assert.ok(engineA.entriesState.has("1:B:1"));
    assert.ok(engineA.entriesState.has("1:B:2"));
    assert.ok(engineA.entriesState.has("1:B:3"));
    assert.ok(!engineA.entriesState.has("2:B:1"));

    const rebuilt = new Map();
    rebuildEntriesState(engineA.meta, rebuilt, engineA.snapshotsV2, engineA.mutationJournal);
    assert.equal(rebuilt.size, engineA.entriesState.size);
    for (const [k, v] of engineA.entriesState.entries()) {
      assert.deepEqual(rebuilt.get(k), v);
    }
  });

  it("TEST 2: All-frontier rollback consistency post-excision", async () => {
    const { engineA } = await createTestCluster();
    const streamKey = "1:B";
    engineA.meta.frontiers.localDurableFrontier[streamKey] = 5;
    engineA.meta.frontiers.knownProducedFrontier[streamKey] = 6;
    engineA.meta.frontiers.stableFrontier[streamKey] = 4;
    engineA.meta.frontiers.compactionFrontier[streamKey] = 3;
    engineA.meta.frontiers.snapshotIncludedFrontier[streamKey] = 3;
    engineA.meta.frontiers.digestPrunedFrontier[streamKey] = 2;
    engineA.meta.frontiers.serverAcceptedFrontier[streamKey] = 4;
    engineA.meta.clusterAcks["peer-1"] = { [streamKey]: 4 };

    reconcileAllFrontiersPostExcision(engineA.meta, streamKey, 3);

    assert.equal(engineA.meta.frontiers.localDurableFrontier[streamKey], 3);
    assert.equal(engineA.meta.frontiers.knownProducedFrontier[streamKey], 3);
    assert.equal(engineA.meta.frontiers.stableFrontier[streamKey], 3);
    assert.equal(engineA.meta.frontiers.compactionFrontier[streamKey], 3);
    assert.equal(engineA.meta.frontiers.snapshotIncludedFrontier[streamKey], 3);
    assert.equal(engineA.meta.frontiers.serverAcceptedFrontier[streamKey], 3);
    assert.equal(engineA.meta.clusterAcks["peer-1"][streamKey], 3);
    assert.ok(engineA.meta.frontiers.digestPrunedFrontier[streamKey] <= 3);
  });

  it("TEST 3: Legacy deleted-entry migration preserves deleted state and tombstones on cold boot with snapshot seq 0", async () => {
    const { engineA } = await createTestCluster();
    const migKey = await generateSigningKeyPair("Ed25519", true);
    const legacyEntries = [
      { id: "task-live", fields: { title: "Live Task" }, deleted: false },
      { id: "task-deleted", fields: { title: "Deleted Task" }, deleted: true },
      { id: "task-purged", deleted: true },
    ];
    const migRes = await migrateLegacyV1Store(
      engineA.meta,
      engineA.entriesState,
      engineA.snapshotsV2,
      engineA.mutationJournal,
      engineA.operationDigests,
      legacyEntries,
      migKey
    );
    assert.equal(migRes.ok, true);
    assert.equal(migRes.migratedCount, 3);

    engineA.snapshotsV2.clear();
    engineA.meta.activeSnapshotSeq = 0;

    rebuildEntriesState(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    const view = materializeVisibleArray(engineA.entriesState);
    assert.equal(view.totalCount, 1);
    assert.equal(view.items[0].id, "task-live");

    let foundDeleted = false;
    let foundPurged = false;
    for (const e of engineA.entriesState.values()) {
      if (e.externalId === "task-deleted" && e.deleted) foundDeleted = true;
      if (e.externalId === "task-purged" && e.deleted) foundPurged = true;
    }
    assert.ok(foundDeleted, "task-deleted tombstone must exist");
    assert.ok(foundPurged, "task-purged tombstone must exist");
  });

  it("TEST 4: Legacy migration records pass normal cryptographic author verification", async () => {
    const { engineA, channel } = await createTestCluster();
    const migKey = await generateSigningKeyPair("Ed25519", true);
    await migrateLegacyV1Store(
      engineA.meta,
      engineA.entriesState,
      engineA.snapshotsV2,
      engineA.mutationJournal,
      engineA.operationDigests,
      [{ id: "item-1", deleted: false }],
      migKey
    );
    const jOp = engineA.mutationJournal.values().next().value.operation;
    const verifyRes = await preVerifyIncomingOperationAsync(engineA.meta, jOp, channel);
    assert.equal(verifyRes.ok, true, `Migration op must pass cryptographic author verification: ${verifyRes.code} ${verifyRes.detail}`);
  });

  it("TEST 5: Cross-stream causal dependency buffers without falsely flagging equivocation", async () => {
    const { engineA, engineB, engineC, channel } = await createTestCluster();
    const targetIncarnation = { epochNumber: 1, replicaId: "A", sequence: 1 };
    const updateOp = (await engineB.allocateLocalMutation({
      kind: "update",
      targetIncarnation,
      externalId: "item-a1",
      partialFields: { status: "COMPLETED" },
    })).op;

    const ingestRes = await engineC.ingestRemoteOperation(updateOp, channel);
    assert.equal(ingestRes.ok, true);
    assert.equal(ingestRes.disposition, "BUFFERED_CAUSAL_DEPENDENCY");
    assert.equal(engineC.inboundDependencyBuffer.size, 1);
    assert.equal(Object.keys(engineC.meta.activeEpochEquivocations).length, 0, "Must NOT flag equivocation!");

    const insertOp = (await engineA.allocateLocalMutation({
      kind: "insert",
      externalId: "item-a1",
      initialFields: { title: "Item A1", status: "PENDING" },
    })).op;
    const chanA = { channelId: "c1", channelAuthenticated: true, transportSenderReplicaId: "A" };
    await engineC.ingestRemoteOperation(insertOp, chanA);

    assert.equal(engineC.inboundDependencyBuffer.size, 0);
    const incKey = toIncarnationId(targetIncarnation);
    const finalEntry = engineC.entriesState.get(incKey);
    assert.ok(finalEntry);
    assert.equal(finalEntry.fields.status.value, "COMPLETED");
  });

  it("TEST 6: Rolling digest chain continues unbroken after checkpoint & pruning", async () => {
    const keyA = await generateSigningKeyPair("Ed25519", true);
    const certDraft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 1,
      epochCertificateId: "cert-epoch-1",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        A: { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 0 },
    };
    const cPayload = computeCertificateSigningPayload(certDraft);
    const cSig = await signPayloadAsync(cPayload, keyA.privateKeyHex, "Ed25519");
    const cert = { ...certDraft, coordinatorSignature: cSig };
    const engineA = new ReplicationEngine("todos", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
    const streamKey = "1:A";

    for (let i = 1; i <= 4; i++) {
      const res = await engineA.allocateLocalMutation({ kind: "insert", externalId: `t-${i}`, initialFields: { v: i } });
      assert.equal(res.ok, true);
    }
    const digestAt3 = engineA.meta.rollingStreamDigests[streamKey][3];
    const digestAt4 = engineA.meta.rollingStreamDigests[streamKey][4];
    assert.ok(digestAt3 && digestAt4);

    const epoch2CertDraft = {
      ...cert,
      epochNumber: 2,
      epochCertificateId: "cert-epoch-2",
      baselineStableFrontier: { "1:A": 4 },
      coordinatorSignature: "",
    };
    const payload = computeCertificateSigningPayload(epoch2CertDraft);
    const sig = await signPayloadAsync(payload, keyA.privateKeyHex, "Ed25519");
    const epoch2Cert = { ...epoch2CertDraft, coordinatorSignature: sig };
    const transRes = await engineA.ingestEpochTransitionCertificate(epoch2Cert);
    assert.equal(transRes.ok, true);

    engineA.meta.clusterAcks["A"] = { [streamKey]: 3 };
    engineA.meta.frontiers.stableFrontier[streamKey] = 3;
    commitCheckpoint(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    commitCheckpoint(engineA.meta, engineA.entriesState, engineA.snapshotsV2, engineA.mutationJournal);
    assert.equal(engineA.meta.frontiers.compactionFrontier[streamKey], 3);

    assert.equal(engineA.meta.rollingStreamDigestAnchors[streamKey].sequence, 3);
    assert.equal(engineA.meta.rollingStreamDigestAnchors[streamKey].digest, digestAt3);

    assert.equal(engineA.meta.rollingStreamDigests[streamKey][4], digestAt4);
    const op4 = engineA.mutationJournal.get("todos:1:A:4").operation;
    const expectedDigestAt4 = sha256Hex(`${digestAt3}:${op4.payloadDigest}`);
    assert.equal(digestAt4, expectedDigestAt4);

    const nextOpRes = await engineA.allocateLocalMutation({ kind: "insert", externalId: "t-next", initialFields: { v: 5 } });
    assert.equal(nextOpRes.ok, true);
    assert.deepEqual(nextOpRes.op.opDot, { epochNumber: 2, replicaId: "A", sequence: 1 });
  });

  it("TEST 7: Local state exported into existing cluster preserves updates and deletions", async () => {
    const { engineA, engineB } = await createTestCluster();
    await engineB.allocateLocalMutation({ kind: "insert", externalId: "item-live", initialFields: { title: "Remote Live" } });
    await engineB.allocateLocalMutation({ kind: "insert", externalId: "item-to-delete", initialFields: { title: "Remote To Delete" } });
    const remoteSnap = commitCheckpoint(engineB.meta, engineB.entriesState, engineB.snapshotsV2, engineB.mutationJournal);

    await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-live", initialFields: { title: "Local Live Updated" } });
    await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-to-delete", initialFields: { title: "To Delete" } });
    await engineA.allocateLocalMutation({ kind: "delete", externalId: "item-to-delete", targetIncarnation: { epochNumber: 1, replicaId: "A", sequence: 2 } });
    await engineA.allocateLocalMutation({ kind: "insert", externalId: "item-local-only", initialFields: { title: "Local Only" } });

    const joinRes = await engineA.enableRemoteSync("JOIN_EXISTING_REMOTE_CLUSTER", remoteSnap);
    assert.equal(joinRes.ok, true);
    const view = materializeVisibleArray(engineA.entriesState);
    const visibleIds = view.items.map((i) => i.id);
    assert.ok(visibleIds.includes("item-live"));
    assert.ok(visibleIds.includes("item-local-only"));
    assert.ok(!visibleIds.includes("item-to-delete"), "item-to-delete must not be live!");
  });

  it("TEST 8: Remote sync founding snapshot follows staged coordinator handshake", async () => {
    const { engineA, cert } = await createTestCluster();
    const stageRes = await engineA.enableRemoteSync("SEED_NEW_REMOTE_EPOCH");
    assert.equal(stageRes.ok, true);
    assert.equal(engineA.meta.lifecycleState, "COORDINATOR_ACCEPTANCE_PENDING");
    assert.equal(engineA.meta.remoteSyncEnabled, false);

    const activeRes = await engineA.enableRemoteSync("SEED_NEW_REMOTE_EPOCH", cert);
    assert.equal(activeRes.ok, true);
    assert.equal(engineA.meta.lifecycleState, "ACTIVE");
    assert.equal(engineA.meta.remoteSyncEnabled, true);
  });

  it("TEST 9: Storage bounds enforcement on operation, entry and backpressure", async () => {
    const { engineA } = await createTestCluster();
    const largePayload = { kind: "insert", externalId: "big", initialFields: { data: "x".repeat(70_000) } };
    const opRes = await engineA.allocateLocalMutation(largePayload);
    assert.equal(opRes.ok, false);
    assert.equal(opRes.code, "SYNC_OPERATION_PAYLOAD_TOO_LARGE");

    for (let i = 0; i < 250; i++) {
      recordQuarantine(engineA.meta, engineA.quarantineJournal, "SYNC_EQUIVOCATION_DETECTED", "Tier 1 forensic", {});
      recordQuarantine(engineA.meta, engineA.quarantineJournal, "TRANSIENT_LOG", "Tier 2 diagnostic", {});
    }
    assert.equal(engineA.quarantineJournal.size, 500);

    recordQuarantine(engineA.meta, engineA.quarantineJournal, "SYNC_EQUIVOCATION_DETECTED", "New Tier 1", {});
    assert.equal(engineA.quarantineJournal.size, 500);
    assert.equal(engineA.meta.quarantineEvictedCriticalCount, 0, "No Tier 1 record should be evicted while Tier 2 exists");
  });

  it("TEST 10: WebCrypto decoupled lifecycle prevents IndexedDB transaction deactivation", async () => {
    const { engineA, engineB, channel } = await createTestCluster();
    const op = (await engineB.allocateLocalMutation({ kind: "insert", externalId: "test-item", initialFields: { v: 1 } })).op;
    const ingestRes = await engineA.ingestRemoteOperation(op, channel);
    assert.equal(ingestRes.ok, true);
    assert.equal(ingestRes.disposition, "APPLIED");
    assert.ok(engineA.entriesState.has("1:B:1"));
  });
});

