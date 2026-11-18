/**
 * Sync-v33-reference: Snapshot Creation, Digest Verification & Two-Snapshot Recovery
 */

import { canonicalizeValue, sha256Hex, toIncarnationId } from "./canonicalization.js";
import { compareCausalDots } from "./crdt.js";
import { pruneRollingStreamDigests } from "./frontiers.js";
import { applyOperationToState, type InTransactionContext } from "./operations.js";
import {
  SYNC_PROTOCOL_LIMITS,
  EntryStateRecord,
  EpochMembershipCertificate,
  MutationJournalRecord,
  ReplicaMetaRecord,
  RollingDigestAnchor,
  SnapshotRecord,
} from "./types.js";

export function computeCanonicalSnapshotDigest(snap: SnapshotRecord): string {
  const sortedEntries = [...snap.entries].sort((a, b) => compareCausalDots(a.targetBirthDot, b.targetBirthDot));
  const canonicalPayload = {
    protocolVersion: snap.protocolVersion,
    collectionId: snap.collectionId,
    snapshotSeq: snap.snapshotSeq,
    epochNumber: snap.epochNumber,
    epochCertificateId: snap.epochCertificateId,
    epochCertificate: snap.epochCertificate,
    members: [...snap.members].sort(),
    revokedKeyIds: [...snap.revokedKeyIds].sort(),
    baselineStableFrontier: snap.baselineStableFrontier,
    foldedEpochBaseline: snap.foldedEpochBaseline,
    frontiers: {
      localDurableFrontier: snap.frontiers.localDurableFrontier,
      knownProducedFrontier: snap.frontiers.knownProducedFrontier,
      snapshotIncludedFrontier: snap.frontiers.snapshotIncludedFrontier,
      stableFrontier: snap.frontiers.stableFrontier,
      compactionFrontier: snap.frontiers.compactionFrontier,
      digestPrunedFrontier: snap.frontiers.digestPrunedFrontier,
      serverAcceptedFrontier: snap.frontiers.serverAcceptedFrontier,
      replayCompletedWatermark: snap.frontiers.replayCompletedWatermark,
    },
    rollingStreamDigestAnchors: snap.rollingStreamDigestAnchors ?? {},
    activeEpochEquivocations: snap.activeEpochEquivocations,
    historicalEquivocationAudit: snap.historicalEquivocationAudit,
    entries: sortedEntries,
  };
  return sha256Hex(canonicalizeValue(canonicalPayload));
}

function buildSnapshotAnchors(
  meta: ReplicaMetaRecord,
  snapshotIncludedFrontier: Record<string, number>
): Record<string, RollingDigestAnchor> {
  const anchors: Record<string, RollingDigestAnchor> = { ...meta.rollingStreamDigestAnchors };
  for (const [streamKey, seq] of Object.entries(snapshotIncludedFrontier)) {
    const streamDigests = meta.rollingStreamDigests[streamKey];
    if (streamDigests && streamDigests[seq]) {
      anchors[streamKey] = {
        sequence: seq,
        digest: streamDigests[seq]!,
      };
    }
  }
  return anchors;
}

export function isSnapshotValidForBaseline(
  snap: SnapshotRecord,
  meta: ReplicaMetaRecord,
  targetFloors?: Record<string, number>
): boolean {
  const floors = targetFloors ?? meta.epochCertificate.baselineStableFrontier;
  for (const [streamKey, incSeq] of Object.entries(snap.frontiers.snapshotIncludedFrontier)) {
    const floor = floors[streamKey] ?? 0;
    if (incSeq > floor) {
      return false;
    }
  }
  return true;
}

export function getBaselineSnapshot(
  meta: ReplicaMetaRecord,
  snapshotsV2: Map<number, SnapshotRecord>,
  targetFloors?: Record<string, number>
): SnapshotRecord | undefined {
  if (meta.baselineSnapshotSeq !== undefined) {
    const snap = snapshotsV2.get(meta.baselineSnapshotSeq);
    if (snap && isSnapshotValidForBaseline(snap, meta, targetFloors)) {
      return snap;
    }
  }
  let bestSnap: SnapshotRecord | undefined = snapshotsV2.get(0);
  for (const snap of snapshotsV2.values()) {
    if (isSnapshotValidForBaseline(snap, meta, targetFloors)) {
      if (!bestSnap || snap.snapshotSeq > bestSnap.snapshotSeq) {
        bestSnap = snap;
      }
    }
  }
  return bestSnap;
}

