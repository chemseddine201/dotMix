/**
 * @dotmix/sync — Enforceable Storage Bounds, Buffer Eviction & Quarantine Tiering (Gate 33 / D-137)
 */

import { canonicalizeValue } from "./apply.js";
import {
  D137_V331_LIMITS,
  type EntryStateRecord,
  type InTransactionContext,
  type OriginStreamKey,
  type QuarantineRecord,
  type ReplicaMetaRecord,
  type ReplicableOperation,
  type SequenceNumber,
} from "./types.js";

const encoder = new TextEncoder();

export function computeEntryByteSize(entry: EntryStateRecord): number {
  return encoder.encode(canonicalizeValue(entry)).length;
}

export function computeOperationByteSize(op: ReplicableOperation): number {
  return encoder.encode(canonicalizeValue(op)).length;
}

export function validateOperationSize(op: ReplicableOperation): { ok: boolean; code?: string; detail?: string } {
  const size = computeOperationByteSize(op);
  if (size > D137_V331_LIMITS.MAX_OPERATION_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: "D137_OPERATION_PAYLOAD_TOO_LARGE",
      detail: `Operation size ${size} bytes exceeds limit ${D137_V331_LIMITS.MAX_OPERATION_PAYLOAD_BYTES}`,
    };
  }
  if ("indexKey" in op && typeof op.indexKey === "string" && encoder.encode(op.indexKey).length > D137_V331_LIMITS.MAX_INDEX_KEY_BYTES) {
    return {
      ok: false,
      code: "D137_INDEX_KEY_TOO_LONG",
      detail: `Index key exceeds limit ${D137_V331_LIMITS.MAX_INDEX_KEY_BYTES}`,
    };
  }
  if ("newIndexKey" in op && typeof op.newIndexKey === "string" && encoder.encode(op.newIndexKey).length > D137_V331_LIMITS.MAX_INDEX_KEY_BYTES) {
    return {
      ok: false,
      code: "D137_INDEX_KEY_TOO_LONG",
      detail: `New index key exceeds limit ${D137_V331_LIMITS.MAX_INDEX_KEY_BYTES}`,
    };
  }
  if (
    op.kind === "clear" &&
    op.targetIncarnations &&
    op.targetIncarnations.length > D137_V331_LIMITS.CLEAR_MAX_TARGETS_PER_CHUNK
  ) {
    return {
      ok: false,
      code: "D137_CLEAR_CHUNK_TARGETS_EXCEEDED",
      detail: `Clear chunk contains ${op.targetIncarnations.length} targets, exceeding limit ${D137_V331_LIMITS.CLEAR_MAX_TARGETS_PER_CHUNK}`,
    };
  }
  return { ok: true };
}

export function validateEntrySize(entry: EntryStateRecord): { ok: boolean; code?: string; detail?: string } {
  const size = computeEntryByteSize(entry);
  if (size > D137_V331_LIMITS.MAX_ENTRY_TOTAL_BYTES) {
    return {
      ok: false,
      code: "D137_ENTRY_SIZE_LIMIT_EXCEEDED",
      detail: `Accumulated entry size ${size} bytes exceeds limit ${D137_V331_LIMITS.MAX_ENTRY_TOTAL_BYTES}`,
    };
  }
  return { ok: true };
}

const TIER1_CRITICAL_CODES = new Set<string>([
  "D137_EQUIVOCATION_DETECTED",
  "D137_EQUIVOCATION_ON_COMPACTED_HISTORY",
  "D137_STATE_TARGET_EQUIVOCATION",
  "D137_INVALID_AUTHOR_SIGNATURE",
  "D137_REVOKED_AUTHOR_KEY",
  "D137_BOTH_SNAPSHOTS_CORRUPT",
  "SNAPSHOT_N_CORRUPT_FALLBACK_TO_N_MINUS_1",
  "D137_SNAPSHOT_MEMBERSHIP_CERTIFICATE_MISMATCH",
  "LEGACY_CACHE_DIVERGENCE_RECONCILED",
  "LEGACY_EQUAL_MUTATION_ID_CONFLICT",
]);

