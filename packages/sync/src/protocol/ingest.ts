/**
 * @dotmix/sync — Remote Operation Ingestion Pipeline (Gate 33 / D-137)
 */

import { assertActiveLeaseFencing } from "./leases.js";
import {
  preVerifyIncomingOperationAsync,
  checkCommitTimeSecurityState,
  type PreVerifyResult,
} from "./preverify.js";
import {
  recordQuarantine,
  bufferOutOfOrderOperation,
  blockStreamAndEvictSuccessors,
} from "./quarantine.js";
import {
  exciseEquivocatedStream,
  rebuildEntriesState,
} from "./equivocation.js";
import {
  evictDependencyBufferForEquivocatedStream,
  recordDurableOperation,
  drainTransitive,
} from "./dependency.js";
import {
  applyOperationToState,
  toOperationKey,
  toOriginStreamKey,
  toIncarnationId,
} from "./apply.js";
import type {
  InTransactionContext,
  OperationDisposition,
  ReplicableOperation,
  SnapshotRecord,
  TransportChannelPrincipal,
} from "./types.js";

export interface EngineIngestTarget {
  meta: InTransactionContext["meta"];
  entriesState: InTransactionContext["entriesState"];
  mutationJournal: InTransactionContext["mutationJournal"];
  operationDigests: InTransactionContext["operationDigests"];
  inboundGapBuffer: InTransactionContext["inboundGapBuffer"];
  inboundDependencyBuffer: InTransactionContext["inboundDependencyBuffer"];
  quarantineJournal: InTransactionContext["quarantineJournal"];
  snapshotsV2: Map<number, SnapshotRecord>;
  getTxContext(): InTransactionContext;
}

export function recordEpochClosed(
  target: EngineIngestTarget,
  op: ReplicableOperation,
  detail?: string | undefined
): { ok: false; code: string; disposition: "D137_EPOCH_CLOSED"; detail?: string | undefined } {
  const opKey = toOperationKey(target.meta.collectionId, op.opDot);
  target.operationDigests.set(opKey, {
    opKey,
    collectionId: target.meta.collectionId,
    epochNumber: op.opDot.epochNumber,
    replicaId: op.opDot.replicaId,
    sequence: op.opDot.sequence,
    kind: op.kind,
    status: "D137_EPOCH_CLOSED",
    payloadDigest: op.payloadDigest,
    observedDigests: [op.payloadDigest],
  });
  recordQuarantine(
    target.meta,
    target.quarantineJournal,
    "D137_EPOCH_CLOSED",
    detail ?? "Epoch closed",
    op
  );
  return {
    ok: false,
    code: "D137_EPOCH_CLOSED",
    disposition: "D137_EPOCH_CLOSED",
    detail,
  };
}

