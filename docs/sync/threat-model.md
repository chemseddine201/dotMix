# Threat Model: Mix Sync Protocol Security Architecture

## 1. Executive Summary & Scope

The `@dotmix/sync` replication subsystem provides a local-first, offline-first reactive state synchronization engine for collaborative applications. This document outlines the formal threat model, security boundaries, adversarial threat vectors, mitigations, and verification mappings for the synchronization protocol.

The trust boundary encompasses:
1. **Local Browser Runtime:** Web applications operating across multiple browser tabs, web workers, and private storage contexts (IndexedDB, OPFS).
2. **Network Transport:** Untrusted, arbitrary WebSocket or WebRTC relay channels subject to eavesdropping, packet tampering, reordering, replay, and degradation.
3. **Cluster Topology:** Decentralized peers (writer replicas, read-only followers) coordinated through certified epoch transitions and membership attestation.

---

## 2. Security Invariants & Defense-in-Depth

The synchronization engine enforces ten primary security invariants across the entire protocol lifecycle:

- **I1: Cryptographic Identity & Signature Attestation:** Every operation, snapshot, and membership certificate is signed using asymmetric cryptography (ECDSA P-256 or Ed25519) with non-extractable keys.
- **I2: Protocol Version Enforcement:** Envelopes and operations must match the active protocol specification (`D-137.v3.3.1`). Downgrades are rejected at decode time.
- **I3: Monotonic Lamport & Dot Integrity:** Operation dots (`opDot`) and causal timestamps (`stamp`) are strictly bound. Lamport clocks are monotonic per origin stream with bounded jumps.
- **I4: Durable Deduplication & Operation Digest Anchoring:** Applied operations are recorded with SHA-256 rolling digest chains in `operation_digests`, preventing duplicate execution.
- **I5: Two-Phase Commit Security Revalidation:** Operations pre-verified asynchronously undergo synchronous re-verification of `securityStateVersion` inside the storage transaction.
- **I6: Certified Excision & Compaction Horizons:** The baseline stable frontier (`baselineStableFrontier`) defines immutable compaction floors within an epoch.
- **I7: Bounded Buffer Capacity (DoS Protection):** Inbound gap and dependency buffers enforce strict operational ceilings (1,000 operations per collection) to guarantee bounded memory.
- **I8: Monotonic Tab Lease Fencing:** Multi-tab storage access requires active lease ownership with monotonic fencing terms to prevent split-brain writes.
- **I9: Fail-Closed Transition & Monotonic Floor Verification:** Epoch transition certificates verify coordinator signatures and enforce non-decreasing baseline floors for listed streams.
- **I10: Fallback Snapshot Recovery:** Corrupt snapshots are detected via canonical digest verification, triggering fallback to previous snapshots ($N-1$ or certified baseline).

---

## 3. Threat Analysis & Mitigations

### 3.1 Protocol Version Downgrade
- **Adversary Goal:** Force replicas to process messages using obsolete or relaxed protocol rules to bypass security checks.
- **Attack Vector:** An attacker broadcasts envelopes or wire operations stamped with legacy version strings (`D-137.v1.0.0`, `D-137.v2.0.0`, `legacy-v1`).
- **Mitigation:** Strict wire-level version validation occurs during envelope and operation decoding (`decodeWireEnvelope`, `decodeWireOperation`). Mismatched or downgraded versions fail closed with `D137_PROTOCOL_VERSION_MISMATCH` (`packages/sync/src/transport/envelope.ts:263`, `packages/sync/src/protocol/types.ts:398`).
- **Verification:** `tests/sync-d137/security/downgrade.test.mjs` and `tests/sync-d137/wire/wire-decoding.test.mjs` assert `D137_PROTOCOL_VERSION_MISMATCH`.

