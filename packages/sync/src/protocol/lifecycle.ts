/**
 * @dotmix/sync — Lifecycle State Machine, Epoch Advance & Remote Sync
 * Enforces Option A Risk D-1, Defect 7, Defect 8.
 */

import { toIncarnationId } from "./apply.js";
import {
  computeCertificateSigningPayload,
  signPayloadAsync,
  verifySignatureAsync,
  validateEpochMembershipCertificate,
} from "./preverify.js";
import { planClusterExportReplay, executeReplayPlan } from "./replay.js";
import {
  commitBaselineSnapshot,
  commitCheckpoint,
  computeCanonicalSnapshotDigest,
} from "./snapshots.js";
import { PROTOCOL_VERSION } from "./types.js";
import type {
  EpochMembershipCertificate,
  ReplicaMetaRecord,
  ReplicableOperation,
  ReplayPlanRecord,
  SnapshotRecord,
  InTransactionContext,
} from "./types.js";

export { validateEpochMembershipCertificate };

export function createInitialReplicaMeta(
  collectionId: string,
  replicaId: string,
  epochNumber: number,
  epochCertificate: EpochMembershipCertificate,
  authorKeyId: string,
  authorPrivateKeyHex?: string
): ReplicaMetaRecord {
  return {
    protocolVersion: PROTOCOL_VERSION,
    collectionId,
    replicaId,
    epochNumber,
    epochCertificateId: epochCertificate.epochCertificateId,
    epochCertificate,
    epochMemberBindings: { ...epochCertificate.memberBindings },
    revokedKeyIds: [],
    authorKeyId,
    authorPrivateKeyHex,
    securityStateVersion: 1,
    localLamport: 0,
    nextLocalSequence: 1,
    nextQuarantineSeq: 1,
    activeSnapshotSeq: 0,
    remoteSyncEnabled: false,
    lifecycleState: "ACTIVE",
    leaseHolderTabId: "tab-primary",
    leaseFencingTerm: 1,
    baselineSnapshotSeq: 0,
    frontiers: {
      localDurableFrontier: {}, knownProducedFrontier: {}, snapshotIncludedFrontier: {},
      stableFrontier: {}, compactionFrontier: {}, digestPrunedFrontier: {},
      serverAcceptedFrontier: {}, replayCompletedWatermark: {},
    },
    clusterAcks: { [replicaId]: {} },
    rollingStreamDigests: {},
    rollingStreamDigestAnchors: {},
    foldedEpochBaseline: {},
    activeEpochEquivocations: {},
    historicalEquivocationAudit: [],
    quarantineEvictedCriticalCount: 0,
    totalGapBufferOps: 0, totalGapBufferBytes: 0,
    totalDependencyBufferOps: 0, totalDependencyBufferBytes: 0,
  };
}

export function installEpochCertificate(
  meta: ReplicaMetaRecord,
  cert: EpochMembershipCertificate
): void {
  meta.epochNumber = cert.epochNumber;
  meta.epochCertificateId = cert.epochCertificateId;
  meta.epochCertificate = cert;
  meta.epochMemberBindings = { ...cert.memberBindings };
  if (cert.revokedKeyIds && Array.isArray(cert.revokedKeyIds)) {
    meta.revokedKeyIds = [...cert.revokedKeyIds];
  }
}

export interface LifecycleEngineTarget {
  meta: ReplicaMetaRecord;
  entriesState: InTransactionContext["entriesState"];
  mutationJournal: InTransactionContext["mutationJournal"];
  operationDigests: InTransactionContext["operationDigests"];
  syncOutbox: InTransactionContext["syncOutbox"];
  inboundGapBuffer: InTransactionContext["inboundGapBuffer"];
  inboundDependencyBuffer: InTransactionContext["inboundDependencyBuffer"];
  snapshotsV2: Map<number, SnapshotRecord>;
  enqueueAllocation<T>(actionTask: () => Promise<T>): Promise<T>;
  allocateLocalMutation(input: unknown): Promise<{ ok: boolean; op?: ReplicableOperation | undefined; code?: string | undefined; detail?: string | undefined }>;
}

