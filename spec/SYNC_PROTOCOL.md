<!-- Canonical protocol specification. Audit kit: reports/SYNC_V3_3_2_AUDIT_KIT/. -->
# dotMix Replicated State Synchronization Protocol Specification

**Standard Identifier:** replicated.v3.3.2  
**Authority:** Human Architecture Authority (HAA)  
**Governing Ratified Decisions:** Replicated State Protocol Architecture, D-139 (Option A), D-140, D-141, D-142, D-143, D-144, D-150, D-157  
**Status:** CANONICAL REFERENCE SPECIFICATION (Consolidated from v3.3, v3.3.1, and v3.3.2 Amendments)  
**Target Architecture:** dotMix / Tix Offline-First Replicated State Protocol

---

## 1. Scope, System Identity & Normative Precedence

1. **RFC 2119 Compliance:** Every requirement in this specification SHALL use RFC 2119 keywords (`MUST`, `MUST NOT`, `REQUIRED`, `SHALL`, `SHALL NOT`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `MAY`, `OPTIONAL`).
2. **Consolidation Authority:** This document supersedes all prior drafts (v3.1, v3.2, v3.3, v3.3.1) and integrates all ratified amendments into one normative contract. No external amendment chains exist.
3. **Core Philosophy:** dotMix Replicated State Synchronization is a compiler-native, zero-runtime-dependency synchronization protocol delivering causal consistency, deterministic conflict-free replication (CRDT), and cryptographically verified state convergence across untrusted transports and distributed browser clients.

---

## 2. Core Protocol Invariants

### I1: Pure CRDT Convergence
- Materialized state across replicas observing the same causal history in any delivery order MUST converge to identical canonical state digests (`entriesDigest` and `visibleDigest`).

### I2: Candidate Mutation Atomicity (F-12)
- Applying local or remote mutations to `entriesState` MUST be strictly atomic. Mutating in-place is forbidden.
- Mutations MUST be executed on an isolated candidate copy. If any constraint (e.g. entry size $\le 65,536$ bytes) fails, candidate state is discarded with zero side-effects on live state.

### I3: Stamp-to-Dot Binding & Lamport Merge (F-10)
- Every operation's Lamport stamp (`stamp`) MUST cryptographically match its identity dot (`opDot`): `stamp.{epochNumber, replicaId, sequence} === opDot.{epochNumber, replicaId, sequence}`.
- Lamport advance between consecutive ops on a stream MUST be monotonic and capped at $100,000$.
- Durable ingestion merges the Lamport clock: `meta.localLamport = Math.max(meta.localLamport, op.stamp.lamport)`. Local allocation increments `meta.localLamport + 1`.
- LWW register tie-breaks use canonical total order (`compareLamportStamps`: lamport $\to$ epoch $\to$ replicaId $\to$ sequence). Arrival order has no influence.

### I4: Contiguous Ingestion & Frontier Monotonicity
- Remote operations on stream $s$ MUST be ingested in strict sequential order (`sequence = localDurableFrontier[s] + 1`). Out-of-order operations MUST be staged in `inboundGapBuffer`.

### I5: Commit-Time Security Revalidation (F-05)
- Operations are pre-verified asynchronously against current security state.
- Inside the synchronous commit section, the engine MUST re-verify `securityStateVersion`. On version mismatch (e.g. key revocation or epoch transition during async verify), verification is re-evaluated. If invalid, the op is rejected with `SYNC_SECURITY_STATE_CHANGED`.

### I6: Cryptographic Authenticity & Member Attestation
- Every operation, epoch certificate, and durable ACK MUST carry an Ed25519 (or ECDSA P-256) signature verified against author bindings in `meta.epochMemberBindings`.

### I7: Authenticated Anti-Entropy Range Pull (D-144)
- Missing gaps or stalled causal dependencies exceeding `RANGE_PULL_TIMEOUT_MS` (2,000ms) trigger `StreamRangeRequest`.
- Responses (`StreamRangeResponse`) are capped at 250 ops and rate-limited to 10 requests per 10-second window.
- Ingestion verifies author signatures and rolling digest chain continuity op-by-op. Corrupted responses are rejected with `SYNC_RANGE_RESPONSE_INVALID`.

### I8: State Failure Stream Blocking & Eviction (S80)
- A state failure on stream $s$ transitions the stream to `BLOCKING_UNRESOLVED_STREAM_POSITION`, evicting buffered successors as `EVICTED_STREAM_BLOCKED_SUCCESSOR`.

