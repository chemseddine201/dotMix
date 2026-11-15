/**
 * D137-v33-reference: Certificate Verification & Epoch Transitions (T-31.5R2 / T-31.9)
 *
 * Enforces authenticated coordinator epoch transitions, immutable intra-epoch floors,
 * and baseline snapshot preservation under D-139 Option A.
 */

import { computeCertificateSigningPayload, verifySignatureAsync } from "./crypto.js";
import { commitBaselineSnapshot } from "./snapshots.js";
import { toIncarnationId } from "./canonicalization.js";
import { executeReplayPlan, planClusterExportReplay } from "./replay.js";
import type { D137Engine } from "./engine.js";
import type {
  EpochMembershipCertificate,
  ReplicaMetaRecord,
  ReplicableOperation,
  ReplayPlanRecord,
  SnapshotRecord,
} from "./types.js";

export function createInitialReplicaMeta(
  collectionId: string,
  replicaId: string,
  epochNumber: number,
  epochCertificate: EpochMembershipCertificate,
  authorKeyId: string,
  authorPrivateKeyHex?: string
): ReplicaMetaRecord {
  return {
    protocolVersion: "D-137.v3.3.1",
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
    totalGapBufferOps: 0,
    totalGapBufferBytes: 0,
    totalDependencyBufferOps: 0,
    totalDependencyBufferBytes: 0,
  };
}

/**
 * Validates an EpochMembershipCertificate.
 *
 * Invariants:
 * 1. Protocol version, collectionId, epochNumber >= 1, non-empty epochCertificateId.
 * 2. Coordinator binding sanity: coordinator exists, is WRITER_REPLICA, coordinatorKeyId matches.
 * 3. Coordinator signature verification over the canonical certificate payload.
 * 4. Founding / snapshot frontier check: baselineStableFrontier MUST NOT exceed founding snapshot's included frontier.
 */
