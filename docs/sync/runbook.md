# Mix Sync Operations Runbook & Maintenance Guide

## 1. Scope & Operator Responsibility

This runbook provides actionable procedures for Site Reliability Engineers (SREs), system operators, and cluster administrators managing `@dotmix/sync` production deployments. It covers routine cryptographic maintenance, emergency threat responses, browser storage degradation, store recovery, and the proposed retirement of the legacy synchronization engine.

---

## 2. Standard Operating Procedures (SOPs)

### SOP-01: Member Key Rotation
**Scenario:** Routine rotation of replica author signing keys or scheduled credential refreshes.
1. **Generate Replacement Key:** The target replica generates a fresh non-extractable signing key pair (ECDSA P-256 or Ed25519) in storage.
2. **Submit Re-Binding Request:** The replica transmits an authenticated `JOIN` enrollment request to the coordinator server containing:
   - Existing `replicaId`
   - New `authorKeyId` (e.g. `key:<replicaId>:v2`)
   - New `authorPublicKeyHex`
   - Signature produced by the *previous* key affirming the handover.
3. **Issue Transition Certificate:** The coordinator issues an epoch advance certificate incrementing `epochNumber` ($N \to N+1$), binding the new key to the replica, and recording the prior key in `revokedKeyIds`.
4. **Cluster Convergence:** All replicas ingest the transition certificate. Subsequent operations signed by the new key are accepted; operations referencing the revoked key are rejected.

---

### SOP-02: Member Eviction (Compromise or Decommissioning)
**Scenario:** A client device is reported stolen, an author private key is compromised, or a replica is decommissioned.
1. **Identify Target Replica:** Note the compromised `replicaId` and associated `authorKeyId`.
2. **Execute Coordinator Eviction:**
   - On the coordinator server, trigger the member eviction CLI command:
     ```bash
     node tools/d137-coordinator/admin.js evict-member \
       --collection="production_collection" \
       --replica="compromised_replica_id"
     ```
   - The coordinator removes the replica from `memberBindings`, appends its key identifier to `revokedKeyIds`, and records its latest durable sequence in `baselineStableFrontier`.
3. **Broadcast Epoch Advance:** The coordinator broadcasts the signed transition certificate to all active members.
4. **Verify Rejection:** Confirm via monitoring logs that subsequent operations from the evicted replica are rejected with `D137_AUTHOR_NOT_IN_EPOCH_MEMBERSHIP` or `D137_REVOKED_AUTHOR_KEY`.

---

### SOP-03: Epoch Advance
**Scenario:** Periodic compaction horizon advancement, membership changes, or post-quarantine resumption.
1. **Quiesce Active Frontier:** Collect durable ACKs from all connected writer replicas to establish the current stable frontier.
2. **Construct Epoch Certificate:**
   - Increment `epochNumber` ($N \to N+1$).
   - Set `baselineStableFrontier` to the current stable frontier.
   - Assemble `memberBindings` including only active authorized replicas.
   - Sign the certificate using the coordinator's authoritative private key.
3. **Distribute to Members:** Send the signed certificate to all member replicas via `CERT` wire envelopes. Replicas commit the certificate inside transactional scope `TX8_EPOCH_TRANSITION_STORES`.

---

### SOP-04: IndexedDB Quota Backpressure Response
**Scenario:** A client browser triggers a `DOMException: QuotaExceededError` due to local device storage limits.
1. **Verify Backpressure State:**
   - On a failed flush (for example `QuotaExceededError`) the adapter sets `isBackpressure = true`, status `"error"` and error code `D137_STORAGE_QUOTA_EXCEEDED` (spec §3.6, HAA-20). The next successful flush clears them.
   - Outgoing mutations are preserved in memory; no pending intents are dropped.
2. **Initiate Local Compaction:**
   - Trigger snapshot checkpointing to advance the compaction frontier:
     ```typescript
     await collectionAdapter.commitCheckpoint();
     ```
   - Prune obsolete historical operations from `mutation_journal` below `compactionFrontier`.
3. **Clear Non-Essential Storage:**
   - Purge `quarantine_journal` of old rejected entries.
   - Legacy v1 data is removed per collection by `finalizeMigration()`; do not delete `mix_sync_db` by hand while any collection is not finalized.
4. **Resume Storage Commits:**
   - Verify available storage quota via `navigator.storage.estimate()`.
   - The adapter clears `isBackpressure` and flushes staged in-memory intents to IndexedDB.

---

### SOP-05: Corrupt-Store Recovery
**Scenario:** An unclean browser shutdown, power failure, or disk error results in local store corruption (`CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED`).

