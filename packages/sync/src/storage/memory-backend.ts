/**
 * @dotmix/sync — In-Memory Store Backend with ACID Rollback & Crash Injection
 *
 * Implements the StoreBackend interface for tests and SSR with atomic transactions,
 * staged writes, rollback on abort/error, and isolated post-commit execution.
 * Zero external dependencies.
 */

import { STORE_NAMES, type StoreName } from "./idb-schema.js";

export type CrashInjectionHook = (
  store: StoreName,
  op: "put" | "delete" | "clear",
  key: string | number
) => boolean;

export interface StorageTransaction {
  readonly mode: "readonly" | "readwrite";
  get<T>(store: StoreName, key: string | number): Promise<T | undefined>;
  put<T>(store: StoreName, key: string | number, value: T): Promise<void>;
  delete(store: StoreName, key: string | number): Promise<void>;
  getAll<T>(store: StoreName): Promise<T[]>;
  clear(store: StoreName): Promise<void>;
  abort(): void;
  onCommit(callback: () => void | Promise<void>): void;
}

export interface StoreBackend {
  readonly name: string;
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;
  runTransaction<T>(
    stores: readonly StoreName[],
    mode: "readonly" | "readwrite",
    transactionOperation: (transaction: StorageTransaction) => Promise<T>
  ): Promise<T>;
  setCrashInjectionHook(hook?: CrashInjectionHook): void;
  clearCrashInjectionHook(): void;
}

function safeClone<T>(itemToClone: T): T {
  try {
    return structuredClone(itemToClone);
  } catch {
    return JSON.parse(JSON.stringify(itemToClone)) as T;
  }
}

export class MemoryStoreBackend implements StoreBackend {
  readonly name = "memory";
  private opened = false;
  private crashHook?: CrashInjectionHook | undefined;
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

  setCrashInjectionHook(hook?: CrashInjectionHook | undefined): void {
    this.crashHook = hook;
  }

  clearCrashInjectionHook(): void {
    this.crashHook = undefined;
  }

  async runTransaction<T>(
    storeNames: readonly StoreName[],
    mode: "readonly" | "readwrite",
    transactionOperation: (transaction: StorageTransaction) => Promise<T>
  ): Promise<T> {
    if (!this.opened) {
      await this.open();
    }

    // Validate declared store scopes
    for (const name of storeNames) {
      if (!this.stores.has(name)) {
        throw new Error(`Unknown store name: ${name}`);
      }
    }

    let aborted = false;
    const postCommitCallbacks: Array<() => void | Promise<void>> = [];

    // ACID Staging buffers
    const stagedPuts = new Map<StoreName, Map<string | number, unknown>>();
    const stagedDeletes = new Map<StoreName, Set<string | number>>();
    const stagedClears = new Set<StoreName>();

    for (const name of storeNames) {
      stagedPuts.set(name, new Map());
      stagedDeletes.set(name, new Set());
    }

    const tx: StorageTransaction = {
      mode,
      get: async <R>(store: StoreName, key: string | number): Promise<R | undefined> => {
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        if (stagedClears.has(store)) {
          const put = stagedPuts.get(store)?.get(key);
          return put !== undefined ? (safeClone(put) as R) : undefined;
        }
        if (stagedDeletes.get(store)?.has(key)) {
          return undefined;
        }
        const staged = stagedPuts.get(store)?.get(key);
        if (staged !== undefined) {
          return safeClone(staged) as R;
        }
        const original = this.stores.get(store)!.get(key);
        return original !== undefined ? (safeClone(original) as R) : undefined;
      },

      put: async <R>(store: StoreName, key: string | number, value: R): Promise<void> => {
        if (mode === "readonly") {
          throw new Error("Cannot write in readonly transaction");
        }
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        if (this.crashHook && this.crashHook(store, "put", key)) {
          aborted = true;
          throw new Error(`CRASH_INJECTED: aborting at put(${store}, ${key})`);
        }
        stagedDeletes.get(store)!.delete(key);
        stagedPuts.get(store)!.set(key, safeClone(value));
      },

      delete: async (store: StoreName, key: string | number): Promise<void> => {
        if (mode === "readonly") {
          throw new Error("Cannot delete in readonly transaction");
        }
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        if (this.crashHook && this.crashHook(store, "delete", key)) {
          aborted = true;
          throw new Error(`CRASH_INJECTED: aborting at delete(${store}, ${key})`);
        }
        stagedPuts.get(store)!.delete(key);
        stagedDeletes.get(store)!.add(key);
      },

      getAll: async <R>(store: StoreName): Promise<R[]> => {
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        const baseMap = this.stores.get(store)!;
        const result = new Map<string | number, unknown>();
        if (!stagedClears.has(store)) {
          for (const [k, v] of baseMap.entries()) {
            result.set(k, safeClone(v));
          }
        }
        for (const k of stagedDeletes.get(store)!) {
          result.delete(k);
        }
        for (const [k, v] of stagedPuts.get(store)!.entries()) {
          result.set(k, safeClone(v));
        }
        return Array.from(result.values()) as R[];
      },

      clear: async (store: StoreName): Promise<void> => {
        if (mode === "readonly") {
          throw new Error("Cannot clear in readonly transaction");
        }
        if (!storeNames.includes(store)) {
          throw new Error(`Store ${store} not included in transaction scope`);
        }
        if (this.crashHook && this.crashHook(store, "clear", 0)) {
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

      onCommit(postCommitCallback: () => void | Promise<void>): void {
        postCommitCallbacks.push(postCommitCallback);
      },
    };

    const result = await transactionOperation(tx);

    if (aborted) {
      throw new Error("Transaction aborted");
    }

    // Commit staging atomically into persistent memory stores
    for (const store of storeNames) {
      const storeMap = this.stores.get(store)!;
      if (stagedClears.has(store)) {
        storeMap.clear();
      }
      for (const entryKey of stagedDeletes.get(store)!) {
        storeMap.delete(entryKey);
      }
      for (const [entryKey, entryValue] of stagedPuts.get(store)!.entries()) {
        storeMap.set(entryKey, entryValue);
      }
    }

    // Execute post-commit callbacks with isolation (I21)
    for (const postCommitCallback of postCommitCallbacks) {
      try {
        await postCommitCallback();
      } catch (callbackError) {
        // Log isolated error without failing committed transaction
        console.error("[MemoryStoreBackend] Isolated post-commit callback error:", callbackError);
      }
    }

    return result;
  }
}
