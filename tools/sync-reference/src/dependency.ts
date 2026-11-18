/**
 * Sync-v33-reference: Causal Dependency Buffer & Drainage Invariants
 * Enforces, F-01, F-06, F-07, F-13, F-14.
 */

import {
  toIncarnationId,
  toOperationKey,
  toOriginStreamKey,
} from "./canonicalization.js";
import { rebuildEntriesState } from "./equivocation.js";
import { updateRollingStreamDigest } from "./frontiers.js";
import {
  applyOperationToState,
  type InTransactionContext,
} from "./operations.js";
import {
  blockStreamAndEvictSuccessors,
  computeOperationByteSize,
  recordQuarantine,
} from "./storage-bounds.js";
import {
  SYNC_PROTOCOL_LIMITS,
  type CausalDot,
  type OperationApplyResult,
  type OperationDisposition,
  type OriginStreamKey,
  type ReplicableOperation,
} from "./types.js";

/**
 * Classifies a missing target dependency during operation apply.
 * Enforces invalid target rejections (AUD-B1, AUD-B2), equivocation fencing (AUD-B3),
 * compaction fencing, and dependency buffer bounding.
 */
export function classifyCausalDependency(
  ctx: InTransactionContext,
  op: ReplicableOperation,
  isRemote: boolean = true
): OperationApplyResult {
  const { meta, inboundDependencyBuffer, mutationJournal, operationDigests } = ctx;
  const targetDot: CausalDot = op.targetIncarnation;

  // Local allocation: buffer dependency optimistically
  if (!isRemote) {
    const opKey = toOperationKey(meta.collectionId, op.opDot);
    const byteSize = computeOperationByteSize(op);
    inboundDependencyBuffer.set(opKey, {
      opKey,
      collectionId: meta.collectionId,
      waitingForIncarnationKey: toIncarnationId(targetDot),
      operation: op,
      byteSize,
    });
    meta.totalDependencyBufferOps++;
    meta.totalDependencyBufferBytes += byteSize;
    return { ok: true, disposition: "BUFFERED_CAUSAL_DEPENDENCY" };
  }

  // 1. Structural target validation: seq >= 1
  if (targetDot.sequence < 1) {
    return {
      ok: false,
      code: "SYNC_INVALID_DEPENDENCY_TARGET",
      detail: `Target sequence ${targetDot.sequence} must be >= 1`,
    };
  }

  // 2. Foreign epoch validation
  if (targetDot.epochNumber !== meta.epochNumber) {
    return {
      ok: false,
      code: "SYNC_INVALID_DEPENDENCY_TARGET",
      detail: `Target epoch ${targetDot.epochNumber} does not match current epoch ${meta.epochNumber}`,
    };
  }

  // 3. Cluster member validation
  if (!meta.epochMemberBindings[targetDot.replicaId]) {
    return {
      ok: false,
      code: "SYNC_INVALID_DEPENDENCY_TARGET",
      detail: `Target author ${targetDot.replicaId} is not a member of current epoch`,
    };
  }

  // 4. Known non-insert validation
  const targetOpKey = toOperationKey(meta.collectionId, targetDot);
  const targetDigestRec = operationDigests.get(targetOpKey);
  if (targetDigestRec?.kind && targetDigestRec.kind !== "insert") {
    return {
      ok: false,
      code: "SYNC_INVALID_DEPENDENCY_TARGET",
      detail: `Target dot ${toIncarnationId(targetDot)} is recorded as ${targetDigestRec.kind}, not insert`,
    };
  }
  const targetJournalRec = mutationJournal.get(targetOpKey);
  if (targetJournalRec && targetJournalRec.operation.kind !== "insert") {
    return {
      ok: false,
      code: "SYNC_INVALID_DEPENDENCY_TARGET",
      detail: `Target dot ${toIncarnationId(targetDot)} is a journaled ${targetJournalRec.operation.kind}, not insert`,
    };
  }

  // 5. Equivocation check: target stream or target op was excised
  const targetStreamKey = toOriginStreamKey(targetDot.epochNumber, targetDot.replicaId);
  if (
    meta.activeEpochEquivocations[targetStreamKey] ||
    targetDigestRec?.status === "EQUIVOCATED" ||
    targetDigestRec?.status === "EXCISED_STREAM_QUARANTINED"
  ) {
    return { ok: true, disposition: "FENCED_EQUIVOCATED_TARGET" };
  }

  // 6. Causal gap check
  const targetDurable = meta.frontiers.localDurableFrontier[targetStreamKey] ?? 0;
  if (targetDot.sequence > targetDurable) {
    // Target stream is lagging: causal gap! Buffer in inboundDependencyBuffer
    const opKey = toOperationKey(meta.collectionId, op.opDot);
    const byteSize = computeOperationByteSize(op);

    // Enforce dependency buffer limits
    if (
      meta.totalDependencyBufferOps + 1 > SYNC_PROTOCOL_LIMITS.MAX_DEPENDENCY_BUFFER_OPS_PER_COLLECTION ||
      meta.totalDependencyBufferBytes + byteSize > SYNC_PROTOCOL_LIMITS.MAX_DEPENDENCY_BUFFER_BYTES_PER_COLLECTION
    ) {
      return {
        ok: false,
        code: "SYNC_DEPENDENCY_BUFFER_OVERFLOW",
        detail: `Dependency buffer capacity exceeded (${meta.totalDependencyBufferOps} ops, ${meta.totalDependencyBufferBytes} bytes)`,
      };
    }

    inboundDependencyBuffer.set(opKey, {
      opKey,
      collectionId: meta.collectionId,
      waitingForIncarnationKey: toIncarnationId(targetDot),
      operation: op,
      byteSize,
    });
    meta.totalDependencyBufferOps++;
    meta.totalDependencyBufferBytes += byteSize;
    return { ok: true, disposition: "BUFFERED_CAUSAL_DEPENDENCY" };
  }

  // 7. Compaction check: target sequence <= compactionFrontier
  const targetCompaction = meta.frontiers.compactionFrontier[targetStreamKey] ?? 0;
  if (targetDot.sequence <= targetCompaction) {
    return { ok: true, disposition: "FENCED_COMPACTED_TARGET" };
  }

  // Target sequence <= durable, but not in entriesState and not compacted -> invalid
  return {
    ok: false,
    code: "SYNC_INVALID_DEPENDENCY_TARGET",
    detail: `Target dot ${toIncarnationId(targetDot)} does not exist and was not compacted`,
  };
}