export async function ingestEpochTransitionCertificate(
  engine: LifecycleEngineTarget,
  cert: EpochMembershipCertificate
): Promise<{ ok: boolean; code?: string | undefined; detail?: string | undefined }> {
  const transitionResult = await engine.enqueueAllocation(async () => {
    if (
      cert.collectionId !== engine.meta.collectionId ||
      cert.epochNumber !== engine.meta.epochNumber + 1 ||
      !cert.epochCertificateId ||
      cert.epochCertificateId === engine.meta.epochCertificateId
    ) {
      return {
        ok: false,
        code: "SYNC_EPOCH_TRANSITION_INVALID",
        detail: `Transition certificate invalid: collection=${cert.collectionId}, epoch=${cert.epochNumber}, certId=${cert.epochCertificateId}`,
      };
    }

    // Risk D-1 (Permanent Case 2): Non-member check
    if (!(engine.meta.replicaId in engine.meta.epochCertificate.memberBindings)) {
      return {
        ok: false,
        code: "SYNC_CERTIFICATE_NOT_A_MEMBER",
        detail: `Receiving replica ${engine.meta.replicaId} is not a member of current certificate`,
      };
    }

    const currentCoordId = engine.meta.epochCertificate.coordinatorReplicaId;
    const currentCoordBinding = engine.meta.epochCertificate.memberBindings[currentCoordId];

    if (!currentCoordBinding || !cert.coordinatorSignature) {
      return {
        ok: false,
        code: "SYNC_CERTIFICATE_SIGNATURE_INVALID",
        detail: "Current coordinator binding missing or signature missing on transition certificate",
      };
    }

    const signingPayload = computeCertificateSigningPayload(cert);
    const isValidSig = await verifySignatureAsync(
      signingPayload,
      cert.coordinatorSignature,
      currentCoordBinding.authorPublicKeyHex,
      currentCoordBinding.signingAlgorithm ?? "Ed25519"
    );

    if (!isValidSig) {
      return {
        ok: false,
        code: "SYNC_CERTIFICATE_SIGNATURE_INVALID",
        detail: `Coordinator signature verification failed against current coordinator ${currentCoordId}`,
      };
    }

    // G32-1 & Risk D-1 (Permanent Case 1): Monotonicity check on listed streams
    for (const [streamKey, currentFloor] of Object.entries(engine.meta.epochCertificate.baselineStableFrontier)) {
      if (!(streamKey in cert.baselineStableFrontier)) continue;
      const newFloor = cert.baselineStableFrontier[streamKey] ?? 0;
      if (newFloor < currentFloor) {
        return {
          ok: false,
          code: "SYNC_CERTIFICATE_FLOOR_REGRESSION",
          detail: `Baseline floor for stream ${streamKey} decreased from ${currentFloor} to ${newFloor}`,
        };
      }
    }

    // Readiness: new floor must be <= localDurableFrontier for every stream in new certificate
    for (const [streamKey, newFloor] of Object.entries(cert.baselineStableFrontier)) {
      const durable = engine.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
      if (newFloor > durable) {
        return {
          ok: false,
          code: "SYNC_EPOCH_TRANSITION_NOT_READY",
          detail: `Baseline floor ${newFloor} for stream ${streamKey} exceeds local durable frontier ${durable}`,
        };
      }
      const currentFloor = engine.meta.epochCertificate.baselineStableFrontier[streamKey] ?? 0;
      if (newFloor < currentFloor) {
        return {
          ok: false,
          code: "SYNC_CERTIFICATE_FLOOR_REGRESSION",
          detail: `Baseline floor for stream ${streamKey} decreased from ${currentFloor} to ${newFloor}`,
        };
      }
    }

    const baselineSnap = commitBaselineSnapshot(
      engine.meta,
      engine.entriesState,
      engine.snapshotsV2,
      engine.mutationJournal,
      cert
    );

    const oldEpoch = engine.meta.epochNumber;
    const discardedLocalOps: ReplicableOperation[] = [];
    const preTransitionEntriesState = new Map(engine.entriesState);

    for (const [streamKey, closingFloor] of Object.entries(cert.baselineStableFrontier)) {
      if (streamKey.startsWith(`${oldEpoch}:`)) {
        const durSeq = engine.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
        if (durSeq > closingFloor) {
          for (let s = closingFloor + 1; s <= durSeq; s++) {
            const opKey = `${engine.meta.collectionId}:${streamKey}:${s}`;
            const j = engine.mutationJournal.get(opKey);
            if (j) {
              if (j.replicaId === engine.meta.replicaId) discardedLocalOps.push(j.operation);
              engine.mutationJournal.delete(opKey);
            }
            engine.syncOutbox.delete(opKey);
            const dig = engine.operationDigests.get(opKey);
            if (dig) dig.status = "SYNC_EPOCH_CLOSED";
          }
          for (const [gKey, gRec] of engine.inboundGapBuffer.entries()) {
            if (gRec.streamKey === streamKey && gRec.sequence > closingFloor) {
              engine.inboundGapBuffer.delete(gKey);
              engine.meta.totalGapBufferOps--;
              engine.meta.totalGapBufferBytes -= gRec.byteSize;
            }
          }
          engine.meta.frontiers.localDurableFrontier[streamKey] = closingFloor;
          engine.meta.frontiers.knownProducedFrontier[streamKey] = Math.min(engine.meta.frontiers.knownProducedFrontier[streamKey] ?? 0, closingFloor);
          engine.meta.frontiers.snapshotIncludedFrontier[streamKey] = Math.min(engine.meta.frontiers.snapshotIncludedFrontier[streamKey] ?? 0, closingFloor);
          engine.meta.frontiers.compactionFrontier[streamKey] = Math.min(engine.meta.frontiers.compactionFrontier[streamKey] ?? 0, closingFloor);
        }
      }
    }

    engine.entriesState.clear();
    for (const e of baselineSnap.entries) {
      engine.entriesState.set(toIncarnationId(e.targetBirthDot), JSON.parse(JSON.stringify(e)));
    }

    installEpochCertificate(engine.meta, cert);
    engine.meta.nextLocalSequence = 1;

    let replayPlan: ReplayPlanRecord | undefined;
    if (discardedLocalOps.length > 0) {
      replayPlan = planClusterExportReplay(preTransitionEntriesState, baselineSnap, engine.meta.collectionId, cert.epochNumber);
      engine.meta.activeReplayPlan = replayPlan;
    }

    return { ok: true, replayPlan };
  });

  if (!transitionResult.ok) return transitionResult;

  if (transitionResult.replayPlan) {
    await executeReplayPlan(engine, transitionResult.replayPlan);
    engine.meta.activeReplayPlan = undefined;
  }

  return { ok: true };
}

