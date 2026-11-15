/**
 * D137-v33-reference: High-Level Protocol Engine & Storage Lifecycle
 */

import { drainTransitive, evictDependencyBufferForEquivocatedStream, recordDurableOperation } from "./dependency.js";
import { executeEnableRemoteSync, executeSelfCertifiedEpochAdvance, resumeActivation } from "./lifecycle.js";
import { createInitialReplicaMeta, ingestEpochTransitionCertificate } from "./certificates.js";
import { canonicalizeValue, sha256Hex, toIncarnationId, toOperationKey, toOriginStreamKey } from "./canonicalization.js";
import {
  checkCommitTimeSecurityState, computeOperationDigest, computeOperationSigningPayload,
  makeReactiveMeta, preVerifyIncomingOperationAsync, signPayloadAsync, type PreVerifyResult,
} from "./crypto.js";
import { exciseEquivocatedStream, rebuildEntriesState } from "./equivocation.js";
import { recomputeStableFrontier, updateRollingStreamDigest } from "./frontiers.js";
import { assertActiveLeaseFencing } from "./leases.js";
import {
  applyOperationToState, buildDraftOperation, drainCausalDependencyBuffer,
  type InTransactionContext, type LocalMutationPayloadInput,
} from "./operations.js";
import { commitCheckpoint, createFoundingSnapshot } from "./snapshots.js";
import {
  blockStreamAndEvictSuccessors, bufferOutOfOrderOperation, computeOperationByteSize,
  recordQuarantine, validateOperationSize,
} from "./storage-bounds.js";
import {
  D137_V331_LIMITS,
  type CausalDot,
  type ClearBatchMetadata,
  type EntryStateRecord,
  type EpochMembershipCertificate,
  type InboundDependencyBufferRecord,
  type InboundGapBufferRecord,
  type LamportStamp,
  type MutationJournalRecord,
  type OperationDigestRecord,
  type OperationDisposition,
  type OperationKey,
  type QuarantineRecord,
  type ReplicaMetaRecord,
  type ReplicableOperation,
  type SnapshotRecord,
  type SyncOutboxRecord,
  type TabLeaseRecord,
  type TransportChannelPrincipal,
  type VerifiedEnvelope,
} from "./types.js";

const allocationQueuesByCollection = new Map<string, Promise<unknown>>();