### 3.2 Operation Replay Attack
- **Adversary Goal:** Re-broadcast legitimate signed operations from previous epochs or past transactions to resurrect deleted entries or corrupt state.
- **Attack Vector:** Network packet capture and duplicate transmission across peer channels.
- **Mitigation:**
  1. *Durable Frontier Tracking:* Operations at or below `localDurableFrontier` are discarded as already processed.
  2. *Digest Store Deduplication:* If an incoming dot matches an existing entry in `operation_digests`, it is recognized as a duplicate and ignored without mutating state or triggering redundant reactive notifications.
  3. *Pruned Horizon Rejection:* Operations arriving at or below the pruned digest horizon without a digest record are rejected with `D137_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON` (`packages/sync/src/protocol/ingest.ts:192`).
  4. *Closed Epoch Rejection:* Operations from closed epochs above the certified closing floor are rejected with `D137_EPOCH_CLOSED` (`packages/sync/src/protocol/ingest.ts:77`).
- **Verification:** `tests/sync-d137/security/replay.test.mjs` (duplicate delivery does not change state; asserts no code), `tests/sync-d137/protocol/ingestion-invariants.test.mjs` (asserts `D137_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON`), `tests/sync-d137/protocol/epoch-close.test.mjs` (asserts `D137_EPOCH_CLOSED`).

### 3.3 Key Compromise & Revocation Runbook
- **Adversary Goal:** Submit forged operations using a leaked or compromised author signing key.
- **Attack Vector:** Compromised client author key used to sign unauthorized updates.
- **Mitigation:**
  1. The coordinator issues a signed `EpochMembershipCertificate` advancing the epoch and listing revoked key identifiers in `revokedKeyIds`.
  2. Replicas advance epoch, append revoked keys to `meta.revokedKeyIds`, and increment `securityStateVersion`.
  3. Inside storage transactions, `revalidateFencingAndMembership` verifies author key validity against `meta.revokedKeyIds` and returns `D137_KEY_REVOKED` (`packages/sync/src/storage/idb-tx.ts:429`). Local allocation with a revoked key returns `D137_REVOKED_AUTHOR_KEY` (`packages/sync/src/protocol/allocate.ts:167`); remote pre-verification returns the same code (`packages/sync/src/protocol/preverify.ts:330`).
  4. Uncommitted local mutations from honest replicas are re-issued under fresh keys in epoch $E+1$ via deterministic replay planning.
- **Verification:** `tests/sync-d137/security/revocation-runbook.test.mjs` (stale-key operation is not applied; asserts no code), `tests/sync-d137/storage/fencing-revalidation.test.mjs` (asserts `D137_KEY_REVOKED`), `tests/sync-d137/protocol/epoch-close.test.mjs` (asserts `D137_REVOKED_AUTHOR_KEY`).

### 3.4 Dependency Buffer Exhaustion (Denial-of-Service)
- **Adversary Goal:** Exhaust replica memory by flooding unresolvable causal dependencies, causing browser tab crashes.
- **Attack Vector:** Attacker transmits thousands of operations referencing non-existent parent operations (`targetIncarnation`).
- **Mitigation:** Hard operational limits are enforced by `classifyCausalDependency`. Collections permit at most 1,000 pending dependency operations (`MAX_DEPENDENCY_BUFFER_OPS_PER_COLLECTION`). When full, additional dependent operations are rejected with `D137_DEPENDENCY_BUFFER_OVERFLOW` (`packages/sync/src/protocol/dependency.ts:128`), keeping heap consumption strictly bounded.
- **Verification:** `tests/sync-d137/security/buffer-dos.test.mjs` asserts `D137_DEPENDENCY_BUFFER_OVERFLOW`.

