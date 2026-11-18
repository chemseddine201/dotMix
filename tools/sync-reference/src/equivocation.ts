/**
 * Sync-v33-reference: Deterministic Equivocation Handling, Compaction Horizon & Frontier Reconciliation
 */

import { toIncarnationId, toOriginStreamKey } from "./canonicalization.js";
import { reconcileAllFrontiersPostExcision } from "./frontiers.js";
import { applyOperationToState, type InTransactionContext } from "./operations.js";
import { getBaselineSnapshot } from "./snapshots.js";
import { recordQuarantine } from "./storage-bounds.js";
import {
  CausalDot,
  SYNC_PROTOCOL_LIMITS,
  EntryStateRecord,
  InboundDependencyBufferRecord,
  InboundGapBufferRecord,
  MutationJournalRecord,
  OperationDigestRecord,
  OperationKey,
  OriginStreamKey,
  QuarantineRecord,
  ReplicaMetaRecord,
  ReplicableOperation,
  SequenceNumber,
  SnapshotRecord,
} from "./types.js";

export function exciseEquivocatedStream(
  meta: ReplicaMetaRecord,
  entriesState: Map<string, EntryStateRecord>,
  snapshotsV2: Map<number, SnapshotRecord>,
  mutationJournal: Map<string, MutationJournalRecord>,
  operationDigests: Map<string, OperationDigestRecord>,
  inboundGapBuffer: Map<string, InboundGapBufferRecord>,
  quarantineJournal: Map<string, QuarantineRecord>,
  streamKey: OriginStreamKey,
  equivocatedSeq: SequenceNumber,
  opKey: OperationKey,
  conflictingDigests: readonly string[],
  incomingOp: ReplicableOperation,
  detail: string,
  inboundDependencyBuffer?: Map<string, InboundDependencyBufferRecord>
): { ok: boolean; code?: string; detail?: string } {
  const ep = incomingOp.opDot.epochNumber;
  const repId = incomingOp.opDot.replicaId;

  // Option A: Excision floor is strictly determined by the certified baseline
  const excisionFloorSeq = meta.epochCertificate.baselineStableFrontier[streamKey] ?? 0;

  // Check if equivocation attempts to rewrite already-compacted history
  if (equivocatedSeq <= excisionFloorSeq) {
    recordQuarantine(
      meta,
      quarantineJournal,
      "SYNC_EQUIVOCATION_ON_COMPACTED_HISTORY",
      `Equivocation attempted on irrevocably compacted sequence ${equivocatedSeq} <= floor ${excisionFloorSeq}`,
      incomingOp
    );
    // Block stream from future ops in this epoch
    meta.activeEpochEquivocations[streamKey] = {
      streamKey,
      certifiedBaselineSeq: excisionFloorSeq,
      firstEquivocatedSeq: equivocatedSeq,
      reason: "SYNC_EQUIVOCATION_ON_COMPACTED_HISTORY",
      observedDigests: conflictingDigests,
    };
    // Excise any uncertified ops in mutationJournal and operationDigests
    const effectiveStartSeq = excisionFloorSeq + 1;
    for (const [jKey, jRec] of mutationJournal.entries()) {
      if (jRec.epochNumber === ep && jRec.replicaId === repId && jRec.sequence >= effectiveStartSeq) {
        if (jRec.disposition === "APPLIED") {
          jRec.disposition = "EXCISED_STREAM_QUARANTINED";
        }
      }
    }
    for (const [dKey, dRec] of operationDigests.entries()) {
      if (dRec.epochNumber === ep && dRec.replicaId === repId && dRec.sequence >= effectiveStartSeq) {
        if (dRec.status === "APPLIED") {
          dRec.status = "EXCISED_STREAM_QUARANTINED";
        }
      }
    }
    return {
      ok: false,
      code: "SYNC_EQUIVOCATION_ON_COMPACTED_HISTORY",
      detail: `Stream ${streamKey} attempted equivocation on compacted history (seq ${equivocatedSeq} <= floor ${excisionFloorSeq})`,
    };
  }

  // 1. Record sorted observedDigests in operation_digests (capped at MAX_OBSERVED_CONFLICT_DIGESTS_PER_DOT = 8)
  const existingDigRec = operationDigests.get(opKey);
  const combinedDigests = [...new Set([...(existingDigRec?.observedDigests ?? []), ...conflictingDigests])]
    .sort()
    .slice(0, SYNC_PROTOCOL_LIMITS.MAX_OBSERVED_CONFLICT_DIGESTS_PER_DOT);

  operationDigests.set(opKey, {
    opKey,
    collectionId: meta.collectionId,
    epochNumber: ep,
    replicaId: repId,
    sequence: equivocatedSeq,
    status: "EQUIVOCATED",
    payloadDigest: combinedDigests[0]!,
    observedDigests: combinedDigests,
  });

  //: At most one excision per stream per epoch. Later conflicts record evidence only.
  const prevEq = meta.activeEpochEquivocations[streamKey];
  const existingOp = mutationJournal.get(opKey)?.operation;
  const mergedOps = [existingOp, incomingOp, ...(prevEq?.conflictingOps ?? [])].filter((x): x is ReplicableOperation => Boolean(x));

  if (prevEq && prevEq.reason === "SYNC_EQUIVOCATION_DETECTED" && equivocatedSeq >= prevEq.firstEquivocatedSeq) {
    meta.activeEpochEquivocations[streamKey] = {
      ...prevEq,
      observedDigests: [...new Set([...prevEq.observedDigests, ...conflictingDigests])]
        .sort()
        .slice(0, SYNC_PROTOCOL_LIMITS.MAX_OBSERVED_CONFLICT_DIGESTS_PER_DOT),
      conflictingOps: mergedOps,
    };
    return {
      ok: false,
      code: "SYNC_EQUIVOCATION_DETECTED",
      detail: `Stream ${streamKey} already excised in this epoch; recorded additional conflict evidence`,
    };
  }

  const firstSeq = prevEq ? Math.min(prevEq.firstEquivocatedSeq, equivocatedSeq) : equivocatedSeq;
  meta.activeEpochEquivocations[streamKey] = {
    streamKey,
    certifiedBaselineSeq: excisionFloorSeq,
    firstEquivocatedSeq: firstSeq,
    reason: "SYNC_EQUIVOCATION_DETECTED",
    observedDigests: combinedDigests,
    conflictingOps: mergedOps,
  };

  // 3. Add to historical audit (bounded by MAX_EQUIVOCATION_AUDIT_RECORDS)
  if (meta.historicalEquivocationAudit.length < SYNC_PROTOCOL_LIMITS.MAX_EQUIVOCATION_AUDIT_RECORDS) {
    meta.historicalEquivocationAudit.push({
      epochNumber: ep,
      replicaId: repId,
      sequence: equivocatedSeq,
      observedDigests: combinedDigests,
    });
  }

  // 4. Excise strictly the uncompacted uncertified suffix (> excisionFloorSeq) from mutationJournal
  const effectiveStartSeq = excisionFloorSeq + 1;
  for (const [jKey, jRec] of mutationJournal.entries()) {
    if (jRec.epochNumber === ep && jRec.replicaId === repId && jRec.sequence >= effectiveStartSeq) {
      if (jRec.disposition === "APPLIED") {
        jRec.disposition = "EXCISED_STREAM_QUARANTINED";
        recordQuarantine(
          meta,
          quarantineJournal,
          "SYNC_EQUIVOCATION_DETECTED",
          `Excised uncertified op ${jKey} from equivocated stream ${streamKey}`,
          jRec.operation
        );
      }
      const dRec = operationDigests.get(jKey);
      if (dRec && dRec.status !== "EQUIVOCATED") {
        dRec.status = "EXCISED_STREAM_QUARANTINED";
      }
    }
  }

  for (const [dKey, dRec] of operationDigests.entries()) {
    if (dRec.epochNumber === ep && dRec.replicaId === repId && dRec.sequence >= effectiveStartSeq) {
      if (dRec.status === "APPLIED") {
        dRec.status = "EXCISED_STREAM_QUARANTINED";
      }
    }
  }

  // 5. Evict all buffered ops on streamKey from inboundGapBuffer and inboundDependencyBuffer
  for (const [bKey, bRec] of [...inboundGapBuffer.entries()]) {
    if (bRec.streamKey === streamKey) {
      inboundGapBuffer.delete(bKey);
      meta.totalGapBufferOps--;
      meta.totalGapBufferBytes -= bRec.byteSize;
      recordQuarantine(
        meta,
        quarantineJournal,
        "EVICTED_STREAM_BLOCKED_SUCCESSOR",
        `Evicted buffered op ${bKey} on equivocated stream ${streamKey}`,
        bRec.operation
      );
    }
  }

  if (inboundDependencyBuffer) {
    for (const [dKey, dRec] of [...inboundDependencyBuffer.entries()]) {
      if (dRec.operation.opDot.epochNumber === ep && dRec.operation.opDot.replicaId === repId) {
        inboundDependencyBuffer.delete(dKey);
        meta.totalDependencyBufferOps--;
        meta.totalDependencyBufferBytes -= dRec.byteSize;
        recordQuarantine(
          meta,
          quarantineJournal,
          "EVICTED_STREAM_BLOCKED_SUCCESSOR",
          `Evicted dependency buffered op ${dKey} on equivocated stream ${streamKey}`,
          dRec.operation
        );
      }
    }
  }

  // 6. Reconcile ALL 8 frontiers, peer ACKs, and rolling digests (Fixes Defect 2)
  reconcileAllFrontiersPostExcision(meta, streamKey, excisionFloorSeq);

  // Invalidate any rolling snapshots containing uncertified ops above excisionFloorSeq
  const baselineSeq = meta.baselineSnapshotSeq ?? 0;
  for (const [seq, snap] of [...snapshotsV2.entries()]) {
    if (seq === baselineSeq) continue;
    const snapSeq = snap.frontiers.snapshotIncludedFrontier[streamKey] ?? 0;
    if (snapSeq > excisionFloorSeq) {
      snapshotsV2.delete(seq);
    }
  }
  const remainingSeqs = [...snapshotsV2.keys()].sort((a, b) => a - b);
  meta.activeSnapshotSeq = remainingSeqs.length > 0 ? remainingSeqs[remainingSeqs.length - 1]! : 0;

  recordQuarantine(meta, quarantineJournal, "SYNC_EQUIVOCATION_DETECTED", detail, incomingOp);

  // 7. Rebuild entriesState deterministically:
  // Restore baseline snapshot entries, then replay remaining valid mutationJournal!
  rebuildEntriesState(meta, entriesState, snapshotsV2, mutationJournal);

  return { ok: true };
}

