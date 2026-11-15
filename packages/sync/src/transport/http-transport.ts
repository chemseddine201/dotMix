/**
 * @dotmix/sync — D-137 HTTP Sync Transport (Gate 34 / T-34.5)
 *
 * Implements wire envelope batching, anti-entropy range pulls, and server
 * session authentication over HTTP with zero external dependencies.
 */

import type { SyncChannel, SyncPacket } from "../types.js";
import type { TransportChannelPrincipal } from "../protocol/types.js";
import {
  decodeWireEnvelope,
  type WireEnvelope,
} from "./envelope.js";
import { createHttpPrincipal } from "./principal.js";
import type { StreamRangeRequest, StreamRangeResponse } from "../protocol/antientropy.js";

export interface HttpTransportOptions {
  readonly endpointUrl: string;
  readonly collectionId: string;
  readonly localReplicaId: string;
  readonly serverSessionIdentifier?: string | undefined;
  readonly bearerSessionToken?: string | undefined;
  readonly batchIntervalMilliseconds?: number | undefined;
  readonly customFetchFunction?: typeof fetch | undefined;
  readonly customHeaders?: Record<string, string> | undefined;
}

export class HttpSyncTransport implements SyncChannel {
  public readonly channelKind = "unicast" as const;
  public readonly collectionId: string;
  public readonly localReplicaId: string;

  private readonly endpointUrl: string;
  private readonly serverSessionIdentifier: string;
  private readonly bearerSessionToken?: string | undefined;
  private readonly batchIntervalMilliseconds: number;
  private readonly performFetch: typeof fetch;
  private readonly customHeaders: Record<string, string>;

  private outgoingEnvelopes: WireEnvelope[] = [];
  private batchFlushTimer: unknown = null;
  private isClosed = false;

  private readonly legacyPacketHandlers = new Set<(packet: SyncPacket) => void | Promise<void>>();
  private readonly envelopeListeners = new Set<
    (envelope: WireEnvelope, principal: TransportChannelPrincipal) => Promise<void> | void
  >();

  constructor(options: HttpTransportOptions) {
    this.endpointUrl = options.endpointUrl;
    this.collectionId = options.collectionId;
    this.localReplicaId = options.localReplicaId;
    this.serverSessionIdentifier = options.serverSessionIdentifier ?? `session_${options.localReplicaId}`;
    this.bearerSessionToken = options.bearerSessionToken;
    this.batchIntervalMilliseconds = options.batchIntervalMilliseconds ?? 50;
    this.customHeaders = options.customHeaders ?? {};
    this.performFetch =
      options.customFetchFunction ??
      (typeof fetch !== "undefined" ? fetch : (null as unknown as typeof fetch));
  }

  public getPrincipal(): TransportChannelPrincipal {
    return createHttpPrincipal(
      this.serverSessionIdentifier,
      this.localReplicaId,
      this.bearerSessionToken
    );
  }

  public async send(packet: SyncPacket): Promise<void> {
    if (this.isClosed) return;
    // For legacy packets, convert or forward
    await this.postRawJsonPayload(`${this.endpointUrl}/legacy`, packet);
  }

  public async sendEnvelope(envelope: WireEnvelope): Promise<void> {
    if (this.isClosed) return;
    this.outgoingEnvelopes.push(envelope);

    if (!this.batchFlushTimer) {
      this.batchFlushTimer = globalThis.setTimeout(() => {
        this.batchFlushTimer = null;
        void this.flushBatch();
      }, this.batchIntervalMilliseconds);
    }
  }

  public async flushBatch(): Promise<void> {
    if (this.outgoingEnvelopes.length === 0 || this.isClosed || !this.performFetch) {
      return;
    }

    const envelopesToTransmit = this.outgoingEnvelopes.splice(0, this.outgoingEnvelopes.length);

    try {
      const transmissionResult = await this.performFetch(`${this.endpointUrl}/envelope`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mix-Session": this.serverSessionIdentifier,
          ...(this.bearerSessionToken ? { Authorization: `Bearer ${this.bearerSessionToken}` } : {}),
          ...this.customHeaders,
        },
        body: JSON.stringify({ envelopes: envelopesToTransmit }),
      });

      if (transmissionResult.ok) {
        const responseData = (await transmissionResult.json()) as { incomingEnvelopes?: unknown[] };
        if (responseData && Array.isArray(responseData.incomingEnvelopes)) {
          this.processIncomingEnvelopes(responseData.incomingEnvelopes);
        }
      } else {
        // Re-queue uncommitted envelopes upon transmission failure
        this.outgoingEnvelopes.unshift(...envelopesToTransmit);
      }
    } catch {
      // Re-queue uncommitted envelopes upon network failure
      this.outgoingEnvelopes.unshift(...envelopesToTransmit);
    }
  }

  /**
   * Performs an anti-entropy range pull against the remote coordinator.
   */
  public async pullStreamRange(
    rangeRequest: StreamRangeRequest
  ): Promise<StreamRangeResponse | null> {
    if (this.isClosed || !this.performFetch) return null;

    try {
      const rangePullResult = await this.performFetch(`${this.endpointUrl}/range`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mix-Session": this.serverSessionIdentifier,
          ...this.customHeaders,
        },
        body: JSON.stringify(rangeRequest),
      });

      if (!rangePullResult.ok) return null;
      const responseJson = (await rangePullResult.json()) as unknown;
      return responseJson as StreamRangeResponse;
    } catch {
      return null;
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
    if (this.batchFlushTimer) {
      globalThis.clearTimeout(this.batchFlushTimer as ReturnType<typeof setTimeout>);
      this.batchFlushTimer = null;
    }
    this.outgoingEnvelopes = [];
    this.legacyPacketHandlers.clear();
    this.envelopeListeners.clear();
  }

  private processIncomingEnvelopes(rawEnvelopes: unknown[]): void {
    const principal = this.getPrincipal();
    for (const rawEnvelope of rawEnvelopes) {
      const decodeResult = decodeWireEnvelope(rawEnvelope);
      if (decodeResult.ok) {
        for (const listener of this.envelopeListeners) {
          try {
            void listener(decodeResult.value, principal);
          } catch {
            // Suppress unhandled listener error
          }
        }
      }
    }
  }

  private async postRawJsonPayload(targetUrl: string, jsonBody: unknown): Promise<void> {
    if (!this.performFetch) return;
    try {
      await this.performFetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.customHeaders,
        },
        body: JSON.stringify(jsonBody),
      });
    } catch {
      // Suppress background push error
    }
  }
}