/**
 * Commits a successfully applied or fenced operation into durable metadata.
 */
export function recordDurableOperation(
  ctx: InTransactionContext,
  op: ReplicableOperation,
  disposition: OperationDisposition
): void {
  const { meta, mutationJournal, operationDigests } = ctx;
  const opKey = toOperationKey(meta.collectionId, op.opDot);
  const streamKey = toOriginStreamKey(op.opDot.epochNumber, op.opDot.replicaId);
  const seq = op.opDot.sequence;

  mutationJournal.set(opKey, {
    opKey,
    collectionId: meta.collectionId,
    epochNumber: op.opDot.epochNumber,
    replicaId: op.opDot.replicaId,
    sequence: seq,
    operation: op,
    disposition,
  });

  operationDigests.set(opKey, {
    opKey,
    collectionId: meta.collectionId,
    epochNumber: op.opDot.epochNumber,
    replicaId: op.opDot.replicaId,
    sequence: seq,
    kind: op.kind,
    status: disposition,
    payloadDigest: op.payloadDigest,
    observedDigests: [op.payloadDigest],
  });

  meta.frontiers.localDurableFrontier[streamKey] = seq;
  meta.frontiers.knownProducedFrontier[streamKey] = seq;
  meta.localLamport = Math.max(meta.localLamport, op.stamp.lamport);
  updateRollingStreamDigest(meta, streamKey, seq, op.payloadDigest);

  if (!meta.clusterAcks[meta.replicaId]) {
    meta.clusterAcks[meta.replicaId] = {};
  }
  meta.clusterAcks[meta.replicaId][streamKey] = seq;
}

/**
 * Transitive drain loop:
 * When an incarnation is unblocked or a stream advances, unblocks waiting dependencies,
 * applies them, drains gap-buffered successors, and cascades transitively until quiescence.
 */
