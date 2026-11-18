/**
 * @dotmix/sync — Collection Projection & Incarnation Resolution
 *
 * Implements deterministic winner selection for concurrent externalId incarnations,
 * position-based fractional index sorting, and conflicted ID reporting.
 * Zero external dependencies.
 */

import { compareCausalDots, compareLamportStamps } from "../protocol/apply.js";
import { generateKeyBetween } from "../crdt/fractional.js";
import type { CausalDot, EntryStateRecord, LamportStamp, QuarantineRecord } from "../protocol/types.js";
import type { OverlayHost } from "./contract.js";
import { resolveItemIdentifier } from "./compensation.js";

export function computeCommittedItems<T>(
  entriesState: Map<string, EntryStateRecord>,
  idField?: keyof T | ((candidateItem: T) => string)
): readonly T[] {
  const liveEntriesByExternalId = new Map<string, EntryStateRecord[]>();
  for (const candidateEntry of entriesState.values()) {
    if (!candidateEntry.deleted && candidateEntry.targetBirthDot.epochNumber >= 1) {
      const existingEntries = liveEntriesByExternalId.get(candidateEntry.externalId);
      if (existingEntries) {
        existingEntries.push(candidateEntry);
      } else {
        liveEntriesByExternalId.set(candidateEntry.externalId, [candidateEntry]);
      }
    }
  }

  const winningEntries: EntryStateRecord[] = [];
  for (const [_externalId, candidateGroup] of liveEntriesByExternalId.entries()) {
    if (candidateGroup.length === 1) {
      winningEntries.push(candidateGroup[0]!);
    } else {
      const sortedGroup = [...candidateGroup].sort((firstEntry, secondEntry) => {
        return compareCausalDots(secondEntry.targetBirthDot, firstEntry.targetBirthDot);
      });
      winningEntries.push(sortedGroup[0]!);
    }
  }

  winningEntries.sort((firstEntry, secondEntry) => {
    if (firstEntry.pos.indexKey !== secondEntry.pos.indexKey) {
      return firstEntry.pos.indexKey < secondEntry.pos.indexKey ? -1 : 1;
    }
    const stampComparison = compareLamportStamps(firstEntry.pos.stamp, secondEntry.pos.stamp);
    if (stampComparison !== 0) return stampComparison;
    return compareCausalDots(firstEntry.targetBirthDot, secondEntry.targetBirthDot);
  });

  return winningEntries.map((entryRecord) => {
    const itemObject: Record<string, unknown> = { id: entryRecord.externalId };
    if (typeof idField === "string") {
      itemObject[idField] = entryRecord.externalId;
    }
    for (const [fieldName, fieldRegister] of Object.entries(entryRecord.fields)) {
      if (fieldRegister && fieldRegister.present && !fieldName.startsWith("__")) {
        itemObject[fieldName] = fieldRegister.value;
      }
    }
    return itemObject as T;
  });
}

export function findWinningLiveEntry(
  entriesState: Map<string, EntryStateRecord>,
  targetExternalId: string
): EntryStateRecord | undefined {
  const matchingEntries: EntryStateRecord[] = [];
  for (const candidateEntry of entriesState.values()) {
    if (
      candidateEntry.externalId === targetExternalId &&
      !candidateEntry.deleted &&
      candidateEntry.targetBirthDot.epochNumber >= 1
    ) {
      matchingEntries.push(candidateEntry);
    }
  }
  if (matchingEntries.length === 0) return undefined;
  if (matchingEntries.length === 1) return matchingEntries[0];

  matchingEntries.sort((firstEntry, secondEntry) => {
    return compareCausalDots(secondEntry.targetBirthDot, firstEntry.targetBirthDot);
  });
  return matchingEntries[0];
}

export function findAllLiveEntries(
  entriesState: Map<string, EntryStateRecord>,
  targetExternalId: string
): EntryStateRecord[] {
  const matchingEntries: EntryStateRecord[] = [];
  for (const candidateEntry of entriesState.values()) {
    if (
      candidateEntry.externalId === targetExternalId &&
      !candidateEntry.deleted &&
      candidateEntry.targetBirthDot.epochNumber >= 1
    ) {
      matchingEntries.push(candidateEntry);
    }
  }
  return matchingEntries;
}