### 3.5 Byzantine / Unauthorized Peer Injection
- **Adversary Goal:** Inject unauthorized data or fabricate operations without valid cluster membership.
- **Attack Vector:** Rogue peer connects to WebSocket relay and transmits forged mutations with fabricated author keys or missing signatures.
- **Mitigation:** Every operation undergoes cryptographic attestation:
  1. Verification that `authorKeyId` exists in `epochMemberBindings`.
  2. Verification that `authorReplicaId` matches the binding's authorized replica.
  3. Asymmetric signature verification over canonical operation payload (`verifySignatureAsync`).
  Pre-verification rejects an author outside the epoch membership with `D137_AUTHOR_NOT_IN_EPOCH_MEMBERSHIP` (`packages/sync/src/protocol/preverify.ts:324`), a payload digest mismatch with `D137_PAYLOAD_DIGEST_MISMATCH` (`preverify.ts:335`) and a bad signature with `D137_INVALID_AUTHOR_SIGNATURE` (`preverify.ts:347`).
- **Verification:** `tests/sync-d137/api/forged-op.test.mjs` asserts that the forged operation and unsigned mutations do not change collection items. It does not assert a rejection code; no test asserts these three codes yet.

### 3.6 Multi-Tab Fencing Violation
- **Adversary Goal:** Multiple browser tabs concurrently mutate the same IndexedDB collection, producing split-brain corruption.
- **Attack Vector:** Concurrently running tabs attempt to drain sync outbox or write local mutations simultaneously without coordination.
- **Mitigation:**
  1. Primary tab elects itself leader and acquires a lease record in `tab_leases`.
  2. Leases maintain a strictly monotonic `leaseFencingTerm` and periodic heartbeat timestamp.
  3. Local mutation transactions and remote drain transactions execute fencing validation (`revalidateFencingAndMembership`).
  4. Stale tabs observing higher fencing terms yield leadership immediately. A tab that is not the lease holder gets `D137_STALE_TAB_LEASE_FENCED` (`packages/sync/src/protocol/leases.ts:33`); a write transaction with a stale fencing term aborts with `D137_FENCE_FAILED` (`packages/sync/src/storage/idb-tx.ts:468`).
- **Verification:** `tests/sync-d137/e2e/multi-tab-failover.test.mjs` (asserts `D137_STALE_TAB_LEASE_FENCED`), `tests/sync-d137/storage/fencing-revalidation.test.mjs` (asserts `D137_FENCE_FAILED`), browser scenario `tools/browser-matrix/scenarios/multi-tab-lease-failover.js`.

### 3.7 Storage Quota Exhaustion
- **Adversary Goal:** Trigger unhandled browser quota exceptions (`QuotaExceededError`) to corrupt underlying IndexedDB state.
- **Attack Vector:** Massive burst of incoming operations or oversized local assets exceeding origin disk quota.
- **Mitigation:**
  1. Multi-store updates execute within atomic IndexedDB transactions.
  2. Quota failures trigger transactional abort, leaving persistent stores in their pre-transaction state.
  3. On a failed flush the collection adapter sets `isBackpressure`, status `"error"` and error code `D137_STORAGE_QUOTA_EXCEEDED` (spec §3.6, HAA-20; `packages/sync/src/adapter/collection-adapter.ts:199`). The next successful flush clears all three (`collection-adapter.ts:202`).
- **Status:** OPEN - HAA decision: no storage-quota code in spec/SYNC_PROTOCOL.md.
- **Verification:** `tests/sync-d137/storage/abort-consistency.test.mjs` (transaction abort leaves stores unchanged), browser scenario `tools/browser-matrix/scenarios/quota-exceeded-backpressure.js`. No test asserts a quota code.

### 3.8 Tampered / Corrupt Snapshot Fallback
- **Adversary Goal:** Bit rot or malicious manipulation of stored snapshot records causing invalid state reconstruction on boot.
- **Attack Vector:** Corrupting snapshot JSON data in IndexedDB `snapshots` object store.
- **Mitigation:**
  1. Snapshots include a canonical SHA-256 digest calculated over the serialized payload.
  2. On boot, `recoverFromStoreOnBoot` calculates and verifies the digest against `snapshotDigest`.
  3. If snapshot $N$ fails digest verification, the recovery machine falls back to snapshot $N-1$ or the certified baseline snapshot, replaying mutations from `mutation_journal` to reconstruct an uncorrupted state. Boot fallback returns no error code.
  4. A remote bootstrap snapshot with a bad digest is rejected with `D137_SNAPSHOT_DIGEST_MISMATCH` (`packages/sync/src/protocol/lifecycle.ts:334`); no test asserts this code yet.