export async function executeSelfCertifiedEpochAdvance(
  engine: LifecycleEngineTarget
): Promise<{ ok: boolean; code?: string | undefined; detail?: string | undefined }> {
  if (!engine.meta.authorPrivateKeyHex) {
    return { ok: false, code: "SYNC_SIGNING_KEY_REQUIRED", detail: "Author private key required to self-certify epoch advance" };
  }

  const writers = Object.entries(engine.meta.epochMemberBindings).filter(([_, b]) => b.role === "WRITER_REPLICA");
  if (writers.length !== 1 || writers[0]![0] !== engine.meta.replicaId) {
    return { ok: false, code: "SYNC_MULTI_WRITER_COORDINATOR_REQUIRED", detail: "Only single-writer topologies may self-certify epoch advance" };
  }

  const nextEpoch = engine.meta.epochNumber + 1;
  const nextCertId = `cert-epoch-${nextEpoch}`;
  const newBaseline: Record<string, number> = {};
  for (const [streamKey, seq] of Object.entries(engine.meta.frontiers.localDurableFrontier)) {
    newBaseline[streamKey] = seq;
  }

  const certDraft: EpochMembershipCertificate = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: engine.meta.collectionId,
    epochNumber: nextEpoch,
    epochCertificateId: nextCertId,
    coordinatorReplicaId: engine.meta.replicaId,
    coordinatorKeyId: engine.meta.authorKeyId,
    memberBindings: { ...engine.meta.epochMemberBindings },
    baselineStableFrontier: newBaseline,
    coordinatorSignature: "",
  };

  const signingPayload = computeCertificateSigningPayload(certDraft);
  const sig = await signPayloadAsync(signingPayload, engine.meta.authorPrivateKeyHex, "Ed25519");
  const cert: EpochMembershipCertificate = { ...certDraft, coordinatorSignature: sig };

  return ingestEpochTransitionCertificate(engine, cert);
}

