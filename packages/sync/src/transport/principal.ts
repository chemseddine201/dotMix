/**
 * @dotmix/sync — Authenticated Transport Channel Principals (Gate 34 / T-34.5)
 *
 * Provides typed, authenticated principals for each underlying transport medium:
 * - HTTP (authenticated server session)
 * - WebSocket (authenticated connection handshake)
 * - BroadcastChannel (same-origin tab principal tied to clock-safe lease)
 */

import type { ReplicaId, TransportChannelPrincipal } from "../protocol/types.js";

export type TransportMedium = "http" | "websocket" | "broadcast";

export interface AuthenticatedHttpPrincipal extends TransportChannelPrincipal {
  readonly transportMedium: "http";
  readonly serverSessionIdentifier: string;
  readonly bearerSessionToken?: string | undefined;
}

export interface AuthenticatedWebSocketPrincipal extends TransportChannelPrincipal {
  readonly transportMedium: "websocket";
  readonly connectionIdentifier: string;
  readonly handshakeVerified: boolean;
}

export interface AuthenticatedBroadcastPrincipal extends TransportChannelPrincipal {
  readonly transportMedium: "broadcast";
  readonly tabIdentifier: string;
  readonly leaseFencingTerm: number;
  readonly sameOriginVerified: boolean;
}

export type AnyAuthenticatedPrincipal =
  | AuthenticatedHttpPrincipal
  | AuthenticatedWebSocketPrincipal
  | AuthenticatedBroadcastPrincipal;

/**
 * Creates an authenticated HTTP session channel principal.
 */
export function createHttpPrincipal(
  serverSessionIdentifier: string,
  transportSenderReplicaId: ReplicaId,
  bearerSessionToken?: string
): AuthenticatedHttpPrincipal {
  return {
    channelId: `http:${serverSessionIdentifier}`,
    channelAuthenticated: Boolean(serverSessionIdentifier && transportSenderReplicaId),
    transportSenderReplicaId,
    transportMedium: "http",
    serverSessionIdentifier,
    bearerSessionToken,
  };
}

/**
 * Creates an authenticated WebSocket handshake channel principal.
 */
export function createWebSocketPrincipal(
  connectionIdentifier: string,
  transportSenderReplicaId: ReplicaId,
  handshakeVerified: boolean = true
): AuthenticatedWebSocketPrincipal {
  return {
    channelId: `ws:${connectionIdentifier}`,
    channelAuthenticated: Boolean(connectionIdentifier && transportSenderReplicaId && handshakeVerified),
    transportSenderReplicaId,
    transportMedium: "websocket",
    connectionIdentifier,
    handshakeVerified,
  };
}

/**
 * Creates an authenticated BroadcastChannel tab principal tied to a lease fencing term.
 */
export function createBroadcastPrincipal(
  tabIdentifier: string,
  leaseFencingTerm: number,
  transportSenderReplicaId: ReplicaId,
  sameOriginVerified: boolean = true
): AuthenticatedBroadcastPrincipal {
  return {
    channelId: `tab:${tabIdentifier}:term:${leaseFencingTerm}`,
    channelAuthenticated: Boolean(tabIdentifier && leaseFencingTerm >= 1 && sameOriginVerified),
    transportSenderReplicaId,
    transportMedium: "broadcast",
    tabIdentifier,
    leaseFencingTerm,
    sameOriginVerified,
  };
}


/**
 * Validates that an incoming wire message principal is authentic and allowed.
 */
export function verifyChannelPrincipal(
  principal: TransportChannelPrincipal,
  expectedReplicaIdentifier?: ReplicaId
): boolean {
  if (!principal.channelAuthenticated) return false;
  if (!principal.channelId) return false;
  if (!principal.transportSenderReplicaId) return false;
  if (expectedReplicaIdentifier && principal.transportSenderReplicaId !== expectedReplicaIdentifier) {
    return false;
  }
  return true;
}
