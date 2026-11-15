/**
 * @dotmix/sync — D-137 BroadcastChannel Transport (Gate 34 / T-34.5 / T-34.6)
 *
 * Implements wire envelope exchange and multi-tab lease coordination over
 * the browser BroadcastChannel API with zero external dependencies.
 */

import type { SyncChannel, SyncPacket } from "../types.js";
import type { TransportChannelPrincipal } from "../protocol/types.js";
import {
  decodeWireEnvelope,
  type WireEnvelope,
} from "./envelope.js";
import { createBroadcastPrincipal } from "./principal.js";
import { MultiTabCoordinator, type MultiTabCoordinatorOptions } from "./multi-tab.js";

export interface BroadcastTransportOptions extends MultiTabCoordinatorOptions {
  readonly channelName?: string | undefined;
  readonly broadcastChannelFactory?: ((channelName: string) => BroadcastChannel) | undefined;
}

export class BroadcastChannelSyncTransport implements SyncChannel {
  public readonly isBroadcast = true;
  public readonly channelKind = "broadcast" as const;
  public readonly coordinator: MultiTabCoordinator;

  private broadcastChannel: BroadcastChannel | null = null;
  private readonly legacyPacketHandlers = new Set<(packet: SyncPacket) => void | Promise<void>>();
  private readonly envelopeListeners = new Set<
    (envelope: WireEnvelope, principal: TransportChannelPrincipal) => Promise<void> | void
  >();
  private isClosed = false;

  constructor(options: BroadcastTransportOptions) {
    this.coordinator = new MultiTabCoordinator(options);
    const channelName = options.channelName ?? `mix_d137_broadcast_${options.collectionId}`;

    if (options.broadcastChannelFactory) {
      this.broadcastChannel = options.broadcastChannelFactory(channelName);
    } else if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel(channelName);
      const unrefChannel = this.broadcastChannel as unknown as { unref?: () => void };
      if (typeof unrefChannel.unref === "function") {
        unrefChannel.unref();
      }
    }

    if (this.broadcastChannel) {
      this.broadcastChannel.onmessage = (messageEvent: MessageEvent<unknown>) => {
        this.handleIncomingRawMessage(messageEvent.data);
      };
    }
  }

  /**
   * Sends a legacy SyncPacket (for legacy compatibility).
   */
  public async send(packet: SyncPacket): Promise<void> {
    if (this.isClosed || !this.broadcastChannel) return;
    this.broadcastChannel.postMessage(packet);
  }

  /**
   * Sends a strictly validated D-137 WireEnvelope.
   */
  public async sendEnvelope(envelope: WireEnvelope): Promise<void> {
    if (this.isClosed || !this.broadcastChannel) return;
    this.broadcastChannel.postMessage(envelope);
  }

  /**
   * Registers a listener for strictly decoded WireEnvelopes.
   */
  public onReceiveEnvelope(
    listener: (envelope: WireEnvelope, principal: TransportChannelPrincipal) => Promise<void> | void
  ): () => void {
    this.envelopeListeners.add(listener);
    return () => {
      this.envelopeListeners.delete(listener);
    };
  }

  /**
   * Registers a listener for legacy SyncPackets.
   */
  public onReceive(handler: (packet: SyncPacket) => void | Promise<void>): () => void {
    this.legacyPacketHandlers.add(handler);
    return () => {
      this.legacyPacketHandlers.delete(handler);
    };
  }

  /**
   * Closes transport and releases underlying resources.
   */
  public close(): void {
    this.isClosed = true;
    this.coordinator.dispose();
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    this.legacyPacketHandlers.clear();
    this.envelopeListeners.clear();
  }

  private handleIncomingRawMessage(rawMessage: unknown): void {
    if (!rawMessage || typeof rawMessage !== "object") return;

    // Check if it is a D-137 WireEnvelope
    const decodeResult = decodeWireEnvelope(rawMessage);
    if (decodeResult.ok) {
      const decodedEnvelope = decodeResult.value;
      const principal = createBroadcastPrincipal(
        this.coordinator.tabIdentifier,
        this.coordinator.getFencingTerm(),
        decodedEnvelope.senderReplicaId
      );

      for (const listener of this.envelopeListeners) {
        try {
          void listener(decodedEnvelope, principal);
        } catch {
          // Suppress unhandled listener error
        }
      }
      return;
    }

    // Otherwise check if it is a legacy SyncPacket
    const candidatePacket = rawMessage as Partial<SyncPacket>;
    if (Array.isArray(candidatePacket.mutations) || Array.isArray(candidatePacket.acks)) {
      for (const handler of this.legacyPacketHandlers) {
        try {
          void handler(rawMessage as SyncPacket);
        } catch {
          // Suppress unhandled handler error
        }
      }
    }
  }
}
