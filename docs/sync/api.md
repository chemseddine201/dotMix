# Mix Sync Subsystem: API Reference

## 1. Overview & Engine Selection

The `@dotmix/sync` package exposes two primary reactive primitives for local-first state synchronization:
- `syncCollection<T>()`: Replicable, ordered, collaborative collection backed by CRDT registers and fractional indexing.
- `syncSignal<T>()`: Single collaborative reactive value backed by a Last-Write-Wins (LWW) register.

Both primitives run on the **replicated state engine** by default (`engine: "replicated"`), while retaining full compatibility with the legacy engine (`engine: "legacy"`) for phased migrations.

```typescript
import { syncCollection, syncSignal } from "@dotmix/sync";

// Primary collaborative collection
const tasksCollection = syncCollection<TaskItem>("project_tasks", {
  driver: "indexeddb",
  engine: "replicated",
  idField: "id"
});

// Single collaborative reactive signal
const themeSetting = syncSignal<string>("application_theme", "system", {
  driver: "indexeddb",
  engine: "replicated"
});
```

---

## 2. `syncCollection<T>`

### 2.1 Interface Definition
```typescript
interface SyncCollection<T> {
  // Reactive readers
  readonly items: () => readonly T[];
  readonly pendingCount: () => number;
  readonly status: () => SyncStatus; // "synced" | "offline" | "syncing" | "error"
  readonly errorCode?: () => string | undefined;
  readonly ready: Promise<void>;

  // Synchronous item retrieval
  getItem(itemIdentifier: string): T | undefined;

  // Mutations
  insert(itemPayload: T, targetIndex?: number): Promise<Mutation<T>>;
  update(itemIdentifier: string, partialFields: Partial<T>): Promise<Mutation<T>>;
  delete(itemIdentifier: string): Promise<Mutation<T>>;
  reorder(fromIndex: number, toIndex: number): Promise<Mutation<unknown>>;
  clear(): Promise<void>;

  // Rollback and lifecycle
  rollback(mutationIdString?: string): void;
  compact(): Promise<{ purgedTombstones: number; prunedLogEntries: number }>;
  close(): Promise<void>;
}
```

### 2.2 Configuration Options (`SyncCollectionOptions<T>`)
| Option | Type | Default | Description |
|---|---|---|---|
| `key` | `string` | `"default_collection"` | Unique collection storage and stream identifier. |
| `engine` | `"replicated" \| "legacy"` | `"replicated"` | Replication engine selector. Defaults to replicated engine. |
| `driver` | `"indexeddb" \| "memory" \| "opfs"` | `"indexeddb"` | Storage driver backend. OPFS is restricted to legacy engine in release 1. |
| `idField` | `keyof T \| ((item: T) => string)` | `"id"` | Property or resolver extracting the unique item identifier. |
| `initialItems` | `readonly T[]` | `[]` | Seed records materialized synchronously on initial uninitialized startup. |
| `syncEngine` | `SyncEngine` | Global Default | Custom or shared `SyncEngine` instance managing transports. |

### 2.3 Closing a Collection (`close()`)
`close(): Promise<void>` closes the connection of the storage driver behind the collection. Await it before another engine, a migration or `finalizeMigration()` opens the same database (`dotmix_sync:<collectionId>` for replicated engine, `mix_sync_db` for legacy); an open connection can block the other open or version upgrade.

### 2.4 `finalizeMigration()`
```typescript
function finalizeMigration(
  collectionId: string,
  options?: {
    store?: StoreBackend;       // default: IndexedDB database dotmix_sync:<collectionId>
    legacyFactory?: IDBFactory; // default: globalThis.indexedDB (holds mix_sync_db)
  }
): Promise<FinalizeMigrationResult>;

interface FinalizeMigrationResult {
  readonly ok: boolean;
  readonly code?: string;   // "SYNC_MIGRATION_FAILED" on failure
  readonly detail?: string;
}
```
Requires migration stage `checkpoint_committed` (already `finalized` returns `{ ok: true }`). Verifies the checkpoint with `recoverFromStoreOnBoot`, deletes this collection's legacy records, then sets stage `finalized`. A failed verification rejects the promise with `CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED` and deletes nothing. See [migration.md](./migration.md).

---

### 2.5 `errorCode()`

On `engine: "replicated"` collections, `errorCode(): string | undefined` returns the `SYNC_*` code behind an `"error"` status: for example `SYNC_OPFS_NOT_SUPPORTED`, `SYNC_MIGRATION_FAILED` or `SYNC_STORAGE_QUOTA_EXCEEDED`. The value is `undefined` when there is no error.

