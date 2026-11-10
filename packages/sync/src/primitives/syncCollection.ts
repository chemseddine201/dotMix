/**
 * @mix/sync — Local-First Reactive Collection Primitive (Replicable Array CRDT)
 */

import { signal } from "@mix/runtime";
import type {
  CollectionDeletePayload,
  CollectionInsertPayload,
  CollectionMovePayload,
  CollectionUpdatePayload,
  Mutation,
  MutationId,
  SyncCollection,
  SyncCollectionOptions,
  SyncDriver,
  SyncStatus,
} from "../types.js";
import { formatMutationId } from "../crdt/clock.js";
import { type ArrayEntry, ReplicableArray } from "../crdt/array.js";
import { getDefaultSyncEngine, SyncEngine } from "../engine/engine.js";
import { IndexedDbDriver } from "../storage/indexeddb.js";
import { OpfsDriver } from "../storage/opfs.js";

function resolveDriver(
  driverOpt: SyncDriver | "memory" | "indexeddb" | "opfs" | undefined,
  engine: SyncEngine
): SyncDriver {
  if (typeof driverOpt === "object" && driverOpt !== null) {
    return driverOpt;
  }
  if (driverOpt === "opfs") return new OpfsDriver();
  if (driverOpt === "indexeddb") return new IndexedDbDriver();
  return engine.driver;
}

function resolveItemId<T>(item: T, idField?: keyof T | ((item: T) => string)): string {
  if (typeof idField === "function") {
    return idField(item);
  }
  if (typeof idField === "string" && item && typeof item === "object") {
    return String((item as Record<string, unknown>)[idField as string]);
  }
  const obj = item as { id?: unknown; key?: unknown };
  if (obj?.id !== undefined) return String(obj.id);
  if (obj?.key !== undefined) return String(obj.key);
  return String(item);
}