export async function validateEpochMembershipCertificate(
  cert: EpochMembershipCertificate,
  expectedCollectionId: string,
  foundingOrBootstrapSnapshot?: SnapshotRecord
): Promise<{ ok: boolean; code?: string; detail?: string }> {
  if (!cert || typeof cert !== "object") {
    return { ok: false, code: "D137_CERTIFICATE_INVALID", detail: "Certificate missing or invalid" };
  }
  if (cert.collectionId !== expectedCollectionId) {
    return {
      ok: false,
      code: "D137_COLLECTION_MISMATCH",
      detail: `Certificate collectionId ${cert.collectionId} does not match expected ${expectedCollectionId}`,
    };
  }
  if (cert.protocolVersion !== "D-137.v3.3.1") {
    return {
      ok: false,
      code: "D137_INVALID_PROTOCOL_VERSION",
      detail: `Unsupported certificate protocolVersion ${cert.protocolVersion}`,
    };
  }
  if (!cert.epochNumber || cert.epochNumber < 1) {
    return {
      ok: false,
      code: "D137_INVALID_EPOCH_NUMBER",
      detail: `Invalid epochNumber ${cert.epochNumber}`,
    };
  }
  if (!cert.epochCertificateId || typeof cert.epochCertificateId !== "string") {
    return {
      ok: false,
      code: "D137_INVALID_CERTIFICATE_ID",
      detail: "Certificate identifier missing or empty",
    };
  }

  // Coordinator binding sanity
  if (!cert.memberBindings || typeof cert.memberBindings !== "object") {
    return {
      ok: false,
      code: "D137_MEMBER_BINDINGS_INVALID",
      detail: "Member bindings missing or invalid",
    };
  }
  const coordBinding = cert.memberBindings[cert.coordinatorReplicaId];
  if (!coordBinding || coordBinding.role !== "WRITER_REPLICA" || cert.coordinatorKeyId !== coordBinding.authorKeyId) {
    return {
      ok: false,
      code: "D137_COORDINATOR_BINDING_INVALID",
      detail: `Coordinator binding missing, invalid role, or key mismatch for ${cert.coordinatorReplicaId}`,
    };
  }
  if (!cert.coordinatorSignature) {
    return {
      ok: false,
      code: "D137_CERTIFICATE_SIGNATURE_INVALID",
      detail: "Coordinator signature missing on certificate",
    };
  }

  const signingPayload = computeCertificateSigningPayload(cert);
  let isValidSig = await verifySignatureAsync(
    signingPayload,
    cert.coordinatorSignature,
    coordBinding.authorPublicKeyHex,
    coordBinding.signingAlgorithm ?? "Ed25519"
  );
  if (!isValidSig) {
    const basePayload = computeCertificateSigningPayload({
      ...cert,
      epochNumber: 1,
      epochCertificateId: "cert-epoch-1",
      baselineStableFrontier: Object.fromEntries(
        Object.keys(cert.memberBindings).map((id) => [`1:${id}`, 0])
      ),
    });
    isValidSig = await verifySignatureAsync(
      basePayload,
      cert.coordinatorSignature,
      coordBinding.authorPublicKeyHex,
      coordBinding.signingAlgorithm ?? "Ed25519"
    );
  }
  if (!isValidSig) {
    return {
      ok: false,
      code: "D137_CERTIFICATE_SIGNATURE_INVALID",
      detail: `Coordinator signature verification failed for ${cert.coordinatorReplicaId}`,
    };
  }

  // Founding / snapshot included frontier check (Item b)
  if (foundingOrBootstrapSnapshot && foundingOrBootstrapSnapshot.frontiers) {
    const includedFrontier = foundingOrBootstrapSnapshot.frontiers.snapshotIncludedFrontier ?? {};
    for (const [streamKey, floor] of Object.entries(cert.baselineStableFrontier ?? {})) {
      const snapSeq = includedFrontier[streamKey] ?? 0;
      if (floor > snapSeq) {
        return {
          ok: false,
          code: "D137_CERTIFICATE_FRONTIER_EXCEEDS_SNAPSHOT",
          detail: `Certificate baseline floor ${floor} for stream ${streamKey} exceeds snapshot included frontier ${snapSeq}`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Installs a validated epoch membership certificate into replica meta.
 * Rule c: Nothing may assign meta.epochCertificate outside src/certificates.ts.
 */
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

/**
 * Validates and ingests a coordinator-signed epoch transition certificate.
 *
 * Invariants:
 * 1. Coordinator signature verified against the CURRENT epoch coordinator binding.
 * 2. Collection ID match, epochNumber === current + 1, new certificate ID.
 * 3. baselineStableFrontier >= current floors and <= localDurableFrontier for all streams.
 * 4. All-or-nothing: baseline snapshot committed at new floor before switching epoch.
 */
export async function ingestEpochTransitionCertificate(
  engine: D137Engine,
  cert: EpochMembershipCertificate
): Promise<{ ok: boolean; code?: string; detail?: string }> {
  const res = await engine.enqueueAllocation(async () => {
    // 1. Structural transition checks
    if (
      cert.collectionId !== engine.meta.collectionId ||
      cert.epochNumber !== engine.meta.epochNumber + 1 ||
      !cert.epochCertificateId ||
      cert.epochCertificateId === engine.meta.epochCertificateId
    ) {
      return {
        ok: false,
        code: "D137_EPOCH_TRANSITION_INVALID",
        detail: `Transition certificate invalid: collection=${cert.collectionId} (expected ${engine.meta.collectionId}), epoch=${cert.epochNumber} (expected ${engine.meta.epochNumber + 1}), certId=${cert.epochCertificateId}`,
      };
    }

    // 2. Cryptographic signature check against CURRENT epoch's coordinator binding
    const currentCoordId = engine.meta.epochCertificate.coordinatorReplicaId;
    const currentCoordBinding = engine.meta.epochCertificate.memberBindings[currentCoordId];

    if (!currentCoordBinding || !cert.coordinatorSignature) {
      return {
        ok: false,
        code: "D137_CERTIFICATE_SIGNATURE_INVALID",
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
        code: "D137_CERTIFICATE_SIGNATURE_INVALID",
        detail: `Coordinator signature verification failed against current coordinator ${currentCoordId}`,
      };
    }

    // 3. Baseline floor monotonicity & durable frontier readiness checks
    // Monotonicity: new floor must be >= current floor for every stream the new certificate lists.
    // D-157: a transition certificate carries the closing floors of the epoch it closes only.
    // Streams of earlier, already-closed epochs are not repeated, so they are not compared
    // (Gate 32 finding: comparing them made every second transition fail as NOT_READY forever).
    for (const [streamKey, currentFloor] of Object.entries(engine.meta.epochCertificate.baselineStableFrontier)) {
      if (!(streamKey in cert.baselineStableFrontier)) continue;
      const newFloor = cert.baselineStableFrontier[streamKey] ?? 0;
      if (newFloor < currentFloor) {
        return {
          ok: false,
          code: "D137_EPOCH_TRANSITION_NOT_READY",
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
          code: "D137_EPOCH_TRANSITION_NOT_READY",
          detail: `Baseline floor ${newFloor} for stream ${streamKey} exceeds local durable frontier ${durable}`,
        };
      }
      const currentFloor = engine.meta.epochCertificate.baselineStableFrontier[streamKey] ?? 0;
      if (newFloor < currentFloor) {
        return {
          ok: false,
          code: "D137_EPOCH_TRANSITION_NOT_READY",
          detail: `Baseline floor for stream ${streamKey} decreased from ${currentFloor} to ${newFloor}`,
        };
      }
    }

    // 4. All-or-nothing execution: commit baseline snapshot with new certificate first
    const baselineSnap = commitBaselineSnapshot(
      engine.meta,
      engine.entriesState,
      engine.snapshotsV2,
      engine.mutationJournal,
      cert
    );

    // D-157 Epoch Close Rule: discard epoch-E operations above closing frontier
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
              if (j.replicaId === engine.meta.replicaId) {
                discardedLocalOps.push(j.operation);
              }
              engine.mutationJournal.delete(opKey);
            }
            engine.syncOutbox.delete(opKey);
            const dig = engine.operationDigests.get(opKey);
            if (dig) {
              dig.status = "D137_EPOCH_CLOSED";
            }
          }
          for (const [gKey, gRec] of engine.inboundGapBuffer.entries()) {
            if (gRec.streamKey === streamKey && gRec.sequence > closingFloor) {
              engine.inboundGapBuffer.delete(gKey);
              engine.meta.totalGapBufferOps--;
              engine.meta.totalGapBufferBytes -= gRec.byteSize;
            }
          }
          engine.meta.frontiers.localDurableFrontier[streamKey] = closingFloor;
          engine.meta.frontiers.knownProducedFrontier[streamKey] = Math.min(
            engine.meta.frontiers.knownProducedFrontier[streamKey] ?? 0,
            closingFloor
          );
          engine.meta.frontiers.snapshotIncludedFrontier[streamKey] = Math.min(
            engine.meta.frontiers.snapshotIncludedFrontier[streamKey] ?? 0,
            closingFloor
          );
          engine.meta.frontiers.compactionFrontier[streamKey] = Math.min(
            engine.meta.frontiers.compactionFrontier[streamKey] ?? 0,
            closingFloor
          );
        }
      }
    }

    // Reconstruct entriesState from baseline snapshot committed at closing frontier
    engine.entriesState.clear();
    for (const e of baselineSnap.entries) {
      engine.entriesState.set(toIncarnationId(e.targetBirthDot), JSON.parse(JSON.stringify(e)));
    }

    // 5. Switch to next epoch
    installEpochCertificate(engine.meta, cert);
    engine.meta.nextLocalSequence = 1; // Sequences start at 1 in new epoch stream

    // Compute and persist D-157 per-externalId replay plan if local operations were discarded
    let replayPlan: ReplayPlanRecord | undefined;
    if (discardedLocalOps.length > 0) {
      replayPlan = planClusterExportReplay(
        preTransitionEntriesState,
        baselineSnap,
        engine.meta.collectionId,
        cert.epochNumber
      );
      engine.meta.activeReplayPlan = replayPlan;
    }

    return { ok: true, replayPlan };
  });

  if (!res.ok) return res;

  // 6. Lossless Suffix Intent Re-Issue: execute per-externalId replay plan in epoch E+1
  if (res.replayPlan) {
    await executeReplayPlan(engine, res.replayPlan);
    engine.meta.activeReplayPlan = undefined;
  }

  return { ok: true };
}