export function drainTransitive(
  ctx: InTransactionContext,
  initialIncarnationKey?: string,
  initialStreamKey?: OriginStreamKey
): void {
  const unblockedIncarnations: string[] = initialIncarnationKey ? [initialIncarnationKey] : [];
  const streamsToDrain: OriginStreamKey[] = initialStreamKey ? [initialStreamKey] : [];

  let iterations = 0;
  const maxIterations = 2_000;

  while (
    (unblockedIncarnations.length > 0 || streamsToDrain.length > 0) &&
    iterations < maxIterations
  ) {
    iterations++;

    // Part A: Drain dependency buffer for unblocked incarnations
    while (unblockedIncarnations.length > 0) {
      const incKey = unblockedIncarnations.shift()!;
      for (const [opKey, depRec] of [...ctx.inboundDependencyBuffer.entries()]) {
        if (depRec.waitingForIncarnationKey !== incKey) continue;

        const op = depRec.operation;
        const authorStreamKey = toOriginStreamKey(op.opDot.epochNumber, op.opDot.replicaId);

        // Equivocation re-check (AUD-C2)
        const digestRec = ctx.operationDigests.get(opKey);
        if (
          ctx.meta.activeEpochEquivocations[authorStreamKey] ||
          digestRec?.status === "EQUIVOCATED" ||
          digestRec?.status === "EXCISED_STREAM_QUARANTINED"
        ) {
          ctx.inboundDependencyBuffer.delete(opKey);
          ctx.meta.totalDependencyBufferOps--;
          ctx.meta.totalDependencyBufferBytes -= depRec.byteSize;
          continue;
        }

        // Must be contiguous on its own stream
        const currentDurable = ctx.meta.frontiers.localDurableFrontier[authorStreamKey] ?? 0;
        if (op.opDot.sequence !== currentDurable + 1) {
          continue;
        }

        ctx.inboundDependencyBuffer.delete(opKey);
        ctx.meta.totalDependencyBufferOps--;
        ctx.meta.totalDependencyBufferBytes -= depRec.byteSize;

        const applyRes = applyOperationToState(ctx, op, true);
        if (!applyRes.ok) {
          // S80: Failed drain -> state failure (AUD-C5): block stream & evict successors
          ctx.operationDigests.set(opKey, {
            opKey,
            collectionId: ctx.meta.collectionId,
            epochNumber: op.opDot.epochNumber,
            replicaId: op.opDot.replicaId,
            sequence: op.opDot.sequence,
            kind: op.kind,
            status: "QUARANTINED_REJECTED",
            payloadDigest: op.payloadDigest,
            observedDigests: [op.payloadDigest],
          });
          recordQuarantine(
            ctx.meta,
            ctx.quarantineJournal,
            applyRes.code ?? "SYNC_DRAIN_STATE_FAILURE",
            applyRes.detail ?? "Failed to apply unblocked dependency",
            op
          );
          const bRes = blockStreamAndEvictSuccessors(
            ctx,
            authorStreamKey,
            op.opDot.sequence,
            op,
            applyRes.detail ?? "Failed drain on unblocked dependency"
          );
          if (bRes.excisedAny && ctx.snapshotsV2) {
            rebuildEntriesState(ctx.meta, ctx.entriesState, ctx.snapshotsV2, ctx.mutationJournal);
          }
          continue;
        }

        if (applyRes.disposition === "BUFFERED_CAUSAL_DEPENDENCY") {
          // Re-buffered on another dependency
          continue;
        }

        recordDurableOperation(ctx, op, applyRes.disposition!);
        if (op.kind === "insert") {
          unblockedIncarnations.push(toIncarnationId(op.opDot));
        }
        streamsToDrain.push(authorStreamKey);
      }
    }

    // Part B: Drain gap buffer for streams that advanced
    while (streamsToDrain.length > 0) {
      const streamKey = streamsToDrain.shift()!;
      let currentSeq = ctx.meta.frontiers.localDurableFrontier[streamKey] ?? 0;

      while (true) {
        const nextSeq = currentSeq + 1;
        // Search gap buffer for nextSeq on this stream
        let foundNextKey: string | null = null;
        for (const [gapKey, gapRec] of ctx.inboundGapBuffer.entries()) {
          if (gapRec.streamKey === streamKey && gapRec.sequence === nextSeq) {
            foundNextKey = gapKey;
            break;
          }
        }

        if (!foundNextKey) break;

        const gapRec = ctx.inboundGapBuffer.get(foundNextKey)!;
        ctx.inboundGapBuffer.delete(foundNextKey);
        ctx.meta.totalGapBufferOps--;
        ctx.meta.totalGapBufferBytes -= gapRec.byteSize;

        const applyRes = applyOperationToState(ctx, gapRec.operation, true);
        if (!applyRes.ok) {
          ctx.operationDigests.set(foundNextKey, {
            opKey: foundNextKey,
            collectionId: ctx.meta.collectionId,
            epochNumber: gapRec.epochNumber,
            replicaId: gapRec.replicaId,
            sequence: nextSeq,
            kind: gapRec.operation.kind,
            status: "QUARANTINED_REJECTED",
            payloadDigest: gapRec.operation.payloadDigest,
            observedDigests: [gapRec.operation.payloadDigest],
          });
          recordQuarantine(
            ctx.meta,
            ctx.quarantineJournal,
            applyRes.code ?? "SYNC_DRAIN_STATE_FAILURE",
            applyRes.detail ?? "Failed to apply gap buffered op",
            gapRec.operation
          );
          for (const [k, r] of [...ctx.inboundGapBuffer.entries()]) {
            if (r.streamKey === streamKey && r.sequence > nextSeq) {
              ctx.inboundGapBuffer.delete(k);
              ctx.meta.totalGapBufferOps--;
              ctx.meta.totalGapBufferBytes -= r.byteSize;
              recordQuarantine(
                ctx.meta,
                ctx.quarantineJournal,
                "EVICTED_STREAM_BLOCKED_SUCCESSOR",
                `Evicted successor ${k}`,
                r.operation
              );
            }
          }
          break;
        }

        if (applyRes.disposition === "BUFFERED_CAUSAL_DEPENDENCY") {
          ctx.operationDigests.set(foundNextKey, {
            opKey: foundNextKey,
            collectionId: ctx.meta.collectionId,
            epochNumber: gapRec.epochNumber,
            replicaId: gapRec.replicaId,
            sequence: nextSeq,
            kind: gapRec.operation.kind,
            status: "BUFFERED_CAUSAL_DEPENDENCY",
            payloadDigest: gapRec.operation.payloadDigest,
            observedDigests: [gapRec.operation.payloadDigest],
          });
          break;
        }

        recordDurableOperation(ctx, gapRec.operation, applyRes.disposition!);
        currentSeq = nextSeq;

        if (gapRec.operation.kind === "insert") {
          unblockedIncarnations.push(toIncarnationId(gapRec.operation.opDot));
        }
      }
    }
  }
}

