/**
 * @dotmix/sync — CRDT State Join Semilattice, Register Resolution & Array Materialization (Gate 33 / D-137)
 */

import { sha256 } from "./sha256.js";
import { validateEntrySize } from "./quarantine.js";
import { classifyCausalDependency } from "./dependency.js";
import type {
  CausalDot,
  LamportStamp,
  FieldValueRegister,
  PositionRegister,
  EntryStateRecord,
  InTransactionContext,
  ReplicableOperation,
  OperationApplyResult,
} from "./types.js";

export type {
  CausalDot,
  LamportStamp,
  FieldValueRegister,
  PositionRegister,
  EntryStateRecord,
  OperationApplyResult,
};

export function sha256Hex(utf8Str: string): string {
  const bytes = sha256(utf8Str);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      hex += b.toString(16).padStart(2, "0");
    }
  }
  return hex;
}

export function toIncarnationId(dot: CausalDot): string {
  return `${dot.epochNumber}:${dot.replicaId}:${dot.sequence}`;
}

export function toOriginStreamKey(epochNumber: number, replicaId: string): string {
  return `${epochNumber}:${replicaId}`;
}

export function toOperationKey(collectionId: string, dot: CausalDot): string {
  return `${collectionId}:${dot.epochNumber}:${dot.replicaId}:${dot.sequence}`;
}

export function canonicalizeValue(targetValue: unknown): string {
  if (targetValue === null || targetValue === undefined) return "null";
  const targetType = typeof targetValue;
  if (targetType === "boolean") return targetValue ? "true" : "false";
  if (targetType === "number") {
    if (!Number.isFinite(targetValue as number)) {
      throw new Error("D137_NON_CANONICAL_VALUE: Non-finite number encountered");
    }
    return JSON.stringify(targetValue);
  }
  if (targetType === "string") return JSON.stringify(targetValue);
  if (Array.isArray(targetValue)) {
    return "[" + (targetValue as unknown[]).map(canonicalizeValue).join(",") + "]";
  }
  if (targetType === "object") {
    const objectRecord = targetValue as Record<string, unknown>;
    const sortedKeys = Object.keys(objectRecord)
      .filter((recordKey) => objectRecord[recordKey] !== undefined)
      .sort();
    return "{" + sortedKeys.map((recordKey) => JSON.stringify(recordKey) + ":" + canonicalizeValue(objectRecord[recordKey])).join(",") + "}";
  }
  throw new Error(`D137_NON_CANONICAL_VALUE: Unsupported value type: ${targetType}`);
}

export function compareCausalDots(a: CausalDot, b: CausalDot): number {
  if (a.epochNumber !== b.epochNumber) return a.epochNumber - b.epochNumber;
  if (a.replicaId !== b.replicaId) return a.replicaId < b.replicaId ? -1 : 1;
  return a.sequence - b.sequence;
}

export function areDotsEqual(a: CausalDot, b: CausalDot): boolean {
  return a.epochNumber === b.epochNumber && a.replicaId === b.replicaId && a.sequence === b.sequence;
}

export function compareLamportStamps(a: LamportStamp, b: LamportStamp): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.epochNumber !== b.epochNumber) return a.epochNumber - b.epochNumber;
  if (a.replicaId !== b.replicaId) return a.replicaId < b.replicaId ? -1 : 1;
  return a.sequence - b.sequence;
}

export function normalizeAndBoundDeleteDots(dots: readonly CausalDot[]): readonly CausalDot[] {
  const byReplica = new Map<string, CausalDot>();
  for (const d of dots) {
    const existing = byReplica.get(d.replicaId);
    if (!existing || compareCausalDots(d, existing) < 0) {
      byReplica.set(d.replicaId, d);
    }
  }
  return [...byReplica.values()].sort(compareCausalDots).slice(0, 64);
}

export function joinFieldRegister(
  a: FieldValueRegister | undefined,
  b: FieldValueRegister | undefined
): FieldValueRegister {
  if (!a && !b) throw new Error("Both field registers undefined");
  if (!a) return b!;
  if (!b) return a;
  const cmp = compareLamportStamps(a.stamp, b.stamp);
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  const cA = canonicalizeValue(a.value);
  const cB = canonicalizeValue(b.value);
  return cA >= cB ? a : b;
}