export function lookupItemIndexKey<T>(
  targetExternalId: string,
  entriesState: Map<string, EntryStateRecord>,
  overlayHost: OverlayHost<T>
): string | undefined {
  const winningEntry = findWinningLiveEntry(entriesState, targetExternalId);
  if (winningEntry) return winningEntry.pos.indexKey;

  for (const pendingIntent of overlayHost.pendingIntents()) {
    if (pendingIntent.externalId === targetExternalId && pendingIntent.indexKey) {
      return pendingIntent.indexKey;
    }
  }
  return undefined;
}

export function resolveNeighborPositions<T>(
  effectiveItems: readonly T[],
  destinationIndex: number,
  idField: keyof T | ((candidateItem: T) => string) | undefined,
  entriesState: Map<string, EntryStateRecord>,
  overlayHost: OverlayHost<T>
): {
  previousKey: string | null;
  nextKey: string | null;
  leftDot: CausalDot | null;
  rightDot: CausalDot | null;
} {
  const leftNeighbor = destinationIndex > 0 ? effectiveItems[destinationIndex - 1] : undefined;
  const rightNeighbor = destinationIndex < effectiveItems.length ? effectiveItems[destinationIndex] : undefined;

  const leftId = leftNeighbor ? resolveItemIdentifier(leftNeighbor, idField) : undefined;
  const rightId = rightNeighbor ? resolveItemIdentifier(rightNeighbor, idField) : undefined;

  const previousKey = leftId ? lookupItemIndexKey(leftId, entriesState, overlayHost) ?? null : null;
  const nextKey = rightId ? lookupItemIndexKey(rightId, entriesState, overlayHost) ?? null : null;

  const leftDot = leftId ? findWinningLiveEntry(entriesState, leftId)?.targetBirthDot ?? null : null;
  const rightDot = rightId ? findWinningLiveEntry(entriesState, rightId)?.targetBirthDot ?? null : null;

  return { previousKey, nextKey, leftDot, rightDot };
}

export function populateInitialEntries<T>(
  entriesState: Map<string, EntryStateRecord>,
  initialItems: readonly T[],
  replicaId: string,
  idField?: keyof T | ((candidateItem: T) => string)
): { lastSequence: number } {
  let previousIndexKey: string | null = null;
  let sequence = 0;
  for (let itemIndex = 0; itemIndex < initialItems.length; itemIndex++) {
    const candidateInitialItem = initialItems[itemIndex]!;
    const targetExternalId = resolveItemIdentifier(candidateInitialItem, idField);
    const currentIndexKey = generateKeyBetween(previousIndexKey, null);
    previousIndexKey = currentIndexKey;

    const birthDot: CausalDot = {
      epochNumber: 1,
      replicaId,
      sequence: ++sequence,
    };
    const birthStamp: LamportStamp = {
      lamport: Date.now(),
      ...birthDot,
    };

    const fieldRegisters: Record<string, { stamp: LamportStamp; value: unknown; present: boolean }> = {};
    for (const [propName, propValue] of Object.entries(candidateInitialItem as Record<string, unknown>)) {
      fieldRegisters[propName] = { stamp: birthStamp, value: propValue, present: true };
    }

    entriesState.set(`${birthDot.epochNumber}:${birthDot.replicaId}:${birthDot.sequence}`, {
      targetBirthDot: birthDot,
      externalId: targetExternalId,
      pos: { indexKey: currentIndexKey, stamp: birthStamp, leftNeighbor: null, rightNeighbor: null },
      fields: fieldRegisters,
      deleted: false,
      deleteDots: [],
    });
  }
  return { lastSequence: sequence };
}

export function detectConflictedExternalIds(
  entriesState: Map<string, EntryStateRecord>,
  quarantineJournal: Map<string, QuarantineRecord>
): string[] {
  const conflictedSet = new Set<string>();
  const liveEntriesByExternalId = new Map<string, number>();

  for (const candidateEntry of entriesState.values()) {
    if (!candidateEntry.deleted && candidateEntry.targetBirthDot.epochNumber >= 1) {
      const previousCount = liveEntriesByExternalId.get(candidateEntry.externalId) ?? 0;
      liveEntriesByExternalId.set(candidateEntry.externalId, previousCount + 1);
      if (previousCount >= 1) {
        conflictedSet.add(candidateEntry.externalId);
      }
    }
  }

  for (const [_entryKey, quarantineEntry] of quarantineJournal.entries()) {
    if (quarantineEntry.storageKey) {
      conflictedSet.add(quarantineEntry.storageKey);
    }
  }

  return Array.from(conflictedSet).sort();
}