- **Verification:** `tests/sync-d137/storage/boot-recovery.test.mjs` (fallback to the previous snapshot) and `tests/sync-d137/crypto/canonical-sha256.test.mjs`.

### 3.9 Malicious Coordinator Lowering Listed Floor
- **Adversary Goal:** A rogue or compromised coordinator publishes an epoch transition certificate that reduces the baseline stable floor, resurrecting compacted or excised history.
- **Status:** **Accepted Threat (HAA Ruling).**
- **Mitigation:**
  1. Coordinator signatures on `EpochMembershipCertificate` are mandatory and strictly verified.
  2. Transition certificates are non-cumulative: floors for previously closed epochs are immutable and final.
  3. Replicas evaluate `baselineStableFrontier` monotonicity: for every stream listed in the transition certificate, the new floor must satisfy `newFloor >= currentFloor`.
  4. Any attempted floor reduction fails immediately with `D137_CERTIFICATE_FLOOR_REGRESSION` (`packages/sync/src/protocol/lifecycle.ts:164`), and the certificate is rejected.
- **Verification:** `tests/sync-d137/protocol/epoch-transition.test.mjs` and `tests/sync-d137/protocol/risk-d1-non-retryable.test.mjs` assert `D137_CERTIFICATE_FLOOR_REGRESSION`.

### 3.10 Forged Founding Certificate at Boot
- **Adversary Goal:** Load local state signed by a forged or edited certificate, for example a stored snapshot whose certificate carries a fixed `coordinatorSignature` string.
- **Status:** Mitigated.
- **Mitigation:** `recoverFromStoreOnBoot` verifies the certificate of every snapshot candidate with `validateEpochMembershipCertificate`; no signature string is accepted without verification (`packages/sync/src/storage/boot-recovery.ts`). A failing snapshot falls back to $N-1$; if both fail, boot throws `CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED`. `finalizeMigration()` runs the same verification before it deletes legacy data.
- **Verification:** `tests/sync-d137/storage/boot-recovery.test.mjs` (tampered epoch certificate falls back to N-1) and `tests/sync-d137/migration/migration.test.mjs` (finalize verifies the signed checkpoint).

### 3.11 Signing Key Lost or Extracted After Reload
- **Adversary Goal:** Read the replica's private key from storage, or force a new unbound key after reload.
- **Status:** Mitigated.
- **Mitigation:** The signing key is a non-extractable `CryptoKey` stored in `replica_meta` under `signing-key:<collectionId>`; no key bytes are written (`packages/sync/src/adapter/signing-key-store.ts`). It is restored on boot and on follower refresh (`packages/sync/src/adapter/storage-init.ts`).
- **Verification:** browser scenario `tools/browser-matrix/scenarios/non-extractable-key-persistence.js`.

---

## 4. Threat Matrix & Verification Mapping

