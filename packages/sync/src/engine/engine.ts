/**
 * @dotmix/sync — Central Client Sync Coordinator Engine
 */

import { signal, type Signal } from "@dotmix/runtime";
import type { Mutation, SyncChannel, SyncDriver, SyncPacket, SyncStatus } from "../types.js";
import { getDefaultClientId, LamportClock } from "../crdt/clock.js";
import { MemoryDriver } from "../storage/memory.js";

export interface SyncStoreHandler {
  applyRemoteMutation(mutation: Mutation<unknown>): void;
  rollbackMutation(mutationIdStr: string): void;
  commitMutation?(mutationIdStr: string): void;
  compact?(ackWatermarkClock: number): number;
  registerPeer?(peerId: string, watermark?: number): void;
  witnessPeer?(peerId: string, timestamp: number): void;
}

export class SyncEngine {
  readonly clientId: string;
  readonly clock: LamportClock;
  readonly driver: SyncDriver;
  readonly isOnline: Signal<boolean>;
  readonly status: Signal<SyncStatus>;

  private channel: SyncChannel | null = null;
  private unlistenChannel: (() => void) | null = null;
  private stores: Map<string, SyncStoreHandler> = new Map();
  private collections: Map<string, unknown> = new Map();
  private signals: Map<string, unknown> = new Map();
  private pendingQueue: Mutation<unknown>[] = [];
  private flushing = false;
  private peerWatermarks: Map<string, number> = new Map();

  registerPeer(peerId: string, watermark = 0): void {
    this.peerWatermarks.set(peerId, watermark);
    for (const store of this.stores.values()) {
      store.registerPeer?.(peerId, watermark);
    }
  }

  witnessPeer(peerId: string, timestamp: number): void {
    const current = this.peerWatermarks.get(peerId) ?? 0;
    if (timestamp > current) {
      this.peerWatermarks.set(peerId, timestamp);
    }
    for (const store of this.stores.values()) {
      store.witnessPeer?.(peerId, timestamp);
    }
  }

  getStabilityHorizon(): number {
    if (this.peerWatermarks.size === 0) return 0;
    let min = Infinity;
    for (const wm of this.peerWatermarks.values()) {
      if (wm < min) min = wm;
    }
    return min === Infinity ? 0 : min;
  }