export function commitCheckpoint(
  meta: ReplicaMetaRecord,
  entriesState: Map<string, EntryStateRecord>,
  snapshotsV2: Map<number, SnapshotRecord>,
  mutationJournal: Map<string, MutationJournalRecord>,
  targetCertificate?: EpochMembershipCertificate | Record<string, number>
): SnapshotRecord {
  const nextSnapSeq = meta.activeSnapshotSeq + 1;
  const isCert = targetCertificate && typeof targetCertificate === "object" && "epochCertificateId" in targetCertificate;
  const targetCert = isCert ? (targetCertificate as EpochMembershipCertificate) : undefined;
  const targetFloors = targetCert
    ? targetCert.baselineStableFrontier
    : ((targetCertificate as Record<string, number>) ?? meta.epochCertificate.baselineStableFrontier);
  const epochCert = targetCert ?? meta.epochCertificate;

  // snapshotIncludedFrontier captures localDurableFrontier at checkpoint time
  const snapshotIncludedFrontier = { ...meta.frontiers.localDurableFrontier };

  // Check if this checkpoint qualifies as an updated baseline snapshot
  let qualifiesAsBaseline = true;
  for (const [sKey, incSeq] of Object.entries(snapshotIncludedFrontier)) {
    const floor = targetFloors[sKey] ?? 0;
    if (incSeq > floor) {
      qualifiesAsBaseline = false;
      break;
    }
  }
  if (qualifiesAsBaseline) {
    meta.baselineSnapshotSeq = nextSnapSeq;
  }

  // Option A (HAA clarification):
  // compactionFrontier[s] <= min(floor[s], baselineSnapshot.includedFrontier[s])
  const baselineSnap = qualifiesAsBaseline ? undefined : getBaselineSnapshot(meta, snapshotsV2, targetFloors);
  const baselineFrontier = qualifiesAsBaseline
    ? snapshotIncludedFrontier
    : (baselineSnap?.frontiers.snapshotIncludedFrontier ?? {});

  for (const [streamKey, stableSeq] of Object.entries(meta.frontiers.stableFrontier)) {
    const certifiedFloor = targetFloors[streamKey] ?? 0;
    const baselineIncluded = baselineFrontier[streamKey] ?? 0;
    const maxAllowedCompaction = Math.min(certifiedFloor, baselineIncluded);
    const targetCompaction = Math.min(stableSeq, maxAllowedCompaction);
    const curCompaction = meta.frontiers.compactionFrontier[streamKey] ?? 0;
    if (targetCompaction > curCompaction) {
      meta.frontiers.compactionFrontier[streamKey] = targetCompaction;
    }
  }

  meta.frontiers.snapshotIncludedFrontier = snapshotIncludedFrontier;

  // Snapshot captures all surviving entries (live & tombstones)
  const entriesList = [...entriesState.values()];

  const draftSnap: SnapshotRecord = {
    protocolVersion: "replicated.v3.3.1",
    collectionId: meta.collectionId,
    snapshotSeq: nextSnapSeq,
    epochNumber: epochCert.epochNumber,
    epochCertificateId: epochCert.epochCertificateId,
    epochCertificate: epochCert,
    members: Object.keys(epochCert.memberBindings).sort(),
    revokedKeyIds: [...meta.revokedKeyIds].sort(),
    baselineStableFrontier: { ...epochCert.baselineStableFrontier },
    foldedEpochBaseline: { ...meta.foldedEpochBaseline },
    frontiers: JSON.parse(JSON.stringify(meta.frontiers)),
    rollingStreamDigestAnchors: buildSnapshotAnchors(meta, snapshotIncludedFrontier),
    activeEpochEquivocations: { ...meta.activeEpochEquivocations },
    historicalEquivocationAudit: [...meta.historicalEquivocationAudit],
    entries: entriesList,
    snapshotDigest: "",
  };

  const snapshotDigest = computeCanonicalSnapshotDigest(draftSnap);
  const finalSnap: SnapshotRecord = { ...draftSnap, snapshotDigest };

  snapshotsV2.set(nextSnapSeq, finalSnap);
  meta.activeSnapshotSeq = nextSnapSeq;

  // Option A: Retain certified baseline snapshot alongside N and N-1
  const baselineSeq = meta.baselineSnapshotSeq ?? 0;
  for (const seq of [...snapshotsV2.keys()]) {
    if (seq !== baselineSeq && seq < nextSnapSeq - 1) {
      snapshotsV2.delete(seq);
    }
  }

  // Determine journal truncation horizon: min(snapshots[N-1].frontier, compactionFrontier)
  const snapNMinus1 = snapshotsV2.get(nextSnapSeq - 1);
  const truncationHorizon: Record<string, number> = {};

  for (const [streamKey, compactionSeq] of Object.entries(meta.frontiers.compactionFrontier)) {
    const snapNMinus1Seq = snapNMinus1?.frontiers.snapshotIncludedFrontier[streamKey] ?? 0;
    truncationHorizon[streamKey] = Math.min(snapNMinus1Seq, compactionSeq);
  }

  // Truncate mutation_journal strictly below truncationHorizon
  for (const [opKey, jRec] of [...mutationJournal.entries()]) {
    const streamKey = `${jRec.epochNumber}:${jRec.replicaId}`;
    const horizon = truncationHorizon[streamKey] ?? 0;
    if (jRec.sequence <= horizon) {
      mutationJournal.delete(opKey);
    }
  }

  // Prune rolling digests with persistent anchor
  for (const [streamKey, horizon] of Object.entries(truncationHorizon)) {
    if (horizon > 0) {
      pruneRollingStreamDigests(meta, streamKey, horizon);
    }
  }

  if (meta.lifecycleState === "READ_ONLY_COMPACTION_BACKPRESSURE" && mutationJournal.size < SYNC_PROTOCOL_LIMITS.MAX_UNCOMPACTED_JOURNAL_OPS_SOFT_LIMIT) {
    meta.lifecycleState = "ACTIVE";
  }

  return finalSnap;
}