export async function executeEnableRemoteSync(
  engine: LifecycleEngineTarget,
  mode: "SEED_NEW_REMOTE_EPOCH" | "JOIN_EXISTING_REMOTE_CLUSTER",
  coordinatorCertOrRemoteSnapshot?: EpochMembershipCertificate | SnapshotRecord,
  assignedReplicaId?: string
): Promise<{ ok: boolean; code?: string | undefined; detail?: string | undefined }> {
  if (mode === "SEED_NEW_REMOTE_EPOCH") {
    engine.meta.lifecycleState = "FOUNDING_SNAPSHOT_STAGED";
    commitCheckpoint(engine.meta, engine.entriesState, engine.snapshotsV2, engine.mutationJournal);
    engine.meta.lifecycleState = "COORDINATOR_ACCEPTANCE_PENDING";

    if (coordinatorCertOrRemoteSnapshot && "memberBindings" in coordinatorCertOrRemoteSnapshot) {
      const cert = coordinatorCertOrRemoteSnapshot as EpochMembershipCertificate;
      const foundingSnap = engine.snapshotsV2.get(engine.meta.activeSnapshotSeq);
      const valRes = await validateEpochMembershipCertificate(cert, engine.meta.collectionId, foundingSnap);
      if (!valRes.ok) return valRes;

      installEpochCertificate(engine.meta, cert);
      engine.meta.remoteSyncEnabled = true;
      engine.meta.lifecycleState = "ACTIVE";
      return { ok: true };
    }

    return { ok: true, code: "COORDINATOR_ACCEPTANCE_PENDING", detail: "Founding snapshot staged; waiting for coordinator epoch certificate" };
  }

  if (!coordinatorCertOrRemoteSnapshot || !("entries" in coordinatorCertOrRemoteSnapshot)) {
    return { ok: false, code: "SYNC_REMOTE_SNAPSHOT_REQUIRED", detail: "Remote cluster snapshot required to join existing cluster" };
  }

  const remoteSnap = coordinatorCertOrRemoteSnapshot as SnapshotRecord;

  const valCertRes = await validateEpochMembershipCertificate(remoteSnap.epochCertificate, engine.meta.collectionId, remoteSnap);
  if (!valCertRes.ok) return valCertRes;

  const expectedSnapDigest = computeCanonicalSnapshotDigest(remoteSnap);
  if (remoteSnap.snapshotDigest !== expectedSnapDigest) {
    return { ok: false, code: "SYNC_SNAPSHOT_DIGEST_MISMATCH", detail: "Bootstrap snapshot digest verification failed" };
  }

  const joinerPublicKey = engine.meta.epochMemberBindings?.[engine.meta.replicaId]?.authorPublicKeyHex;
  if (!joinerPublicKey) {
    return { ok: false, code: "SYNC_JOIN_IDENTITY_INVALID", detail: "Joiner own public key is unknown in local metadata" };
  }

  let targetReplicaId: string;
  let binding: (typeof remoteSnap.epochCertificate.memberBindings)[string] | undefined;

  if (assignedReplicaId) {
    targetReplicaId = assignedReplicaId;
    binding = remoteSnap.epochCertificate.memberBindings?.[targetReplicaId];
    if (!binding || binding.authorPublicKeyHex !== joinerPublicKey) {
      return { ok: false, code: "SYNC_JOIN_IDENTITY_INVALID", detail: `Coordinator certificate does not contain valid member binding for replica ${targetReplicaId}` };
    }
  } else {
    const matchingBindings = Object.entries(remoteSnap.epochCertificate.memberBindings ?? {}).filter(
      ([_, b]) => b.authorPublicKeyHex === joinerPublicKey
    );
    if (matchingBindings.length !== 1) {
      return { ok: false, code: "SYNC_JOIN_IDENTITY_INVALID", detail: `Coordinator certificate must contain exactly one member binding for joiner public key (found ${matchingBindings.length})` };
    }
    targetReplicaId = matchingBindings[0]![0];
    binding = matchingBindings[0]![1];
  }

  const targetStreamKey = `${remoteSnap.epochNumber}:${targetReplicaId}`;
  const existingDurable = remoteSnap.frontiers.localDurableFrontier[targetStreamKey] ?? 0;
  const existingIncluded = remoteSnap.frontiers.snapshotIncludedFrontier[targetStreamKey] ?? 0;
  const existingBaseline = remoteSnap.baselineStableFrontier?.[targetStreamKey] ?? 0;
  if (existingDurable > 0 || existingIncluded > 0 || existingBaseline > 0) {
    return { ok: false, code: "SYNC_JOIN_IDENTITY_INVALID", detail: `Snapshot frontiers already contain operations for stream ${targetStreamKey}; cannot restart at seq 1` };
  }

  const replayPlan = planClusterExportReplay(engine.entriesState, remoteSnap, engine.meta.collectionId, remoteSnap.epochNumber);

  engine.mutationJournal.clear();
  engine.operationDigests.clear();
  engine.syncOutbox.clear();
  engine.inboundGapBuffer.clear();
  engine.inboundDependencyBuffer.clear();
  engine.meta.totalGapBufferOps = 0;
  engine.meta.totalGapBufferBytes = 0;
  engine.meta.totalDependencyBufferOps = 0;
  engine.meta.totalDependencyBufferBytes = 0;

  engine.entriesState.clear();
  for (const e of remoteSnap.entries) {
    engine.entriesState.set(toIncarnationId(e.targetBirthDot), JSON.parse(JSON.stringify(e)));
  }

  engine.meta.replicaId = targetReplicaId;
  engine.meta.authorKeyId = binding.authorKeyId;
  installEpochCertificate(engine.meta, remoteSnap.epochCertificate);
  engine.meta.frontiers = JSON.parse(JSON.stringify(remoteSnap.frontiers));
  engine.meta.rollingStreamDigestAnchors = { ...(remoteSnap.rollingStreamDigestAnchors ?? {}) };
  engine.meta.rollingStreamDigests = {};
  for (const [k, a] of Object.entries(engine.meta.rollingStreamDigestAnchors)) {
    engine.meta.rollingStreamDigests[k] = { [a.sequence]: a.digest };
  }

  engine.meta.nextLocalSequence = 1;

  let maxLamport = 0;
  for (const e of remoteSnap.entries) {
    if (e.pos?.stamp?.lamport) maxLamport = Math.max(maxLamport, e.pos.stamp.lamport);
    if (e.fields) {
      for (const f of Object.values(e.fields)) {
        if (f && typeof f === "object" && "stamp" in f && (f as { stamp?: { lamport?: number } }).stamp?.lamport) {
          maxLamport = Math.max(maxLamport, (f as { stamp: { lamport: number } }).stamp.lamport);
        }
      }
    }
  }
  engine.meta.localLamport = Math.max(engine.meta.localLamport, maxLamport);
  engine.meta.remoteSyncEnabled = true;
  engine.meta.lifecycleState = "ACTIVE";
  engine.meta.activeReplayPlan = replayPlan;

  await executeReplayPlan(engine, replayPlan);
  engine.meta.activeReplayPlan = undefined;

  return { ok: true };
}

