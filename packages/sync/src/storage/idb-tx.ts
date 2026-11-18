/**
 * @dotmix/sync — IndexedDB Transactions, Scope Matrix & Fencing Invariants
 *
 * Implements Tx #1..#13 transaction scopes matching §5.2-SPEC-v3.3.2,
 * synchronous SHA-256 digest calculations (no WebCrypto microtask drift),
 * isolated post-commit execution (I21), AUD-D1..AUD-D4 fencing enforcement,
 * and S59/S91 boot recovery. Zero external dependencies.
 */

import {
  DB_NAME,
  openDatabase,
  reqToPromise,
  type IDBDatabaseLike,
  type IDBFactoryLike,
  type IDBRequestLike,
  type StoreName,
} from "./idb-schema.js";
import type { CrashInjectionHook, StorageTransaction, StoreBackend } from "./memory-backend.js";
import { sha256 } from "../protocol/sha256.js";

// §5.2 Transaction Scope Matrix (Tx #1..#13)
export const TX1_LOCAL_ALLOCATION_STORES = [
  "replica_meta",
  "entries_state",
  "mutation_journal",
  "sync_outbox",
  "operation_digests",
] as const;

export const TX2_REMOTE_DRAIN_STORES = [
  "replica_meta",
  "entries_state",
  "mutation_journal",
  "operation_digests",
  "inbound_gap_buffer",
  "quarantine_journal",
  "cluster_acks",
] as const;

export const TX3_TAB_LEASE_RENEWAL_STORES = [
  "replica_meta",
  "tab_leases",
] as const;

export const TX4_DURABLE_ACK_RECEIPT_STORES = [
  "replica_meta",
  "cluster_acks",
] as const;

export const TX5_SERVER_ACCEPTANCE_ACK_STORES = [
  "replica_meta",
  "sync_outbox",
] as const;

export const TX6_CHECKPOINT_COMMIT_STORES = [
  "replica_meta",
  "snapshots",
  "mutation_journal",
  "operation_digests",
] as const;

export const TX7_COMPACTION_STORES = [
  "replica_meta",
  "entries_state",
  "mutation_journal",
] as const;

export const TX8_EPOCH_TRANSITION_STORES = [
  "replica_meta",
  "snapshots",
  "entries_state",
  "mutation_journal",
  "sync_outbox",
  "inbound_gap_buffer",
  "inbound_dependency_buffer",
  "quarantine_journal",
  "replay_state",
] as const;

export const TX9_OFFLINE_QUARANTINE_STORES = [
  "replica_meta",
  "quarantine_journal",
  "replay_state",
] as const;

export const TX10_REPLAY_BATCH_STORES = [
  "replica_meta",
  "entries_state",
  "mutation_journal",
  "sync_outbox",
  "replay_state",
] as const;

export const TX11_LEGACY_MIGRATION_STORES = [
  "replica_meta",
  "entries_state",
  "mutation_journal",
  "legacy_archive",
] as const;

export const TX12_ANTI_ENTROPY_PULL_STORES = [
  "replica_meta",
  "inbound_gap_buffer",
  "mutation_journal",
  "entries_state",
  "operation_digests",
] as const;

export const TX13_EQUIVOCATION_EXCISION_STORES = [
  "replica_meta",
  "entries_state",
  "mutation_journal",
  "snapshots",
  "quarantine_journal",
] as const;

/**
 * Computes synchronous hex-encoded SHA-256 digest without WebCrypto async ticks.
 */
export function computeDigestSync(data: Uint8Array | string): string {
  const bytes = sha256(data);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      hex += b.toString(16).padStart(2, "0");
    }
  }
  return hex;
}

function safeClone<T>(itemToClone: T): T {
  try {
    return structuredClone(itemToClone);
  } catch {
    return JSON.parse(JSON.stringify(itemToClone)) as T;
  }
}

export class IndexedDbStoreBackend implements StoreBackend {
  readonly name = "indexeddb";
  readonly dbName: string;
  private db: IDBDatabaseLike | null = null;
  private crashHook?: CrashInjectionHook | undefined;
  private customFactory?: IDBFactoryLike | undefined;

