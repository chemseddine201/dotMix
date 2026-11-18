/**
 * Sync-v33-reference: Operation Allocation, State Application & Causal Dependency Handling
 */

import { classifyCausalDependency, drainTransitive } from "./dependency.js";
import {
  canonicalizeValue,
  sha256Hex,
  toIncarnationId,
  toOperationKey,
  toOriginStreamKey,
} from "./canonicalization.js";
import {
  compareCausalDots,
  compareLamportStamps,
  joinFieldRegister,
  joinPositionRegister,
  normalizeAndBoundDeleteDots,
} from "./crdt.js";
import { computeOperationDigest, computeOperationSigningPayload } from "./crypto.js";
import { updateRollingStreamDigest } from "./frontiers.js";
import {
  computeOperationByteSize,
  recordQuarantine,
  validateEntrySize,
  validateOperationSize,
} from "./storage-bounds.js";
import {
  SYNC_PROTOCOL_LIMITS,
  type CausalDot,
  type ClearBatchMetadata,
  type EntryStateRecord,
  type FieldValueRegister,
  type InboundDependencyBufferRecord,
  type InboundGapBufferRecord,
  type LamportStamp,
  type MutationJournalRecord,
  type OperationDigestRecord,
  type OperationDisposition,
  type OperationKey,
  type PositionRegister,
  type ReplicaMetaRecord,
  type ReplicableOperation,
  type SnapshotRecord,
  type SyncOutboxRecord,
} from "./types.js";

export interface LocalMutationPayloadInput {
  kind: "insert" | "update" | "move" | "delete" | "clear";
  externalId?: string;
  targetIncarnation?: CausalDot;
  indexKey?: string;
  newIndexKey?: string;
  leftNeighborIncarnation?: CausalDot | null;
  rightNeighborIncarnation?: CausalDot | null;
  initialFields?: Record<string, unknown>;
  partialFields?: Record<string, unknown>;
  removedFields?: readonly string[];
  baseFieldStamps?: Record<string, LamportStamp>;
  basePosStamp?: LamportStamp;
  basePosSourceOpKey?: OperationKey;
  targetIncarnations?: readonly CausalDot[];
  clearBatchMeta?: ClearBatchMetadata;
}

export interface InTransactionContext {
  meta: ReplicaMetaRecord;
  entriesState: Map<string, EntryStateRecord>;
  mutationJournal: Map<string, MutationJournalRecord>;
  operationDigests: Map<string, OperationDigestRecord>;
  syncOutbox: Map<string, SyncOutboxRecord>;
  inboundGapBuffer: Map<string, InboundGapBufferRecord>;
  inboundDependencyBuffer: Map<string, InboundDependencyBufferRecord>;
  quarantineJournal: Map<string, any>;
  snapshotsV2?: Map<number, SnapshotRecord>;
}

