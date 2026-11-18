# Mix Sync: v1 to v2 Migration Guide

## 1. Executive Summary & Migration Scope

With the adoption of the replicated state synchronization protocol, `@dotmix/sync` upgrades its underlying storage schema and replication primitives from v1 to v2:
- **v1 Schema:** Relied on `mix_sync_db` version 1 containing two loose object stores: `snapshots` (whole-array JSON blobs) and `mutation_log` (unauthenticated client-asserted mutations).
- **v2 Schema:** One IndexedDB database per collection, named `dotmix_sync:<collectionId>`, at version 2 with 13 specialized stores providing authenticated cryptographic signing, entry-level causal dots, field-level LWW registers, and transactional checkpointing.
- The legacy database `mix_sync_db` stays at version 1. The migration reads it read-only (`readLegacyCollection`) and never creates or upgrades it.

This guide outlines the architectural guarantees, multi-stage migration execution, rollback rehearsals, and finalization protocol for production systems.

---

## 2. Architectural Guarantees

The migration subsystem enforces four mandatory guarantees:

1. **Non-Destructive Preservation:** The replicated data lives in its own database, so the legacy stores (`snapshots` and `mutation_log` in `mix_sync_db`) are not changed by the migration. Only `finalizeMigration()` deletes legacy data.
2. **Zero Data Loss for Offline Mutations:** Pending offline mutations in `mutation_log` that have not yet been synchronized are extracted, transformed into an ordered replay plan, and applied to replicated registers with monotonic Lamport stamps.
3. **Idempotent Re-Execution:** If a browser closes, reloads, or crashes mid-migration, the migration runner resumes safely from the last recorded stage in `legacy_archive` without duplicate entry creation or corruption.
4. **Rehearsal & Rollback Safety:** Applications can be switched back to `engine: "legacy"` at any point before calling `finalizeMigration()`.

---

## 3. Migration Lifecycle & State Machine

The migration stage is stored in the `legacy_archive` store of the replicated database. The stage type has four values; `runV1Migration` writes `archive_written` and ends at `checkpoint_committed`, and only `finalizeMigration()` writes `finalized`:

```text
[v1 Database: snapshots & mutation_log]
                  |
                  v
       Stage 1: archive_written
  (Legacy snapshot and pending mutations captured in legacy_archive)
                  |
                  v
       Stage 2: entries_migrated
  (Active and deleted entries converted into causal incarnations)
                  |
                  v
    Stage 3: checkpoint_committed
  (Pending mutations replayed; first v2 snapshot committed with digest)
                  |
                  v
          Stage 4: finalized
  (finalizeMigration(): checkpoint verified; this collection's legacy records deleted)
```

### 3.1 Stage 1: Archive Snapshot Extraction
The migration runner extracts the latest snapshot entry for the collection from `snapshots` along with all pending mutation records from `mutation_log`. These records are stored in `legacy_archive` under the stage `archive_written`.

### 3.2 Stage 2: Entry Transformation & Tombstone Preservation
`entries_migrated` is defined in the stage type and accepted on resume, but the current runner does not write it; an interrupted run restarts from `archive_written`.

- **Active Entries:** Each entry is assigned an initial incarnation dot in epoch 1 under the migration replica identity and converted into field-level registers in `entries_state`. Fractional index keys are generated to preserve existing sort order.
- **Tombstones:** Deleted entries marked with `deleted: true` in v1 snapshots are migrated as explicit tombstone records with delete dots, preventing resurrection when old peer messages arrive.

### 3.3 Stage 3: Offline Mutation Replay & First Checkpoint
Pending offline mutations from `mutation_log` are executed in chronological sequence:
- Pending `insert` records allocate new incarnation records.
- Pending `update` records apply fresh field values with updated Lamport stamps.
- Pending `delete` records append delete dots.

Every migrated operation is signed with a new non-extractable ECDSA P-256 key under a self-signed founding certificate (`createMigrationSigningIdentity`). There are no placeholder signatures. The key is then stored in `replica_meta` under `signing-key:<collectionId>` as a `CryptoKey`; no key bytes are written.

Once replay is complete, `commitCheckpoint()` generates the first canonical v2 snapshot (`snapshotSeq = 1`), computes its SHA-256 digest, and stores it in `snapshots`. The stage becomes `checkpoint_committed`.

---

## 4. Rollback Rehearsal Protocol

Production operators and automated test suites verify rollback resilience prior to finalization:

```javascript
import { syncCollection } from "@dotmix/sync";

// Step 1: Open with modern replicated engine (performs non-destructive migration)
const modernCollection = syncCollection("customer_orders", {
  engine: "replicated",
  driver: "indexeddb"
});
await modernCollection.ready;

// Assert migrated data is present in modern collection
console.assert(modernCollection.items().length > 0, "Modern collection holds migrated data");
await modernCollection.close();

// Step 2: Rollback rehearsal - Reopen with legacy engine BEFORE finalizeMigration()
const legacyCollection = syncCollection("customer_orders", {
  engine: "legacy",
  driver: "indexeddb"
});

// Assert legacy engine successfully reads intact legacy snapshot
console.assert(legacyCollection.items().length > 0, "Legacy collection remains completely functional");
await legacyCollection.close();
```

---

## 5. Finalization (`finalizeMigration`)

```typescript
finalizeMigration(
  collectionId: string,
  options?: { store?: StoreBackend; legacyFactory?: IDBFactory }
): Promise<{ ok: boolean; code?: string; detail?: string }>
```

- `store` defaults to the IndexedDB database `dotmix_sync:<collectionId>`; `legacyFactory` defaults to `globalThis.indexedDB`.
- Stage `finalized`: returns `{ ok: true }` and does nothing.
- Any stage other than `checkpoint_committed`, or no store available: returns `{ ok: false, code: "SYNC_MIGRATION_FAILED" }`.
- Otherwise it verifies the checkpoint with `recoverFromStoreOnBoot` (snapshot digest and founding certificate signature), deletes this collection's records from the legacy database, and sets the stage to `finalized`.
- If verification fails, `recoverFromStoreOnBoot` throws `CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED`; the promise rejects and the legacy data is not deleted.

```typescript
import { finalizeMigration } from "@dotmix/sync";

const outcome = await finalizeMigration("customer_orders");
if (!outcome.ok) {
  console.error(outcome.code, outcome.detail);
}
```

---

## 6. Rollback Limits

- The legacy database `mix_sync_db` (version 1) and the replicated database `dotmix_sync:<collectionId>` are separate. The migration does not modify the legacy database.
- Until `finalizeMigration()` runs for a collection, `engine: "legacy"` still reads that collection's old data.
- `finalizeMigration()` deletes the collection's legacy records. After that, `engine: "legacy"` can no longer read the old data for that collection.
