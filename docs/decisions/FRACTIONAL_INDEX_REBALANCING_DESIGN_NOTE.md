# Technical Design Note: Distributed Fractional Index Rebalancing Preconditions

**Status:** `VERIFIED_LIMITATION — SAFE FIX DEFERRED`  
**Package:** `@dotmix/sync` (`packages/sync/src/crdt/fractional.ts`, `packages/sync/src/crdt/array.ts`)  
**Date:** November 10, 2026  
**Auditor:** Phase 4 Remediation Authority  

---

## 1. Empirical Finding Summary (`FINDING-SYNC-02`)

Under repeated insertions into the exact same adjacent key gap (e.g., repeatedly inserting between $k_{prev} = \text{"a0"}$ and $k_{next} = \text{"a1"}$ without interleaving insertions elsewhere):
- Key length expands linearly: $\text{Length}(N) \approx N + 2$ characters.
- 10 insertions: 12 chars (75 total bytes)
- 50 insertions: 52 chars (1,375 total bytes)
- 100 insertions: 102 chars (5,250 total bytes)
- 1,000 insertions: 1,002 chars (502,500 total bytes)

In standard usage (sequential appends), key length grows logarithmically (reaching only 40 characters after 1,000 continuous appends). However, adversarial localized insertions in text editors or nested lists create sustained string expansion.

---

## 2. Why Local-Only Rebalancing is Unsafe in Offline-First CRDTs

A tempting but catastrophic workaround is to implement a local `rebalance()` method on `ReplicableArray` that sorts entries and assigns fresh, uniformly spaced base-62 keys (`"a"`, `"b"`, `"c"`...).

### The Concurrency Hazard:
1. Replicas $R_A$ and $R_B$ have identical collections with items $[X, Y, Z]$ at keys $[k_1, k_2, k_3]$.
2. $R_B$ disconnects.
3. $R_A$ triggers local rebalance: keys are rewritten to $[a_1, a_2, a_3]$.
4. While offline, $R_B$ inserts item $W$ between $X$ and $Y$. $R_B$ computes $k_{new} = \text{generateKeyBetween}(k_1, k_2)$.
5. $R_B$ reconnects and sends $W$ with key $k_{new}$.
6. $R_A$ receives $W$. Because $R_A$ replaced $[k_1, k_2, k_3]$ with $[a_1, a_2, a_3]$, $k_{new}$ is evaluated against the new keys. In base-62 lexicographical sorting, $k_{new}$ will sort arbitrarily (e.g. after $a_3$ or before $a_1$), permanently corrupting user list order and causing replicas to diverge.

---

## 3. Preconditions for Distributed-Safe Rebalancing

Safe rebalancing without order corruption requires an explicit distributed epoch protocol:

1. **Epoch Versioning on Collection:** Every collection maintains an `epoch: number`. Keys are scoped to the epoch: `(epoch, key)`.
2. **Causal Horizon Consensus:** Rebalancing creates epoch $E + 1$. A replica cannot propose epoch $E + 1$ without consensus or an authoritative sequencer confirming that all active peers have acknowledged up to epoch $E$.
3. **Causal Translation Matrix:** Replicas that receive an operation tagged with epoch $E$ after epoch $E + 1$ has been adopted must project the key through a deterministic translation table based on the item's logical neighbors at the rebalance boundary.
4. **Snapshot Epoch Fencing:** Stale peers presenting operations older than $E - 1$ must be fenced and forced to accept the authoritative epoch snapshot before emitting new mutations.

---

## 4. Remediation Decision

Because implementing a distributed epoch consensus protocol constitutes a major wire-protocol and architectural expansion outside the authorized Phase 4 remediation boundaries, **local rebalancing is intentionally deferred** in accordance with Section 9.4.

### Immediate Observability Measure:
`@dotmix/sync` provides a read-only threshold diagnostic helper (`getMaxKeyLength()` on `ReplicableArray`) so applications can observe key growth without mutating data ordering.