| Threat Vector | Severity | Mitigation Invariant | Primary Error Code | Verification Test / Status |
|:---|:---:|:---|:---:|:---|
| **Protocol Version Downgrade** | High | Wire decode version match; reject obsolete versions | `D137_PROTOCOL_VERSION_MISMATCH` | `tests/sync-d137/security/downgrade.test.mjs`, `tests/sync-d137/wire/wire-decoding.test.mjs` |
| **Operation Replay Attack** | High | Frontier checks, digest deduplication, horizon gating | `D137_EPOCH_CLOSED`, `D137_LATE_OP_BELOW_PRUNED_DIGEST_HORIZON` | `tests/sync-d137/protocol/epoch-close.test.mjs`, `tests/sync-d137/protocol/ingestion-invariants.test.mjs`, `tests/sync-d137/security/replay.test.mjs` (no code asserted) |
| **Key Compromise & Revocation** | Critical | Epoch advance, `revokedKeyIds` check | `D137_KEY_REVOKED`, `D137_REVOKED_AUTHOR_KEY` | `tests/sync-d137/storage/fencing-revalidation.test.mjs`, `tests/sync-d137/protocol/epoch-close.test.mjs`, `tests/sync-d137/security/revocation-runbook.test.mjs` (no code asserted) |
| **Dependency Buffer Exhaustion (DoS)** | High | Max 1,000 ops ceiling per collection | `D137_DEPENDENCY_BUFFER_OVERFLOW` | `tests/sync-d137/security/buffer-dos.test.mjs` |
| **Byzantine / Unauthorized Peer Injection** | Critical | Member bindings check & cryptographic signature verification | `D137_AUTHOR_NOT_IN_EPOCH_MEMBERSHIP`, `D137_PAYLOAD_DIGEST_MISMATCH`, `D137_INVALID_AUTHOR_SIGNATURE` | `tests/sync-d137/api/forged-op.test.mjs` (asserts no mutation; no code asserted) |
| **Multi-Tab Fencing Violation** | High | Primary tab lease renewal, monotonic fencing terms | `D137_STALE_TAB_LEASE_FENCED`, `D137_FENCE_FAILED` | `tests/sync-d137/e2e/multi-tab-failover.test.mjs`, `tests/sync-d137/storage/fencing-revalidation.test.mjs` |
| **Storage Quota Exhaustion** | Medium | Atomic transaction rollback & sync outbox backpressure | `D137_STORAGE_QUOTA_EXCEEDED` | `tools/browser-matrix/scenarios/quota-exceeded-backpressure.js` |
| **Tampered / Corrupt Snapshot Fallback** | High | Canonical SHA-256 digest validation with $N-1$ fallback | none on boot fallback; `D137_SNAPSHOT_DIGEST_MISMATCH` for remote bootstrap | `tests/sync-d137/storage/boot-recovery.test.mjs` (fallback; no code asserted) |
| **Forged Founding Certificate at Boot** | Critical | Certificate verification on every boot candidate | none (boot throws `CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED` when N and N-1 fail) | `tests/sync-d137/storage/boot-recovery.test.mjs`, `tests/sync-d137/migration/migration.test.mjs` |
| **Signing Key Lost or Extracted After Reload** | High | Non-extractable `CryptoKey` persisted in `replica_meta`, restored on boot | none | `tools/browser-matrix/scenarios/non-extractable-key-persistence.js` |
| **Malicious Coordinator Lowering Floor** | Critical | Coordinator signature & monotonic floor validation | `D137_CERTIFICATE_FLOOR_REGRESSION` | `tests/sync-d137/protocol/epoch-transition.test.mjs`, `tests/sync-d137/protocol/risk-d1-non-retryable.test.mjs` (accepted threat, HAA ruling) |

---

## 5. Security Diagnostics & Quarantine Subsystem

To facilitate forensic analysis and real-time observability without compromising user privacy, `@dotmix/sync` includes an isolated diagnostics controller:

1. **Structured Diagnostic Stream:** Emits real-time reactive signals for security events (`D137_*` codes) with timestamps and sanitized previews.
2. **Quarantine Isolation:** Malformed, unauthorized, or equivocating operations are diverted to `quarantineJournal` rather than crashing the engine.
3. **Privacy-Preserving Inspector:** The `QuarantineInspector` exposes sanitized views where:
   - User-defined fields (`partialFields`, raw data) are strictly omitted.
   - Forensic payload previews are bounded to $\le 80$ characters.
   - Operators can safely query entry counts and clear quarantined records without direct database inspection.
- **Verification:** [`tests/sync-d137/security/diagnostics.test.mjs`](file:///tests/sync-d137/security/diagnostics.test.mjs)