### I9: Rolling Digest Verification & Durable ACKs (S93)
- Each operation updates a rolling SHA-256 digest: `H_n = sha256(H_{n-1} + ":" + payloadDigest)`.
- Replicas exchange signed `DurableAckMessage` records. ACKs with rolling digest mismatches at or below local durable frontier are rejected with `SYNC_ACK_DIGEST_MISMATCH`.
- Valid ACKs advance `meta.frontiers.stableFrontier` as the min acknowledged sequence across all writer replicas.

### I10: Certified Baseline Excision Floor (D-139 Option A)
- Excision floors are defined strictly by `meta.epochCertificate.baselineStableFrontier` and are immutable within an epoch.
- Compaction horizon is bounded: `compactionFrontier[s] <= min(floor[s], baselineSnapshot.includedFrontier[s])`.

### I11: Certified Baseline Snapshot Retention
- Replicas preserve a baseline snapshot committed at or below the floor alongside operational snapshots $N$ and $N-1$. Journal operations $\le$ floor are retained as required for baseline rebuild.

### I12: Idempotent Rebuild Equivalence (F-04)
- `rebuildEntriesState(baselineSnapshot, journal) === incrementalApplication`. Rebuild applies ops via pure CRDT merge without direct overwrite.

### I13: Late-Op Pruned-Horizon Rejection (S81)
- Ops arriving below `max(digestPrunedFrontier, localDurableFrontier)` with no digest record are rejected as `SYNC_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON`.

### I14: Single Excision Invariant & Evidence Bounds (F-20)
- At most one state excision and rollback occurs per stream per epoch. Subsequent conflicts update evidence in `meta.activeEpochEquivocations` without re-excising.
- Conflicting payload digests per dot are capped at 8 (lexicographically smallest). Historical audit records are capped at 256.

### I15: Strict Wire Limits & Canonical JSON
- Operation payloads are capped at 64 KiB. JSON must omit undefined properties and reject non-finite numbers.

### I16: Authenticated Lifecycle State Machine
- Lifecycle transitions (`UNINITIALIZED` $\to$ `COORDINATOR_ACCEPTANCE_PENDING` $\to$ `ACTIVE`) must verify coordinator signatures before mutation. Non-active writes are rejected with `SYNC_LIFECYCLE_NOT_ACTIVE`. Staged states resume cleanly on boot.

### I17: Fail-Closed JOIN Identity (D-141)
- JOIN adopts coordinator-assigned `replicaId`, verifies bound public key matches local key, and starts a fresh stream in the joined epoch at seq 1.
- JOIN fails closed with `SYNC_JOIN_IDENTITY_INVALID` if joiner public key is unknown, if snapshot frontiers already contain entries for the target stream, or if omitted assignedReplicaId is ambiguous.
- Pre-join local state is exported to the cluster exclusively through per-externalId replay planning.

### I18: Chunked Clear Operations
- Bulk clear operations must not exceed 2,000 target entries per chunk. Excess targets are chunked or rejected.

### I19: Local-Only Legacy Migration (D-142)
- Legacy v1 migration operations are local-only and never placed in `syncOutbox`. Migrated state reaches peers exclusively via SEED/JOIN export. Order and pending mutations are preserved.

### I20: Dynamic Multi-Tab Lease Fencing
- Multi-tab access enforces leadership leases. Stale writers losing lease fencing are rejected from commit.

### I21: Memory & Buffer Bounding
- Inbound gap buffer and dependency buffer are capped at 1,000 ops and 16 MiB each. Excess ops are rejected with `SYNC_GAP_BUFFER_OVERFLOW` / `SYNC_DEPENDENCY_BUFFER_OVERFLOW`.

### I22: 13-Store IndexedDB Schema (D-143)
- Durable storage is organized into exactly 13 object stores: `replica_meta`, `entries_state`, `mutation_journal`, `sync_outbox`, `inbound_gap_buffer`, `inbound_dependency_buffer`, `operation_digests`, `snapshots`, `quarantine_journal`, `replay_state`, `legacy_archive`, `tab_leases`, `cluster_acks`.
- Transactions execute within a single IndexedDB transaction without non-IDB awaits.

### I23: Two-Snapshot Boot Recovery with Fallback (S59, S91)
- Boot verifies snapshot $N$. If corrupted, falls back to $N-1$ and replays journal. If both snapshots fail or an unbridgeable journal gap exists, boot fails closed with `CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED`.

