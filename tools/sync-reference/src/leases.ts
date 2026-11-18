/**
 * Sync-v33-reference: Clock-Safe Tab Lease Fencing
 */

import { SYNC_PROTOCOL_LIMITS, type CollectionId, type ReplicaMetaRecord, type TabLeaseRecord } from "./types.js";

export function assertActiveLeaseFencing(
  meta: ReplicaMetaRecord,
  callerTabId: string,
  expectedFencingTerm: number
): { ok: boolean; code?: string; detail?: string } {
  if (meta.leaseHolderTabId !== callerTabId) {
    return {
      ok: false,
      code: "SYNC_STALE_TAB_LEASE_FENCED",
      detail: `Caller tab ${callerTabId} is not active lease holder (${meta.leaseHolderTabId})`,
    };
  }
  if (meta.leaseFencingTerm !== expectedFencingTerm) {
    return {
      ok: false,
      code: "SYNC_STALE_TAB_LEASE_FENCED",
      detail: `Caller fencing term ${expectedFencingTerm} is stale (active: ${meta.leaseFencingTerm})`,
    };
  }
  return { ok: true };
}

export function acquireOrRenewTabLease(
  tabLeases: Map<CollectionId, TabLeaseRecord>,
  meta: ReplicaMetaRecord,
  callerTabId: string,
  currentWallMs: number,
  observedContenderMonotonicStallMs: number
): { ok: boolean; fencingTerm: number; code?: string; detail?: string } {
  const currentLease = tabLeases.get(meta.collectionId);

  if (!currentLease) {
    // Fresh lease acquisition
    const newRecord: TabLeaseRecord = {
      collectionId: meta.collectionId,
      leaseHolderTabId: callerTabId,
      leaseFencingTerm: 1,
      leaseAcquiredAtWallMs: currentWallMs,
      heartbeatCounter: 1,
      monotonicHeartbeatObservationMs: 0,
    };
    tabLeases.set(meta.collectionId, newRecord);
    meta.leaseHolderTabId = callerTabId;
    meta.leaseFencingTerm = 1;
    return { ok: true, fencingTerm: 1 };
  }

  // Renewal by existing holder
  if (currentLease.leaseHolderTabId === callerTabId) {
    const updated: TabLeaseRecord = {
      ...currentLease,
      heartbeatCounter: currentLease.heartbeatCounter + 1,
      leaseAcquiredAtWallMs: currentWallMs,
    };
    tabLeases.set(meta.collectionId, updated);
    return { ok: true, fencingTerm: updated.leaseFencingTerm };
  }

  // Contender takeover check: requires observing unchanged heartbeatCounter for >= 10,000ms
  if (observedContenderMonotonicStallMs >= SYNC_PROTOCOL_LIMITS.TAB_LEASE_TAKEOVER_STALE_MS) {
    const nextFencingTerm = currentLease.leaseFencingTerm + 1;
    const takeoverRecord: TabLeaseRecord = {
      collectionId: meta.collectionId,
      leaseHolderTabId: callerTabId,
      leaseFencingTerm: nextFencingTerm,
      leaseAcquiredAtWallMs: currentWallMs,
      heartbeatCounter: 1,
      monotonicHeartbeatObservationMs: 0,
    };
    tabLeases.set(meta.collectionId, takeoverRecord);
    meta.leaseHolderTabId = callerTabId;
    meta.leaseFencingTerm = nextFencingTerm;
    return { ok: true, fencingTerm: nextFencingTerm };
  }

  return {
    ok: false,
    fencingTerm: currentLease.leaseFencingTerm,
    code: "SYNC_LEASE_BUSY",
    detail: `Tab lease currently held by ${currentLease.leaseHolderTabId} and not yet stale`,
  };
}