export function recordQuarantine(
  meta: ReplicaMetaRecord,
  quarantineJournal: Map<string, QuarantineRecord>,
  reasonCode: string,
  detail: string,
  offendingPayload: unknown
): void {
  const seq = meta.nextQuarantineSeq++;
  const priorityTier: 1 | 2 = TIER1_CRITICAL_CODES.has(reasonCode) ? 1 : 2;

  if (quarantineJournal.size >= D137_V331_LIMITS.MAX_QUARANTINE_RECORDS) {
    let victimKey: string | null = null;
    // Always evict oldest Tier 2 first
    for (const [k, rec] of quarantineJournal.entries()) {
      if (rec.priorityTier === 2) {
        victimKey = k;
        break;
      }
    }
    if (!victimKey) {
      victimKey = quarantineJournal.keys().next().value ?? null;
      meta.quarantineEvictedCriticalCount++;
    }
    if (victimKey) quarantineJournal.delete(victimKey);
  }

  const storageKey = `${meta.collectionId}:${seq}`;
  quarantineJournal.set(storageKey, {
    storageKey,
    collectionId: meta.collectionId,
    quarantineSeq: seq,
    priorityTier,
    reasonCode,
    detail,
    offendingPayloadPreview: JSON.stringify(offendingPayload ?? "").slice(0, 512),
    recordedAtLogicalStep: meta.localLamport,
  });
}

/**
 * S80: Blocks an origin stream upon state failure and evicts all buffered successors.
 * Ensures every journal entry and operation digest with seq >= firstEquivocatedSeq leaves APPLIED.
 */
export function blockStreamAndEvictSuccessors(
  ctx: InTransactionContext,
  streamKey: OriginStreamKey,
  failedSeq: SequenceNumber,
  failedOp: ReplicableOperation,
  detail: string
): { excisedAny: boolean } {
  const floor = ctx.meta.epochCertificate.baselineStableFrontier[streamKey] ?? 0;
  const prevEq = ctx.meta.activeEpochEquivocations[streamKey];
  const firstSeq = prevEq ? Math.min(prevEq.firstEquivocatedSeq, failedSeq) : failedSeq;
  const combinedDigests = [...new Set([...(prevEq?.observedDigests ?? []), failedOp.payloadDigest])]
    .sort()
    .slice(0, D137_V331_LIMITS.MAX_OBSERVED_CONFLICT_DIGESTS_PER_DOT);

  ctx.meta.activeEpochEquivocations[streamKey] = {
    streamKey,
    certifiedBaselineSeq: floor,
    firstEquivocatedSeq: firstSeq,
    reason: prevEq?.reason ?? "BLOCKING_UNRESOLVED_STREAM_POSITION",
    observedDigests: combinedDigests,
  };

  const [epStr, repId] = streamKey.split(":");
  const ep = Number(epStr);

  let excisedAny = false;

  // 1. Any journal entry in mutationJournal with seq >= firstSeq must leave APPLIED
  for (const [jKey, jRec] of ctx.mutationJournal.entries()) {
    if (jRec.epochNumber === ep && jRec.replicaId === repId && jRec.sequence >= firstSeq) {
      if (jRec.disposition === "APPLIED") {
        jRec.disposition = "EXCISED_STREAM_QUARANTINED";
        excisedAny = true;
        recordQuarantine(
          ctx.meta,
          ctx.quarantineJournal,
          "EXCISED_STREAM_QUARANTINED",
          `Excised journal entry ${jKey} on blocked stream ${streamKey} (seq >= ${firstSeq}): ${detail}`,
          jRec.operation
        );
      }
    }
  }

  // 2. Any operation digest in operationDigests with seq >= firstSeq must leave APPLIED
  for (const [_dKey, dRec] of ctx.operationDigests.entries()) {
    if (dRec.epochNumber === ep && dRec.replicaId === repId && dRec.sequence >= firstSeq) {
      if (dRec.status === "APPLIED") {
        dRec.status = "EXCISED_STREAM_QUARANTINED";
      }
    }
  }

  // 3. Evict buffered successors from inboundGapBuffer
  for (const [gapKey, gapRec] of [...ctx.inboundGapBuffer.entries()]) {
    if (gapRec.streamKey === streamKey && gapRec.sequence >= firstSeq) {
      ctx.inboundGapBuffer.delete(gapKey);
      ctx.meta.totalGapBufferOps--;
      ctx.meta.totalGapBufferBytes -= gapRec.byteSize;
      ctx.operationDigests.set(gapKey, {
        opKey: gapKey,
        collectionId: ctx.meta.collectionId,
        epochNumber: gapRec.epochNumber,
        replicaId: gapRec.replicaId,
        sequence: gapRec.sequence,
        kind: gapRec.operation.kind,
        status: "EVICTED_STREAM_BLOCKED_SUCCESSOR",
        payloadDigest: gapRec.operation.payloadDigest,
        observedDigests: [gapRec.operation.payloadDigest],
      });
      recordQuarantine(
        ctx.meta,
        ctx.quarantineJournal,
        "EVICTED_STREAM_BLOCKED_SUCCESSOR",
        `Evicted gap successor ${gapKey}: ${detail}`,
        gapRec.operation
      );
    }
  }

  // 4. Evict buffered successors from inboundDependencyBuffer
  if (ctx.inboundDependencyBuffer) {
    for (const [depKey, depRec] of [...ctx.inboundDependencyBuffer.entries()]) {
      const depStream = `${depRec.operation.opDot.epochNumber}:${depRec.operation.opDot.replicaId}`;
      if (depStream === streamKey && depRec.operation.opDot.sequence >= firstSeq) {
        ctx.inboundDependencyBuffer.delete(depKey);
        ctx.meta.totalDependencyBufferOps--;
        ctx.meta.totalDependencyBufferBytes -= depRec.byteSize;
        ctx.operationDigests.set(depKey, {
          opKey: depKey,
          collectionId: ctx.meta.collectionId,
          epochNumber: depRec.operation.opDot.epochNumber,
          replicaId: depRec.operation.opDot.replicaId,
          sequence: depRec.operation.opDot.sequence,
          kind: depRec.operation.kind,
          status: "EVICTED_STREAM_BLOCKED_SUCCESSOR",
          payloadDigest: depRec.operation.payloadDigest,
          observedDigests: [depRec.operation.payloadDigest],
        });
        recordQuarantine(
          ctx.meta,
          ctx.quarantineJournal,
          "EVICTED_STREAM_BLOCKED_SUCCESSOR",
          `Evicted dependency successor ${depKey}: ${detail}`,
          depRec.operation
        );
      }
    }
  }

  // 5. Clamp frontiers if any op was excised
  if (excisedAny) {
    const curDurable = ctx.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
    if (curDurable >= firstSeq) {
      const clamped = Math.max(floor, firstSeq - 1);
      ctx.meta.frontiers.localDurableFrontier[streamKey] = clamped;
      ctx.meta.frontiers.knownProducedFrontier[streamKey] = Math.max(
        ctx.meta.frontiers.knownProducedFrontier[streamKey] ?? 0,
        clamped
      );
    }
  }

  return { excisedAny };
}