/**
 * Evicts dependency-buffered operations when a stream is excised.
 * Operations originating from the excised stream are purged.
 * Operations waiting for an incarnation on the excised stream are unblocked as FENCED_EQUIVOCATED_TARGET.
 */
export function evictDependencyBufferForEquivocatedStream(
  ctx: InTransactionContext,
  excisedStreamKey: OriginStreamKey
): void {
  const unblockedHonestOps: ReplicableOperation[] = [];

  for (const [opKey, depRec] of [...ctx.inboundDependencyBuffer.entries()]) {
    const op = depRec.operation;
    const authorStream = toOriginStreamKey(op.opDot.epochNumber, op.opDot.replicaId);

    if (authorStream === excisedStreamKey) {
      // Purge op originating from the excised stream
      ctx.inboundDependencyBuffer.delete(opKey);
      ctx.meta.totalDependencyBufferOps--;
      ctx.meta.totalDependencyBufferBytes -= depRec.byteSize;
      continue;
    }

    // If waiting for an incarnation on the excised stream, unblock as FENCED_EQUIVOCATED_TARGET
    const waitingDot = op.targetIncarnation;
    if (waitingDot) {
      const targetStream = toOriginStreamKey(waitingDot.epochNumber, waitingDot.replicaId);
      if (targetStream === excisedStreamKey) {
        ctx.inboundDependencyBuffer.delete(opKey);
        ctx.meta.totalDependencyBufferOps--;
        ctx.meta.totalDependencyBufferBytes -= depRec.byteSize;
        unblockedHonestOps.push(op);
      }
    }
  }

  // Sort by sequence so earlier ops advance durable before later ops are evaluated
  unblockedHonestOps.sort((a, b) => a.opDot.sequence - b.opDot.sequence);

  // Apply unblocked honest operations as FENCED_EQUIVOCATED_TARGET and drain their successors
  for (const op of unblockedHonestOps) {
    const authorStream = toOriginStreamKey(op.opDot.epochNumber, op.opDot.replicaId);
    const currentDurable = ctx.meta.frontiers.localDurableFrontier[authorStream] ?? 0;
    if (op.opDot.sequence === currentDurable + 1) {
      recordDurableOperation(ctx, op, "FENCED_EQUIVOCATED_TARGET");
      drainTransitive(ctx, undefined, authorStream);
    } else if (op.opDot.sequence > currentDurable + 1) {
      const opKey = toOperationKey(ctx.meta.collectionId, op.opDot);
      const byteSize = computeOperationByteSize(op);
      ctx.inboundGapBuffer.set(opKey, {
        opKey,
        collectionId: ctx.meta.collectionId,
        streamKey: authorStream,
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
    }
  }
}