#### Automated Two-Snapshot Fallback
1. During boot initialization (`recoverFromStoreOnBoot`), the engine verifies the canonical SHA-256 digest of snapshot $N$.
2. If snapshot $N$ fails digest validation, the engine automatically falls back to snapshot $N-1$.
3. Operations in `mutation_journal` with sequences higher than snapshot $N-1$ are replayed into memory.
4. If recovery succeeds, the repaired state is saved as a fresh valid snapshot.

#### Manual Emergency Reset (Coordinator Cold Resync)
If both snapshot $N$ and $N-1$ are corrupt:
1. Delete the collection's local IndexedDB database `mix_sync_d137:<collectionId>`. Do not delete `mix_sync_db`; it holds legacy data for collections not yet finalized.
2. Reopen the application. The engine initializes a fresh database with a clean founding certificate.
3. The client connects to the coordinator and initiates an anti-entropy stream range pull (`StreamRangeRequest`) to reconstruct complete collection state from certified cluster history.

---

## 3. Proposal: Legacy Engine Removal Plan

> [!NOTE]
> This proposal is submitted for formal review and separate ratification by the Human Architecture Authority (HAA) following the acceptance of Gate 35.

### 3.1 Background & Rationale
`@dotmix/sync` currently maintains dual synchronization engines:
- **`d137`:** The production-hardened CRDT engine with cryptographic identity, field-level registers, Lamport causal ordering, and transactional IndexedDB persistence.
- **`legacy`:** The original prototype engine based on whole-array LWW snapshots (`ReplicableArray`), unauthenticated mutation logs, and basic localStorage mirrors.

Maintaining the legacy engine incurs ongoing technical overhead, complicates browser storage schemas, and risks accidental developer usage of unauthenticated synchronization.

### 3.2 Phased Removal Roadmap

```text
Phase A (Post Gate 35)      Phase B (Gate 36/37)       Phase C (Next Minor)       Phase D (Final Cleanup)
+--------------------+      +--------------------+     +--------------------+     +--------------------+
| Telemetry & Audit  | ---> | Deprecation Warning| --> | Code Excision      | --> | Schema Pruning     |
| Confirm 100% d137  |      | Lock Default d137  |     | Remove Array CRDT  |     | Drop v1 IDB Stores |
+--------------------+      +--------------------+     +--------------------+     +--------------------+
```

#### Phase A: Telemetry & Production Verification
- **Duration:** 14 calendar days post Gate 35.
- **Objective:** Verify via client telemetry that zero production instances rely on `engine: "legacy"`.
- **Action:** Add telemetry ping reporting active engine selection. Monitor showcase applications (`showcase/src/pages/SyncPage.mix`) to confirm 100% convergence on `d137`.

#### Phase B: Formal Deprecation & Default Lock
- **Objective:** Mark the legacy engine as deprecated in public TypeScript contracts.
- **Action:**
  - Update `SyncCollectionOptions`: annotate `engine?: "d137" | "legacy"` with `@deprecated Use 'd137'. Legacy engine will be removed in next minor release.`
  - Emitting a console warning when `engine: "legacy"` is explicitly configured.
  - Reject `engine: "legacy"` in new project scaffolding (`packages/cli/templates`).

#### Phase C: Core Code Excision
- **Objective:** Eliminate legacy CRDT classes and unused storage drivers.
- **Action:**
  - Remove `packages/sync/src/crdt/array.ts` and `packages/sync/src/crdt/lww.ts`.
  - Remove legacy `IndexedDbDriver` in `packages/sync/src/storage/indexeddb.ts` (replaced by `IndexedDbStoreBackend`).
  - Retire legacy-specific tests (`tests/crdt-resurrection-safety.test.mjs`, `tests/showcase-burst-ids.test.mjs`).

#### Phase D: Database Schema Finalization
- **Objective:** Remove legacy storage compatibility code.
- **Action:**
  - Confirm every collection reached migration stage `finalized`, then delete the legacy database `mix_sync_db` (version 1). D-137 databases (`mix_sync_d137:<collectionId>`) never contain legacy stores.
  - Archive `packages/sync/src/migration/` into a standalone migration utility package or retired tools folder.

### 3.3 HAA Decision Criteria
Approval to proceed with Phase C and D requires:
1. Zero regressions in the root test suite and golden path.
2. 100% passing results across Chromium, Edge, and Firefox browser matrix scenarios.
3. Explicit written authorization from the Human Architecture Authority naming the legacy removal gate.