export function syncCollection<T>(
  keyOrOptions: string | SyncCollectionOptions<T>,
  opts?: SyncCollectionOptions<T>
): SyncCollection<T> {
  const options: SyncCollectionOptions<T> =
    typeof keyOrOptions === "string"
      ? { ...opts, key: keyOrOptions }
      : keyOrOptions;
  const key = options.key ?? "default_collection";
  const engine = (options.syncEngine as SyncEngine) || getDefaultSyncEngine();

  return engine.getOrCreateCollection(key, () => {
    const driver = resolveDriver(options.driver, engine);
    const crdtArray = new ReplicableArray<T>();

    const itemsSig = signal<T[]>([]);
    const pendingCountSig = signal<number>(0);
    const statusSig = signal<SyncStatus>(engine.isOnline() ? "synced" : "offline");

    // Rollback state tracking: map mutationIdStr -> previous snapshot entries
    const rollbackHistory = new Map<string, ArrayEntry<T>[]>();

    function updateItems(): void {
      itemsSig.set(crdtArray.toArray());
    }

    function saveSnapshot(): void {
      void driver.setItem(key, crdtArray.toJSON());
    }

    function restoreAndWitness(saved: ArrayEntry<T>[]): void {
      for (const entry of saved) {
        if (entry.mutationId && typeof entry.mutationId.timestamp === "number") {
          engine.clock.witness(entry.mutationId.timestamp);
        }
      }
      crdtArray.restoreSnapshot(saved);
      updateItems();
    }

    // 1. Check synchronous snapshot cache / storage first so route changes preserve state in 0ms
    const syncSaved = driver.getItemSync?.<ArrayEntry<T>[]>(key) ?? null;
    let initialSeeded = false;
    if (Array.isArray(syncSaved)) {
      restoreAndWitness(syncSaved);
    } else if (options.initialItems && options.initialItems.length > 0) {
      // Pre-seed initial items in-memory for immediate UI rendering
      for (const it of options.initialItems) {
        const id = resolveItemId(it, options.idField);
        crdtArray.insert(id, it, engine.clock.tick());
      }
      updateItems();
      initialSeeded = true;
    }

    // Register with SyncEngine
    engine.registerStore(key, {
      applyRemoteMutation(remoteMut: Mutation<unknown>) {
        if (remoteMut.op === "insert") {
          const payload = remoteMut.payload as CollectionInsertPayload<T>;
          crdtArray.insertWithKey(payload.id, payload.value, payload.indexKey, remoteMut.id);
        } else if (remoteMut.op === "update") {
          const payload = remoteMut.payload as CollectionUpdatePayload<T>;
          crdtArray.update(payload.id, payload.partial, remoteMut.id);
        } else if (remoteMut.op === "delete") {
          const payload = remoteMut.payload as CollectionDeletePayload;
          crdtArray.delete(payload.id, remoteMut.id);
        } else if (remoteMut.op === "move") {
          const payload = remoteMut.payload as CollectionMovePayload;
          crdtArray.move(payload.id, payload.targetIndex, remoteMut.id);
        }
        updateItems();
        saveSnapshot();
      },
      rollbackMutation(mutationIdStr: string) {
        const prevSnapshot = rollbackHistory.get(mutationIdStr);
        if (prevSnapshot) {
          crdtArray.restoreSnapshot(prevSnapshot);
          rollbackHistory.delete(mutationIdStr);
          pendingCountSig.set(rollbackHistory.size);
          updateItems();
          saveSnapshot();
        }
      },
      commitMutation(mutationIdStr: string) {
        if (rollbackHistory.has(mutationIdStr)) {
          rollbackHistory.delete(mutationIdStr);
          pendingCountSig.set(rollbackHistory.size);
          if (rollbackHistory.size === 0 && engine.isOnline()) {
            statusSig.set("synced");
          }
        }
      },
      compact(ackWatermarkClock: number): number {
        const purged = crdtArray.compact(ackWatermarkClock);
        saveSnapshot();
        return purged;
      },
    });

    // Attempt async hydration from driver on init
    void (async () => {
      try {
        await driver.init();
        const saved = await driver.getItem<ArrayEntry<T>[]>(key);
        if (Array.isArray(saved) && saved.length > 0) {
          restoreAndWitness(saved);
        } else if (initialSeeded && crdtArray.length > 0) {
          saveSnapshot();
        }
      } catch {
        // Ignore hydration errors
      }
    })();

    return {
      items: () => itemsSig(),
      status: () => engine.status(),
      isPending: () => pendingCountSig() > 0,
      pendingCount: () => pendingCountSig(),
      pendingMutations: () => engine.queue,
      engine,

      async insert(item: T, targetIndex?: number): Promise<Mutation<T>> {
        const id = resolveItemId(item, options.idField);
        const mutId: MutationId = engine.clock.tick();
        const idStr = formatMutationId(mutId);

        // Record snapshot for rollback
        rollbackHistory.set(idStr, crdtArray.toJSON());
        pendingCountSig.set(rollbackHistory.size);

        // Immediate optimistic update
        const entry = crdtArray.insert(id, item, mutId, targetIndex);
        updateItems();
        saveSnapshot();

        const payload: CollectionInsertPayload<T> = {
          id,
          value: item,
          indexKey: entry.indexKey,
          targetIndex,
        };
        const mutation: Mutation<T> = {
          id: mutId,
          idStr,
          storeKey: key,
          op: "insert",
          payload,
          state: "pending",
          createdAt: Date.now(),
        };

        await engine.enqueueMutation(mutation);
        if (engine.isOnline() && rollbackHistory.size === 0) {
          statusSig.set("synced");
        }
        return mutation;
      },

      async update(id: string, partial: Partial<T>): Promise<Mutation<Partial<T>>> {
        const mutId: MutationId = engine.clock.tick();
        const idStr = formatMutationId(mutId);

        rollbackHistory.set(idStr, crdtArray.toJSON());
        pendingCountSig.set(rollbackHistory.size);

        crdtArray.update(id, partial, mutId);
        updateItems();
        saveSnapshot();

        const payload: CollectionUpdatePayload<T> = { id, partial };
        const mutation: Mutation<Partial<T>> = {
          id: mutId,
          idStr,
          storeKey: key,
          op: "update",
          payload,
          state: "pending",
          createdAt: Date.now(),
        };

        await engine.enqueueMutation(mutation);
        return mutation;
      },

      async delete(id: string): Promise<Mutation<string>> {
        const mutId: MutationId = engine.clock.tick();
        const idStr = formatMutationId(mutId);

        rollbackHistory.set(idStr, crdtArray.toJSON());
        pendingCountSig.set(rollbackHistory.size);

        crdtArray.delete(id, mutId);
        updateItems();
        saveSnapshot();

        const payload: CollectionDeletePayload = { id };
        const mutation: Mutation<string> = {
          id: mutId,
          idStr,
          storeKey: key,
          op: "delete",
          payload,
          state: "pending",
          createdAt: Date.now(),
        };

        await engine.enqueueMutation(mutation);
        return mutation;
      },

      async reorder(fromIndex: number, toIndex: number): Promise<Mutation<unknown>> {
        const sorted = crdtArray.getSortedEntries();
        const target = sorted[fromIndex];
        if (!target) {
          throw new Error(`[syncCollection] Invalid fromIndex ${fromIndex}`);
        }

        const mutId: MutationId = engine.clock.tick();
        const idStr = formatMutationId(mutId);

        rollbackHistory.set(idStr, crdtArray.toJSON());
        pendingCountSig.set(rollbackHistory.size);

        crdtArray.move(target.id, toIndex, mutId);
        updateItems();
        saveSnapshot();

        const payload: CollectionMovePayload = { id: target.id, targetIndex: toIndex };
        const mutation: Mutation<unknown> = {
          id: mutId,
          idStr,
          storeKey: key,
          op: "move",
          payload,
          state: "pending",
          createdAt: Date.now(),
        };

        await engine.enqueueMutation(mutation);
        return mutation;
      },

      rollback(mutationIdStr?: string): void {
        if (mutationIdStr) {
          const prev = rollbackHistory.get(mutationIdStr);
          if (prev) {
            crdtArray.restoreSnapshot(prev);
            rollbackHistory.delete(mutationIdStr);
          }
        } else if (rollbackHistory.size > 0) {
          const lastKey = Array.from(rollbackHistory.keys()).pop()!;
          const prev = rollbackHistory.get(lastKey)!;
          crdtArray.restoreSnapshot(prev);
          rollbackHistory.delete(lastKey);
        }
        pendingCountSig.set(rollbackHistory.size);
        updateItems();
        saveSnapshot();
      },

      async clear(): Promise<void> {
        rollbackHistory.clear();
        pendingCountSig.set(0);
        await driver.removeItem(key);
        itemsSig.set([]);
      },

      compact(ackWatermarkClock?: number): number {
        const clock = ackWatermarkClock ?? engine.clock.currentTime;
        const purged = crdtArray.compact(clock);
        updateItems();
        saveSnapshot();
        return purged;
      },
    };
  });
}
