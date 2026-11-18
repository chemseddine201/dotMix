/**
 * Sync-v33-reference: CRDT State Join Semilattice & Array Materialization
 */

import { canonicalizeValue } from "./canonicalization.js";
import type {
  CausalDot,
  EntryStateRecord,
  FieldValueRegister,
  LamportStamp,
  PositionRegister,
} from "./types.js";

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

export function joinFieldRegister(a: FieldValueRegister | undefined, b: FieldValueRegister | undefined): FieldValueRegister {
  if (!a && !b) throw new Error("Both field registers undefined");
  if (!a) return b!;
  if (!b) return a;
  const cmp = compareLamportStamps(a.stamp, b.stamp);
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  // Deterministic tie break on canonical value
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

  // Sort visible items: indexKey ASC, pos.stamp ASC, targetBirthDot ASC
  visibleEntries.sort((a, b) => {
    if (a.pos.indexKey !== b.pos.indexKey) {
      return a.pos.indexKey < b.pos.indexKey ? -1 : 1;
    }
    const stampCmp = compareLamportStamps(a.pos.stamp, b.pos.stamp);
    if (stampCmp !== 0) return stampCmp;
    return compareCausalDots(a.targetBirthDot, b.targetBirthDot);
  });

  const items = visibleEntries.map((entry) => {
    const obj: Record<string, unknown> = { id: entry.externalId };
    const sortedFieldKeys = Object.keys(entry.fields).sort();
    for (const k of sortedFieldKeys) {
      const reg = entry.fields[k];
      if (reg && reg.present) {
        obj[k] = reg.value;
      }
    }
    return obj as T;
  });

  return {
    items,
    totalCount: items.length,
    conflictedDuplicateExternalIds: [...duplicateExternalIds].sort(),
  };
}
