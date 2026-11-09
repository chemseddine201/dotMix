/**
 * @mix/sync — Transport Channels for Distributed Synchronization
 */

import type { SyncChannel, SyncPacket } from "../types.js";

export class MockTransportChannel implements SyncChannel {
  private handlers = new Set<(packet: SyncPacket) => void | Promise<void>>();
  public peerChannel: MockTransportChannel | null = null;
  public isOnline = true;
  public latencyMs = 0;

  async send(packet: SyncPacket): Promise<void> {
    if (!this.isOnline || !this.peerChannel) {
      return;
    }
    const cloned = structuredClone(packet);
    if (this.latencyMs > 0) {
      setTimeout(() => {
        if (this.isOnline && this.peerChannel) {
          this.peerChannel.deliver(cloned);
        }
      }, this.latencyMs);
    } else {
      this.peerChannel.deliver(cloned);
    }
  }

  deliver(packet: SyncPacket): void {
    if (!this.isOnline) return;
    for (const h of this.handlers) {
      void h(packet);
    }
  }

  onReceive(handler: (packet: SyncPacket) => void | Promise<void>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.handlers.clear();
    this.peerChannel = null;
  }
}

export class BroadcastChannelTransport implements SyncChannel {
  private channel: BroadcastChannel | null = null;
  private handlers = new Set<(packet: SyncPacket) => void | Promise<void>>();

  constructor(channelName = "mix_sync_broadcast") {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(channelName);
      const unrefChannel = this.channel as unknown as { unref?: () => void };
      if (typeof unrefChannel.unref === "function") {
        unrefChannel.unref();
      }
      this.channel.onmessage = (event: MessageEvent<SyncPacket>) => {
        for (const h of this.handlers) {
          void h(event.data);
        }
      };
    }
  }

  async send(packet: SyncPacket): Promise<void> {
    if (this.channel) {
      this.channel.postMessage(packet);
    }
  }

  onReceive(handler: (packet: SyncPacket) => void | Promise<void>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.handlers.clear();
  }
}
