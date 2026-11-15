# Decision Record D-136: CRDT Vector Stability Horizon, Stale-Peer Resurrection Fencing & Compaction Safety

**Status:** Accepted & Implemented (Phase 4 Remediation of `FINDING-CRDT-01`, amends `D-125`)  
**Package:** `@dotmix/sync` (`packages/sync/src/crdt/array.ts`, `packages/sync/src/engine/engine.ts`)  
**Author:** Phase 4 Remediation Team  
**Date:** November 10, 2026  

---

## 1. Context & Problem Statement

In Gate 22 (`D-125`), `@dotmix/sync` introduced `compact(ackWatermarkClock: number)` into `ReplicableArray` to garbage-collect tombstones (`deleted: true`). However, `compact()` relied on a scalar local watermark:
1. When tombstones are deleted from `this.entries`, the local replica loses the memory that those items ever existed.
2. If a peer (e.g. Replica B) was offline prior to the deletion and reconnects after compaction has run, Replica B transmits its stale active entries (`deleted: false`).
3. In `ReplicableArray.merge()`, because the item is absent locally (`!local`), the engine treats the entry as a brand-new insertion and re-adds it to `this.entries`.
4. **Impact:** Permanent loss of deletion intent (the "tombstone resurrection" bug).

---

## 2. Compaction Safety Model: Multi-Peer Vector Stability + Horizon Fencing

To guarantee complete data integrity in distributed offline-first applications, dotMix implements a dual-layer safety model:

### Layer 1: Vector Stability Horizon (Peer Acknowledgment Consensus)
- `ReplicableArray` and `SyncEngine` maintain a registered peer acknowledgment vector: `peerWatermarks: Map<string, number>`.
- The **stability horizon** is calculated as the minimum acknowledged timestamp across all registered peers:
  $$\text{stabilityHorizon} = \min_{p \in \text{registeredPeers}} (\text{peerWatermarks}[p])$$
- If active peers are registered, `compact(watermark)` restricts the effective compaction watermark to:
  $$\text{effectiveWatermark} = \min(\text{watermark}, \text{stabilityHorizon})$$
- A tombstone is NEVER physically purged while any registered peer has not yet acknowledged operations up to that deletion timestamp.

### Layer 2: Compaction Horizon Fencing & Stale Resurrection Prevention
- If compaction is executed (e.g. up to watermark $H$), `ReplicableArray` records:
  - `compactionHorizon = Math.max(this.compactionHorizon, H)`
  - `purgedTombstoneIds: Set<string>`
- During `merge(remoteEntries)`:
  When a remote entry $E_{remote}$ is encountered where `!local`:
  - If $E_{remote}$ is NOT deleted (`!E_remote.deleted`), but either:
    1. $E_{remote}.\text{id} \in \text{purgedTombstoneIds}$, or
    2. $E_{remote}.\text{mutationId.timestamp} \le \text{compactionHorizon}$
  - **Fencing Action:** The entry is identified as a stale pre-compaction resurrection attempt and is strictly rejected (`rejectedStale++`). It is NOT added to local active state.
  - If $E_{remote}.\text{mutationId.timestamp} > \text{compactionHorizon}$, the entry was created *after* compaction and is accepted as a legitimate new insertion.

### Layer 3: Unrelated Offline Writes & Conflict Preservation
- If an offline peer modified an existing active item $Y$, $Y$ is present locally and `compareMutationIds` applies the standard Last-Write-Wins rule.
- If an offline peer created a new item $Z$ while offline with a timestamp after the horizon, $Z$ is safely inserted.
- If an offline peer deleted an item $W$, `remote.deleted` is true and is recorded without resurrecting anything.

### Layer 4: Snapshot Persistence & Wire-Protocol Compatibility
- `toJSON()` continues returning an array of entries (`ArrayEntry<T>[]`) with metadata properties (`compactionHorizon`, `purgedTombstoneIds`) attached to preserve 100% backward compatibility with all array consumers and JSON serialization.
- `restoreSnapshot()` accepts both legacy array formats and structured snapshot objects `{ entries, compactionHorizon, purgedTombstoneIds }`.

