/**
 * @dotmix/sync — Replicable Array CRDT with Fractional Indexing
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

export interface ArraySnapshotState<T> {
  entries: ArrayEntry<T>[];
  compactionHorizon?: number;
  purgedTombstoneIds?: string[];
  peerWatermarks?: Record<string, number>;
}

export class ReplicableArray<T> {
  private entries: Map<string, ArrayEntry<T>> = new Map();
  private peerWatermarks: Map<string, number> = new Map();
  private compactionHorizon = 0;
  private purgedTombstoneIds: Set<string> = new Set();

  constructor(initialEntries?: ArrayEntry<T>[] | ArraySnapshotState<T>) {
    if (initialEntries) {
      this.restoreSnapshot(initialEntries);
    }
  }

  registerPeer(peerId: string, watermark = 0): void {
    this.peerWatermarks.set(peerId, watermark);
  }

  unregisterPeer(peerId: string): void {
    this.peerWatermarks.delete(peerId);
  }

  witnessPeer(peerId: string, timestamp: number): void {
    const current = this.peerWatermarks.get(peerId) ?? 0;
    if (timestamp > current) {
      this.peerWatermarks.set(peerId, timestamp);
    }
  }

  getPeerWatermark(peerId: string): number | undefined {
    return this.peerWatermarks.get(peerId);
  }

  getStabilityHorizon(): number {
    if (this.peerWatermarks.size === 0) {
      return 0;
    }
    let min = Infinity;
    for (const wm of this.peerWatermarks.values()) {
      if (wm < min) min = wm;
    }
    return min === Infinity ? 0 : min;
  }

  getCompactionHorizon(): number {
    return this.compactionHorizon;
  }

  getPurgedTombstoneIds(): string[] {
    return Array.from(this.purgedTombstoneIds);
  }

  getMaxKeyLength(): number {
    let max = 0;
    for (const e of this.entries.values()) {
      if (e.indexKey.length > max) max = e.indexKey.length;
    }
    return max;
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

  restoreSnapshot(snapshot: ArrayEntry<T>[] | ArraySnapshotState<T>): void {
    this.entries.clear();
    if (Array.isArray(snapshot)) {
      for (const e of snapshot) {
        this.entries.set(e.id, { ...e });
      }
      const snapObj = snapshot as unknown as { compactionHorizon?: number; purgedTombstoneIds?: string[] };
      if (typeof snapObj.compactionHorizon === "number") {
        this.compactionHorizon = Math.max(this.compactionHorizon, snapObj.compactionHorizon);
      }
      if (Array.isArray(snapObj.purgedTombstoneIds)) {
        for (const id of snapObj.purgedTombstoneIds) {
          this.purgedTombstoneIds.add(id);
        }
      }
    } else if (snapshot && typeof snapshot === "object") {
      const entries = snapshot.entries || [];
      for (const e of entries) {
        this.entries.set(e.id, { ...e });
      }
      if (typeof snapshot.compactionHorizon === "number") {
        this.compactionHorizon = Math.max(this.compactionHorizon, snapshot.compactionHorizon);
      }
      if (Array.isArray(snapshot.purgedTombstoneIds)) {
        for (const id of snapshot.purgedTombstoneIds) {
          this.purgedTombstoneIds.add(id);
        }
      }
      if (snapshot.peerWatermarks && typeof snapshot.peerWatermarks === "object") {
        for (const [peer, wm] of Object.entries(snapshot.peerWatermarks)) {
          this.peerWatermarks.set(peer, wm);
        }
      }
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

  merge(remoteEntries: ArrayEntry<T>[]): { merged: number; rejectedStale: number } {
    let merged = 0;
    let rejectedStale = 0;

    for (const remote of remoteEntries) {
      const local = this.entries.get(remote.id);
      if (!local) {
        // D-136: Stale-peer tombstone resurrection fencing
        // If the entry is not marked deleted, but its ID was previously purged on this node,
        // or its mutation timestamp is at or before our compaction horizon:
        if (
          !remote.deleted &&
          (this.purgedTombstoneIds.has(remote.id) ||
            (this.compactionHorizon > 0 && remote.mutationId.timestamp <= this.compactionHorizon))
        ) {
          rejectedStale++;
          continue; // Fence stale resurrection attempt!
        }

        this.entries.set(remote.id, { ...remote });
        merged++;
      } else if (compareMutationIds(remote.mutationId, local.mutationId) > 0) {
        local.indexKey = remote.indexKey;
        local.value = remote.value;
        local.deleted = remote.deleted;
        local.mutationId = remote.mutationId;
        merged++;
      }
    }

    return { merged, rejectedStale };
  }

  compact(ackWatermarkClock?: number): number {
    const stabilityHorizon = this.getStabilityHorizon();
    let effectiveWatermark = ackWatermarkClock ?? stabilityHorizon;

    // If active peers are registered, compaction cannot exceed the stability horizon of the mesh
    if (this.peerWatermarks.size > 0) {
      effectiveWatermark = Math.min(effectiveWatermark, stabilityHorizon);
      if (effectiveWatermark <= 0) {
        return 0; // At least one peer has not acknowledged past 0; cannot purge safely
      }
    }

    let purged = 0;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.deleted && entry.mutationId.timestamp <= effectiveWatermark) {
        this.entries.delete(id);
        this.purgedTombstoneIds.add(id);
        purged++;
      }
    }

    if (purged > 0 || (effectiveWatermark > this.compactionHorizon && this.peerWatermarks.size > 0)) {
      this.compactionHorizon = Math.max(this.compactionHorizon, effectiveWatermark);
    }

    return purged;
  }

  toJSON(): ArrayEntry<T>[] {
    const list = Array.from(this.entries.values());
    Object.defineProperty(list, "compactionHorizon", {
      value: this.compactionHorizon,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(list, "purgedTombstoneIds", {
      value: Array.from(this.purgedTombstoneIds),
      enumerable: false,
      writable: true,
      configurable: true,
    });
    return list;
  }

  toSnapshotState(): ArraySnapshotState<T> {
    const peerWatermarks: Record<string, number> = {};
    for (const [p, wm] of this.peerWatermarks.entries()) {
      peerWatermarks[p] = wm;
    }
    return {
      entries: Array.from(this.entries.values()),
      compactionHorizon: this.compactionHorizon,
      purgedTombstoneIds: Array.from(this.purgedTombstoneIds),
      peerWatermarks,
    };
  }

  static fromJSON<T>(json: ArrayEntry<T>[] | ArraySnapshotState<T>): ReplicableArray<T> {
    return new ReplicableArray<T>(json);
  }
}
