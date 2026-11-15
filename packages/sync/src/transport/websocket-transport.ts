/**
 * @dotmix/sync — D-137 WebSocket Sync Transport (Gate 34 / T-34.5)
 *
 * Implements real-time duplex wire envelope streaming, handshake authentication,
 * and automatic anti-entropy range pull upon reconnect with zero external dependencies.
 */

import type { SyncChannel, SyncPacket } from "../types.js";
import type { TransportChannelPrincipal } from "../protocol/types.js";
import {
  createWireEnvelope,
  decodeWireEnvelope,
  type WireEnvelope,
} from "./envelope.js";
import { createWebSocketPrincipal } from "./principal.js";
import type { StreamRangeRequest } from "../protocol/antientropy.js";

export interface WebSocketTransportOptions {
  readonly serverWebSocketUrl?: string | undefined;
  readonly url?: string | undefined;
  readonly collectionId?: string | undefined;
  readonly localReplicaId?: string | undefined;
  readonly connectionIdentifier?: string | undefined;
  readonly reconnectIntervalMilliseconds?: number | undefined;
  readonly reconnectIntervalMs?: number | undefined;
  readonly handshakeToken?: string | undefined;
  readonly getResumeRangeRequests?: (() => StreamRangeRequest[]) | undefined;
  readonly webSocketFactory?: ((targetUrl: string) => WebSocket) | undefined;
}

export class AuthenticatedWebSocketTransport implements SyncChannel {
  public readonly channelKind = "unicast" as const;
  public readonly collectionId: string;
  public readonly localReplicaId: string;

  private readonly serverWebSocketUrl: string;
  private readonly connectionIdentifier: string;
  private readonly reconnectIntervalMilliseconds: number;
  private readonly handshakeToken?: string | undefined;
  private readonly getResumeRangeRequests?: (() => StreamRangeRequest[]) | undefined;
  private readonly webSocketFactory?: ((targetUrl: string) => WebSocket) | undefined;

  private activeWebSocket: WebSocket | null = null;
  private outgoingEnvelopeQueue: WireEnvelope[] = [];
  private outgoingPacketQueue: SyncPacket[] = [];
  private reconnectTimer: unknown = null;
  private isClosed = false;
  private isHandshakeComplete = false;

  private readonly legacyPacketHandlers = new Set<(packet: SyncPacket) => void | Promise<void>>();
  private readonly envelopeListeners = new Set<
    (envelope: WireEnvelope, principal: TransportChannelPrincipal) => Promise<void> | void
  >();

  constructor(options: WebSocketTransportOptions) {
    this.serverWebSocketUrl = options.serverWebSocketUrl ?? options.url ?? "";
    this.collectionId = options.collectionId ?? "default";
    this.localReplicaId = options.localReplicaId ?? `anon_${Date.now()}`;
    this.connectionIdentifier =
      options.connectionIdentifier ?? `ws_${this.localReplicaId}_${Date.now()}`;
    this.reconnectIntervalMilliseconds =
      options.reconnectIntervalMilliseconds ?? options.reconnectIntervalMs ?? 1000;
    this.handshakeToken = options.handshakeToken;
    this.getResumeRangeRequests = options.getResumeRangeRequests;
    this.webSocketFactory = options.webSocketFactory;

    this.setupSocket();
  }

  public getPrincipal(): TransportChannelPrincipal {
    return createWebSocketPrincipal(
      this.connectionIdentifier,
      this.localReplicaId,
      this.isHandshakeComplete
    );
  }

  public async send(packet: SyncPacket): Promise<void> {
    if (this.isClosed) return;
    if (this.activeWebSocket && this.activeWebSocket.readyState === WebSocket.OPEN) {
      this.activeWebSocket.send(JSON.stringify(packet));
    } else {
      this.outgoingPacketQueue.push(packet);
    }
  }

  public async sendEnvelope(envelope: WireEnvelope): Promise<void> {
    if (this.isClosed) return;

    if (
      this.activeWebSocket &&
      this.activeWebSocket.readyState === WebSocket.OPEN &&
      this.isHandshakeComplete
    ) {
      this.activeWebSocket.send(JSON.stringify(envelope));
    } else {
      this.outgoingEnvelopeQueue.push(envelope);
    }
  }

  public onReceiveEnvelope(
    listener: (envelope: WireEnvelope, principal: TransportChannelPrincipal) => Promise<void> | void
  ): () => void {
    this.envelopeListeners.add(listener);
    return () => {
      this.envelopeListeners.delete(listener);
    };
  }

