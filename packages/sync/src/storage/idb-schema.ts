/**
 * @dotmix/sync — IndexedDB Schema v2 & Database Lifecycle (I22, D-143)
 *
 * Implements the D-137 database (DB_VERSION=2, one database per collection) with exactly 13 object stores and
 * non-destructive upgrade from v1 (retaining snapshots and mutation_log).
 * Zero external dependencies.
 */

export const DB_NAME = "mix_sync_d137";
/** The legacy engine's database. D-137 only reads it during migration (HAA-19). */
export const LEGACY_DB_NAME = "mix_sync_db";

export function collectionDatabaseName(collectionId: string): string {
  return `${DB_NAME}:${collectionId}`;
}
export const DB_VERSION = 2;
export const LEGACY_DB_VERSION = 1;

export const STORE_NAMES = [
  "replica_meta",
  "entries_state",
  "mutation_journal",
  "sync_outbox",
  "inbound_gap_buffer",
  "inbound_dependency_buffer",
  "operation_digests",
  "snapshots",
  "quarantine_journal",
  "replay_state",
  "legacy_archive",
  "tab_leases",
  "cluster_acks",
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export const LEGACY_STORE_NAMES = ["snapshots", "mutation_log"] as const;
export type LegacyStoreName = (typeof LEGACY_STORE_NAMES)[number];

export interface IDBRequestLike<T = unknown> {
  result: T;
  error: Error | null;
  onsuccess: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface IDBObjectStoreLike {
  name: string;
  get(key: unknown): IDBRequestLike;
  put(value: unknown, key?: unknown): IDBRequestLike;
  delete(key: unknown): IDBRequestLike;
  getAll(): IDBRequestLike<unknown[]>;
  clear(): IDBRequestLike;
}

export interface IDBTransactionLike {
  objectStore(name: string): IDBObjectStoreLike;
  abort(): void;
  error: Error | null;
  oncomplete: ((ev: unknown) => void) | null;
  onabort: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface IDBDatabaseLike {
  close(): void;
  readonly name: string;
  readonly version: number;
  readonly objectStoreNames: {
    contains(name: string): boolean;
    readonly length: number;
    item(index: number): string | null;
    [Symbol.iterator]?(): IterableIterator<string>;
  };
  createObjectStore(name: string, options?: { keyPath?: string | string[]; autoIncrement?: boolean }): IDBObjectStoreLike;
  transaction(storeNames: string[], mode: "readonly" | "readwrite"): IDBTransactionLike;
}

export interface IDBOpenDBRequestLike extends IDBRequestLike<IDBDatabaseLike> {
  onupgradeneeded: ((ev: { oldVersion: number; newVersion: number | null }) => void) | null;
  onblocked: ((ev: unknown) => void) | null;
}

export interface IDBFactoryLike {
  open(name: string, version?: number): IDBOpenDBRequestLike;
  deleteDatabase?(name: string): IDBRequestLike<void>;
}

/**
 * Applies non-destructive schema upgrade from v1 (or initializes fresh v2).
 * Preserves legacy stores ('snapshots', 'mutation_log') intact.
 */
export function upgradeSchemaV2(db: IDBDatabaseLike, _oldVersion: number): void {
  // If upgrading from v1:
  // v1 stores were "snapshots" ({ keyPath: "key" }) and "mutation_log" ({ keyPath: "idStr" }).
  // They are retained as legacy stores.
  for (const name of STORE_NAMES) {
    if (!db.objectStoreNames.contains(name)) {
      db.createObjectStore(name);
    }
  }
}

/**
 * Converts an IDBRequest-like object to a Promise.
 */
export function reqToPromise<R>(req: IDBRequestLike<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Opens or upgrades a D-137 collection database to version 2.
 */
export async function openDatabase(
  name: string = DB_NAME,
  version: number = DB_VERSION,
  factory?: IDBFactoryLike
): Promise<IDBDatabaseLike> {
  const f = factory ?? (globalThis as unknown as { indexedDB?: IDBFactoryLike }).indexedDB;
  if (!f) {
    throw new Error("No IndexedDB factory available in current environment");
  }

  return new Promise((resolve, reject) => {
    const req = f.open(name, version);

    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVer = ev?.oldVersion ?? 0;
      upgradeSchemaV2(db, oldVer);
    };

    req.onsuccess = () => {
      resolve(req.result);
    };

    req.onerror = () => {
      reject(req.error ?? new Error("Failed to open IndexedDB"));
    };
  });
}

function safeClone<T>(itemToClone: T): T {
  try {
    return structuredClone(itemToClone);
  } catch {
    return JSON.parse(JSON.stringify(itemToClone)) as T;
  }
}

/**
 * Pure TypeScript mock IDB factory for zero-dependency unit tests in Node.js.
 */
export function createMockIDBFactory(): IDBFactoryLike {
  const dbs = new Map<string, { version: number; stores: Map<string, Map<unknown, unknown>> }>();

  return {
    open(name: string, version: number = 1): IDBOpenDBRequestLike {
      let state = dbs.get(name);
      const isNew = !state;
      const oldVersion = state ? state.version : 0;
      if (!state) {
        state = { version, stores: new Map() };
        dbs.set(name, state);
      } else {
        state.version = Math.max(state.version, version);
      }

      const storeNamesSet = state.stores;
      const simulatedDb: IDBDatabaseLike = {
        name,
        version: state.version,
        close() {},
        objectStoreNames: {
          contains(s: string) { return storeNamesSet.has(s); },
          get length() { return storeNamesSet.size; },
          item(index: number) { return Array.from(storeNamesSet.keys())[index] ?? null; },
          *[Symbol.iterator]() { yield* storeNamesSet.keys(); },
        },
        createObjectStore(storeName: string): IDBObjectStoreLike {
          if (!storeNamesSet.has(storeName)) {
            storeNamesSet.set(storeName, new Map());
          }
          const storeMap = storeNamesSet.get(storeName)!;
          return {
            name: storeName,
            get(entryKey: unknown) {
              const request: IDBRequestLike = { result: storeMap.get(entryKey), error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => request.onsuccess && request.onsuccess({}));
              return request;
            },
            put(entryValue: unknown, entryKey?: unknown) {
              storeMap.set(entryKey, safeClone(entryValue));
              const request: IDBRequestLike = { result: entryKey, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => request.onsuccess && request.onsuccess({}));
              return request;
            },
            delete(entryKey: unknown) {
              storeMap.delete(entryKey);
              const request: IDBRequestLike = { result: undefined, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => request.onsuccess && request.onsuccess({}));
              return request;
            },
            getAll() {
              const items = Array.from(storeMap.values()).map((storedItem) => safeClone(storedItem));
              const request: IDBRequestLike<unknown[]> = { result: items, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => request.onsuccess && request.onsuccess({}));
              return request;
            },
            clear() {
              storeMap.clear();
              const request: IDBRequestLike = { result: undefined, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => request.onsuccess && request.onsuccess({}));
              return request;
            },
          };
        },
        transaction(storeNames: string[], mode: "readonly" | "readwrite"): IDBTransactionLike {
          let aborted = false;
          let completed = false;
          let pending = 0;
          let timer: ReturnType<typeof setTimeout> | null = null;

          const scheduleCompletion = () => {
            if (completed || aborted) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              if (!aborted && !completed && pending === 0) {
                completed = true;
                if (tx.oncomplete) tx.oncomplete({});
              }
            }, 5);
          };

          const tx: IDBTransactionLike = {
            error: null,
            oncomplete: null,
            onabort: null,
            onerror: null,
            abort() {
              aborted = true;
              if (timer) clearTimeout(timer);
              if (tx.onabort) tx.onabort({});
            },
            objectStore(targetStoreName: string) {
              if (!storeNames.includes(targetStoreName)) {
                throw new Error(`Store ${targetStoreName} not in transaction scope`);
              }
              const storeMap = storeNamesSet.get(targetStoreName);
              if (!storeMap) throw new Error(`Unknown store ${targetStoreName}`);
              return {
                name: targetStoreName,
                get(entryKey: unknown) {
                  pending++;
                  const request: IDBRequestLike = { result: storeMap.get(entryKey), error: null, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    pending--;
                    if (request.onsuccess) request.onsuccess({});
                    scheduleCompletion();
                  });
                  return request;
                },
                put(entryValue: unknown, entryKey?: unknown) {
                  if (mode === "readonly") throw new Error("Cannot write in readonly mode");
                  pending++;
                  storeMap.set(entryKey, safeClone(entryValue));
                  const request: IDBRequestLike = { result: entryKey, error: null, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    pending--;
                    if (request.onsuccess) request.onsuccess({});
                    scheduleCompletion();
                  });
                  return request;
                },
                delete(entryKey: unknown) {
                  if (mode === "readonly") throw new Error("Cannot delete in readonly mode");
                  pending++;
                  storeMap.delete(entryKey);
                  const request: IDBRequestLike = { result: undefined, error: null, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    pending--;
                    if (request.onsuccess) request.onsuccess({});
                    scheduleCompletion();
                  });
                  return request;
                },
                getAll() {
                  pending++;
                  const items = Array.from(storeMap.values()).map((storedItem) => safeClone(storedItem));
                  const request: IDBRequestLike<unknown[]> = { result: items, error: null, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    pending--;
                    if (request.onsuccess) request.onsuccess({});
                    scheduleCompletion();
                  });
                  return request;
                },
                clear() {
                  if (mode === "readonly") throw new Error("Cannot clear in readonly mode");
                  pending++;
                  storeMap.clear();
                  const request: IDBRequestLike = { result: undefined, error: null, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    pending--;
                    if (request.onsuccess) request.onsuccess({});
                    scheduleCompletion();
                  });
                  return request;
                },
              };
            },
          };

          scheduleCompletion();
          return tx;
        },
      };

      const openReq: IDBOpenDBRequestLike = {
        result: simulatedDb,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        if (isNew || version > oldVersion) {
          if (openReq.onupgradeneeded) {
            openReq.onupgradeneeded({ oldVersion, newVersion: version });
          }
        }
        if (openReq.onsuccess) {
          openReq.onsuccess({});
        }
      });

      return openReq;
    },
  };
}
