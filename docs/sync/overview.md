# Mix Sync Subsystem: Architecture Overview

## 1. System Mission & Scope

The `@dotmix/sync` subsystem provides a local-first, offline-first reactive state synchronization engine for collaborative applications built with the Mix and Tix framework. It enables continuous offline interaction, deterministic multi-device convergence, cryptographic tamper resistance, and surgical DOM reconciliation without an intermediate virtual DOM.

The architecture combines Conflict-free Replicated Data Types (CRDTs), asymmetric cryptographic signing, monotonic Lamport logical clocks, and transactional IndexedDB persistence into a zero-runtime-dependency package.

---

## 2. Core Protocol Model

Replication is governed by the replicated state protocol specification, which operates as a hybrid operation-based and state-based replication model:

### 2.1 Causal Dots & Lamport Timestamps
Every state mutation within the cluster is permanently identified by a **Causal Dot** (`CausalDot`):
- `epochNumber`: Monotonic epoch identifier managed by cluster membership certificates.
- `replicaId`: Unique identifier representing the authoring replica.
- `sequence`: Monotonically incrementing per-replica operation sequence number.

Operations are causally ordered via **Lamport Stamps** (`LamportStamp`), ensuring strict total ordering across concurrent writers:
$$\text{Stamp} = \langle \text{lamport}, \text{epochNumber}, \text{replicaId}, \text{sequence} \rangle$$

Ties between operations with identical Lamport values are deterministically broken using causal dot precedence (`epochNumber`, then `replicaId`, then `sequence`).

### 2.2 Entry Incarnations & Field-Level Registers
Collection items are tracked via immutable birth dots termed **Incarnation Identifiers** (`toIncarnationId(dot)`). 
- **Last-Write-Wins (LWW) per Field:** Updates mutate individual fields with independent Lamport stamps. Concurrent edits to disjoint fields on the same record converge without data loss.
- **Tombstones & Delete Dots:** Deletions record delete dots referencing specific incarnations, preventing resurrection anomalies caused by delayed network delivery.
- **Fractional Indexing:** Reordering uses deterministic fractional index keys (`generateKeyBetween`), resolving concurrent moves without cycle deadlock or list interleaving.

---

## 3. Cryptographic Verification & Identity

Security state is integral to replication invariants rather than an external layer:

```text
+--------------------------------------------------------------+
|                   Wire Message Ingestion                     |
+--------------------------------------------------------------+
                               |
                               v
            [Protocol Version Validation (replicated.v3.3.1)]
                               |
                               v
             [Epoch Membership & Role Attestation]
                               |
                               v
               [Asymmetric Signature Verification]
                               |
                               v
         [Equivocation Check & Rolling Digest Validation]
                               |
                               v
         [Durable Atomic Storage Commit (Tx #1 .. #13)]
```

### 3.1 Non-Extractable Cryptographic Keys
- Author keys are generated using WebCrypto (`ECDSA` P-256 mandatory; `Ed25519` optional).
- Private key material is marked `extractable = false` and persisted in IndexedDB via structured clone serialization. Raw private key bytes are never exported or serialized into transmission payloads.

### 3.2 Canonical Payloads & Rolling Digest Chains
Every operation computes a canonical SHA-256 payload digest. Operations within each stream form a hash chain:
$$H_k = \text{SHA-256}(H_{k-1} \parallel \text{digest}_k)$$
This guarantees stream continuity and prevents unauthorized op insertion, deletion, or truncation.

### 3.3 Equivocation Detection & Quarantine
If an author emits two distinct operations with identical causal dots (`opDot`), the engine flags equivocation immediately (`SYNC_EQUIVOCATION_DETECTED`), halts ingestion from that stream, and sequesters the conflicting operations into `quarantine_journal` without corrupting active state.

---

## 4. Storage Architecture & Transactional Scopes

Persistent storage uses one IndexedDB database per collection, `dotmix_sync:<collectionId>`, at version 2 with exactly 13 specialized object stores (the legacy engine keeps its own `mix_sync_db` at version 1):

| Store Name | Function & Durability Scope |
|---|---|
| `replica_meta` | Local replica state, epoch certificate, stable frontiers, and active leases. |
| `entries_state` | Current reconciled register states, field values, and tombstones. |
| `mutation_journal` | Append-only journal of durable, signed operations. |
| `sync_outbox` | Staged operations awaiting network transmission to peers or coordinator. |
| `inbound_gap_buffer` | Bounded buffer (max 1,000 ops) for out-of-order operations awaiting prior sequence numbers. |
| `inbound_dependency_buffer` | Bounded buffer for operations awaiting causal parent incarnations. |
| `operation_digests` | Deduplication index and verified rolling digest chain states. |
| `snapshots` | Checkpoint snapshots with canonical state digests for instant boot recovery. |
| `quarantine_journal` | Isolated holding store for malformed, equivocating, or invalid operations. |
| `replay_state` | State markers and logs for replaying pending offline mutations. |
| `legacy_archive` | Non-destructive archive tracking v1 legacy data and migration stages. |
| `tab_leases` | Multi-tab leader lease records and fencing terms. |
| `cluster_acks` | Durable frontier acknowledgments received from cluster members. |

### 4.1 Strict Transaction Scoping (Tx #1 – Tx #13)
All storage operations run inside explicit transaction boundaries matching defined store subsets (e.g. `TX1_LOCAL_ALLOCATION_STORES`, `TX6_CHECKPOINT_COMMIT_STORES`). To avoid browser IndexedDB transaction auto-commit and deactivation, all cryptographic digests computed inside transaction bodies execute via synchronous SHA-256 rather than asynchronous WebCrypto microtasks.

### 4.2 Two-Snapshot Fallback Recovery
Snapshots record a canonical SHA-256 digest of normalized state. During cold boot recovery (`recoverFromStoreOnBoot`), if snapshot $N$ is corrupted, the engine automatically verifies and falls back to snapshot $N-1$, replaying journal entries past $N-1$ without data loss.

---

## 5. Multi-Tab Coordination & Lease Fencing

To ensure safe concurrent access from multiple browser tabs:

1. **Leader Election:** Tabs elect a single primary writer tab using `BroadcastChannel` with time-bounded heartbeat leases (default 5,000 ms).
2. **Monotonic Fencing Terms:** Every lease renewal increments a monotonic fencing term. Any write operation attempted under a stale fencing term is rejected immediately (`SYNC_FENCE_FAILED`), eliminating split-brain races.
3. **Reactive Follower Refresh:** Follower tabs observe leader commits via broadcast notifications and refresh their in-memory state directly from IndexedDB.

---

## 6. Anti-Entropy & Network Synchronization

Replication across unreliable network connections uses a combination of push and pull protocols:
- **Eager Broadcast:** Newly committed local operations are broadcast in signed wire envelopes to peer replicas and the coordinator.
- **Gap Detection & Buffering:** Gaps in received sequence numbers are held in `inbound_gap_buffer` while anti-entropy range requests (`StreamRangeRequest`) pull missing ranges from the coordinator or peer.
- **Compaction Horizons:** Checkpoints and stable frontiers define safe garbage collection horizons (`compactionFrontier`), pruning historic operations while preserving exact state convergence.

