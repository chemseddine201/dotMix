/**
 * @mix/sync — Local-First Offline-First Reactive CRDT State Types
 */

export interface MutationId {
  readonly timestamp: number;
  readonly clientId: string;
  readonly sequence: number;
}

export type MutationOp = "set" | "insert" | "update" | "delete" | "move";

export interface Mutation<T = unknown> {
  readonly id: MutationId;
  readonly idStr: string;
  readonly storeKey: string;
  readonly op: MutationOp;
  readonly payload: T;
  readonly previousState?: unknown;
  state: "pending" | "committed" | "rejected";
  readonly createdAt: number;
}

export type SyncStatus = "synced" | "syncing" | "offline" | "error";

export interface SyncDriver {
  readonly name: string;
  init(): Promise<void>;
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  appendMutation(mutation: Mutation<unknown>): Promise<void>;
  getPendingMutations(storeKey?: string): Promise<Mutation<unknown>[]>;
  markMutationsCommitted(mutationIdStrs: string[]): Promise<void>;
  markMutationRejected(mutationIdStr: string): Promise<void>;
  clear(): Promise<void>;
}

export interface SyncSignalOptions<T> {
  readonly key: string;
  readonly driver?: SyncDriver | "memory" | "indexeddb" | "opfs";
  readonly conflictStrategy?: "lww" | ((local: T, remote: T) => T);
  readonly syncEngine?: unknown; // SyncEngine instance
}

export interface SyncSignal<T> {
  (): T;
  set(newValue: T | ((prev: T) => T)): void;
  readonly status: () => SyncStatus;
  readonly isPending: () => boolean;
  readonly pendingCount: () => number;
  rollback(): void;
  commit(): void;
}

export interface SyncCollectionOptions<T> {
  readonly key: string;
  readonly idField?: keyof T | ((item: T) => string);
  readonly driver?: SyncDriver | "memory" | "indexeddb" | "opfs";
  readonly syncEngine?: unknown; // SyncEngine instance
  readonly initialItems?: readonly T[];
}

export interface SyncCollection<T> {
  readonly items: () => T[];
  readonly status: () => SyncStatus;
  readonly isPending: () => boolean;
  readonly pendingCount: () => number;
  insert(item: T, targetIndex?: number): Promise<Mutation<T>>;
  update(id: string, partial: Partial<T>): Promise<Mutation<Partial<T>>>;
  delete(id: string): Promise<Mutation<string>>;
  reorder(fromIndex: number, toIndex: number): Promise<Mutation<unknown>>;
  rollback(mutationIdStr?: string): void;
  clear(): Promise<void>;
}

export interface SyncPacket {
  readonly clientId: string;
  readonly mutations: Mutation<unknown>[];
  readonly acks?: string[];
  readonly rejections?: { idStr: string; reason: string }[];
}

export interface SyncChannel {
  send(packet: SyncPacket): Promise<void>;
  onReceive(handler: (packet: SyncPacket) => void | Promise<void>): () => void;
  close(): void;
}