  public onReceive(handler: (packet: SyncPacket) => void | Promise<void>): () => void {
    this.legacyPacketHandlers.add(handler);
    return () => {
      this.legacyPacketHandlers.delete(handler);
    };
  }

  public close(): void {
    this.isClosed = true;
    if (this.reconnectTimer) {
      globalThis.clearTimeout(this.reconnectTimer as ReturnType<typeof setTimeout>);
      this.reconnectTimer = null;
    }
    if (this.activeWebSocket) {
      this.activeWebSocket.close();
      this.activeWebSocket = null;
    }
    this.outgoingEnvelopeQueue = [];
    this.outgoingPacketQueue = [];
    this.legacyPacketHandlers.clear();
    this.envelopeListeners.clear();
  }

  private setupSocket(): void {
    if (this.isClosed) return;

    try {
      if (this.webSocketFactory) {
        this.activeWebSocket = this.webSocketFactory(this.serverWebSocketUrl);
      } else if (typeof WebSocket !== "undefined") {
        this.activeWebSocket = new WebSocket(this.serverWebSocketUrl);
      } else {
        return;
      }

      this.activeWebSocket.onopen = () => {
        this.handleSocketOpen();
      };

      this.activeWebSocket.onmessage = (messageEvent: MessageEvent<unknown>) => {
        this.handleSocketMessage(messageEvent.data);
      };

      this.activeWebSocket.onclose = () => {
        this.handleSocketClose();
      };

      this.activeWebSocket.onerror = () => {
        // Handled through close event
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private handleSocketOpen(): void {
    if (this.handshakeToken) {
      const handshakeEnvelope = createWireEnvelope(
        "serverAck",
        this.collectionId,
        this.localReplicaId,
        {
          serverTimestamp: Date.now(),
          originStreamKey: this.connectionIdentifier,
        },
        this.handshakeToken
      );

      if (this.activeWebSocket && this.activeWebSocket.readyState === WebSocket.OPEN) {
        this.activeWebSocket.send(JSON.stringify(handshakeEnvelope));
        this.isHandshakeComplete = true;
      }
    } else {
      this.isHandshakeComplete = true;
    }

    if (this.activeWebSocket && this.activeWebSocket.readyState === WebSocket.OPEN) {
      // Reconnect resumes through anti-entropy range pull
      if (this.getResumeRangeRequests) {
        try {
          const rangeRequests = this.getResumeRangeRequests();
          for (const rangeRequest of rangeRequests) {
            const rangeEnvelope = createWireEnvelope(
              "rangeRequest",
              this.collectionId,
              this.localReplicaId,
              rangeRequest
            );
            this.activeWebSocket.send(JSON.stringify(rangeEnvelope));
          }
        } catch {
          // Suppress resume range request errors
        }
      }

      // Flush queued envelopes
      while (
        this.outgoingEnvelopeQueue.length > 0 &&
        this.activeWebSocket.readyState === WebSocket.OPEN
      ) {
        const queuedEnvelope = this.outgoingEnvelopeQueue.shift();
        if (queuedEnvelope) {
          this.activeWebSocket.send(JSON.stringify(queuedEnvelope));
        }
      }

      // Flush queued packets
      while (
        this.outgoingPacketQueue.length > 0 &&
        this.activeWebSocket.readyState === WebSocket.OPEN
      ) {
        const queuedPacket = this.outgoingPacketQueue.shift();
        if (queuedPacket) {
          this.activeWebSocket.send(JSON.stringify(queuedPacket));
        }
      }
    }
  }

  private handleSocketMessage(messageData: unknown): void {
    if (!messageData) return;

    try {
      const parsedJson =
        typeof messageData === "string" ? (JSON.parse(messageData) as unknown) : messageData;

      const decodeResult = decodeWireEnvelope(parsedJson);
      if (decodeResult.ok) {
        const principal = this.getPrincipal();
        for (const listener of this.envelopeListeners) {
          try {
            void listener(decodeResult.value, principal);
          } catch {
            // Suppress unhandled listener error
          }
        }
        return;
      }

      // Check legacy packet format
      const candidatePacket = parsedJson as Partial<SyncPacket>;
      if (Array.isArray(candidatePacket.mutations) || Array.isArray(candidatePacket.acks)) {
        for (const handler of this.legacyPacketHandlers) {
          try {
            void handler(parsedJson as SyncPacket);
          } catch {
            // Suppress unhandled handler error
          }
        }
      }
    } catch {
      // Discard invalid JSON frame
    }
  }

  private handleSocketClose(): void {
    this.isHandshakeComplete = false;
    this.activeWebSocket = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isClosed || this.reconnectTimer) return;
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      this.setupSocket();
    }, this.reconnectIntervalMilliseconds);
  }
}
