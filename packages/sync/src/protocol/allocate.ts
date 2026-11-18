/**
 * @dotmix/sync — Operation Allocation, Draft Building & Single-Flight Queue
 */

import { assertActiveLeaseFencing } from "./leases.js";
import { validateOperationSize } from "./quarantine.js";
import {
  computeOperationDigest,
  computeOperationSigningPayload,
} from "./preverify.js";
import { signPayloadAsync } from "./signing.js";
import {
  applyOperationToState,
  toOperationKey,
  toOriginStreamKey,
  toIncarnationId,
} from "./apply.js";
import { updateRollingStreamDigest } from "./frontiers.js";
import { drainCausalDependencyBuffer } from "./dependency.js";
import {
  SYNC_PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  type CausalDot,
  type LamportStamp,
  type ReplicableOperation,
  type InTransactionContext,
} from "./types.js";

export interface LocalMutationPayloadInput {
  kind: "insert" | "update" | "move" | "delete" | "clear";
  externalId?: string | undefined;
  targetIncarnation?: CausalDot | undefined;
  indexKey?: string | undefined;
  newIndexKey?: string | undefined;
  leftNeighborIncarnation?: CausalDot | null | undefined;
  rightNeighborIncarnation?: CausalDot | null | undefined;
  initialFields?: Record<string, unknown> | undefined;
  partialFields?: Record<string, unknown> | undefined;
  removedFields?: readonly string[] | undefined;
  baseFieldStamps?: Record<string, LamportStamp> | undefined;
  basePosStamp?: LamportStamp | undefined;
  basePosSourceOpKey?: string | undefined;
  targetIncarnations?: readonly CausalDot[] | undefined;
  clearBatchMeta?: {
    batchId: string;
    chunkIndex: number;
    totalChunks: number;
  } | undefined;
}

export function buildDraftOperation(
  baseFields: {
    protocolVersion: typeof PROTOCOL_VERSION;
    collectionId: string;
    epochNumber: number;
    epochCertificateId: string;
    opDot: CausalDot;
    targetIncarnation: CausalDot;
    externalId: string;
    stamp: LamportStamp;
    authorKeyId: string;
    payloadDigest: string;
    authorSignature: string;
  },
  input: LocalMutationPayloadInput,
  opDot: CausalDot,
  stamp: LamportStamp
): ReplicableOperation {
  switch (input.kind) {
    case "insert":
      return {
        ...baseFields,
        kind: "insert",
        indexKey: input.indexKey ?? "a0",
        leftNeighborIncarnation: input.leftNeighborIncarnation ?? null,
        rightNeighborIncarnation: input.rightNeighborIncarnation ?? null,
        initialFields: input.initialFields ?? {},
      };
    case "update":
      return {
        ...baseFields,
        kind: "update",
        partialFields: input.partialFields ?? {},
        removedFields: input.removedFields ?? [],
        baseFieldStamps: input.baseFieldStamps ?? {},
      };
    case "move":
      return {
        ...baseFields,
        kind: "move",
        newIndexKey: input.newIndexKey ?? "a0",
        leftNeighborIncarnation: input.leftNeighborIncarnation ?? null,
        rightNeighborIncarnation: input.rightNeighborIncarnation ?? null,
        basePosStamp: input.basePosStamp ?? stamp,
        basePosSourceOpKey: input.basePosSourceOpKey,
      };
    case "delete":
      return { ...baseFields, kind: "delete" };
    case "clear":
      return {
        ...baseFields,
        kind: "clear",
        targetIncarnations: input.targetIncarnations ?? [],
        clearBatchMeta: input.clearBatchMeta ?? {
          batchId: `${opDot.epochNumber}:${opDot.replicaId}:${opDot.sequence}`,
          chunkIndex: 0,
          totalChunks: 1,
        },
      };
  }
}

const allocationQueuesByCollection = new Map<string, Promise<unknown>>();

export function enqueueCollectionAllocation<T>(
  collectionId: string,
  replicaId: string,
  allocationAction: () => Promise<T>
): Promise<T> {
  const key = `${collectionId}:${replicaId}`;
  const prev = allocationQueuesByCollection.get(key) ?? Promise.resolve();
  const run = () => allocationAction();
  const next = prev.then(run, run);
  allocationQueuesByCollection.set(key, next.then(() => {}, () => {}));
  return next;
}

