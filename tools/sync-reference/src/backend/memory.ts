/**
 * Sync-v33-reference: In-Memory Storage Backend with ACID Rollback & Crash Injection
 */

import {
  STORE_NAMES,
  type CrashInjectionHook,
  type StorageTransaction,
  type StoreBackend,
  type StoreName,
} from "./types.js";

export class MemoryStoreBackend implements StoreBackend {
  readonly name = "memory";
  private opened = false;
  private crashHook?: CrashInjectionHook;
  private stores = new Map<StoreName, Map<string | number, unknown>>();

  constructor() {
    for (const name of STORE_NAMES) {
      this.stores.set(name, new Map());
    }
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  isOpen(): boolean {
    return this.opened;
  }

  setCrashInjectionHook(hook?: CrashInjectionHook): void {
    this.crashHook = hook;
  }

  clearCrashInjectionHook(): void {
    this.crashHook = undefined;
  }

  async runTransaction<T>(
    storeNames: readonly StoreName[],
    mode: "readonly" | "readwrite",
    fn: (tx: StorageTransaction) => Promise<T>
  ): Promise<T> {
    if (!this.opened) {
      await this.open();
    }

    // Validate store names
    for (const name of storeNames) {
      if (!this.stores.has(name)) {
        throw new Error(`Unknown store name: ${name}`);
      }
    }

    let aborted = false;
    // Staging changes: Map<StoreName, Map<key, { op: "put" | "delete", value?: unknown } | { op: "clear" }>>
    const stagedPuts = new Map<StoreName, Map<string | number, unknown>>();
    const stagedDeletes = new Map<StoreName, Set<string | number>>();
    const stagedClears = new Set<StoreName>();

    for (const name of storeNames) {
      stagedPuts.set(name, new Map());
      stagedDeletes.set(name, new Set());
    }

    const tx: StorageTransaction = {
      mode,
      async get<R>(store: StoreName, key: string | number): Promise<R | undefined> {
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        if (stagedClears.has(store)) {
          const put = stagedPuts.get(store)?.get(key);
          return put !== undefined ? (JSON.parse(JSON.stringify(put)) as R) : undefined;
        }
        if (stagedDeletes.get(store)?.has(key)) {
          return undefined;
        }
        const staged = stagedPuts.get(store)?.get(key);
        if (staged !== undefined) {
          return JSON.parse(JSON.stringify(staged)) as R;
        }
        const original = thisContext.stores.get(store)!.get(key);
        return original !== undefined ? (JSON.parse(JSON.stringify(original)) as R) : undefined;
      },

      async put<R>(store: StoreName, key: string | number, value: R): Promise<void> {
        if (mode === "readonly") {
          throw new Error("Cannot write in readonly transaction");
        }
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        if (thisContext.crashHook && thisContext.crashHook(store, "put", key)) {
          aborted = true;
          throw new Error(`CRASH_INJECTED: aborting at put(${store}, ${key})`);
        }
        stagedDeletes.get(store)?.delete(key);
        stagedPuts.get(store)!.set(key, JSON.parse(JSON.stringify(value)));
      },

      async delete(store: StoreName, key: string | number): Promise<void> {
        if (mode === "readonly") {
          throw new Error("Cannot delete in readonly transaction");
        }
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        if (thisContext.crashHook && thisContext.crashHook(store, "delete", key)) {
          aborted = true;
          throw new Error(`CRASH_INJECTED: aborting at delete(${store}, ${key})`);
        }
        stagedPuts.get(store)?.delete(key);
        stagedDeletes.get(store)!.add(key);
      },

      async getAll<R>(store: StoreName): Promise<R[]> {
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        const result = new Map<string | number, unknown>();
        if (!stagedClears.has(store)) {
          for (const [k, v] of thisContext.stores.get(store)!.entries()) {
            result.set(k, v);
          }
        }
        for (const k of stagedDeletes.get(store)!) {
          result.delete(k);
        }
        for (const [k, v] of stagedPuts.get(store)!.entries()) {
          result.set(k, v);
        }
        return [...result.values()].map((v) => JSON.parse(JSON.stringify(v)) as R);
      },

      async clear(store: StoreName): Promise<void> {
        if (mode === "readonly") {
          throw new Error("Cannot clear in readonly transaction");
        }
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        if (thisContext.crashHook && thisContext.crashHook(store, "clear", 0)) {
          aborted = true;
          throw new Error(`CRASH_INJECTED: aborting at clear(${store})`);
        }
        stagedClears.add(store);
        stagedPuts.get(store)!.clear();
        stagedDeletes.get(store)!.clear();
      },

      abort(): void {
        aborted = true;
      },
    };

    const thisContext = this;

    try {
      const result = await fn(tx);
      if (aborted) {
        throw new Error("Transaction aborted");
      }

      // Commit changes atomically
      if (mode === "readwrite") {
        for (const store of storeNames) {
          const underlying = this.stores.get(store)!;
          if (stagedClears.has(store)) {
            underlying.clear();
          }
          for (const key of stagedDeletes.get(store)!) {
            underlying.delete(key);
          }
          for (const [key, val] of stagedPuts.get(store)!.entries()) {
            underlying.set(key, val);
          }
        }
      }
      return result;
    } catch (err) {
      // Discard staged changes on abort or error
      throw err;
    }
  }
}