  constructor(
    dbName: string = DB_NAME,
    factory?: IDBFactoryLike | undefined
  ) {
    this.dbName = dbName;
    this.customFactory = factory;
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await openDatabase(this.dbName, 2, this.customFactory);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
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
    if (!this.db) {
      await this.open();
    }

    return new Promise<T>((resolve, reject) => {
      const idbTx = this.db!.transaction(storeNames as string[], mode);
      let userError: unknown;
      let userResult: T;
      let completed = false;
      let fnResolved = false;
      const postCommitCallbacks: Array<() => void | Promise<void>> = [];

      const maybeFinish = () => {
        if (completed && fnResolved) {
          // Post-commit callbacks run strictly in oncomplete, isolated (I21)
          for (const postCommitCallback of postCommitCallbacks) {
            try {
              const operationResult = postCommitCallback();
              if (operationResult && typeof (operationResult as Promise<void>).catch === "function") {
                (operationResult as Promise<void>).catch((callbackAsyncError) => {
                  console.error("[IndexedDbStoreBackend] Isolated async post-commit callback error:", callbackAsyncError);
                });
              }
            } catch (callbackSyncError) {
              console.error("[IndexedDbStoreBackend] Isolated post-commit callback error:", callbackSyncError);
            }
          }
          resolve(userResult);
        }
      };

      idbTx.oncomplete = () => {
        completed = true;
        maybeFinish();
      };

      idbTx.onabort = () => {
        if (!completed) {
          reject(userError ?? idbTx.error ?? new Error("Transaction aborted"));
        }
      };

      idbTx.onerror = () => {
        if (!completed) {
          reject(userError ?? idbTx.error ?? new Error("Transaction error"));
        }
      };

      const tx: StorageTransaction = {
        mode,
        get: async <R>(store: StoreName, key: string | number): Promise<R | undefined> => {
          if (!storeNames.includes(store)) {
            throw new Error(`Store ${store} not included in transaction scope`);
          }
          const os = idbTx.objectStore(store);
          const recordValue = await reqToPromise<R>(os.get(key) as unknown as IDBRequestLike<R>);
          return recordValue !== undefined ? (safeClone(recordValue) as R) : undefined;
        },

        put: async <R>(store: StoreName, key: string | number, value: R): Promise<void> => {
          if (mode === "readonly") {
            throw new Error("Cannot write in readonly transaction");
          }
          if (!storeNames.includes(store)) {
            throw new Error(`Store ${store} not included in transaction scope`);
          }
          if (this.crashHook && this.crashHook(store, "put", key)) {
            idbTx.abort();
            throw new Error(`CRASH_INJECTED: aborting at put(${store}, ${key})`);
          }
          const os = idbTx.objectStore(store);
          await reqToPromise(os.put(safeClone(value), key));
        },

        delete: async (store: StoreName, key: string | number): Promise<void> => {
          if (mode === "readonly") {
            throw new Error("Cannot delete in readonly transaction");
          }
          if (!storeNames.includes(store)) {
            throw new Error(`Store ${store} not included in transaction scope`);
          }
          if (this.crashHook && this.crashHook(store, "delete", key)) {
            idbTx.abort();
            throw new Error(`CRASH_INJECTED: aborting at delete(${store}, ${key})`);
          }
          const os = idbTx.objectStore(store);
          await reqToPromise(os.delete(key));
        },

        getAll: async <R>(store: StoreName): Promise<R[]> => {
          if (!storeNames.includes(store)) {
            throw new Error(`Store ${store} not included in transaction scope`);
          }
          const os = idbTx.objectStore(store);
          const list = await reqToPromise<R[]>(os.getAll() as unknown as IDBRequestLike<R[]>);
          return list.map((item) => safeClone(item) as R);
        },

        clear: async (store: StoreName): Promise<void> => {
          if (mode === "readonly") {
            throw new Error("Cannot clear in readonly transaction");
          }
          if (!storeNames.includes(store)) {
            throw new Error(`Store ${store} not included in transaction scope`);
          }
          if (this.crashHook && this.crashHook(store, "clear", 0)) {
            idbTx.abort();
            throw new Error(`CRASH_INJECTED: aborting at clear(${store})`);
          }
          const os = idbTx.objectStore(store);
          await reqToPromise(os.clear());
        },

        abort(): void {
          idbTx.abort();
        },

        onCommit(postCommitCallback: () => void | Promise<void>): void {
          postCommitCallbacks.push(postCommitCallback);
        },
      };

      transactionOperation(tx)
        .then((operationResult) => {
          userResult = operationResult;
          fnResolved = true;
          maybeFinish();
        })
        .catch((executionError) => {
          userError = executionError;
          try {
            idbTx.abort();
          } catch {
            // Already aborted or inactive
          }
          reject(executionError);
        });
    });
  }
}

// Transaction Scope Helpers (Tx #1..#13)
export function runTx1LocalAllocation<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX1_LOCAL_ALLOCATION_STORES, "readwrite", transactionOperation);
}

export function runTx2RemoteDrain<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX2_REMOTE_DRAIN_STORES, "readwrite", transactionOperation);
}

export function runTx3TabLeaseRenewal<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX3_TAB_LEASE_RENEWAL_STORES, "readwrite", transactionOperation);
}