## 3. Behavior Changes & Architectural Deltas

The replicated engine introduces several critical behavioral differences compared to the legacy sync engine:

### 3.1 Deprecation of `compact()` as a Manual No-Op
- **Legacy Behavior:** `compact()` manually deleted tombstones from memory and truncated the local mutation log.
- **Replicated Engine Behavior:** In the replicated engine, history cannot be arbitrarily truncated by clients because cryptographic digest chains and causal validation require complete operation history. Compaction is automated and governed by **certified epoch checkpoints** and the cluster **stable frontier** (`compactionFrontier`).
- **API Contract:** Calling `collection.compact()` on the replicated engine is a safe, deprecated no-op that returns:
  ```json
  { "purgedTombstones": 0, "prunedLogEntries": 0 }
  ```

### 3.2 Fractional Indexing & Conflict-Free Reordering
- **Legacy Behavior:** Moving an item relied on integer `targetIndex` coordinates, causing index drifting and interleaving under concurrent reorders.
- **Replicated Engine Behavior:** Items are ordered by immutable string keys generated through fractional indexing (`generateKeyBetween`). Concurrent moves compute intermediate keys between neighboring elements. When two peers move items into identical positions concurrently, deterministic Lamport stamp ordering breaks ties cleanly without cyclic graphs.

### 3.3 Compensating Rollbacks
- **Legacy Behavior:** `rollback()` restored a pre-mutation whole-state snapshot, destructively overwriting concurrent remote mutations that arrived in the interim.
- **Replicated Engine Behavior:** Stored historical records are immutable and append-only. When `rollback(mutationId)` is invoked:
  1. The pending optimistic intent is removed from the local overlay.
  2. If the operation was already committed locally, the engine issues a **compensating mutation** that restores the prior field values under a fresh Lamport timestamp.
  3. History is never truncated, ensuring that remote peers converge identically regardless of local rollbacks.

### 3.4 Replicated Collection `clear()`
- **Legacy Behavior:** `clear()` was local-only and did not replicate across the network.
- **Replicated Engine Behavior:** Calling `clear()` scans all live entry incarnations in the collection and emits authenticated tombstone delete operations for each incarnation, replicating the clearance deterministically across the cluster.

### 3.5 Optimistic Local Overlay
- Mutations (`insert`, `update`, `delete`, `reorder`, `clear`) update the user interface **immediately** via an in-memory pending intent overlay (`overlayHost`).
- Durable storage persistence and network broadcast execute asynchronously, batched per microtask to minimize disk I/O and cryptographic signing overhead.
- If storage persistence fails (e.g., `QuotaExceededError`), the pending intent is preserved in backpressure mode rather than silently dropped.

---

## 4. `syncSignal<T>`

`syncSignal` provides collaborative synchronization for standalone values (e.g. document titles, application settings, toggles):

```typescript
interface SyncSignal<T> {
  // Reactive value getter
  (): T;
  // Explicit value reader
  get(): T;
  // Mutator
  set(nextValue: T): void;
  // Status readers
  readonly status: () => SyncStatus;
  readonly ready: Promise<void>;
  // Lifecycle
  close(): Promise<void>;
}
```

Values are encapsulated in an LWW register. Concurrent updates resolve by highest Lamport stamp, falling back to author replica identifier for deterministic tie-breaking.

---

## 5. Observability & Diagnostics

The replicated engine exposes comprehensive runtime telemetry without exposing sensitive user payload data:

### 5.1 Diagnostic Signals
Applications can observe diagnostic events through the engine's diagnostic controller:
```typescript
import { createDiagnosticsController } from "@dotmix/sync";

const diagnostics = activeEngine.diagnostics();
// Diagnostics signal emits structured event codes:
// "SYNC_EQUIVOCATION_DETECTED"
// "SYNC_GAP_BUFFER_OVERFLOW"
// "SYNC_FENCE_FAILED"
// "SYNC_PROTOCOL_VERSION_MISMATCH"
// "SYNC_MIGRATION_FAILED"
```

### 5.2 Quarantine Inspector API
Malformed, equivocating, or invalid operations are isolated in `quarantine_journal`:
```typescript
const quarantinedEntries = await activeEngine.inspectQuarantineJournal();
for (const entry of quarantinedEntries) {
  console.warn(`Quarantined op: ${entry.opKey}, reason: ${entry.rejectionCode}`);
}
```
Payload previews in diagnostics are strictly bounded (maximum 256 bytes) to protect user data privacy.

