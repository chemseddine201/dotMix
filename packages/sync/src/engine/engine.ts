/**
 * @mix/sync — Central Client Sync Coordinator Engine
 */

import { signal, type Signal } from "@mix/runtime";
import type { Mutation, SyncChannel, SyncDriver, SyncPacket, SyncStatus } from "../types.js";
import { getDefaultClientId, LamportClock } from "../crdt/clock.js";
import { MemoryDriver } from "../storage/memory.js";

export interface SyncStoreHandler {
  applyRemoteMutation(mutation: Mutation<unknown>): void;
  rollbackMutation(mutationIdStr: string): void;
  commitMutation?(mutationIdStr: string): void;
  compact?(ackWatermarkClock: number): number;
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

  constructor(options: {
    clientId?: string;
    driver?: SyncDriver;
    channel?: SyncChannel;
    initialOnline?: boolean;
  } = {}) {
    this.clientId = options.clientId || getDefaultClientId();
    this.clock = new LamportClock(this.clientId);
    this.driver = options.driver || new MemoryDriver();
    const onlineInit = options.initialOnline ?? (typeof navigator !== "undefined" ? navigator.onLine : true);
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
      const combined = new Map<string, Mutation<unknown>>();
      for (const m of this.pendingQueue) combined.set(m.idStr, m);
      for (const m of pendingFromDriver) combined.set(m.idStr, m);

      const toSend = Array.from(combined.values());
      if (toSend.length > 0) {
        const packet: SyncPacket = {
          clientId: this.clientId,
          mutations: toSend,
        };
        await this.channel.send(packet);

        const isBroadcast =
          (this.channel as { isBroadcast?: boolean }).isBroadcast ||
          this.channel.constructor.name === "BroadcastChannelTransport";

        if (isBroadcast) {
          const sentIds = toSend.map((m) => m.idStr);
          await this.driver.markMutationsCommitted(sentIds);
          for (const m of toSend) {
            const store = this.stores.get(m.storeKey);
            store?.commitMutation?.(m.idStr);
          }
          this.pendingQueue = this.pendingQueue.filter((m) => !sentIds.includes(m.idStr));
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
        }
      }
    }

    // 3. Process remote incoming mutations
    if (packet.mutations && packet.mutations.length > 0) {
      const acksToSend: string[] = [];
      for (const remoteMut of packet.mutations) {
        // Skip mutations generated by our own client
        if (remoteMut.id.clientId === this.clientId) {
          continue;
        }

        this.clock.witness(remoteMut.id.timestamp);
        const store = this.stores.get(remoteMut.storeKey);
        if (store) {
          store.applyRemoteMutation(remoteMut);
          acksToSend.push(remoteMut.idStr);
        }
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

  async compact(ackWatermarkClock: number): Promise<{ purgedTombstones: number; prunedLogEntries: number }> {
    let purgedTombstones = 0;
    for (const store of this.stores.values()) {
      if (typeof store.compact === "function") {
        purgedTombstones += store.compact(ackWatermarkClock);
      }
    }

    let prunedLogEntries = 0;
    if (typeof this.driver.pruneMutations === "function") {
      prunedLogEntries = await this.driver.pruneMutations(
        (m) => m.state === "committed" && m.id.timestamp <= ackWatermarkClock
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

