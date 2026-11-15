/**
 * D137-v33-reference: Lifecycle State Machine, Epoch Advance & Remote Sync
 * Enforces T-31.9, D-139 Option A, Defect 7, Defect 8.
 */

import { toIncarnationId } from "./canonicalization.js";
import { computeCertificateSigningPayload, signPayloadAsync } from "./crypto.js";
import { executeReplayPlan, planClusterExportReplay } from "./replay.js";
import { commitBaselineSnapshot, commitCheckpoint, computeCanonicalSnapshotDigest } from "./snapshots.js";
import {
  ingestEpochTransitionCertificate,
  installEpochCertificate,
  validateEpochMembershipCertificate,
} from "./certificates.js";
import type { D137Engine } from "./engine.js";
import type {
  CausalDot,
  EpochMembershipCertificate,
  SnapshotRecord,
} from "./types.js";

/**
 * D-139 Option A: Single-writer self-certified epoch advance
 */
export async function executeSelfCertifiedEpochAdvance(
  engine: D137Engine
): Promise<{ ok: boolean; code?: string; detail?: string }> {
  if (!engine.meta.authorPrivateKeyHex) {
    return {
      ok: false,
      code: "D137_SIGNING_KEY_REQUIRED",
      detail: "Author private key required to self-certify epoch advance",
    };
  }

  const writers = Object.entries(engine.meta.epochMemberBindings).filter(
    ([_, b]) => b.role === "WRITER_REPLICA"
  );
  if (writers.length !== 1 || writers[0]![0] !== engine.meta.replicaId) {
    return {
      ok: false,
      code: "D137_MULTI_WRITER_COORDINATOR_REQUIRED",
      detail: "Only single-writer topologies may self-certify epoch advance",
    };
  }

  const nextEpoch = engine.meta.epochNumber + 1;
  const nextCertId = `cert-epoch-${nextEpoch}`;
  const newBaseline: Record<string, number> = {};
  for (const [streamKey, seq] of Object.entries(engine.meta.frontiers.localDurableFrontier)) {
    newBaseline[streamKey] = seq;
  }

  const certDraft: EpochMembershipCertificate = {
    protocolVersion: "D-137.v3.3.1",
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

/**
 * Enables remote sync with two-phase coordinator handshake and lossless state export.
 */
export async function executeEnableRemoteSync(
  engine: D137Engine,
  mode: "SEED_NEW_REMOTE_EPOCH" | "JOIN_EXISTING_REMOTE_CLUSTER",
  coordinatorCertOrRemoteSnapshot?: EpochMembershipCertificate | SnapshotRecord,
  assignedReplicaId?: string
): Promise<{ ok: boolean; code?: string; detail?: string }> {
  if (mode === "SEED_NEW_REMOTE_EPOCH") {
    engine.meta.lifecycleState = "FOUNDING_SNAPSHOT_STAGED";
    commitCheckpoint(engine.meta, engine.entriesState, engine.snapshotsV2, engine.mutationJournal);

    engine.meta.lifecycleState = "COORDINATOR_ACCEPTANCE_PENDING";

    if (coordinatorCertOrRemoteSnapshot && "memberBindings" in coordinatorCertOrRemoteSnapshot) {
      const cert = coordinatorCertOrRemoteSnapshot as EpochMembershipCertificate;
      const foundingSnap = engine.snapshotsV2.get(engine.meta.activeSnapshotSeq);
      const valRes = await validateEpochMembershipCertificate(cert, engine.meta.collectionId, foundingSnap);
      if (!valRes.ok) {
        return valRes;
      }

      installEpochCertificate(engine.meta, cert);
      engine.meta.remoteSyncEnabled = true;
      engine.meta.lifecycleState = "ACTIVE";
      return { ok: true };
    }

    return {
      ok: true,
      code: "COORDINATOR_ACCEPTANCE_PENDING",
      detail: "Founding snapshot staged; waiting for coordinator epoch certificate",
    };
  }

  // mode === "JOIN_EXISTING_REMOTE_CLUSTER"
  if (!coordinatorCertOrRemoteSnapshot || !("entries" in coordinatorCertOrRemoteSnapshot)) {
    return {
      ok: false,
      code: "D137_REMOTE_SNAPSHOT_REQUIRED",
      detail: "Remote cluster snapshot required to join existing cluster",
    };
  }

  const remoteSnap = coordinatorCertOrRemoteSnapshot as SnapshotRecord;

  // 1. Verify coordinator certificate and signature
  const valCertRes = await validateEpochMembershipCertificate(
    remoteSnap.epochCertificate,
    engine.meta.collectionId,
    remoteSnap
  );
  if (!valCertRes.ok) {
    return valCertRes;
  }

  // 2. Verify bootstrap snapshot digest
  const expectedSnapDigest = computeCanonicalSnapshotDigest(remoteSnap);
  if (remoteSnap.snapshotDigest !== expectedSnapDigest) {
    return {
      ok: false,
      code: "D137_SNAPSHOT_DIGEST_MISMATCH",
      detail: "Bootstrap snapshot digest verification failed",
    };
  }

  // 3. D-141 Join identity check (Fail-closed rules a, b, c)
  const joinerPublicKey = engine.meta.epochMemberBindings?.[engine.meta.replicaId]?.authorPublicKeyHex;
  if (!joinerPublicKey) {
    return {
      ok: false,
      code: "D137_JOIN_IDENTITY_INVALID",
      detail: "Joiner own public key is unknown in local metadata",
    };
  }

  let targetReplicaId: string;
  let binding: any;

  if (assignedReplicaId) {
    targetReplicaId = assignedReplicaId;
    binding = remoteSnap.epochCertificate.memberBindings?.[targetReplicaId];
    if (!binding || binding.authorPublicKeyHex !== joinerPublicKey) {
      return {
        ok: false,
        code: "D137_JOIN_IDENTITY_INVALID",
        detail: `Coordinator certificate does not contain valid member binding for replica ${targetReplicaId}`,
      };
    }
  } else {
    const matchingBindings = Object.entries(remoteSnap.epochCertificate.memberBindings ?? {})
      .filter(([_, b]) => b.authorPublicKeyHex === joinerPublicKey);
    if (matchingBindings.length !== 1) {
      return {
        ok: false,
        code: "D137_JOIN_IDENTITY_INVALID",
        detail: `Coordinator certificate must contain exactly one member binding for joiner public key (found ${matchingBindings.length})`,
      };
    }
    targetReplicaId = matchingBindings[0]![0];
    binding = matchingBindings[0]![1];
  }

  const targetStreamKey = `${remoteSnap.epochNumber}:${targetReplicaId}`;
  const existingDurable = remoteSnap.frontiers.localDurableFrontier[targetStreamKey] ?? 0;
  const existingIncluded = remoteSnap.frontiers.snapshotIncludedFrontier[targetStreamKey] ?? 0;
  const existingBaseline = remoteSnap.baselineStableFrontier?.[targetStreamKey] ?? 0;
  if (existingDurable > 0 || existingIncluded > 0 || existingBaseline > 0) {
    return {
      ok: false,
      code: "D137_JOIN_IDENTITY_INVALID",
      detail: `Snapshot frontiers already contain operations for stream ${targetStreamKey}; cannot restart at seq 1`,
    };
  }

  // 4. Plan export replay per externalId BEFORE clearing local state
  const replayPlan = planClusterExportReplay(
    engine.entriesState,
    remoteSnap,
    engine.meta.collectionId,
    remoteSnap.epochNumber
  );

  // 5. Replace state from bootstrap: wipe pre-JOIN journals, digests, outbox, buffers
  engine.mutationJournal.clear();
  engine.operationDigests.clear();
  engine.syncOutbox.clear();
  engine.inboundGapBuffer.clear();
  engine.inboundDependencyBuffer.clear();
  engine.meta.totalGapBufferOps = 0;
  engine.meta.totalGapBufferBytes = 0;
  engine.meta.totalDependencyBufferOps = 0;
  engine.meta.totalDependencyBufferBytes = 0;

  // 6. Replace entriesState from bootstrap snapshot
  engine.entriesState.clear();
  for (const e of remoteSnap.entries) {
    engine.entriesState.set(toIncarnationId(e.targetBirthDot), JSON.parse(JSON.stringify(e)));
  }

  // 7. Update replica identity and metadata
  engine.meta.replicaId = targetReplicaId;
  engine.meta.authorKeyId = binding.authorKeyId;
  installEpochCertificate(engine.meta, remoteSnap.epochCertificate);
  engine.meta.frontiers = JSON.parse(JSON.stringify(remoteSnap.frontiers));
  engine.meta.rollingStreamDigestAnchors = { ...(remoteSnap.rollingStreamDigestAnchors ?? {}) };
  engine.meta.rollingStreamDigests = {};
  for (const [k, a] of Object.entries(engine.meta.rollingStreamDigestAnchors)) {
    engine.meta.rollingStreamDigests[k] = { [a.sequence]: a.digest };
  }

  // In the joined epoch stream, nextLocalSequence starts at 1
  engine.meta.nextLocalSequence = 1;

  // localLamport >= maximum in the snapshot
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

  // 8. Execute synthesized replay plan in joined epoch (seq 1..)
  await executeReplayPlan(engine, replayPlan);
  engine.meta.activeReplayPlan = undefined;

  return { ok: true };
}

/**
 * Resumes activation from staged lifecycle state.
 */
export async function resumeActivation(
  engine: D137Engine,
  coordinatorCert?: EpochMembershipCertificate
): Promise<{ ok: boolean; code?: string; detail?: string }> {
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

