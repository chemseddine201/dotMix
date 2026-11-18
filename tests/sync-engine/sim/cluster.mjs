/**
 * Cluster initialization and operation crafting for simulation on production core
 */

import {
  ReplicationEngine,
  computeCertificateSigningPayload,
  computeOperationDigest,
  computeOperationSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";
import { MemoryStoreBackend, persistEngineToStore } from "../../../packages/sync/dist/storage/index.js";

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createSimCluster(
  seed,
  numReplicas,
  withByzantine,
  collectionId = "sim-collection"
) {
  const replicaIds = [];
  for (let i = 0; i < numReplicas; i++) {
    replicaIds.push(`R${i}`);
  }
  const coordinatorId = replicaIds[0];

  const keys = {};
  for (const id of replicaIds) {
    keys[id] = await generateSigningKeyPair("Ed25519", true);
  }

  const memberBindings = {};
  const baselineStableFrontier = {};

  for (const id of replicaIds) {
    memberBindings[id] = {
      role: "WRITER_REPLICA",
      authorKeyId: `key:${id}:v1`,
      authorPublicKeyHex: keys[id].publicKeyHex,
      signingAlgorithm: "Ed25519",
    };
    baselineStableFrontier[`1:${id}`] = 0;
  }

  const draftCert = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId,
    epochNumber: 1,
    epochCertificateId: "cert-epoch-1",
    coordinatorReplicaId: coordinatorId,
    coordinatorKeyId: `key:${coordinatorId}:v1`,
    memberBindings,
    baselineStableFrontier,
    coordinatorSignature: "",
  };

  const certPayload = computeCertificateSigningPayload(draftCert);
  const coordinatorSignature = await signPayloadAsync(certPayload, keys[coordinatorId].privateKeyHex, "Ed25519");
  const cert = { ...draftCert, coordinatorSignature };

  const replicas = new Map();
  for (let i = 0; i < numReplicas; i++) {
    const id = replicaIds[i];
    const isByz = withByzantine && i === numReplicas - 1;
    const engine = new ReplicationEngine(collectionId, id, 1, cert, `key:${id}:v1`, keys[id].privateKeyHex);
    engine.meta.remoteSyncEnabled = true;
    const backend = new MemoryStoreBackend();
    await backend.open();
    await persistEngineToStore(backend, engine);
    replicas.set(id, { id, isByzantine: isByz, keyPair: keys[id], engine, backend });
  }

  return {
    collectionId,
    replicas,
    replicaIds,
    coordinatorId,
    currentEpoch: 1,
    currentCert: cert,
  };
}

export async function createSignedAck(node, epochNumber, collectionId) {
  const durableFrontier = { ...node.engine.meta.frontiers.localDurableFrontier };
  return {
    protocolVersion: PROTOCOL_VERSION,
    collectionId,
    epochNumber,
    fromReplicaId: node.id,
    durableFrontier,
    authorSignature: "",
  };
}

export async function createByzantineOperation(byzNode, behavior, cluster, stepIndex) {
  const collectionId = cluster.collectionId;
  const epoch = cluster.currentEpoch;
  const certId = cluster.currentCert.epochCertificateId;
  const replicaId = byzNode.id;
  const seq = byzNode.engine.meta.nextLocalSequence;
  const opDot = { epochNumber: epoch, replicaId, sequence: seq };
  const stamp = { lamport: byzNode.engine.meta.localLamport + 1, ...opDot };

  if (behavior === "oversized_payload") {
    const hugeFields = { data: "x".repeat(70_000) };
    const draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId,
      epochNumber: epoch,
      epochCertificateId: certId,
      opDot,
      targetIncarnation: opDot,
      externalId: `byz-over-${stepIndex}`,
      stamp,
      authorKeyId: `key:${replicaId}:v1`,
      payloadDigest: "",
      authorSignature: "",
      kind: "insert",
      indexKey: "a00",
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: hugeFields,
    };
    const payloadDigest = computeOperationDigest(draft);
    const authorSignature = await signPayloadAsync(computeOperationSigningPayload({ ...draft, payloadDigest }), byzNode.keyPair.privateKeyHex, "Ed25519");
    return { ...draft, payloadDigest, authorSignature };
  }

  if (behavior === "oversized_index") {
    const hugeIndex = "k".repeat(600);
    const draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId,
      epochNumber: epoch,
      epochCertificateId: certId,
      opDot,
      targetIncarnation: opDot,
      externalId: `byz-idx-${stepIndex}`,
      stamp,
      authorKeyId: `key:${replicaId}:v1`,
      payloadDigest: "",
      authorSignature: "",
      kind: "insert",
      indexKey: hugeIndex,
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: { v: 1 },
    };
    const payloadDigest = computeOperationDigest(draft);
    const authorSignature = await signPayloadAsync(computeOperationSigningPayload({ ...draft, payloadDigest }), byzNode.keyPair.privateKeyHex, "Ed25519");
    return { ...draft, payloadDigest, authorSignature };
  }

  if (behavior === "invalid_dependency") {
    const ghostDot = { epochNumber: epoch, replicaId: "R_GHOST", sequence: 999 };
    const draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId,
      epochNumber: epoch,
      epochCertificateId: certId,
      opDot,
      targetIncarnation: ghostDot,
      externalId: `ghost-${stepIndex}`,
      stamp,
      authorKeyId: `key:${replicaId}:v1`,
      payloadDigest: "",
      authorSignature: "",
      kind: "update",
      partialFields: { v: 999 },
      removedFields: [],
      baseFieldStamps: {},
    };
    const payloadDigest = computeOperationDigest(draft);
    const authorSignature = await signPayloadAsync(computeOperationSigningPayload({ ...draft, payloadDigest }), byzNode.keyPair.privateKeyHex, "Ed25519");
    return { ...draft, payloadDigest, authorSignature };
  }

  if (behavior === "invalid_signature") {
    const draft = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId,
      epochNumber: epoch,
      epochCertificateId: certId,
      opDot,
      targetIncarnation: opDot,
      externalId: `bad-sig-${stepIndex}`,
      stamp,
      authorKeyId: `key:${replicaId}:v1`,
      payloadDigest: "",
      authorSignature: "0000deadbeef".repeat(8),
      kind: "insert",
      indexKey: "a99",
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: { v: 1 },
    };
    const payloadDigest = computeOperationDigest(draft);
    return { ...draft, payloadDigest };
  }

  if (behavior === "fork") {
    const allocRes = await byzNode.engine.allocateLocalMutation({
      kind: "insert",
      externalId: `fork-${stepIndex}`,
      indexKey: "f01",
      initialFields: { v: "original" },
    });
    if (allocRes.ok && allocRes.op && allocRes.op.kind === "insert") {
      const conflictDraft = {
        ...allocRes.op,
        initialFields: { v: "forked-conflict" },
      };
      const payloadDigest = computeOperationDigest(conflictDraft);
      const authorSignature = await signPayloadAsync(computeOperationSigningPayload({ ...conflictDraft, payloadDigest }), byzNode.keyPair.privateKeyHex, "Ed25519");
      return { ...conflictDraft, payloadDigest, authorSignature };
    }
  }

  return null;
}