export async function ingestRemoteOperation(
  target: EngineIngestTarget,
  op: ReplicableOperation,
  channelPrincipal: TransportChannelPrincipal,
  callerTabId = "tab-primary",
  expectedFencingTerm = 1
): Promise<{ ok: boolean; disposition?: OperationDisposition | undefined; code?: string | undefined; detail?: string | undefined }> {
  const fenceCheck = assertActiveLeaseFencing(target.meta, callerTabId, expectedFencingTerm);
  if (!fenceCheck.ok) return fenceCheck;

  // Decoupled Pre-Verification with Bounded Retries on Security State Change (T-31.8 / F-05)
  let retries = 0;
  const MAX_PREVERIFY_RETRIES = 3;
  let authCheck: PreVerifyResult | null = null;

  while (retries <= MAX_PREVERIFY_RETRIES) {
    authCheck = await preVerifyIncomingOperationAsync(target.meta, op, channelPrincipal);
    if (!authCheck.ok) {
      if (authCheck.code === "D137_EPOCH_CLOSED") return recordEpochClosed(target, op, authCheck.detail);
      recordQuarantine(target.meta, target.quarantineJournal, authCheck.code!, authCheck.detail!, op);
      return { ok: false, code: authCheck.code, detail: authCheck.detail };
    }

    if (authCheck.envelope && authCheck.envelope.securityStateVersion === target.meta.securityStateVersion) {
      const secCheck = checkCommitTimeSecurityState(target.meta, op);
      if (!secCheck.ok) {
        if (secCheck.code === "D137_EPOCH_CLOSED") return recordEpochClosed(target, op, secCheck.detail);
        recordQuarantine(target.meta, target.quarantineJournal, secCheck.code!, secCheck.detail!, op);
        return { ok: false, code: secCheck.code, detail: secCheck.detail };
      }
      break;
    }

    retries++;
    if (retries > MAX_PREVERIFY_RETRIES) {
      const err = {
        ok: false,
        code: "D137_SECURITY_STATE_CHANGED",
        detail: `Security state changed during pre-verification and exceeded retry bound (${MAX_PREVERIFY_RETRIES})`,
      };
      recordQuarantine(target.meta, target.quarantineJournal, err.code, err.detail, op);
      return err;
    }
  }

  const opKey = toOperationKey(target.meta.collectionId, op.opDot);
  const streamKey = toOriginStreamKey(op.opDot.epochNumber, op.opDot.replicaId);

  // Check operation_digests for idempotence or equivocation
  const existingDigestRec = target.operationDigests.get(opKey);
  if (existingDigestRec) {
    if (existingDigestRec.status === "EQUIVOCATED" || existingDigestRec.status === "EXCISED_STREAM_QUARANTINED") {
      return { ok: false, code: "D137_EQUIVOCATION_DETECTED", detail: "Stream already equivocated" };
    }
    if (existingDigestRec.payloadDigest === op.payloadDigest) {
      const st = existingDigestRec.status;
      if (
        st === "APPLIED" ||
        st === "FENCED_COMPACTED_TARGET" ||
        st === "FENCED_EQUIVOCATED_TARGET" ||
        st === "IDEMPOTENT_DUPLICATE"
      ) {
        return { ok: true, disposition: "IDEMPOTENT_DUPLICATE" };
      }
      if (st === "QUARANTINED_REJECTED" || st === "D137_EPOCH_CLOSED" || st === "EVICTED_STREAM_BLOCKED_SUCCESSOR") {
        return { ok: false, code: "D137_OPERATION_REJECTED", detail: `Operation previously rejected with ${st}` };
      }
    } else {
      // Same-dot conflicting payload -> Equivocation!
      exciseEquivocatedStream(
        target.meta,
        target.entriesState,
        target.snapshotsV2,
        target.mutationJournal,
        target.operationDigests,
        target.inboundGapBuffer,
        target.quarantineJournal,
        streamKey,
        op.opDot.sequence,
        opKey,
        [existingDigestRec.payloadDigest, op.payloadDigest],
        op,
        `Same-dot equivocation detected on ${opKey}`,
        target.inboundDependencyBuffer
      );
      evictDependencyBufferForEquivocatedStream(target.getTxContext(), streamKey);
      return { ok: false, code: "D137_EQUIVOCATION_DETECTED", detail: `Equivocation excised on ${opKey}` };
    }
  }

  const currentDurableSeq = target.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
  if (existingDigestRec && op.opDot.sequence <= currentDurableSeq) {
    return { ok: true, disposition: "IDEMPOTENT_DUPLICATE" };
  }

  // S81: With no digest record, seq <= max(digestPrunedFrontier, localDurableFrontier) -> D137_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON
  if (!existingDigestRec) {
    const prunedDigestSeq = target.meta.frontiers.digestPrunedFrontier[streamKey] ?? 0;
    const lateHorizon = Math.max(prunedDigestSeq, currentDurableSeq);
    if (op.opDot.sequence <= lateHorizon) {
      recordQuarantine(
        target.meta,
        target.quarantineJournal,
        "D137_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON",
        `Late op ${opKey} at seq ${op.opDot.sequence} <= late horizon ${lateHorizon}`,
        op
      );
      return {
        ok: false,
        code: "D137_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON",
        detail: `Late operation below pruned digest horizon (${op.opDot.sequence} <= ${lateHorizon})`,
      };
    }
  }

  // Check inbound_gap_buffer for buffered same-dot equivocation or contiguous retransmission
  const bufferedExisting = target.inboundGapBuffer.get(opKey);
  if (bufferedExisting) {
    if (bufferedExisting.operation.payloadDigest === op.payloadDigest) {
      if (op.opDot.sequence === currentDurableSeq + 1) {
        target.inboundGapBuffer.delete(opKey);
        target.meta.totalGapBufferOps--;
        target.meta.totalGapBufferBytes -= bufferedExisting.byteSize;
        // Contiguous: proceed to apply!
      } else {
        return { ok: true, disposition: "IDEMPOTENT_DUPLICATE" };
      }
    } else {
      target.inboundGapBuffer.delete(opKey);
      target.meta.totalGapBufferOps--;
      target.meta.totalGapBufferBytes -= bufferedExisting.byteSize;
      exciseEquivocatedStream(
        target.meta,
        target.entriesState,
        target.snapshotsV2,
        target.mutationJournal,
        target.operationDigests,
        target.inboundGapBuffer,
        target.quarantineJournal,
        streamKey,
        op.opDot.sequence,
        opKey,
        [bufferedExisting.operation.payloadDigest, op.payloadDigest],
        op,
        `Buffered same-dot equivocation detected on ${opKey}`,
        target.inboundDependencyBuffer
      );
      evictDependencyBufferForEquivocatedStream(target.getTxContext(), streamKey);
      return { ok: false, code: "D137_EQUIVOCATION_DETECTED", detail: `Buffered equivocation excised on ${opKey}` };
    }
  }

  // Check if stream is blocked by active equivocation in this epoch
  if (target.meta.activeEpochEquivocations[streamKey]) {
    target.operationDigests.set(opKey, {
      opKey,
      collectionId: target.meta.collectionId,
      epochNumber: op.opDot.epochNumber,
      replicaId: op.opDot.replicaId,
      sequence: op.opDot.sequence,
      kind: op.kind,
      status: "QUARANTINED_REJECTED",
      payloadDigest: op.payloadDigest,
      observedDigests: [op.payloadDigest],
    });
    recordQuarantine(
      target.meta,
      target.quarantineJournal,
      "D137_EQUIVOCATION_DETECTED",
      `Stream ${streamKey} is quarantined`,
      op
    );
    return {
      ok: false,
      code: "D137_EQUIVOCATION_DETECTED",
      detail: `Stream ${streamKey} is quarantined in epoch ${target.meta.epochNumber}`,
    };
  }

  // Out-of-order delivery -> Buffer in inbound_gap_buffer
  if (op.opDot.sequence > currentDurableSeq + 1) {
    return bufferOutOfOrderOperation(target.getTxContext(), op, opKey, streamKey);
  }

  // Contiguous delivery -> Apply candidate op
  const ctx = target.getTxContext();
  const applyRes = applyOperationToState(ctx, op, true);

  if (!applyRes.ok) {
    target.operationDigests.set(opKey, {
      opKey,
      collectionId: target.meta.collectionId,
      epochNumber: op.opDot.epochNumber,
      replicaId: op.opDot.replicaId,
      sequence: op.opDot.sequence,
      kind: op.kind,
      status: "QUARANTINED_REJECTED",
      payloadDigest: op.payloadDigest,
      observedDigests: [op.payloadDigest],
    });
    recordQuarantine(target.meta, target.quarantineJournal, applyRes.code!, applyRes.detail!, op);
    const bRes = blockStreamAndEvictSuccessors(
      ctx,
      streamKey,
      op.opDot.sequence,
      op,
      applyRes.detail ?? "State failure on remote op"
    );
    if (bRes.excisedAny) {
      rebuildEntriesState(target.meta, target.entriesState, target.snapshotsV2, target.mutationJournal);
    }
    return applyRes;
  }

  if (applyRes.disposition === "BUFFERED_CAUSAL_DEPENDENCY") {
    target.operationDigests.set(opKey, {
      opKey,
      collectionId: target.meta.collectionId,
      epochNumber: op.opDot.epochNumber,
      replicaId: op.opDot.replicaId,
      sequence: op.opDot.sequence,
      kind: op.kind,
      status: "BUFFERED_CAUSAL_DEPENDENCY",
      payloadDigest: op.payloadDigest,
      observedDigests: [op.payloadDigest],
    });
    return { ok: true, disposition: "BUFFERED_CAUSAL_DEPENDENCY" };
  }

  // Record durable operation (APPLIED, FENCED_EQUIVOCATED_TARGET, or FENCED_COMPACTED_TARGET)
  recordDurableOperation(ctx, op, applyRes.disposition!);
  const depRec = target.inboundDependencyBuffer.get(opKey);
  if (depRec) {
    target.inboundDependencyBuffer.delete(opKey);
    target.meta.totalDependencyBufferOps--;
    target.meta.totalDependencyBufferBytes -= depRec.byteSize;
  }

  // Run transitive gap-buffer and dependency drainage
  drainTransitive(ctx, op.kind === "insert" ? toIncarnationId(op.opDot) : undefined, streamKey);

  return { ok: true, disposition: applyRes.disposition };
}