export interface EngineAllocationTarget {
  meta: InTransactionContext["meta"];
  mutationJournal: InTransactionContext["mutationJournal"];
  operationDigests: InTransactionContext["operationDigests"];
  syncOutbox: InTransactionContext["syncOutbox"];
  getTxContext(): InTransactionContext;
}

export function allocateLocalMutation(
  engine: EngineAllocationTarget,
  input: LocalMutationPayloadInput,
  callerTabId = "tab-primary",
  expectedFencingTerm = 1
): Promise<{ ok: boolean; op?: ReplicableOperation | undefined; code?: string | undefined; detail?: string | undefined }> {
  return enqueueCollectionAllocation(engine.meta.collectionId, engine.meta.replicaId, async () => {
    const fenceCheck = assertActiveLeaseFencing(engine.meta, callerTabId, expectedFencingTerm);
    if (!fenceCheck.ok) return fenceCheck;

    if (engine.meta.replicaId.includes(":")) {
      return { ok: false, code: "SYNC_INVALID_REPLICA_ID", detail: "Replica ID cannot contain ':'" };
    }

    if (engine.meta.lifecycleState !== "ACTIVE") {
      return {
        ok: false,
        code: "SYNC_LIFECYCLE_NOT_ACTIVE",
        detail: `Cannot allocate local mutation in lifecycle state ${engine.meta.lifecycleState}`,
      };
    }

    const binding = engine.meta.epochMemberBindings[engine.meta.replicaId];
    if (
      !binding ||
      (engine.meta.revokedKeyIds &&
        (engine.meta.revokedKeyIds.includes(binding.authorKeyId) ||
          engine.meta.revokedKeyIds.includes(engine.meta.authorKeyId)))
    ) {
      return {
        ok: false,
        code: "SYNC_REVOKED_AUTHOR_KEY",
        detail: `Local replica ${engine.meta.replicaId} is not a valid member or key is revoked in epoch ${engine.meta.epochNumber}`,
      };
    }

    // Check soft backpressure limits
    if (
      engine.mutationJournal.size >= SYNC_PROTOCOL_LIMITS.MAX_UNCOMPACTED_JOURNAL_OPS_SOFT_LIMIT ||
      engine.syncOutbox.size >= SYNC_PROTOCOL_LIMITS.MAX_OUTBOX_OPS_SOFT_LIMIT
    ) {
      engine.meta.lifecycleState = "READ_ONLY_COMPACTION_BACKPRESSURE";
      return {
        ok: false,
        code: "SYNC_COMPACTION_BACKPRESSURE_LIMIT_REACHED",
        detail: "Journal or outbox reached 50,000 uncompacted operations; compaction required",
      };
    }

    const tentativeSecurityVersion = engine.meta.securityStateVersion;
    // Tentative sequence and Lamport assignment (counters remain untouched until commit)
    const tentativeSeq = engine.meta.nextLocalSequence;
    const tentativeLamport = engine.meta.localLamport + 1;
    const opDot: CausalDot = {
      epochNumber: engine.meta.epochNumber,
      replicaId: engine.meta.replicaId,
      sequence: tentativeSeq,
    };
    const stamp: LamportStamp = { lamport: tentativeLamport, ...opDot };

    const baseFields = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: engine.meta.collectionId,
      epochNumber: engine.meta.epochNumber,
      epochCertificateId: engine.meta.epochCertificateId,
      opDot,
      targetIncarnation: input.kind === "insert" || input.kind === "clear" ? opDot : input.targetIncarnation!,
      externalId: input.kind === "clear" ? "" : input.externalId ?? "",
      stamp,
      authorKeyId: engine.meta.authorKeyId,
      payloadDigest: "0".repeat(64),
      authorSignature: "0".repeat(128),
    };

    const draftOp = buildDraftOperation(baseFields, input, opDot, stamp);

    const sizeCheck = validateOperationSize(draftOp);
    if (!sizeCheck.ok) return sizeCheck;

    const payloadDigest = computeOperationDigest(draftOp);
    let authorSignature = "0".repeat(128);
    const candidateSigningKey =
      (engine as { authorPrivateKey?: CryptoKey | string }).authorPrivateKey ??
      engine.meta.authorPrivateKeyHex;
    if (candidateSigningKey) {
      const signingPayload = computeOperationSigningPayload({ ...draftOp, payloadDigest });
      const binding = engine.meta.epochMemberBindings[engine.meta.replicaId];
      const signingAlgorithm = binding?.signingAlgorithm ?? "ECDSA_P256";
      authorSignature = await signPayloadAsync(signingPayload, candidateSigningKey, signingAlgorithm);
    }

    const signedOp: ReplicableOperation = { ...draftOp, payloadDigest, authorSignature };

    // Commit section: re-check lease fencing, security state invariance, sequence invariance, and epoch invariance
    const commitFenceCheck = assertActiveLeaseFencing(engine.meta, callerTabId, expectedFencingTerm);
    if (!commitFenceCheck.ok) return commitFenceCheck;

    if (engine.meta.securityStateVersion !== tentativeSecurityVersion) {
      return {
        ok: false,
        code: "SYNC_SECURITY_STATE_CHANGED",
        detail: "Security state changed during local allocation signing",
      };
    }

    if (engine.meta.revokedKeyIds && engine.meta.revokedKeyIds.includes(signedOp.authorKeyId)) {
      return {
        ok: false,
        code: "SYNC_REVOKED_AUTHOR_KEY",
        detail: "Author key was revoked during local signing",
      };
    }

    if (
      engine.meta.epochNumber !== opDot.epochNumber ||
      engine.meta.epochCertificateId !== signedOp.epochCertificateId
    ) {
      return {
        ok: false,
        code: "SYNC_CONCURRENT_ALLOCATION_CONFLICT",
        detail: `Epoch changed during signing: expected ${opDot.epochNumber}/${signedOp.epochCertificateId}, current ${engine.meta.epochNumber}/${engine.meta.epochCertificateId}`,
      };
    }

    if (engine.meta.nextLocalSequence !== tentativeSeq) {
      return {
        ok: false,
        code: "SYNC_CONCURRENT_ALLOCATION_CONFLICT",
        detail: `Sequence changed during signing: expected ${tentativeSeq}, current ${engine.meta.nextLocalSequence}`,
      };
    }

    const ctx = engine.getTxContext();
    const applyRes = applyOperationToState(ctx, signedOp, false);
    if (!applyRes.ok) return applyRes;

    // Durable commit: advance sequence and Lamport counters (clock must never regress)
    engine.meta.nextLocalSequence++;
    engine.meta.localLamport = Math.max(engine.meta.localLamport, tentativeLamport);

    const opKey = toOperationKey(engine.meta.collectionId, opDot);
    const streamKey = toOriginStreamKey(opDot.epochNumber, opDot.replicaId);

    engine.operationDigests.set(opKey, {
      opKey,
      collectionId: engine.meta.collectionId,
      epochNumber: opDot.epochNumber,
      replicaId: opDot.replicaId,
      sequence: opDot.sequence,
      status: applyRes.disposition!,
      payloadDigest,
      observedDigests: [payloadDigest],
    });

    engine.mutationJournal.set(opKey, {
      opKey,
      collectionId: engine.meta.collectionId,
      epochNumber: opDot.epochNumber,
      replicaId: opDot.replicaId,
      sequence: opDot.sequence,
      operation: signedOp,
      disposition: applyRes.disposition!,
    });

    if (engine.meta.remoteSyncEnabled) {
      engine.syncOutbox.set(opKey, {
        opKey,
        collectionId: engine.meta.collectionId,
        epochNumber: opDot.epochNumber,
        replicaId: opDot.replicaId,
        sequence: opDot.sequence,
        operation: signedOp,
        enqueuedAtStep: engine.meta.localLamport,
      });
    }

    engine.meta.frontiers.localDurableFrontier[streamKey] = opDot.sequence;
    engine.meta.frontiers.knownProducedFrontier[streamKey] = opDot.sequence;
    updateRollingStreamDigest(engine.meta, streamKey, opDot.sequence, payloadDigest);

    if (!engine.meta.clusterAcks[engine.meta.replicaId]) {
      engine.meta.clusterAcks[engine.meta.replicaId] = {};
    }
    engine.meta.clusterAcks[engine.meta.replicaId]![streamKey] = opDot.sequence;

    // Drain any dependent operations waiting for this birth dot
    if (input.kind === "insert") {
      drainCausalDependencyBuffer(ctx, toIncarnationId(opDot));
    }

    return { ok: true, op: signedOp };
  });
}