export function runTx4DurableAckReceipt<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX4_DURABLE_ACK_RECEIPT_STORES, "readwrite", transactionOperation);
}

export function runTx5ServerAcceptanceAck<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX5_SERVER_ACCEPTANCE_ACK_STORES, "readwrite", transactionOperation);
}

export function runTx6CheckpointCommit<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX6_CHECKPOINT_COMMIT_STORES, "readwrite", transactionOperation);
}

export function runTx7Compaction<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX7_COMPACTION_STORES, "readwrite", transactionOperation);
}

export function runTx8EpochTransition<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX8_EPOCH_TRANSITION_STORES, "readwrite", transactionOperation);
}

export function runTx9OfflineQuarantine<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX9_OFFLINE_QUARANTINE_STORES, "readwrite", transactionOperation);
}

export function runTx10ReplayBatch<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX10_REPLAY_BATCH_STORES, "readwrite", transactionOperation);
}

export function runTx11LegacyMigration<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX11_LEGACY_MIGRATION_STORES, "readwrite", transactionOperation);
}

export function runTx12AntiEntropyPull<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX12_ANTI_ENTROPY_PULL_STORES, "readwrite", transactionOperation);
}

export function runTx13EquivocationExcision<T>(backend: StoreBackend, transactionOperation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return backend.runTransaction(TX13_EQUIVOCATION_EXCISION_STORES, "readwrite", transactionOperation);
}

//: Fencing & Revalidation Enforcements (AUD-D1..AUD-D4)
export interface FencingContext {
  authorKeyId?: string;
  authorReplicaId?: string;
  expectedEpochNumber?: number;
  tabId?: string;
  leaseFencingTerm?: number;
}

export interface FencingValidationResult {
  ok: boolean;
  code?: "SYNC_KEY_REVOKED" | "SYNC_EPOCH_MISMATCH" | "SYNC_MEMBER_KEY_SUPERSEDED" | "SYNC_FENCE_FAILED";
  reason?: string;
}

export interface ReplicaMetaState {
  revokedKeyIds?: readonly string[];
  epochNumber?: number;
  epochMemberBindings?: Record<string, { authorKeyId?: string }>;
  leaseHolderTabId?: string;
  leaseFencingTerm?: number;
}

/**
 * Enforces AUD-D1..AUD-D4 invariants inside transaction scope before durable commit.
 */
export function revalidateFencingAndMembership(
  meta: ReplicaMetaState,
  context: FencingContext
): FencingValidationResult {
  // AUD-D1: Key revoked during verification
  if (context.authorKeyId && meta.revokedKeyIds && meta.revokedKeyIds.includes(context.authorKeyId)) {
    return {
      ok: false,
      code: "SYNC_KEY_REVOKED",
      reason: `Key ${context.authorKeyId} has been revoked`,
    };
  }

  // AUD-D2: Epoch transition during verification
  if (
    context.expectedEpochNumber !== undefined &&
    meta.epochNumber !== undefined &&
    meta.epochNumber !== context.expectedEpochNumber
  ) {
    return {
      ok: false,
      code: "SYNC_EPOCH_MISMATCH",
      reason: `Epoch moved from ${context.expectedEpochNumber} to ${meta.epochNumber}`,
    };
  }

  // AUD-D3: Author removed from membership or key rotated during verification
  if (context.authorReplicaId && meta.epochMemberBindings) {
    const binding = meta.epochMemberBindings[context.authorReplicaId];
    if (!binding || (context.authorKeyId && binding.authorKeyId !== context.authorKeyId)) {
      return {
        ok: false,
        code: "SYNC_MEMBER_KEY_SUPERSEDED",
        reason: `Key binding for member ${context.authorReplicaId} has been rotated or removed`,
      };
    }
  }

  // AUD-D4: Lease takeover during local signing
  if (context.tabId !== undefined) {
    if (
      meta.leaseHolderTabId !== undefined &&
      (meta.leaseHolderTabId !== context.tabId ||
        (context.leaseFencingTerm !== undefined && meta.leaseFencingTerm !== context.leaseFencingTerm))
    ) {
      return {
        ok: false,
        code: "SYNC_FENCE_FAILED",
        reason: `Tab lease taken over by tab ${meta.leaseHolderTabId} term ${meta.leaseFencingTerm}`,
      };
    }
  }

  return { ok: true };
}

//: Boot Recovery on IndexedDB (S59, S91)
export {
  type SnapshotRecordLike,
  type BootRecoveryResult,
  type BootRecoveryOptions,
  computeSnapshotDigestSync,
  persistEngineToStore,
  recoverFromStoreOnBoot,
} from "./boot-recovery.js";
