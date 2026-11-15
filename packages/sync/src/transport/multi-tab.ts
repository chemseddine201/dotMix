/**
 * @dotmix/sync — Multi-Tab Lease Coordination & Follower Refresh (Gate 34 / T-34.6)
 *
 * Implements clock-safe tab lease fencing, BroadcastChannel heartbeats,
 * leader election / failover, and post-commit follower notifications with
 * zero external dependencies.
 */

import {
  acquireOrRenewTabLease,
  assertActiveLeaseFencing,
  type TabLeaseMeta,
  type TabLeaseRecord,
} from "../protocol/leases.js";
import { D137_V331_LIMITS } from "../protocol/limits.js";
import { type ProtocolVersion, PROTOCOL_VERSION } from "../protocol/types.js";

export type TabRole = "primary" | "follower" | "candidate";

export interface TabHeartbeatMessage {
  readonly protocolVersion: ProtocolVersion;
  readonly type: "tab_heartbeat";
  readonly collectionId: string;
  readonly tabIdentifier: string;
  readonly leaseFencingTerm: number;
  readonly heartbeatCounter: number;
  readonly timestamp: number;
}

export interface PostCommitNotificationMessage {
  readonly protocolVersion: ProtocolVersion;
  readonly type: "post_commit_refresh";
  readonly collectionId: string;
  readonly tabIdentifier: string;
  readonly leaseFencingTerm: number;
  readonly committedOperationKeys: readonly string[];
  readonly timestamp: number;
}

export type MultiTabWireMessage = TabHeartbeatMessage | PostCommitNotificationMessage;

export interface MultiTabCoordinatorOptions {
  readonly collectionId: string;
  readonly tabIdentifier: string;
  readonly channelName?: string | undefined;
  readonly heartbeatIntervalMilliseconds?: number | undefined;
  readonly staleTimeoutMilliseconds?: number | undefined;
  readonly clock?: (() => number) | undefined;
  readonly broadcastChannelFactory?: ((channelName: string) => BroadcastChannel) | undefined;
  readonly sharedLeaseStateMap?: Map<string, TabLeaseRecord> | undefined;
}

export class MultiTabCoordinator {
  public readonly collectionId: string;
  public readonly tabIdentifier: string;
  private readonly heartbeatIntervalMilliseconds: number;
  private readonly staleTimeoutMilliseconds: number;
  private readonly getSystemTime: () => number;

  private currentRole: TabRole = "follower";
  private leaseStateMap: Map<string, TabLeaseRecord>;
  private tabLeaseMetadata: TabLeaseMeta;

  private broadcastChannel: BroadcastChannel | null = null;
  private heartbeatTimer: unknown = null;
  private followerMonitorTimer: unknown = null;

  private latestObservedHeartbeatCounter: number = 0;
  private latestObservedHeartbeatTime: number = 0;
  private activeFencingTerm: number = 0;

  private refreshListeners = new Set<(message: PostCommitNotificationMessage) => void>();
  private roleChangeListeners = new Set<(newRole: TabRole) => void>();
  private isDisposed = false;

  constructor(options: MultiTabCoordinatorOptions) {
    this.collectionId = options.collectionId;
    this.tabIdentifier = options.tabIdentifier;
    this.heartbeatIntervalMilliseconds = options.heartbeatIntervalMilliseconds ?? 1000;
    this.staleTimeoutMilliseconds =
      options.staleTimeoutMilliseconds ?? D137_V331_LIMITS.TAB_LEASE_TAKEOVER_STALE_MS;
    this.getSystemTime = options.clock ?? (() => Date.now());
    this.leaseStateMap = options.sharedLeaseStateMap ?? new Map<string, TabLeaseRecord>();

    this.tabLeaseMetadata = {
      collectionId: this.collectionId,
      leaseHolderTabId: null,
      leaseFencingTerm: 0,
    };

    const effectiveChannelName = options.channelName ?? `mix_multitab_${this.collectionId}`;
    if (options.broadcastChannelFactory) {
      this.broadcastChannel = options.broadcastChannelFactory(effectiveChannelName);
    } else if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel(effectiveChannelName);
    }