### I24: Epoch Close Suffix Pruning & Replay Re-Issue (D-157)
- Ingesting an epoch-transition certificate clamps frontiers to the closing floor and discards operations above the floor.
- Transition certificates are **non-cumulative** (Gate 32, G32-1): a certificate lists the closing floors of the epoch it closes only. Floors of earlier, already-closed epochs are final and are not repeated; floor monotonicity is checked only for streams the new certificate lists.
- Local discarded intent is re-issued as fresh operations in the new epoch via a per-externalId replay plan.
- Operations above the closing floor are rejected with `SYNC_EPOCH_CLOSED`. Revoked keys in `cert.revokedKeyIds` are adopted into `meta.revokedKeyIds`.

---

## 3. Threat Model & Security Analysis

### 3.1 Authorized Byzantine Writer
- **Threat:** An authorized member with valid signing keys attempts equivocation (forking multiple distinct operations with the same causal dot), forging Lamport stamp ties, fabricating missing causal dependencies, or issuing oversized payloads.
- **Mitigation:**
  - *Equivocation Detection:* Rolling digest tracking and digest store detect conflicting payloads at the same dot. First conflict triggers excision down to certified floor and stream quarantine; subsequent conflicts record deterministic evidence (lexicographical min 8 digests).
  - *Stamp Forgery:* `op.stamp` is strictly bound to `op.opDot`. Lamport advances are verified against local history and bounded to $100,000$.
  - *Dependency Stall:* Foreign-epoch or non-member dependencies are rejected immediately. Unresolvable dependencies trigger anti-entropy range pulls; state failures block the stream (S80).
  - *Payload DoS:* Strict size bounds ($64\text{ KiB}$ payload, $512\text{ B}$ index key, $2,000$ clear targets) enforced at pre-verification.

### 3.2 Malicious Network Relay
- **Threat:** An untrusted transport relay injects, reorders, drops, or duplicates valid wire messages.
- **Mitigation:**
  - *Tampering:* All operations and ACKs carry cryptographic signatures over canonical representations. Any modification fails signature validation.
  - *Reordering / Dropping:* Gap buffer stages out-of-order arrivals. Anti-entropy pull resolves stalled streams after 2,000ms.
  - *Duplicate Delivery:* Ingestion checks `localDurableFrontier` and `operationDigests`, idempotently returning `IDEMPOTENT_DUPLICATE` without re-applying.

### 3.3 Replay Attacks
- **Threat:** An attacker re-broadcasts previously valid operations from past epochs or pruned streams.
- **Mitigation:**
  - *Epoch Gating:* Operations from closed epochs above certified closing floor are rejected with `SYNC_EPOCH_CLOSED`.
  - *Pruned Horizon Rejection (S81):* Operations arriving below `max(digestPrunedFrontier, localDurableFrontier)` with no digest record are rejected as `SYNC_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON`.

### 3.4 Key Compromise & Revocation
- **Threat:** A compromised member private key continues signing operations.
- **Mitigation:**
  - The coordinator issues an authenticated epoch transition certificate containing the compromised key in `revokedKeyIds` and closing the stream at `closingFloor`.
  - Replicas adopt `revokedKeyIds`, bump `securityStateVersion`, and reject any subsequent operations signed by the revoked key. Pre-verification revalidation prevents race conditions.

### 3.5 Protocol-Version Downgrade
- **Threat:** A peer attempts to negotiate a legacy or insecure protocol version.
- **Mitigation:**
  - Every message carries `protocolVersion`. Ingestion strictly enforces matching `replicated.v3.3` (or current version). Mismatched versions fail closed immediately.

### 3.6 Buffer Exhaustion & Denial of Service
- **Threat:** An attacker floods a replica with out-of-order operations or anti-entropy pull requests to exhaust memory.
- **Mitigation:**
  - Gap and dependency buffers enforce hard limits: $1,000$ ops and $16\text{ MiB}$ per collection. Excess ops are rejected (`SYNC_GAP_BUFFER_OVERFLOW`).
  - Anti-entropy requests are rate-limited to 10 per 10-second window per peer.
  - Storage soft limits engage `READ_ONLY_COMPACTION_BACKPRESSURE`.
  - A durable write rejected by the host storage quota (`QuotaExceededError`) aborts the whole transaction and reports `SYNC_STORAGE_QUOTA_EXCEEDED` (HAA-20). The collection enters a storage-backpressure state, keeps every pending intent, and leaves it on the next successful durable write. This state is separate from compaction backpressure: it does not change the engine lifecycle state.