export function joinPositionRegister(a: PositionRegister, b: PositionRegister): PositionRegister {
  const cmp = compareLamportStamps(a.stamp, b.stamp);
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  return a.indexKey <= b.indexKey ? a : b;
}

export function joinIncarnationStates(a: EntryStateRecord, b: EntryStateRecord): EntryStateRecord {
  if (!areDotsEqual(a.targetBirthDot, b.targetBirthDot)) {
    throw new Error(
      `Cannot join entries with different targetBirthDots: ${JSON.stringify(a.targetBirthDot)} vs ${JSON.stringify(b.targetBirthDot)}`
    );
  }

  const deleted = a.deleted || b.deleted;
  const deleteDots = normalizeAndBoundDeleteDots([...a.deleteDots, ...b.deleteDots]);
  const pos = joinPositionRegister(a.pos, b.pos);

  const fields: Record<string, FieldValueRegister> = {};
  const allFieldKeys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  for (const k of allFieldKeys) {
    fields[k] = joinFieldRegister(a.fields[k], b.fields[k]);
  }

  return {
    targetBirthDot: a.targetBirthDot,
    externalId: a.externalId,
    pos,
    fields,
    deleted,
    deleteDots,
  };
}

export function applyOperationToState(
  ctx: InTransactionContext,
  op: ReplicableOperation,
  isRemote: boolean
): OperationApplyResult {
  const { entriesState } = ctx;

  switch (op.kind) {
    case "insert": {
      const incKey = toIncarnationId(op.opDot);
      if (entriesState.has(incKey)) {
        return {
          ok: false,
          code: "D137_STATE_TARGET_EQUIVOCATION",
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

export interface MaterializedCollectionView<T = Record<string, unknown>> {
  readonly items: readonly T[];
  readonly totalCount: number;
  readonly conflictedDuplicateExternalIds: readonly string[];
}

export function materializeVisibleArray<T = Record<string, unknown>>(
  entriesState: Map<string, EntryStateRecord>
): MaterializedCollectionView<T> {
  const visibleEntries: EntryStateRecord[] = [];
  const seenExternalIds = new Set<string>();
  const duplicateExternalIds = new Set<string>();

  for (const entry of entriesState.values()) {
    if (!entry.deleted && entry.targetBirthDot.epochNumber >= 1) {
      visibleEntries.push(entry);
      if (entry.externalId) {
        if (seenExternalIds.has(entry.externalId)) {
          duplicateExternalIds.add(entry.externalId);
        } else {
          seenExternalIds.add(entry.externalId);
        }
      }
    }
  }

  visibleEntries.sort((a, b) => {
    if (a.pos.indexKey !== b.pos.indexKey) {
      return a.pos.indexKey < b.pos.indexKey ? -1 : 1;
    }
    const stampCmp = compareLamportStamps(a.pos.stamp, b.pos.stamp);
    if (stampCmp !== 0) return stampCmp;
    return compareCausalDots(a.targetBirthDot, b.targetBirthDot);
  });

  const items = visibleEntries.map((entry) => {
    const objectRecord: Record<string, unknown> = { id: entry.externalId };
    const sortedFieldKeys = Object.keys(entry.fields).sort();
    for (const fieldKey of sortedFieldKeys) {
      const fieldRegister = entry.fields[fieldKey];
      if (fieldRegister && fieldRegister.present) {
        objectRecord[fieldKey] = fieldRegister.value;
      }
    }
    return objectRecord as T;
  });

  return {
    items,
    totalCount: items.length,
    conflictedDuplicateExternalIds: [...duplicateExternalIds].sort(),
  };
}

export function visibleDigest(entriesState: Map<string, EntryStateRecord>): string {
  const visible = materializeVisibleArray(entriesState);
  return sha256Hex(canonicalizeValue(visible.items));
}

export function entriesDigest(entriesState: Map<string, EntryStateRecord>): string {
  const sorted = [...entriesState.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(canonicalizeValue(sorted));
}