/**
 * Commits a certified baseline snapshot at the certified floor when the floor rises.
 */
export function commitBaselineSnapshot(
  meta: ReplicaMetaRecord,
  entriesState: Map<string, EntryStateRecord>,
  snapshotsV2: Map<number, SnapshotRecord>,
  mutationJournal: Map<string, MutationJournalRecord>,
  targetCertificate?: EpochMembershipCertificate | Record<string, number>
): SnapshotRecord {
  const isCert = targetCertificate && typeof targetCertificate === "object" && "epochCertificateId" in targetCertificate;
  const targetCert = isCert ? (targetCertificate as EpochMembershipCertificate) : undefined;
  const targetFloors = targetCert
    ? targetCert.baselineStableFrontier
    : ((targetCertificate as Record<string, number>) ?? meta.epochCertificate.baselineStableFrontier);
  const epochCert = targetCert ?? meta.epochCertificate;

  // If local durable frontier does not exceed the floor, commit normal checkpoint which qualifies as baseline
  let localExceedsFloor = false;
  for (const [sKey, durSeq] of Object.entries(meta.frontiers.localDurableFrontier)) {
    const floor = targetFloors[sKey] ?? 0;
    if (durSeq > floor) {
      localExceedsFloor = true;
      break;
    }
  }

  if (!localExceedsFloor) {
    return commitCheckpoint(meta, entriesState, snapshotsV2, mutationJournal, targetCertificate);
  }

  // If local durable frontier exceeds floor, reconstruct pure baseline state at floor
  const nextSnapSeq = meta.activeSnapshotSeq + 1;
  const targetFrontier: Record<string, number> = {};
  for (const [sKey, floor] of Object.entries(targetFloors)) {
    targetFrontier[sKey] = Math.min(meta.frontiers.localDurableFrontier[sKey] ?? 0, floor);
  }

  const baselineEntriesState = new Map<string, EntryStateRecord>();
  const prevBaseline = getBaselineSnapshot(meta, snapshotsV2, targetFloors);
  if (prevBaseline) {
    for (const e of prevBaseline.entries) {
      baselineEntriesState.set(toIncarnationId(e.targetBirthDot), JSON.parse(JSON.stringify(e)));
    }
  }

  const prevIncluded = prevBaseline?.frontiers.snapshotIncludedFrontier ?? {};
  const opsToReplay = [...mutationJournal.values()]
    .filter(j => {
      const sKey = `${j.epochNumber}:${j.replicaId}`;
      const afterPrev = j.sequence > (prevIncluded[sKey] ?? 0);
      const atOrBelowFloor = j.sequence <= (targetFrontier[sKey] ?? 0);
      return afterPrev && atOrBelowFloor;
    })
    .map(j => j.operation)
    .sort((a, b) => {
      if (a.stamp.lamport !== b.stamp.lamport) return a.stamp.lamport - b.stamp.lamport;
      return a.opDot.sequence - b.opDot.sequence;
    });

  const replayCtx: InTransactionContext = {
    meta,
    entriesState: baselineEntriesState,
    mutationJournal,
    operationDigests: new Map(),
    syncOutbox: new Map(),
    inboundGapBuffer: new Map(),
    inboundDependencyBuffer: new Map(),
    quarantineJournal: new Map(),
  };

  for (const op of opsToReplay) {
    applyOperationToState(replayCtx, op, false);
  }

  const draftSnap: SnapshotRecord = {
    protocolVersion: "replicated.v3.3.1",
    collectionId: meta.collectionId,
    snapshotSeq: nextSnapSeq,
    epochNumber: epochCert.epochNumber,
    epochCertificateId: epochCert.epochCertificateId,
    epochCertificate: epochCert,
    members: Object.keys(epochCert.memberBindings).sort(),
    revokedKeyIds: [...meta.revokedKeyIds].sort(),
    baselineStableFrontier: { ...epochCert.baselineStableFrontier },
    foldedEpochBaseline: { ...meta.foldedEpochBaseline },
    frontiers: {
      localDurableFrontier: { ...targetFrontier },
      knownProducedFrontier: { ...targetFrontier },
      snapshotIncludedFrontier: { ...targetFrontier },
      stableFrontier: { ...meta.frontiers.stableFrontier },
      compactionFrontier: { ...targetFrontier },
      digestPrunedFrontier: { ...meta.frontiers.digestPrunedFrontier },
      serverAcceptedFrontier: { ...meta.frontiers.serverAcceptedFrontier },
      replayCompletedWatermark: { ...meta.frontiers.replayCompletedWatermark },
    },
    rollingStreamDigestAnchors: buildSnapshotAnchors(meta, targetFrontier),
    activeEpochEquivocations: JSON.parse(JSON.stringify(meta.activeEpochEquivocations)),
    historicalEquivocationAudit: JSON.parse(JSON.stringify(meta.historicalEquivocationAudit)),
    entries: [...baselineEntriesState.values()].map((e) => JSON.parse(JSON.stringify(e))),
    snapshotDigest: "",
  };

  const snapshotDigest = computeCanonicalSnapshotDigest(draftSnap);
  const finalSnap: SnapshotRecord = { ...draftSnap, snapshotDigest };

  snapshotsV2.set(nextSnapSeq, finalSnap);
  meta.activeSnapshotSeq = nextSnapSeq;
  meta.baselineSnapshotSeq = nextSnapSeq;

  return finalSnap;
}