export async function resumeActivation(
  engine: LifecycleEngineTarget,
  coordinatorCert?: EpochMembershipCertificate
): Promise<{ ok: boolean; code?: string | undefined; detail?: string | undefined }> {
  if (engine.meta.activeReplayPlan) {
    await executeReplayPlan(engine, engine.meta.activeReplayPlan);
    engine.meta.activeReplayPlan = undefined;
  }
  if (engine.meta.lifecycleState === "FOUNDING_SNAPSHOT_STAGED") {
    commitCheckpoint(engine.meta, engine.entriesState, engine.snapshotsV2, engine.mutationJournal);
    engine.meta.lifecycleState = "COORDINATOR_ACCEPTANCE_PENDING";
  }
  if (engine.meta.lifecycleState === "COORDINATOR_ACCEPTANCE_PENDING") {
    if (coordinatorCert) {
      const foundingSnap = engine.snapshotsV2.get(engine.meta.activeSnapshotSeq);
      const valRes = await validateEpochMembershipCertificate(coordinatorCert, engine.meta.collectionId, foundingSnap);
      if (!valRes.ok) return valRes;
      installEpochCertificate(engine.meta, coordinatorCert);
      engine.meta.remoteSyncEnabled = true;
      engine.meta.lifecycleState = "ACTIVE";
      return { ok: true };
    }
    return { ok: true, code: "COORDINATOR_ACCEPTANCE_PENDING" };
  }
  return { ok: true, code: engine.meta.lifecycleState };
}