function enqueueCollectionAllocation<T>(collectionId: string, replicaId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${collectionId}:${replicaId}`;
  const prev = allocationQueuesByCollection.get(key) ?? Promise.resolve();
  const run = () => fn();
  const next = prev.then(run, run);
  allocationQueuesByCollection.set(key, next.then(() => {}, () => {}));
  return next;
}

export class D137Engine {
  public meta: ReplicaMetaRecord;
  public entriesState = new Map<string, EntryStateRecord>();
  public snapshotsV2 = new Map<number, SnapshotRecord>();
  public mutationJournal = new Map<string, MutationJournalRecord>();
  public operationDigests = new Map<string, OperationDigestRecord>();
  public syncOutbox = new Map<string, SyncOutboxRecord>();
  public inboundGapBuffer = new Map<string, InboundGapBufferRecord>();
  public inboundDependencyBuffer = new Map<string, InboundDependencyBufferRecord>();
  public quarantineJournal = new Map<string, QuarantineRecord>();
  public tabLeases = new Map<string, TabLeaseRecord>();

  public enqueueAllocation<T>(fn: () => Promise<T>): Promise<T> {
    return enqueueCollectionAllocation(this.meta.collectionId, this.meta.replicaId, fn);
  }

  constructor(
    collectionId: string, replicaId: string, epochNumber: number,
    epochCertificate: EpochMembershipCertificate, authorKeyId: string, authorPrivateKeyHex?: string
  ) {
    this.meta = makeReactiveMeta(
      createInitialReplicaMeta(collectionId, replicaId, epochNumber, epochCertificate, authorKeyId, authorPrivateKeyHex)
    );
    this.snapshotsV2.set(0, createFoundingSnapshot(collectionId, epochNumber, epochCertificate));
  }

  public async selfCertifyEpochAdvance() { return executeSelfCertifiedEpochAdvance(this); }
  public async ingestEpochTransitionCertificate(cert: EpochMembershipCertificate) { return ingestEpochTransitionCertificate(this, cert); }
  public async resumeActivation(coordinatorCert?: EpochMembershipCertificate) { return resumeActivation(this, coordinatorCert); }

  private getTxContext(): InTransactionContext {
    return {
      meta: this.meta, entriesState: this.entriesState, mutationJournal: this.mutationJournal,
      operationDigests: this.operationDigests, syncOutbox: this.syncOutbox,
      inboundGapBuffer: this.inboundGapBuffer, inboundDependencyBuffer: this.inboundDependencyBuffer,
      quarantineJournal: this.quarantineJournal, snapshotsV2: this.snapshotsV2,
    };
  }

  /**
   * Allocates a local mutation with backpressure and size limits.
   * Serialized via single-flight allocation queue (T-31.7 / F-11).
   */
  public allocateLocalMutation(
    input: LocalMutationPayloadInput,
    callerTabId = "tab-primary",
    expectedFencingTerm = 1
  ): Promise<{ ok: boolean; op?: ReplicableOperation; code?: string; detail?: string }> {
    return enqueueCollectionAllocation(this.meta.collectionId, this.meta.replicaId, async () => {
      const fenceCheck = assertActiveLeaseFencing(this.meta, callerTabId, expectedFencingTerm);
      if (!fenceCheck.ok) return fenceCheck;

      if (this.meta.replicaId.includes(":")) {
        return { ok: false, code: "D137_INVALID_REPLICA_ID", detail: "Replica ID cannot contain ':'" };
      }

      if (this.meta.lifecycleState !== "ACTIVE") {
        return {
          ok: false,
          code: "D137_LIFECYCLE_NOT_ACTIVE",
          detail: `Cannot allocate local mutation in lifecycle state ${this.meta.lifecycleState}`,
        };
      }

      const binding = this.meta.epochMemberBindings[this.meta.replicaId];
      if (!binding || (this.meta.revokedKeyIds && (this.meta.revokedKeyIds.includes(binding.authorKeyId) || this.meta.revokedKeyIds.includes(this.meta.authorKeyId)))) {
        return {
          ok: false,
          code: "D137_REVOKED_AUTHOR_KEY",
          detail: `Local replica ${this.meta.replicaId} is not a valid member or key is revoked in epoch ${this.meta.epochNumber}`,
        };
      }

      // Check soft backpressure limits
      if (
        this.mutationJournal.size >= D137_V331_LIMITS.MAX_UNCOMPACTED_JOURNAL_OPS_SOFT_LIMIT ||
        this.syncOutbox.size >= D137_V331_LIMITS.MAX_OUTBOX_OPS_SOFT_LIMIT
      ) {
        this.meta.lifecycleState = "READ_ONLY_COMPACTION_BACKPRESSURE";
        return {
          ok: false,
          code: "D137_COMPACTION_BACKPRESSURE_LIMIT_REACHED",
          detail: "Journal or outbox reached 50,000 uncompacted operations; compaction required",
        };
      }

      const tentativeSecurityVersion = this.meta.securityStateVersion;
      // Tentative sequence and Lamport assignment (counters remain untouched until commit)
      const tentativeSeq = this.meta.nextLocalSequence;
      const tentativeLamport = this.meta.localLamport + 1;
      const opDot: CausalDot = { epochNumber: this.meta.epochNumber, replicaId: this.meta.replicaId, sequence: tentativeSeq };
      const stamp: LamportStamp = { lamport: tentativeLamport, ...opDot };

      const baseFields = {
        protocolVersion: "D-137.v3.3.1" as const,
        collectionId: this.meta.collectionId,
        epochNumber: this.meta.epochNumber,
        epochCertificateId: this.meta.epochCertificateId,
        opDot,
        targetIncarnation: input.kind === "insert" || input.kind === "clear" ? opDot : input.targetIncarnation!,
        externalId: input.kind === "clear" ? "" : input.externalId ?? "",
        stamp,
        authorKeyId: this.meta.authorKeyId,
        payloadDigest: "0".repeat(64),
        authorSignature: "0".repeat(128),
      };

      const draftOp = buildDraftOperation(baseFields, input, opDot, stamp);

      const sizeCheck = validateOperationSize(draftOp);
      if (!sizeCheck.ok) return sizeCheck;

      const payloadDigest = computeOperationDigest(draftOp);
      let authorSignature = "0".repeat(128);
      if (this.meta.authorPrivateKeyHex) {
        const signingPayload = computeOperationSigningPayload({ ...draftOp, payloadDigest });
        authorSignature = await signPayloadAsync(signingPayload, this.meta.authorPrivateKeyHex, "Ed25519");
      }

      const signedOp: ReplicableOperation = { ...draftOp, payloadDigest, authorSignature };

      // Commit section: re-check lease fencing, security state invariance, sequence invariance, and epoch invariance
      const commitFenceCheck = assertActiveLeaseFencing(this.meta, callerTabId, expectedFencingTerm);
      if (!commitFenceCheck.ok) return commitFenceCheck;

      if (this.meta.securityStateVersion !== tentativeSecurityVersion) {
        return {
          ok: false,
          code: "D137_SECURITY_STATE_CHANGED",
          detail: "Security state changed during local allocation signing",
        };
      }

      if (this.meta.revokedKeyIds && this.meta.revokedKeyIds.includes(signedOp.authorKeyId)) {
        return {
          ok: false,
          code: "D137_REVOKED_AUTHOR_KEY",
          detail: "Author key was revoked during local signing",
        };
      }

      if (this.meta.epochNumber !== opDot.epochNumber || this.meta.epochCertificateId !== signedOp.epochCertificateId) {
        return {
          ok: false,
          code: "D137_CONCURRENT_ALLOCATION_CONFLICT",
          detail: `Epoch changed during signing: expected ${opDot.epochNumber}/${signedOp.epochCertificateId}, current ${this.meta.epochNumber}/${this.meta.epochCertificateId}`,
        };
      }

      if (this.meta.nextLocalSequence !== tentativeSeq) {
        return {
          ok: false,
          code: "D137_CONCURRENT_ALLOCATION_CONFLICT",
          detail: `Sequence changed during signing: expected ${tentativeSeq}, current ${this.meta.nextLocalSequence}`,
        };
      }

      const ctx = this.getTxContext();
      const applyRes = applyOperationToState(ctx, signedOp, false);
      if (!applyRes.ok) return applyRes;

      // Durable commit: advance sequence and Lamport counters (clock must never regress)
      this.meta.nextLocalSequence++;
      this.meta.localLamport = Math.max(this.meta.localLamport, tentativeLamport);

      const opKey = toOperationKey(this.meta.collectionId, opDot);
      const streamKey = toOriginStreamKey(opDot.epochNumber, opDot.replicaId);

      this.operationDigests.set(opKey, {
        opKey, collectionId: this.meta.collectionId, epochNumber: opDot.epochNumber,
        replicaId: opDot.replicaId, sequence: opDot.sequence, status: applyRes.disposition!,
        payloadDigest, observedDigests: [payloadDigest],
      });

      this.mutationJournal.set(opKey, {
        opKey, collectionId: this.meta.collectionId, epochNumber: opDot.epochNumber,
        replicaId: opDot.replicaId, sequence: opDot.sequence, operation: signedOp,
        disposition: applyRes.disposition!,
      });

      if (this.meta.remoteSyncEnabled) {
        this.syncOutbox.set(opKey, {
          opKey, collectionId: this.meta.collectionId, epochNumber: opDot.epochNumber,
          replicaId: opDot.replicaId, sequence: opDot.sequence, operation: signedOp,
          enqueuedAtStep: this.meta.localLamport,
        });
      }

      this.meta.frontiers.localDurableFrontier[streamKey] = opDot.sequence;
      this.meta.frontiers.knownProducedFrontier[streamKey] = opDot.sequence;
      updateRollingStreamDigest(this.meta, streamKey, opDot.sequence, payloadDigest);

      if (!this.meta.clusterAcks[this.meta.replicaId]) {
        this.meta.clusterAcks[this.meta.replicaId] = {};
      }
      this.meta.clusterAcks[this.meta.replicaId][streamKey] = opDot.sequence;

      // Drain any dependent operations waiting for this birth dot
      if (input.kind === "insert") {
        drainCausalDependencyBuffer(ctx, toIncarnationId(opDot));
      }

      return { ok: true, op: signedOp };
    });
  }

  /**
   * Ingests a remote operation using pre-verified asynchronous crypto and pure transactional execution.
   */
  public async ingestRemoteOperation(
    op: ReplicableOperation,
    channelPrincipal: TransportChannelPrincipal,
    callerTabId = "tab-primary",
    expectedFencingTerm = 1
  ): Promise<{ ok: boolean; disposition?: OperationDisposition; code?: string; detail?: string }> {
    const fenceCheck = assertActiveLeaseFencing(this.meta, callerTabId, expectedFencingTerm);
    if (!fenceCheck.ok) return fenceCheck;

    // Decoupled Pre-Verification with Bounded Retries on Security State Change (T-31.8 / F-05)
    let retries = 0;
    const MAX_PREVERIFY_RETRIES = 3;
    let authCheck: PreVerifyResult | null = null;

    while (retries <= MAX_PREVERIFY_RETRIES) {
      authCheck = await preVerifyIncomingOperationAsync(this.meta, op, channelPrincipal);
      if (!authCheck.ok) {
        if (authCheck.code === "D137_EPOCH_CLOSED") return this.recordEpochClosed(op, authCheck.detail);
        recordQuarantine(this.meta, this.quarantineJournal, authCheck.code!, authCheck.detail!, op);
        return authCheck;
      }

      if (authCheck.envelope && authCheck.envelope.securityStateVersion === this.meta.securityStateVersion) {
        const secCheck = checkCommitTimeSecurityState(this.meta, op);
        if (!secCheck.ok) {
          if (secCheck.code === "D137_EPOCH_CLOSED") return this.recordEpochClosed(op, secCheck.detail);
          recordQuarantine(this.meta, this.quarantineJournal, secCheck.code!, secCheck.detail!, op);
          return secCheck;
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
        recordQuarantine(this.meta, this.quarantineJournal, err.code, err.detail, op);
        return err;
      }
    }

    const opKey = toOperationKey(this.meta.collectionId, op.opDot);
    const streamKey = toOriginStreamKey(op.opDot.epochNumber, op.opDot.replicaId);

    // Check operation_digests for idempotence or equivocation
    const existingDigestRec = this.operationDigests.get(opKey);
    if (existingDigestRec) {
      if (existingDigestRec.status === "EQUIVOCATED" || existingDigestRec.status === "EXCISED_STREAM_QUARANTINED") {
        return { ok: false, code: "D137_EQUIVOCATION_DETECTED", detail: "Stream already equivocated" };
      }
      if (existingDigestRec.payloadDigest === op.payloadDigest) {
        const st = existingDigestRec.status;
        if (st === "APPLIED" || st === "FENCED_COMPACTED_TARGET" || st === "FENCED_EQUIVOCATED_TARGET" || st === "IDEMPOTENT_DUPLICATE") {
          return { ok: true, disposition: "IDEMPOTENT_DUPLICATE" };
        }
        if (st === "QUARANTINED_REJECTED" || st === "D137_EPOCH_CLOSED" || st === "EVICTED_STREAM_BLOCKED_SUCCESSOR") {
          return { ok: false, code: "D137_OPERATION_REJECTED", detail: `Operation previously rejected with ${st}` };
        }
      } else {
        // Same-dot conflicting payload -> Equivocation!
        exciseEquivocatedStream(
          this.meta,
          this.entriesState,
          this.snapshotsV2,
          this.mutationJournal,
          this.operationDigests,
          this.inboundGapBuffer,
          this.quarantineJournal,
          streamKey,
          op.opDot.sequence,
          opKey,
          [existingDigestRec.payloadDigest, op.payloadDigest],
          op,
          `Same-dot equivocation detected on ${opKey}`,
          this.inboundDependencyBuffer
        );
        evictDependencyBufferForEquivocatedStream(this.getTxContext(), streamKey);
        return { ok: false, code: "D137_EQUIVOCATION_DETECTED", detail: `Equivocation excised on ${opKey}` };
      }
    }

    const currentDurableSeq = this.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
    if (existingDigestRec && op.opDot.sequence <= currentDurableSeq) {
      return { ok: true, disposition: "IDEMPOTENT_DUPLICATE" };
    }

    // S81: With no digest record, seq <= max(digestPrunedFrontier, localDurableFrontier) -> D137_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON
    if (!existingDigestRec) {
      const prunedDigestSeq = this.meta.frontiers.digestPrunedFrontier[streamKey] ?? 0;
      const lateHorizon = Math.max(prunedDigestSeq, currentDurableSeq);
      if (op.opDot.sequence <= lateHorizon) {
        recordQuarantine(
          this.meta,
          this.quarantineJournal,
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
    const bufferedExisting = this.inboundGapBuffer.get(opKey);
    if (bufferedExisting) {
      if (bufferedExisting.operation.payloadDigest === op.payloadDigest) {
        if (op.opDot.sequence === currentDurableSeq + 1) {
          this.inboundGapBuffer.delete(opKey);
          this.meta.totalGapBufferOps--;
          this.meta.totalGapBufferBytes -= bufferedExisting.byteSize;
          // Contiguous: proceed to apply!
        } else {
          return { ok: true, disposition: "IDEMPOTENT_DUPLICATE" };
        }
      } else {
        this.inboundGapBuffer.delete(opKey);
        this.meta.totalGapBufferOps--;
        this.meta.totalGapBufferBytes -= bufferedExisting.byteSize;
        exciseEquivocatedStream(
          this.meta,
          this.entriesState,
          this.snapshotsV2,
          this.mutationJournal,
          this.operationDigests,
          this.inboundGapBuffer,
          this.quarantineJournal,
          streamKey,
          op.opDot.sequence,
          opKey,
          [bufferedExisting.operation.payloadDigest, op.payloadDigest],
          op,
          `Buffered same-dot equivocation detected on ${opKey}`,
          this.inboundDependencyBuffer
        );
        evictDependencyBufferForEquivocatedStream(this.getTxContext(), streamKey);
        return { ok: false, code: "D137_EQUIVOCATION_DETECTED", detail: `Buffered equivocation excised on ${opKey}` };
      }
    }

    // Check if stream is blocked by active equivocation in this epoch
    if (this.meta.activeEpochEquivocations[streamKey]) {
      this.operationDigests.set(opKey, {
        opKey, collectionId: this.meta.collectionId, epochNumber: op.opDot.epochNumber,
        replicaId: op.opDot.replicaId, sequence: op.opDot.sequence, kind: op.kind,
        status: "QUARANTINED_REJECTED", payloadDigest: op.payloadDigest, observedDigests: [op.payloadDigest],
      });
      recordQuarantine(this.meta, this.quarantineJournal, "D137_EQUIVOCATION_DETECTED", `Stream ${streamKey} is quarantined`, op);
      return { ok: false, code: "D137_EQUIVOCATION_DETECTED", detail: `Stream ${streamKey} is quarantined in epoch ${this.meta.epochNumber}` };
    }

    // Out-of-order delivery -> Buffer in inbound_gap_buffer
    if (op.opDot.sequence > currentDurableSeq + 1) {
      return bufferOutOfOrderOperation(this.getTxContext(), op, opKey, streamKey);
    }

    // Contiguous delivery -> Apply candidate op
    const ctx = this.getTxContext();
    const applyRes = applyOperationToState(ctx, op, true);

    if (!applyRes.ok) {
      this.operationDigests.set(opKey, {
        opKey, collectionId: this.meta.collectionId, epochNumber: op.opDot.epochNumber,
        replicaId: op.opDot.replicaId, sequence: op.opDot.sequence, kind: op.kind,
        status: "QUARANTINED_REJECTED", payloadDigest: op.payloadDigest, observedDigests: [op.payloadDigest],
      });
      recordQuarantine(this.meta, this.quarantineJournal, applyRes.code!, applyRes.detail!, op);
      const bRes = blockStreamAndEvictSuccessors(ctx, streamKey, op.opDot.sequence, op, applyRes.detail ?? "State failure on remote op");
      if (bRes.excisedAny) rebuildEntriesState(this.meta, this.entriesState, this.snapshotsV2, this.mutationJournal);
      return applyRes;
    }

    if (applyRes.disposition === "BUFFERED_CAUSAL_DEPENDENCY") {
      this.operationDigests.set(opKey, {
        opKey, collectionId: this.meta.collectionId, epochNumber: op.opDot.epochNumber,
        replicaId: op.opDot.replicaId, sequence: op.opDot.sequence, kind: op.kind,
        status: "BUFFERED_CAUSAL_DEPENDENCY", payloadDigest: op.payloadDigest, observedDigests: [op.payloadDigest],
      });
      return { ok: true, disposition: "BUFFERED_CAUSAL_DEPENDENCY" };
    }

    // Record durable operation (APPLIED, FENCED_EQUIVOCATED_TARGET, or FENCED_COMPACTED_TARGET)
    recordDurableOperation(ctx, op, applyRes.disposition!);
    const depRec = this.inboundDependencyBuffer.get(opKey);
    if (depRec) {
      this.inboundDependencyBuffer.delete(opKey);
      this.meta.totalDependencyBufferOps--;
      this.meta.totalDependencyBufferBytes -= depRec.byteSize;
    }

    // Run transitive gap-buffer and dependency drainage
    drainTransitive(ctx, op.kind === "insert" ? toIncarnationId(op.opDot) : undefined, streamKey);

    return { ok: true, disposition: applyRes.disposition };
  }

  private recordEpochClosed(op: ReplicableOperation, detail?: string) {
    const opKey = toOperationKey(this.meta.collectionId, op.opDot);
    this.operationDigests.set(opKey, {
      opKey, collectionId: this.meta.collectionId, epochNumber: op.opDot.epochNumber,
      replicaId: op.opDot.replicaId, sequence: op.opDot.sequence, kind: op.kind,
      status: "D137_EPOCH_CLOSED", payloadDigest: op.payloadDigest, observedDigests: [op.payloadDigest],
    });
    recordQuarantine(this.meta, this.quarantineJournal, "D137_EPOCH_CLOSED", detail ?? "Epoch closed", op);
    return { ok: false, code: "D137_EPOCH_CLOSED", disposition: "D137_EPOCH_CLOSED" as const, detail };
  }

  public async enableRemoteSync(
    mode: "SEED_NEW_REMOTE_EPOCH" | "JOIN_EXISTING_REMOTE_CLUSTER",
    coordinatorCertOrRemoteSnapshot?: EpochMembershipCertificate | SnapshotRecord,
    assignedReplicaId?: string
  ): Promise<{ ok: boolean; code?: string; detail?: string }> {
    return executeEnableRemoteSync(this, mode, coordinatorCertOrRemoteSnapshot, assignedReplicaId);
  }
}