---

## 4. Comprehensive Traceability Matrix

| Invariant / Procedure | Normative Clause | Module & Function | Test Suite & Test IDs |
|---|---|---|---|
| I1: CRDT Convergence | §2 (I1) | `crdt.ts` / `materializeVisibleArray` | `tests/audit/convergence.test.ts` (AUD-CONV-1..5), `tests/convergence.test.ts` |
| I2: Atomic Entry Apply | §2 (I2) | `operations.ts` / `applyOperationToState` | `tests/audit/adversarial.test.ts` (AUD-B1..B3), `tests/epoch-close.test.ts` |
| I3: Stamp Binding & Lamport Merge | §2 (I3) | `crdt.ts` / `compareLamportStamps`, `engine.ts` | `tests/audit/adversarial.test.ts` (AUD-A3, AUD-A4, AUD-A6) |
| I4: Contiguous Ingestion | §2 (I4) | `dependency.ts` / `drainContiguousStreamOps` | `tests/audit/adversarial.test.ts` (AUD-C1, AUD-C3) |
| I5: Commit-Time Revalidation | §2 (I5) | `crypto.ts` / `preverifyRemoteOperation`, `engine.ts` | `tests/activation-security.test.ts` (Security State tests 2, 3) |
| I6: Cryptographic Verification | §2 (I6) | `crypto.ts` / `verifySignatureAsync` | `tests/audit/adversarial.test.ts` (AUD-S1, AUD-J4) |
| I7: Anti-Entropy Range Pull | §2 (I7) | `antientropy.ts` / `ingestStreamRangeResponse` | `tests/antientropy.test.ts` (Tests 1, 2, 3) |
| I8: S80 Stream Blocking | §2 (I8) | `dependency.ts` / `recordQuarantinedStateFailure` | `tests/ingestion-invariants.test.ts` (S80), `tests/audit/adversarial.test.ts` (AUD-J5) |
| I9: S93 Rolling Digest & ACKs | §2 (I9) | `acks.ts` / `ingestDurableAck`, `frontiers.ts` | `tests/persistence-boot.test.ts` (S93), `tests/audit/adversarial.test.ts` (AUD-J6) |
| I10: D-139 Excision Floor | §2 (I10) | `snapshots.ts` / `commitCheckpoint`, `frontiers.ts` | `tests/defect-closure.test.ts` (Tests 1, 2), `tests/audit/adversarial.test.ts` (AUD-A1) |
| I11: Baseline Snapshot Retention | §2 (I11) | `snapshots.ts` / `commitBaselineSnapshot` | `tests/baseline-snapshot.test.ts`, `tests/audit/adversarial.test.ts` (AUD-A5) |
| I12: Idempotent Rebuild | §2 (I12) | `equivocation.ts` / `rebuildEntriesState` | `tests/rebuild-equivalence.test.ts` (200 seeds), `tests/audit/adversarial.test.ts` (AUD-A2) |
| I13: S81 Late-Op Rejection | §2 (I13) | `dependency.ts` / `ingestRemoteOperationInternal` | `tests/ingestion-invariants.test.ts` (S81) |
| I14: Evidence Bounding | §2 (I14) | `equivocation.ts` / `exciseStreamSuffix` | `tests/audit/adversarial.test.ts` (AUD-E2), `tests/audit/concurrency-probe.mjs` |
| I15: Wire Limits & Canonical JSON | §2 (I15) | `canonicalization.ts`, `storage-bounds.ts` | `tests/audit/adversarial.test.ts` (AUD-C6, AUD-C9) |
| I16: Lifecycle State Machine | §2 (I16) | `lifecycle.ts` / `seedNewRemoteEpoch`, `resumeActivation` | `tests/activation-security.test.ts` (Lifecycle tests 4, 5) |
| I17: D-141 Fail-Closed JOIN | §2 (I17) | `lifecycle.ts` / `joinExistingRemoteCluster`, `replay.ts` | `tests/activation-security.test.ts` (JOIN tests 6..10), `tests/audit/adversarial.test.ts` (AUD-J1..J4) |
| I18: Chunked Clear Limit | §2 (I18) | `storage-bounds.ts` / `validateClearChunkLimit` | `tests/audit/adversarial.test.ts` (AUD-C7) |
| I19: D-142 Legacy Migration | §2 (I19) | `migration.ts` / `migrateLegacyV1Store` | `tests/migration-local.test.ts` (Tests 1..4, AUD-M2-LOCAL) |
| I20: Multi-Tab Lease Fencing | §2 (I20) | `leases.ts` / `acquireTabLease`, `renewTabLease` | `tests/audit/adversarial.test.ts` (AUD-D4) |
| I21: Buffer Capacity Limits | §2 (I21) | `storage-bounds.ts` / `checkBufferCapacity` | `tests/ingestion-invariants.test.ts` (S94) |
| I22: 13-Store IDB Schema | §2 (I22) | `backend/idb.ts`, `backend/memory.ts` | `tests/persistence-boot.test.ts` (IDB Persistence & Crash Injection) |
| I23: S59/S91 Boot Recovery | §2 (I23) | `boot.ts` / `recoverFromStoreOnBoot` | `tests/persistence-boot.test.ts` (S59 Fallback, S91 Fail-Closed) |
| I24: D-157 Epoch Close Suffix | §2 (I24) | `certificates.ts` / `ingestEpochTransitionCertificate` | `tests/epoch-close.test.ts` (Tests 1..7) |