export function applyOperationToState(
  ctx: InTransactionContext,
  op: ReplicableOperation,
  isRemote: boolean
): { ok: boolean; disposition?: OperationDisposition; code?: string; detail?: string } {
  const { meta, entriesState, inboundDependencyBuffer } = ctx;

  switch (op.kind) {
    case "insert": {
      const incKey = toIncarnationId(op.opDot);
      if (entriesState.has(incKey)) {
        return {
          ok: false,
          code: "SYNC_STATE_TARGET_EQUIVOCATION",
          detail: `Insert dot ${incKey} already exists in entriesState`,
        };
      }

      const fieldRegisters: EntryStateRecord["fields"] = {};
      for (const [k, v] of Object.entries(op.initialFields)) {
        fieldRegisters[k] = { value: v, stamp: op.stamp, present: true };
      }

      const newEntry: EntryStateRecord = {
        targetBirthDot: op.opDot,
        externalId: op.externalId,
        pos: {
          indexKey: op.indexKey,
          stamp: op.stamp,
          leftNeighbor: op.leftNeighborIncarnation,
          rightNeighbor: op.rightNeighborIncarnation,
        },
        fields: fieldRegisters,
        deleted: false,
        deleteDots: [],
      };

      const sizeCheck = validateEntrySize(newEntry);
      if (!sizeCheck.ok) return sizeCheck;

      entriesState.set(incKey, newEntry);
      return { ok: true, disposition: "APPLIED" };
    }

    case "update": {
      const incKey = toIncarnationId(op.targetIncarnation);
      const entry = entriesState.get(incKey);

      if (!entry) {
        return classifyCausalDependency(ctx, op, isRemote);
      }

      // Entry exists: build candidate entry copy
      const candidateFields: EntryStateRecord["fields"] = {};
      for (const [k, reg] of Object.entries(entry.fields)) {
        candidateFields[k] = { ...reg };
      }
      const candidateEntry: EntryStateRecord = {
        ...entry,
        fields: candidateFields,
      };

      for (const [k, v] of Object.entries(op.partialFields)) {
        const incomingReg: FieldValueRegister = { value: v, stamp: op.stamp, present: true };
        candidateEntry.fields[k] = joinFieldRegister(candidateEntry.fields[k], incomingReg);
      }
      for (const k of op.removedFields) {
        const incomingReg: FieldValueRegister = { value: null, stamp: op.stamp, present: false };
        candidateEntry.fields[k] = joinFieldRegister(candidateEntry.fields[k], incomingReg);
      }

      const sizeCheck = validateEntrySize(candidateEntry);
      if (!sizeCheck.ok) return sizeCheck;

      entriesState.set(incKey, candidateEntry);
      return { ok: true, disposition: "APPLIED" };
    }

    case "move": {
      const incKey = toIncarnationId(op.targetIncarnation);
      const entry = entriesState.get(incKey);

      if (!entry) {
        return classifyCausalDependency(ctx, op, isRemote);
      }

      const candidateEntry: EntryStateRecord = {
        ...entry,
        pos: { ...entry.pos },
      };
      const incomingPos: PositionRegister = {
        indexKey: op.newIndexKey,
        stamp: op.stamp,
        leftNeighbor: op.leftNeighborIncarnation,
        rightNeighbor: op.rightNeighborIncarnation,
      };
      candidateEntry.pos = joinPositionRegister(candidateEntry.pos, incomingPos);
      const sizeCheck = validateEntrySize(candidateEntry);
      if (!sizeCheck.ok) return sizeCheck;

      entriesState.set(incKey, candidateEntry);
      return { ok: true, disposition: "APPLIED" };
    }

    case "delete": {
      const incKey = toIncarnationId(op.targetIncarnation);
      const entry = entriesState.get(incKey);

      if (!entry) {
        return classifyCausalDependency(ctx, op, isRemote);
      }

      const candidateEntry: EntryStateRecord = {
        ...entry,
        deleted: true,
        deleteDots: normalizeAndBoundDeleteDots([...entry.deleteDots, op.opDot]),
      };
      const sizeCheck = validateEntrySize(candidateEntry);
      if (!sizeCheck.ok) return sizeCheck;

      entriesState.set(incKey, candidateEntry);
      return { ok: true, disposition: "APPLIED" };
    }

    case "clear": {
      const candidateModified = new Map<string, EntryStateRecord>();
      for (const targetDot of op.targetIncarnations) {
        const incKey = toIncarnationId(targetDot);
        const entry = entriesState.get(incKey);
        if (entry) {
          const candidateEntry: EntryStateRecord = {
            ...entry,
            deleted: true,
            deleteDots: normalizeAndBoundDeleteDots([...entry.deleteDots, op.opDot]),
          };
          const sizeCheck = validateEntrySize(candidateEntry);
          if (!sizeCheck.ok) return sizeCheck;
          candidateModified.set(incKey, candidateEntry);
        }
      }
      for (const [incKey, modified] of candidateModified) {
        entriesState.set(incKey, modified);
      }
      return { ok: true, disposition: "APPLIED" };
    }
  }
}

/**
 * Drains any causally buffered operations waiting for a newly created or updated incarnation.
 */
export function drainCausalDependencyBuffer(
  ctx: InTransactionContext,
  createdIncarnationKey?: string
): void {
  drainTransitive(ctx, createdIncarnationKey);
}

export function buildDraftOperation(
  baseFields: {
    protocolVersion: "replicated.v3.3.1";
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
      return { ...baseFields, kind: "insert", indexKey: input.indexKey ?? "a0", leftNeighborIncarnation: input.leftNeighborIncarnation ?? null, rightNeighborIncarnation: input.rightNeighborIncarnation ?? null, initialFields: input.initialFields ?? {} };
    case "update":
      return { ...baseFields, kind: "update", partialFields: input.partialFields ?? {}, removedFields: input.removedFields ?? [], baseFieldStamps: input.baseFieldStamps ?? {} };
    case "move":
      return { ...baseFields, kind: "move", newIndexKey: input.newIndexKey ?? "a0", leftNeighborIncarnation: input.leftNeighborIncarnation ?? null, rightNeighborIncarnation: input.rightNeighborIncarnation ?? null, basePosStamp: input.basePosStamp ?? stamp, basePosSourceOpKey: input.basePosSourceOpKey };
    case "delete":
      return { ...baseFields, kind: "delete" };
    case "clear":
      return { ...baseFields, kind: "clear", targetIncarnations: input.targetIncarnations ?? [], clearBatchMeta: input.clearBatchMeta ?? { batchId: `${opDot.epochNumber}:${opDot.replicaId}:${opDot.sequence}`, chunkIndex: 0, totalChunks: 1 } };
  }
}
