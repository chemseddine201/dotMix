/**
 * @mix/sync — IndexedDB Durable Storage Driver
 */

import type { Mutation, SyncDriver } from "../types.js";
import { MemoryDriver } from "./memory.js";

const DB_NAME = "mix_sync_db";
const DB_VERSION = 1;
const STORE_SNAPSHOTS = "snapshots";
const STORE_MUTATIONS = "mutation_log";

export class IndexedDbDriver implements SyncDriver {
  readonly name = "indexeddb";
  private db: IDBDatabase | null = null;
  private fallback: MemoryDriver | null = null;

  async init(): Promise<void> {
    if (typeof indexedDB === "undefined") {
      this.fallback = new MemoryDriver();
      return this.fallback.init();
    }

    return new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_MUTATIONS)) {
          const mStore = db.createObjectStore(STORE_MUTATIONS, { keyPath: "idStr" });
          mStore.createIndex("by_storeKey", "storeKey", { unique: false });
          mStore.createIndex("by_state", "state", { unique: false });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => {
        // Fall back to memory on permission denied or private browsing issue
        this.fallback = new MemoryDriver();
        resolve();
      };
    });
  }

  private async ensureReady(): Promise<SyncDriver | null> {
    if (this.fallback) return this.fallback;
    if (!this.db) await this.init();
    return this.fallback;
  }

  async getItem<T>(key: string): Promise<T | null> {
    const fb = await this.ensureReady();
    if (fb) return fb.getItem<T>(key);

    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_SNAPSHOTS, "readonly");
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? (req.result.value as T) : null);
      };
      req.onerror = () => resolve(null);
    });
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    const fb = await this.ensureReady();
    if (fb) return fb.setItem<T>(key, value);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SNAPSHOTS, "readwrite");
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async removeItem(key: string): Promise<void> {
    const fb = await this.ensureReady();
    if (fb) return fb.removeItem(key);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SNAPSHOTS, "readwrite");
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async appendMutation(mutation: Mutation<unknown>): Promise<void> {
    const fb = await this.ensureReady();
    if (fb) return fb.appendMutation(mutation);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_MUTATIONS, "readwrite");
      const store = tx.objectStore(STORE_MUTATIONS);
      const req = store.put(mutation);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getPendingMutations(storeKey?: string): Promise<Mutation<unknown>[]> {
    const fb = await this.ensureReady();
    if (fb) return fb.getPendingMutations(storeKey);

    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_MUTATIONS, "readonly");
      const store = tx.objectStore(STORE_MUTATIONS);
      const req = store.getAll();
      req.onsuccess = () => {
        const all: Mutation<unknown>[] = req.result || [];
        const pending = all.filter(
          (m) => m.state === "pending" && (!storeKey || m.storeKey === storeKey)
        );
        resolve(pending);
      };
      req.onerror = () => resolve([]);
    });
  }

  async markMutationsCommitted(mutationIdStrs: string[]): Promise<void> {
    const fb = await this.ensureReady();
    if (fb) return fb.markMutationsCommitted(mutationIdStrs);

    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_MUTATIONS, "readwrite");
      const store = tx.objectStore(STORE_MUTATIONS);
      let count = 0;
      if (mutationIdStrs.length === 0) return resolve();

      for (const idStr of mutationIdStrs) {
        const getReq = store.get(idStr);
        getReq.onsuccess = () => {
          if (getReq.result) {
            getReq.result.state = "committed";
            store.put(getReq.result);
          }
          count++;
          if (count === mutationIdStrs.length) resolve();
        };
        getReq.onerror = () => {
          count++;
          if (count === mutationIdStrs.length) resolve();
        };
      }
    });
  }

  async markMutationRejected(mutationIdStr: string): Promise<void> {
    const fb = await this.ensureReady();
    if (fb) return fb.markMutationRejected(mutationIdStr);

    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_MUTATIONS, "readwrite");
      const store = tx.objectStore(STORE_MUTATIONS);
      const req = store.get(mutationIdStr);
      req.onsuccess = () => {
        if (req.result) {
          req.result.state = "rejected";
          store.put(req.result);
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  }

  async clear(): Promise<void> {
    const fb = await this.ensureReady();
    if (fb) return fb.clear();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_SNAPSHOTS, STORE_MUTATIONS], "readwrite");
      tx.objectStore(STORE_SNAPSHOTS).clear();
      tx.objectStore(STORE_MUTATIONS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
