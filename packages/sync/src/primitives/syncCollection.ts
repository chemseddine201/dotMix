/**
 * @mix/sync — Local-First Reactive Collection Primitive (Replicable Array CRDT)
 */

import { signal } from "@mix/runtime";
import type {
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
import { MemoryDriver } from "../storage/memory.js";
import { IndexedDbDriver } from "../storage/indexeddb.js";
import { OpfsDriver } from "../storage/opfs.js";

function resolveDriver(driverOpt?: SyncDriver | "memory" | "indexeddb" | "opfs"): SyncDriver {
  if (typeof driverOpt === "object" && driverOpt !== null) {
    return driverOpt;
  }
  if (driverOpt === "opfs") return new OpfsDriver();
  if (driverOpt === "indexeddb") return new IndexedDbDriver();
  return new MemoryDriver();
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
  key: string,
  options: SyncCollectionOptions<T> = { key }
): SyncCollection<T> {
  const engine = (options.syncEngine as SyncEngine) || getDefaultSyncEngine();
  const driver = resolveDriver(options.driver);
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

  // Register with SyncEngine
  engine.registerStore(key, {
    applyRemoteMutation(remoteMut: Mutation<unknown>) {
      if (remoteMut.op === "insert") {
        const payload = remoteMut.payload as { id: string; value: T; indexKey: string };
        crdtArray.insertWithKey(payload.id, payload.value, payload.indexKey, remoteMut.id);
      } else if (remoteMut.op === "update") {
        const payload = remoteMut.payload as { id: string; partial: Partial<T> };
        crdtArray.update(payload.id, payload.partial, remoteMut.id);
      } else if (remoteMut.op === "delete") {
        const payload = remoteMut.payload as { id: string };
        crdtArray.delete(payload.id, remoteMut.id);
      } else if (remoteMut.op === "move") {
        const payload = remoteMut.payload as { id: string; targetIndex: number };
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
  });

  // Attempt async hydration from driver on init
  void (async () => {
    try {
      await driver.init();
      const saved = await driver.getItem<ArrayEntry<T>[]>(key);
      if (Array.isArray(saved)) {
        crdtArray.merge(saved);
        updateItems();
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

      const mutation: Mutation<T> = {
        id: mutId,
        idStr,
        storeKey: key,
        op: "insert",
        payload: { id, value: item, indexKey: entry.indexKey, targetIndex } as unknown as T,
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

      const mutation: Mutation<Partial<T>> = {
        id: mutId,
        idStr,
        storeKey: key,
        op: "update",
        payload: { id, partial } as unknown as Partial<T>,
        state: "pending",
        createdAt: Date.now(),
      };

      await engine.enqueueMutation(mutation as unknown as Mutation<unknown>);
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

      const mutation: Mutation<string> = {
        id: mutId,
        idStr,
        storeKey: key,
        op: "delete",
        payload: { id } as unknown as string,
        state: "pending",
        createdAt: Date.now(),
      };

      await engine.enqueueMutation(mutation as unknown as Mutation<unknown>);
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

      const mutation: Mutation<unknown> = {
        id: mutId,
        idStr,
        storeKey: key,
        op: "move",
        payload: { id: target.id, targetIndex: toIndex },
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
  };
}