---

## 5. Storage Schema & Transaction Scopes (I22)

### 5.1 The 13 Declared Object Stores
1. `replica_meta`: Local replica metadata, epoch identity, security version, Lamport clock, frontiers, and cluster ACK matrix.
2. `entries_state`: Materialized CRDT incarnation entries (`targetBirthDot`, `fields`, `pos`, `deleteDots`).
3. `mutation_journal`: Write-ahead log of accepted operations awaiting checkpoint truncation.
4. `sync_outbox`: Local operations awaiting server acceptance or peer synchronization.
5. `inbound_gap_buffer`: Staged remote operations awaiting contiguous stream predecessors.
6. `inbound_dependency_buffer`: Staged operations awaiting missing causal dependencies.
7. `operation_digests`: Deduplication, status tracking, and conflict evidence records.
8. `snapshots`: Certified checkpoints and baseline snapshots with canonical digests.
9. `quarantine_journal`: Quarantined conflicting operations and rejected state-failure records.
10. `replay_state`: Active export replay plans and offline transition cursors.
11. `legacy_archive`: Raw legacy storage archives preserved during v1-to-v2 migration.
12. `tab_leases`: Multi-tab leadership leases and heartbeat records.
13. `cluster_acks`: Received peer durable ACK vectors and rolling digest confirmations.

### 5.2 Transaction Scope Matrix (Tx #1..#13)
- **Tx #1 (Local Allocation):** `replica_meta`, `entries_state`, `mutation_journal`, `sync_outbox`, `operation_digests`.
- **Tx #2 (Contiguous Remote Drain):** `replica_meta`, `entries_state`, `mutation_journal`, `operation_digests`, `inbound_gap_buffer`, `quarantine_journal`, `cluster_acks`.
- **Tx #3 (Tab Lease Renewal):** `replica_meta`, `tab_leases`.
- **Tx #4 (Durable ACK Receipt):** `replica_meta`, `cluster_acks`.
- **Tx #5 (Server Acceptance ACK):** `replica_meta`, `sync_outbox`.
- **Tx #6 (Checkpoint Commit & Journal Truncation):** `replica_meta`, `snapshots`, `mutation_journal`, `operation_digests`.
- **Tx #7 (Compaction):** `replica_meta`, `entries_state`, `mutation_journal`.
- **Tx #8 (Epoch Bootstrap / Transition):** `replica_meta`, `snapshots`, `entries_state`, `mutation_journal`, `sync_outbox`, `inbound_gap_buffer`, `inbound_dependency_buffer`, `quarantine_journal`, `replay_state`.
- **Tx #9 (Offline Quarantine Extraction):** `replica_meta`, `quarantine_journal`, `replay_state`.
- **Tx #10 (Replay Batch Commit):** `replica_meta`, `entries_state`, `mutation_journal`, `sync_outbox`, `replay_state`.
- **Tx #11 (Legacy Migration Archive):** `replica_meta`, `entries_state`, `mutation_journal`, `legacy_archive`.
- **Tx #12 (Anti-Entropy Pull Apply):** `replica_meta`, `inbound_gap_buffer`, `mutation_journal`, `entries_state`, `operation_digests`.
- **Tx #13 (Equivocation Excision & Rebuild):** `replica_meta`, `entries_state`, `mutation_journal`, `snapshots`, `quarantine_journal`.

