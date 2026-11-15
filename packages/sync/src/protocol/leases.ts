/**
 * @dotmix/sync — Clock-Safe Tab Lease Fencing (Gate 33 / D-137)
 */

export const D137_V331_LIMITS = {
  TAB_LEASE_TAKEOVER_STALE_MS: 10000,
  HEARTBEAT_CADENCE_MS: 1000,
} as const;

export interface TabLeaseRecord {
  readonly collectionId: string;
  readonly leaseHolderTabId: string;
  readonly leaseFencingTerm: number;
  readonly leaseAcquiredAtWallMs: number;
  readonly heartbeatCounter: number;
  readonly monotonicHeartbeatObservationMs: number;
}

export interface TabLeaseMeta {
  readonly collectionId: string;
  leaseHolderTabId: string | null;
  leaseFencingTerm: number;
}

export function assertActiveLeaseFencing(
  meta: TabLeaseMeta,
  callerTabId: string,
  expectedFencingTerm: number
): { ok: boolean; code?: string; detail?: string } {
  if (meta.leaseHolderTabId !== callerTabId) {
    return {
      ok: false,
      code: "D137_STALE_TAB_LEASE_FENCED",
      detail: `Caller tab ${callerTabId} is not active lease holder (${meta.leaseHolderTabId})`,
    };
  }
  if (meta.leaseFencingTerm !== expectedFencingTerm) {
    return {
      ok: false,
      code: "D137_STALE_TAB_LEASE_FENCED",
      detail: `Caller fencing term ${expectedFencingTerm} is stale (active: ${meta.leaseFencingTerm})`,
    };
  }
  return { ok: true };
}

export function acquireOrRenewTabLease(
  tabLeases: Map<string, TabLeaseRecord>,
  meta: TabLeaseMeta,
  callerTabId: string,
  currentWallMs: number,
  observedContenderMonotonicStallMs: number
): { ok: boolean; fencingTerm: number; code?: string; detail?: string } {
  const currentLease = tabLeases.get(meta.collectionId);

  if (!currentLease) {
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

  if (currentLease.leaseHolderTabId === callerTabId) {
    const updated: TabLeaseRecord = {
      ...currentLease,
      heartbeatCounter: currentLease.heartbeatCounter + 1,
      leaseAcquiredAtWallMs: currentWallMs,
    };
    tabLeases.set(meta.collectionId, updated);
    return { ok: true, fencingTerm: updated.leaseFencingTerm };
  }

  if (observedContenderMonotonicStallMs >= D137_V331_LIMITS.TAB_LEASE_TAKEOVER_STALE_MS) {
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
    code: "D137_LEASE_BUSY",
    detail: `Tab lease currently held by ${currentLease.leaseHolderTabId} and not yet stale`,
  };
}