/**
 * Creates the founding baseline snapshot 0 for a collection.
 */
export function createFoundingSnapshot(
  collectionId: string,
  epochNumber: number,
  epochCertificate: EpochMembershipCertificate
): SnapshotRecord {
  const baselineFrontier = { ...epochCertificate.baselineStableFrontier };
  const draftSnap: SnapshotRecord = {
    protocolVersion: "replicated.v3.3.1",
    collectionId,
    snapshotSeq: 0,
    epochNumber,
    epochCertificateId: epochCertificate.epochCertificateId,
    epochCertificate,
    members: Object.keys(epochCertificate.memberBindings).sort(),
    revokedKeyIds: [],
    baselineStableFrontier: baselineFrontier,
    foldedEpochBaseline: {},
    frontiers: {
      localDurableFrontier: { ...baselineFrontier },
      knownProducedFrontier: { ...baselineFrontier },
      snapshotIncludedFrontier: { ...baselineFrontier },
      stableFrontier: { ...baselineFrontier },
      compactionFrontier: { ...baselineFrontier },
      digestPrunedFrontier: {},
      serverAcceptedFrontier: {},
      replayCompletedWatermark: {},
    },
    rollingStreamDigestAnchors: {},
    activeEpochEquivocations: {},
    historicalEquivocationAudit: [],
    entries: [],
    snapshotDigest: "",
  };
  const snapshotDigest = computeCanonicalSnapshotDigest(draftSnap);
  return { ...draftSnap, snapshotDigest };
}