export function rebuildEntriesState(
  meta: ReplicaMetaRecord,
  entriesState: Map<string, EntryStateRecord>,
  snapshotsV2: Map<number, SnapshotRecord>,
  mutationJournal: Map<string, MutationJournalRecord>
): void {
  entriesState.clear();

  // Option A: Rebuild begins from the certified baseline snapshot
  let snap = getBaselineSnapshot(meta, snapshotsV2);

  if (snap) {
    for (const e of snap.entries) {
      const incKey = toIncarnationId(e.targetBirthDot);
      entriesState.set(incKey, JSON.parse(JSON.stringify(e)));
    }
  }

  //: Filter ops strictly above snapshot's included frontier with disposition APPLIED
  const snapFrontier = snap?.frontiers.snapshotIncludedFrontier ?? {};
  const replayOps: ReplicableOperation[] = [];
  for (const jRec of mutationJournal.values()) {
    if (jRec.disposition !== "APPLIED") continue;
    const sKey = toOriginStreamKey(jRec.epochNumber, jRec.replicaId);
    const snapSeq = snapFrontier[sKey] ?? 0;
    if (jRec.sequence > snapSeq) {
      replayOps.push(jRec.operation);
    }
  }

  // Sort remaining journal records in causal total order: Lamport ASC, then CausalDot ASC
  replayOps.sort((a, b) => {
    if (a.stamp.lamport !== b.stamp.lamport) return a.stamp.lamport - b.stamp.lamport;
    if (a.opDot.epochNumber !== b.opDot.epochNumber) return a.opDot.epochNumber - b.opDot.epochNumber;
    if (a.opDot.replicaId !== b.opDot.replicaId) return a.opDot.replicaId < b.opDot.replicaId ? -1 : 1;
    return a.opDot.sequence - b.opDot.sequence;
  });

  const replayCtx: InTransactionContext = {
    meta,
    entriesState,
    mutationJournal,
    operationDigests: new Map(),
    syncOutbox: new Map(),
    inboundGapBuffer: new Map(),
    inboundDependencyBuffer: new Map(),
    quarantineJournal: new Map(),
  };

  // Replay operations onto entriesState using applyOperationToState semantics (candidate atomicity & CRDT register joins)
  for (const op of replayOps) {
    applyOperationToState(replayCtx, op, false);
  }
}
