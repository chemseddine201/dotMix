/**
 * D137-v33-reference: Storage Backend Types & 13 Object Stores (I22, D-143)
 */

import type {
  EntryStateRecord,
  InboundDependencyBufferRecord,
  InboundGapBufferRecord,
  MutationJournalRecord,
  OperationDigestRecord,
  QuarantineRecord,
  ReplicaMetaRecord,
  SnapshotRecord,
  SyncOutboxRecord,
  TabLeaseRecord,
} from "../types.js";

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
}

export interface PersistedEngineState {
  meta?: ReplicaMetaRecord;
  entries: EntryStateRecord[];
  snapshots: SnapshotRecord[];
  journal: MutationJournalRecord[];
  outbox: SyncOutboxRecord[];
  operationDigests: OperationDigestRecord[];
  gapBuffer: InboundGapBufferRecord[];
  dependencyBuffer: InboundDependencyBufferRecord[];
  quarantine: QuarantineRecord[];
  tabLeases: TabLeaseRecord[];
  clusterAcks: Record<string, Record<string, number>>;
  replayState?: Record<string, unknown>;
  legacyArchive?: Record<string, unknown>;
}

export interface StoreBackend {
  readonly name: string;
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;
  runTransaction<T>(
    stores: readonly StoreName[],
    mode: "readonly" | "readwrite",
    fn: (tx: StorageTransaction) => Promise<T>
  ): Promise<T>;
  setCrashInjectionHook(hook?: CrashInjectionHook): void;
  clearCrashInjectionHook(): void;
}
