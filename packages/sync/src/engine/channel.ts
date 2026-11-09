/**
 * @mix/sync — Transport Channels for Distributed Synchronization
 */

import type { Mutation, SyncChannel, SyncPacket } from "../types.js";

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

export interface HttpBatchOptions {
  endpoint: string;
  batchIntervalMs?: number | undefined;
  headers?: Record<string, string> | undefined;
  fetchFn?: typeof fetch | undefined;
}

export class HttpBatchSyncTransport implements SyncChannel {
  private endpoint: string;
  private batchIntervalMs: number;
  private headers: Record<string, string>;
  private fetchFn: typeof fetch;
  private handlers = new Set<(packet: SyncPacket) => void | Promise<void>>();
  private outgoingMutations: Mutation<unknown>[] = [];
  private outgoingAcks: string[] = [];
  private flushTimer: unknown = null;
  private isClosed = false;

  constructor(options: HttpBatchOptions) {
    this.endpoint = options.endpoint;
    this.batchIntervalMs = options.batchIntervalMs ?? 50;
    this.headers = options.headers ?? {};
    this.fetchFn =
      options.fetchFn ??
      (typeof fetch !== "undefined" ? fetch : (null as unknown as typeof fetch));
  }

  async send(packet: SyncPacket): Promise<void> {
    if (this.isClosed) return;
    if (packet.mutations && packet.mutations.length > 0) {
      this.outgoingMutations.push(...packet.mutations);
    }
    if (packet.acks && packet.acks.length > 0) {
      this.outgoingAcks.push(...packet.acks);
    }

    if (!this.flushTimer) {
      this.flushTimer = globalThis.setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.batchIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (
      (this.outgoingMutations.length === 0 && this.outgoingAcks.length === 0) ||
      !this.fetchFn ||
      this.isClosed
    ) {
      return;
    }

    const mutations = this.outgoingMutations.splice(0, this.outgoingMutations.length);
    const acks = this.outgoingAcks.splice(0, this.outgoingAcks.length);

    try {
      const res = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify({ mutations, acks }),
      });

      if (res.ok) {
        const data = (await res.json()) as SyncPacket;
        if (data) {
          for (const h of this.handlers) {
            void h(data);
          }
        }
      } else {
        // Re-queue on HTTP error
        this.outgoingMutations.unshift(...mutations);
        this.outgoingAcks.unshift(...acks);
      }
    } catch {
      // Re-queue on network error
      this.outgoingMutations.unshift(...mutations);
      this.outgoingAcks.unshift(...acks);
    }
  }

  onReceive(handler: (packet: SyncPacket) => void | Promise<void>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.isClosed = true;
    if (this.flushTimer) {
      globalThis.clearTimeout(this.flushTimer as ReturnType<typeof setTimeout>);
      this.flushTimer = null;
    }
    this.outgoingMutations = [];
    this.outgoingAcks = [];
    this.handlers.clear();
  }
}

export interface WebSocketOptions {
  url: string;
  reconnectIntervalMs?: number | undefined;
}

export class WebSocketSyncTransport implements SyncChannel {
  private url: string;
  private reconnectIntervalMs: number;
  private ws: WebSocket | null = null;
  private handlers = new Set<(packet: SyncPacket) => void | Promise<void>>();
  private sendQueue: SyncPacket[] = [];
  private isClosed = false;

  constructor(options: WebSocketOptions) {
    this.url = options.url;
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? 1000;
    this.connect();
  }

  private connect(): void {
    if (this.isClosed || typeof WebSocket === "undefined") return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        while (this.sendQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
          const packet = this.sendQueue.shift()!;
          this.ws.send(JSON.stringify(packet));
        }
      };
      this.ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(String(event.data)) as SyncPacket;
          for (const h of this.handlers) {
            void h(packet);
          }
        } catch {
          // ignore malformed frame
        }
      };
      this.ws.onclose = () => {
        if (!this.isClosed) {
          globalThis.setTimeout(() => this.connect(), this.reconnectIntervalMs);
        }
      };
    } catch {
      if (!this.isClosed) {
        globalThis.setTimeout(() => this.connect(), this.reconnectIntervalMs);
      }
    }
  }

  async send(packet: SyncPacket): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(packet));
    } else {
      this.sendQueue.push(packet);
    }
  }

  onReceive(handler: (packet: SyncPacket) => void | Promise<void>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.isClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sendQueue = [];
    this.handlers.clear();
  }
}