export function bufferOutOfOrderOperation(
  ctx: InTransactionContext,
  op: ReplicableOperation,
  opKey: string,
  streamKey: string
): { ok: boolean; disposition?: "BUFFERED_OUT_OF_ORDER"; code?: string; detail?: string } {
  const byteSize = computeOperationByteSize(op);
  if (
    ctx.meta.totalGapBufferOps >= D137_V331_LIMITS.MAX_GAP_BUFFER_OPS_PER_COLLECTION ||
    ctx.meta.totalGapBufferBytes + byteSize > D137_V331_LIMITS.MAX_GAP_BUFFER_BYTES_PER_COLLECTION
  ) {
    recordQuarantine(
      ctx.meta,
      ctx.quarantineJournal,
      "D137_GAP_BUFFER_OVERFLOW",
      `Gap buffer overflow: ${ctx.meta.totalGapBufferOps} ops, ${ctx.meta.totalGapBufferBytes} bytes`,
      op
    );
    return {
      ok: false,
      code: "D137_GAP_BUFFER_OVERFLOW",
      detail: `Gap buffer capacity exceeded (max ${D137_V331_LIMITS.MAX_GAP_BUFFER_OPS_PER_COLLECTION} ops)`,
    };
  }
  ctx.inboundGapBuffer.set(opKey, {
    opKey,
    collectionId: ctx.meta.collectionId,
    streamKey,
    epochNumber: op.opDot.epochNumber,
    replicaId: op.opDot.replicaId,
    sequence: op.opDot.sequence,
    operation: op,
    byteSize,
  });
  ctx.meta.totalGapBufferOps++;
  ctx.meta.totalGapBufferBytes += byteSize;
  ctx.operationDigests.set(opKey, {
    opKey,
    collectionId: ctx.meta.collectionId,
    epochNumber: op.opDot.epochNumber,
    replicaId: op.opDot.replicaId,
    sequence: op.opDot.sequence,
    kind: op.kind,
    status: "BUFFERED_OUT_OF_ORDER",
    payloadDigest: op.payloadDigest,
    observedDigests: [op.payloadDigest],
  });
  return { ok: true, disposition: "BUFFERED_OUT_OF_ORDER" };
}