  constructor(options: {
    clientId?: string;
    driver?: SyncDriver;
    channel?: SyncChannel;
    initialOnline?: boolean;
  } = {}) {
    this.clientId = options.clientId || getDefaultClientId();
    this.clock = new LamportClock(this.clientId);
    this.driver = options.driver || new MemoryDriver();
    const onlineInit = options.initialOnline ?? (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true);
    this.isOnline = signal(onlineInit);
    this.status = signal<SyncStatus>(onlineInit ? "synced" : "offline");

    if (options.channel) {
      this.setChannel(options.channel);
    }

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", () => this.goOnline());
      window.addEventListener("offline", () => this.goOffline());
    }
  }

  get queue(): Mutation<unknown>[] {
    return [...this.pendingQueue];
  }

  setChannel(channel: SyncChannel): void {
    if (this.unlistenChannel) {
      this.unlistenChannel();
    }
    this.channel = channel;
    this.unlistenChannel = channel.onReceive((packet) => this.handleIncomingPacket(packet));
  }

  getOrCreateCollection<T>(key: string, factory: () => T): T {
    if (this.collections.has(key)) {
      return this.collections.get(key) as T;
    }
    const inst = factory();
    this.collections.set(key, inst);
    return inst;
  }

  getOrCreateSignal<T>(key: string, factory: () => T): T {
    if (this.signals.has(key)) {
      return this.signals.get(key) as T;
    }
    const inst = factory();
    this.signals.set(key, inst);
    return inst;
  }

  registerStore(storeKey: string, handler: SyncStoreHandler): () => void {
    this.stores.set(storeKey, handler);
    return () => {
      this.stores.delete(storeKey);
    };
  }

  goOnline(): void {
    this.isOnline.set(true);
    this.status.set("syncing");
    void this.flush();
  }

  goOffline(): void {
    this.isOnline.set(false);
    this.status.set("offline");
  }

  async enqueueMutation(mutation: Mutation<unknown>): Promise<void> {
    this.clock.witness(mutation.id.timestamp);
    await this.driver.appendMutation(mutation);
    this.pendingQueue.push(mutation);

    if (!this.channel) {
      await this.driver.markMutationsCommitted([mutation.idStr]);
      const store = this.stores.get(mutation.storeKey);
      store?.commitMutation?.(mutation.idStr);
      this.pendingQueue = this.pendingQueue.filter((m) => m.idStr !== mutation.idStr);
      this.status.set("synced");
    } else if (this.isOnline()) {
      await this.flush();
    } else {
      this.status.set("offline");
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.isOnline() || !this.channel) {
      return;
    }
    this.flushing = true;
    this.status.set("syncing");

    try {
      // Re-read any uncommitted mutations from driver log
      const pendingFromDriver = await this.driver.getPendingMutations();
      const combinedMutations = new Map<string, Mutation<unknown>>();
      for (const queuedMutation of this.pendingQueue) combinedMutations.set(queuedMutation.idStr, queuedMutation);
      for (const driverMutation of pendingFromDriver) combinedMutations.set(driverMutation.idStr, driverMutation);

      const outgoingMutations = Array.from(combinedMutations.values());
      if (outgoingMutations.length > 0) {
        const packet: SyncPacket = {
          clientId: this.clientId,
          mutations: outgoingMutations,
        };
        await this.channel.send(packet);

        const isBroadcast =
          Boolean((this.channel as { isBroadcast?: boolean; channelKind?: string }).isBroadcast) ||
          (this.channel as { channelKind?: string }).channelKind === "broadcast";

        if (isBroadcast) {
          const committedMutationIds = outgoingMutations.map((mutationRecord) => mutationRecord.idStr);
          await this.driver.markMutationsCommitted(committedMutationIds);
          for (const committedMutation of outgoingMutations) {
            const store = this.stores.get(committedMutation.storeKey);
            store?.commitMutation?.(committedMutation.idStr);
          }
          this.pendingQueue = this.pendingQueue.filter(
            (queuedMutation) => !committedMutationIds.includes(queuedMutation.idStr)
          );
        }
      }
      this.status.set(this.pendingQueue.length === 0 ? "synced" : "syncing");
    } catch {
      this.status.set("error");
    } finally {
      this.flushing = false;
    }
  }

  private async handleIncomingPacket(packet: SyncPacket): Promise<void> {
    // 1. Process server ACKs
    if (packet.acks && packet.acks.length > 0) {
      await this.driver.markMutationsCommitted(packet.acks);
      for (const ackId of packet.acks) {
        for (const store of this.stores.values()) {
          store.commitMutation?.(ackId);
        }
      }
      this.pendingQueue = this.pendingQueue.filter((m) => !packet.acks!.includes(m.idStr));
      if (this.pendingQueue.length === 0 && this.isOnline()) {
        this.status.set("synced");
      }
    }

    // 2. Process rejections (Trigger transactional rollback!)
    if (packet.rejections && packet.rejections.length > 0) {
      for (const rej of packet.rejections) {
        await this.driver.markMutationRejected(rej.idStr);
        const rejectedMutation = this.pendingQueue.find((m) => m.idStr === rej.idStr);
        this.pendingQueue = this.pendingQueue.filter((m) => m.idStr !== rej.idStr);

        if (rejectedMutation) {
          const store = this.stores.get(rejectedMutation.storeKey);
          if (store) {
            store.rollbackMutation(rej.idStr);
          }
        } else {
          for (const store of this.stores.values()) {
            store.rollbackMutation(rej.idStr);
          }
        }
      }
    }

    // 3. Process remote incoming mutations
    if (packet.mutations && packet.mutations.length > 0) {
      const acksToSend: string[] = [];
      let maxRemoteTs = 0;

      for (const remoteMut of packet.mutations) {
        // Skip mutations generated by our own client
        if (remoteMut.id.clientId === this.clientId) {
          continue;
        }

        if (remoteMut.id.timestamp > maxRemoteTs) {
          maxRemoteTs = remoteMut.id.timestamp;
        }

        this.clock.witness(remoteMut.id.timestamp);
        const store = this.stores.get(remoteMut.storeKey);
        if (store) {
          store.applyRemoteMutation(remoteMut);
          acksToSend.push(remoteMut.idStr);
        }
      }

      if (packet.clientId && maxRemoteTs > 0) {
        this.witnessPeer(packet.clientId, maxRemoteTs);
      }

      // If channel is available, ACK received remote mutations
      if (acksToSend.length > 0 && this.channel) {
        void this.channel.send({
          clientId: this.clientId,
          mutations: [],
          acks: acksToSend,
        });
      }
    }
  }

  async compact(ackWatermarkClock?: number): Promise<{ purgedTombstones: number; prunedLogEntries: number }> {
    const stability = this.getStabilityHorizon();
    let effective = ackWatermarkClock ?? (stability > 0 ? stability : this.clock.currentTime);
    if (this.peerWatermarks.size > 0 && ackWatermarkClock !== undefined) {
      effective = Math.min(ackWatermarkClock, stability);
    }

    let purgedTombstones = 0;
    for (const store of this.stores.values()) {
      if (typeof store.compact === "function") {
        purgedTombstones += store.compact(effective);
      }
    }

    let prunedLogEntries = 0;
    if (typeof this.driver.pruneMutations === "function") {
      prunedLogEntries = await this.driver.pruneMutations(
        (m) => m.state === "committed" && m.id.timestamp <= effective
      );
    }

    return {
      purgedTombstones,
      prunedLogEntries,
    };
  }

  destroy(): void {
    if (this.unlistenChannel) {
      this.unlistenChannel();
    }
    if (this.channel) {
      this.channel.close();
    }
    this.stores.clear();
    this.pendingQueue = [];
  }
}

let defaultEngine: SyncEngine | null = null;

export function getDefaultSyncEngine(): SyncEngine {
  if (!defaultEngine) {
    defaultEngine = new SyncEngine();
  }
  return defaultEngine;
}