    if (this.broadcastChannel) {
      const channelCandidate = this.broadcastChannel as unknown as { unref?: () => void };
      if (typeof channelCandidate.unref === "function") {
        channelCandidate.unref();
      }
      this.broadcastChannel.onmessage = (messageEvent: MessageEvent<MultiTabWireMessage>) => {
        this.handleIncomingBroadcastMessage(messageEvent.data);
      };
    }
  }

  public getRole(): TabRole {
    return this.currentRole;
  }

  public isPrimary(): boolean {
    return this.currentRole === "primary";
  }

  public getFencingTerm(): number {
    return this.activeFencingTerm;
  }

  public getLeaseRecord(): TabLeaseRecord | undefined {
    return this.leaseStateMap.get(this.collectionId);
  }

  /**
   * Attempts to acquire or renew the primary lease for this tab.
   */
  public acquirePrimaryLease(): boolean {
    if (this.isDisposed) return false;

    const currentTimestamp = this.getSystemTime();
    let observedContenderStallMilliseconds = 0;

    if (this.latestObservedHeartbeatTime > 0) {
      observedContenderStallMilliseconds = currentTimestamp - this.latestObservedHeartbeatTime;
    } else {
      observedContenderStallMilliseconds = this.staleTimeoutMilliseconds;
    }

    const acquisitionResult = acquireOrRenewTabLease(
      this.leaseStateMap,
      this.tabLeaseMetadata,
      this.tabIdentifier,
      currentTimestamp,
      observedContenderStallMilliseconds
    );

    if (acquisitionResult.ok) {
      this.activeFencingTerm = acquisitionResult.fencingTerm;
      const wasPrimary = this.currentRole === "primary";
      this.currentRole = "primary";
      this.startHeartbeatBroadcast();
      if (!wasPrimary) {
        this.notifyRoleChange("primary");
      }
      return true;
    }

    if (this.currentRole === "primary") {
      this.currentRole = "follower";
      this.stopHeartbeatBroadcast();
      this.notifyRoleChange("follower");
    }

    return false;
  }

  /**
   * Asserts that this tab remains the active, unfenced primary lease holder.
   */
  public assertActivePrimary(): { ok: boolean; code?: string; detail?: string } {
    if (this.currentRole !== "primary") {
      return {
        ok: false,
        code: "D137_STALE_TAB_LEASE_FENCED",
        detail: `Tab ${this.tabIdentifier} is not active primary (current role: ${this.currentRole})`,
      };
    }

    return assertActiveLeaseFencing(
      this.tabLeaseMetadata,
      this.tabIdentifier,
      this.activeFencingTerm
    );
  }

  /**
   * Broadcasts a post-commit refresh notification to all follower tabs.
   */
  public broadcastPostCommitRefresh(committedOperationKeys: readonly string[]): boolean {
    const fencingCheck = this.assertActivePrimary();
    if (!fencingCheck.ok) return false;

    const notificationMessage: PostCommitNotificationMessage = {
      protocolVersion: PROTOCOL_VERSION,
      type: "post_commit_refresh",
      collectionId: this.collectionId,
      tabIdentifier: this.tabIdentifier,
      leaseFencingTerm: this.activeFencingTerm,
      committedOperationKeys,
      timestamp: this.getSystemTime(),
    };

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(notificationMessage);
    }
    return true;
  }

  /**
   * Simulates a heartbeat broadcast manually (useful for deterministic tests).
   */
  public emitHeartbeat(): TabHeartbeatMessage | null {
    if (this.currentRole !== "primary") return null;

    this.latestObservedHeartbeatCounter++;
    const heartbeatMessage: TabHeartbeatMessage = {
      protocolVersion: PROTOCOL_VERSION,
      type: "tab_heartbeat",
      collectionId: this.collectionId,
      tabIdentifier: this.tabIdentifier,
      leaseFencingTerm: this.activeFencingTerm,
      heartbeatCounter: this.latestObservedHeartbeatCounter,
      timestamp: this.getSystemTime(),
    };

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(heartbeatMessage);
    }
    return heartbeatMessage;
  }

  /**
   * Registers a follower refresh listener.
   */
  public onFollowerRefresh(
    listener: (notificationMessage: PostCommitNotificationMessage) => void
  ): () => void {
    this.refreshListeners.add(listener);
    return () => {
      this.refreshListeners.delete(listener);
    };
  }

  /**
   * Registers a role change listener.
   */
  public onRoleChange(listener: (newRole: TabRole) => void): () => void {
    this.roleChangeListeners.add(listener);
    return () => {
      this.roleChangeListeners.delete(listener);
    };
  }

  /**
   * Yields primary lease voluntarily, reverting to follower.
   */
  public releasePrimaryLease(): void {
    if (this.currentRole === "primary") {
      this.currentRole = "follower";
      this.stopHeartbeatBroadcast();
      this.tabLeaseMetadata.leaseHolderTabId = null;
      this.notifyRoleChange("follower");
    }
  }

  /**
   * Disposes coordinator and cleans up intervals and channel listeners.
   */
  public dispose(): void {
    this.isDisposed = true;
    this.stopHeartbeatBroadcast();
    this.stopFollowerMonitoring();
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    this.refreshListeners.clear();
    this.roleChangeListeners.clear();
  }

  private handleIncomingBroadcastMessage(broadcastMessage: MultiTabWireMessage): void {
    if (!broadcastMessage || broadcastMessage.collectionId !== this.collectionId) {
      return;
    }

    if (broadcastMessage.type === "tab_heartbeat") {
      this.handleHeartbeatMessage(broadcastMessage);
    } else if (broadcastMessage.type === "post_commit_refresh") {
      this.handleRefreshNotification(broadcastMessage);
    }
  }

  private handleHeartbeatMessage(heartbeatMessage: TabHeartbeatMessage): void {
    if (heartbeatMessage.tabIdentifier === this.tabIdentifier) {
      return;
    }

    const currentTimestamp = this.getSystemTime();
    this.latestObservedHeartbeatTime = currentTimestamp;
    this.latestObservedHeartbeatCounter = heartbeatMessage.heartbeatCounter;

    // Record remote primary lease state
    const currentRecordedLease = this.leaseStateMap.get(this.collectionId);
    if (!currentRecordedLease || heartbeatMessage.leaseFencingTerm >= currentRecordedLease.leaseFencingTerm) {
      this.leaseStateMap.set(this.collectionId, {
        collectionId: this.collectionId,
        leaseHolderTabId: heartbeatMessage.tabIdentifier,
        leaseFencingTerm: heartbeatMessage.leaseFencingTerm,
        leaseAcquiredAtWallMs: heartbeatMessage.timestamp,
        heartbeatCounter: heartbeatMessage.heartbeatCounter,
        monotonicHeartbeatObservationMs: 0,
      });
      this.tabLeaseMetadata.leaseHolderTabId = heartbeatMessage.tabIdentifier;
      this.tabLeaseMetadata.leaseFencingTerm = heartbeatMessage.leaseFencingTerm;
    }

    // Fencing check: if remote peer has a strictly higher fencing term, demote local tab
    if (heartbeatMessage.leaseFencingTerm > this.activeFencingTerm) {
      this.activeFencingTerm = heartbeatMessage.leaseFencingTerm;

      if (this.currentRole === "primary") {
        this.currentRole = "follower";
        this.stopHeartbeatBroadcast();
        this.notifyRoleChange("follower");
      }
    }
  }

  private handleRefreshNotification(refreshNotification: PostCommitNotificationMessage): void {
    if (refreshNotification.tabIdentifier === this.tabIdentifier) {
      return;
    }

    for (const refreshListener of this.refreshListeners) {
      try {
        refreshListener(refreshNotification);
      } catch {
        // Suppress listener callback errors
      }
    }
  }

  private startHeartbeatBroadcast(): void {
    this.stopHeartbeatBroadcast();
    this.emitHeartbeat();
    this.heartbeatTimer = globalThis.setInterval(() => {
      this.emitHeartbeat();
    }, this.heartbeatIntervalMilliseconds);
    if (typeof (this.heartbeatTimer as { unref?: () => void }).unref === "function") {
      (this.heartbeatTimer as { unref: () => void }).unref();
    }
  }

  public stopHeartbeat(): void {
    this.stopHeartbeatBroadcast();
  }

  private stopHeartbeatBroadcast(): void {
    if (this.heartbeatTimer) {
      globalThis.clearInterval(this.heartbeatTimer as ReturnType<typeof setInterval>);
      this.heartbeatTimer = null;
    }
  }

  public startFollowerMonitoring(): void {
    this.stopFollowerMonitoring();
    this.followerMonitorTimer = globalThis.setInterval(() => {
      if (this.currentRole === "follower") {
        const currentTimestamp = this.getSystemTime();
        const stallDuration = currentTimestamp - this.latestObservedHeartbeatTime;
        if (stallDuration >= this.staleTimeoutMilliseconds) {
          // Leader stalled; attempt takeover
          this.acquirePrimaryLease();
        }
      }
    }, Math.max(500, Math.floor(this.staleTimeoutMilliseconds / 4)));
    if (typeof (this.followerMonitorTimer as { unref?: () => void }).unref === "function") {
      (this.followerMonitorTimer as { unref: () => void }).unref();
    }
  }

  private stopFollowerMonitoring(): void {
    if (this.followerMonitorTimer) {
      globalThis.clearInterval(this.followerMonitorTimer as ReturnType<typeof setInterval>);
      this.followerMonitorTimer = null;
    }
  }

  private notifyRoleChange(newRole: TabRole): void {
    for (const roleListener of this.roleChangeListeners) {
      try {
        roleListener(newRole);
      } catch {
        // Suppress listener callback errors
      }
    }
  }
}
