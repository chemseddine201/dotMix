/**
 * @mix/sync — Replicable Array CRDT with Fractional Indexing
 */

import type { MutationId } from "../types.js";
import { compareMutationIds } from "./clock.js";
import { generateKeyBetween } from "./fractional.js";

export interface ArrayEntry<T> {
  id: string;
  indexKey: string;
  value: T;
  deleted: boolean;
  mutationId: MutationId;
}

export class ReplicableArray<T> {
  private entries: Map<string, ArrayEntry<T>> = new Map();

  constructor(initialEntries: ArrayEntry<T>[] = []) {
    for (const e of initialEntries) {
      this.entries.set(e.id, { ...e });
    }
  }

  get length(): number {
    let count = 0;
    for (const e of this.entries.values()) {
      if (!e.deleted) count++;
    }
    return count;
  }

  get(id: string): T | null {
    const entry = this.entries.get(id);
    return entry && !entry.deleted ? entry.value : null;
  }

  getEntry(id: string): ArrayEntry<T> | null {
    return this.entries.get(id) ?? null;
  }

  getSortedEntries(): ArrayEntry<T>[] {
    return Array.from(this.entries.values())
      .filter((e) => !e.deleted)
      .sort((a, b) => {
        if (a.indexKey !== b.indexKey) {
          return a.indexKey < b.indexKey ? -1 : 1;
        }
        return compareMutationIds(a.mutationId, b.mutationId);
      });
  }

  toArray(): T[] {
    return this.getSortedEntries().map((e) => e.value);
  }

  insert(
    id: string,
    value: T,
    mutationId: MutationId,
    targetIndex?: number
  ): ArrayEntry<T> {
    const sorted = this.getSortedEntries();
    let prevKey: string | null = null;
    let nextKey: string | null = null;

    if (targetIndex === undefined || targetIndex >= sorted.length) {
      // Append to the end
      prevKey = sorted.length > 0 ? sorted[sorted.length - 1]!.indexKey : null;
      nextKey = null;
    } else if (targetIndex <= 0) {
      // Prepend to beginning
      prevKey = null;
      nextKey = sorted.length > 0 ? sorted[0]!.indexKey : null;
    } else {
      // Insert between targetIndex - 1 and targetIndex
      prevKey = sorted[targetIndex - 1]!.indexKey;
      nextKey = sorted[targetIndex]!.indexKey;
    }

    const indexKey = generateKeyBetween(prevKey, nextKey);
    const existing = this.entries.get(id);

    if (existing) {
      if (compareMutationIds(mutationId, existing.mutationId) >= 0) {
        existing.value = value;
        existing.indexKey = indexKey;
        existing.deleted = false;
        existing.mutationId = mutationId;
      }
      return existing;
    }

    const entry: ArrayEntry<T> = {
      id,
      indexKey,
      value,
      deleted: false,
      mutationId,
    };
    this.entries.set(id, entry);
    return entry;
  }

  insertWithKey(
    id: string,
    value: T,
    indexKey: string,
    mutationId: MutationId
  ): ArrayEntry<T> {
    const existing = this.entries.get(id);
    if (existing) {
      if (compareMutationIds(mutationId, existing.mutationId) >= 0) {
        existing.value = value;
        existing.indexKey = indexKey;
        existing.deleted = false;
        existing.mutationId = mutationId;
      }
      return existing;
    }

    const entry: ArrayEntry<T> = {
      id,
      indexKey,
      value,
      deleted: false,
      mutationId,
    };
    this.entries.set(id, entry);
    return entry;
  }

  restoreSnapshot(snapshot: ArrayEntry<T>[]): void {
    this.entries.clear();
    for (const e of snapshot) {
      this.entries.set(e.id, { ...e });
    }
  }

  update(id: string, partial: Partial<T>, mutationId: MutationId): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.deleted) {
      return false;
    }
    if (compareMutationIds(mutationId, entry.mutationId) >= 0) {
      if (typeof entry.value === "object" && entry.value !== null) {
        entry.value = { ...entry.value, ...partial };
      } else {
        entry.value = partial as unknown as T;
      }
      entry.mutationId = mutationId;
      return true;
    }
    return false;
  }

  delete(id: string, mutationId: MutationId): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      // Store tombstone even if element was not seen locally yet (CRDT guarantee)
      this.entries.set(id, {
        id,
        indexKey: "",
        value: null as unknown as T,
        deleted: true,
        mutationId,
      });
      return true;
    }
    if (compareMutationIds(mutationId, entry.mutationId) >= 0) {
      entry.deleted = true;
      entry.mutationId = mutationId;
      return true;
    }
    return false;
  }

  move(id: string, targetIndex: number, mutationId: MutationId): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.deleted) {
      return false;
    }

    // Exclude current entry when finding neighbors
    const sorted = this.getSortedEntries().filter((e) => e.id !== id);
    let prevKey: string | null = null;
    let nextKey: string | null = null;

    if (targetIndex <= 0) {
      prevKey = null;
      nextKey = sorted.length > 0 ? sorted[0]!.indexKey : null;
    } else if (targetIndex >= sorted.length) {
      prevKey = sorted.length > 0 ? sorted[sorted.length - 1]!.indexKey : null;
      nextKey = null;
    } else {
      prevKey = sorted[targetIndex - 1]!.indexKey;
      nextKey = sorted[targetIndex]!.indexKey;
    }

    const newIndexKey = generateKeyBetween(prevKey, nextKey);

    if (compareMutationIds(mutationId, entry.mutationId) >= 0) {
      entry.indexKey = newIndexKey;
      entry.mutationId = mutationId;
      return true;
    }
    return false;
  }

  merge(remoteEntries: ArrayEntry<T>[]): void {
    for (const remote of remoteEntries) {
      const local = this.entries.get(remote.id);
      if (!local) {
        this.entries.set(remote.id, { ...remote });
      } else if (compareMutationIds(remote.mutationId, local.mutationId) > 0) {
        local.indexKey = remote.indexKey;
        local.value = remote.value;
        local.deleted = remote.deleted;
        local.mutationId = remote.mutationId;
      }
    }
  }

  compact(ackWatermarkClock: number): number {
    let purged = 0;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.deleted && entry.mutationId.timestamp <= ackWatermarkClock) {
        this.entries.delete(id);
        purged++;
      }
    }
    return purged;
  }

  toJSON(): ArrayEntry<T>[] {
    return Array.from(this.entries.values());
  }

  static fromJSON<T>(json: ArrayEntry<T>[]): ReplicableArray<T> {
    return new ReplicableArray<T>(json);
  }
}
