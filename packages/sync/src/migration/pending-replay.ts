/**
 * @dotmix/sync — Replays pending v1 mutations into migrated state.
 *
 * The legacy engine stores a mutation as { id: MutationId, idStr, storeKey, op, payload,
 * state } where payload is { id, value, indexKey } (insert), { id, partial } (update),
 * { id } (delete) or { id, targetIndex } (move); see types.ts CollectionMutationPayload.
 * A flat record ({ id, value | partial | fields, indexKey, newIndexKey }) is also accepted.
 *
 * Replayed mutations are local-only state changes: they are never placed in syncOutbox (I19).
 * Each one consumes a dot of the local stream, so the caller must advance the stream after.
 */

import { generateKeyBetween } from "../crdt/fractional.js";
import { toIncarnationId } from "../protocol/apply.js";
import type { CausalDot, EntryStateRecord, LamportStamp } from "../protocol/types.js";
import type { LegacyV1MutationRecord } from "./types.js";

interface NormalizedPendingMutation {
  readonly operationName: string;
  readonly targetIdentifier: string | undefined;
  readonly insertedFields: Record<string, unknown> | undefined;
  readonly partialFields: Record<string, unknown> | undefined;
  readonly indexKey: string | undefined;
  readonly newIndexKey: string | undefined;
  readonly targetIndex: number | undefined;
}

function asRecord(candidate: unknown): Record<string, unknown> | undefined {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
}

function asString(candidate: unknown): string | undefined {
  return typeof candidate === "string" ? candidate : undefined;
}

export function normalizeLegacyMutation(mutationRecord: LegacyV1MutationRecord): NormalizedPendingMutation {
  const payload = asRecord(mutationRecord.payload);
  return {
    operationName: mutationRecord.op,
    targetIdentifier:
      asString(payload?.["id"]) ?? asString(mutationRecord.targetId) ?? asString(mutationRecord.id),
    insertedFields: asRecord(payload?.["value"]) ?? asRecord(mutationRecord.value) ?? mutationRecord.fields,
    partialFields: asRecord(payload?.["partial"]) ?? mutationRecord.partial ?? mutationRecord.fields,
    indexKey: asString(payload?.["indexKey"]) ?? mutationRecord.indexKey,
    newIndexKey: asString(payload?.["newIndexKey"]) ?? mutationRecord.newIndexKey,
    targetIndex:
      typeof payload?.["targetIndex"] === "number" ? payload["targetIndex"] : mutationRecord.targetIndex,
  };
}

function stampFor(dot: CausalDot): LamportStamp {
  return { lamport: dot.sequence, ...dot };
}

function computeMovedIndexKey(
  entriesState: Map<string, EntryStateRecord>,
  movedEntry: EntryStateRecord,
  targetIndex: number
): string | undefined {
  const orderedSiblings = [...entriesState.values()]
    .filter((candidateEntry) => !candidateEntry.deleted && candidateEntry !== movedEntry)
    .sort((leftEntry, rightEntry) => (leftEntry.pos.indexKey < rightEntry.pos.indexKey ? -1 : 1));
  const clampedIndex = Math.max(0, Math.min(targetIndex, orderedSiblings.length));
  const previousKey = orderedSiblings[clampedIndex - 1]?.pos.indexKey ?? null;
  const nextKey = orderedSiblings[clampedIndex]?.pos.indexKey ?? null;
  try {
    return generateKeyBetween(previousKey, nextKey);
  } catch {
    return undefined;
  }
}

/** Applies pending legacy mutations to the migrated state. Returns how many were applied. */
export function replayPendingMutations(
  entriesState: Map<string, EntryStateRecord>,
  pendingMutations: readonly LegacyV1MutationRecord[],
  allocateDot: () => CausalDot
): number {
  const entryByExternalId = new Map<string, EntryStateRecord>();
  for (const existingEntry of entriesState.values()) {
    entryByExternalId.set(existingEntry.externalId, existingEntry);
  }

  let appliedCount = 0;
  for (const mutationRecord of pendingMutations) {
    const pendingMutation = normalizeLegacyMutation(mutationRecord);
    const targetIdentifier = pendingMutation.targetIdentifier;
    if (!targetIdentifier) continue;
    const foundEntry = entryByExternalId.get(targetIdentifier);

    if (pendingMutation.operationName === "insert") {
      // The legacy snapshot already holds optimistic inserts; only missing items are added.
      if (foundEntry) continue;
      const insertDot = allocateDot();
      const insertStamp = stampFor(insertDot);
      const fieldRegisters: EntryStateRecord["fields"] = {};
      for (const [fieldName, fieldValue] of Object.entries(pendingMutation.insertedFields ?? {})) {
        fieldRegisters[fieldName] = { value: fieldValue, stamp: insertStamp, present: true };
      }
      const insertedEntry: EntryStateRecord = {
        targetBirthDot: insertDot,
        externalId: targetIdentifier,
        pos: { indexKey: pendingMutation.indexKey ?? "a999999", stamp: insertStamp, leftNeighbor: null, rightNeighbor: null },
        fields: fieldRegisters,
        deleted: false,
        deleteDots: [],
      };
      entriesState.set(toIncarnationId(insertDot), insertedEntry);
      entryByExternalId.set(targetIdentifier, insertedEntry);
      appliedCount++;
    } else if (!foundEntry) {
      continue;
    } else if (pendingMutation.operationName === "update" || pendingMutation.operationName === "set") {
      const updateStamp = stampFor(allocateDot());
      for (const [fieldName, fieldValue] of Object.entries(pendingMutation.partialFields ?? {})) {
        foundEntry.fields[fieldName] = { value: fieldValue, stamp: updateStamp, present: true };
      }
      appliedCount++;
    } else if (pendingMutation.operationName === "delete") {
      if (!foundEntry.deleted) {
        foundEntry.deleted = true;
        foundEntry.deleteDots = [...foundEntry.deleteDots, allocateDot()];
      }
      appliedCount++;
    } else if (pendingMutation.operationName === "move") {
      const movedIndexKey =
        pendingMutation.newIndexKey ??
        (pendingMutation.targetIndex !== undefined
          ? computeMovedIndexKey(entriesState, foundEntry, pendingMutation.targetIndex)
          : undefined);
      if (movedIndexKey === undefined) continue;
      foundEntry.pos = { ...foundEntry.pos, indexKey: movedIndexKey, stamp: stampFor(allocateDot()) };
      appliedCount++;
    }
  }
  return appliedCount;
}
