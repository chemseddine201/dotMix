/**
 * @dotmix/sync — Remote Wire Envelope Processing Bridge
 *
 * Ingests incoming wire envelopes strictly through ReplicationEngine.ingestRemoteOperation
 * (enforcing cryptographic signatures, certificate membership, and lease fencing).
 * Zero external dependencies.
 */

import type { Mutation } from "../types.js";
import type { ReplicationEngine } from "../protocol/engine.js";
import {
  decodeWireEnvelope,
  type WireEnvelope,
} from "../transport/envelope.js";
import type {
  EpochMembershipCertificate,
  ReplicableOperation,
  TransportChannelPrincipal,
} from "../protocol/types.js";

export interface RemoteWireProcessingResult {
  readonly accepted: boolean;
  readonly topologyError?: string | undefined;
}

/**
 * Ingests an incoming wire envelope strictly through the protocol engine.
 * Never bypasses signature checks, preverification, or membership bindings.
 */
export async function processRemoteWireEnvelope(
  candidateEnvelopeOrPayload: unknown,
  engineInstance: ReplicationEngine,
  channelPrincipal?: TransportChannelPrincipal
): Promise<RemoteWireProcessingResult> {
  const decodeOutcome = decodeWireEnvelope(candidateEnvelopeOrPayload);
  if (!decodeOutcome.ok) return { accepted: false };
  const wireEnvelope = decodeOutcome.value;

  if (wireEnvelope.type === "op" && wireEnvelope.payload) {
    const operation = wireEnvelope.payload as ReplicableOperation;

    // Topology enforcement:
    // Release 1 supports isolated-local, browser-shared-origin, and server-coordinated.
    // Coordinator-less peer-to-peer multi-device is deferred.
    // Two replicated clients wired peer-to-peer with no coordinator exchange NO data.
    const memberBinding = engineInstance.meta.epochMemberBindings[operation.opDot.replicaId];
    if (!memberBinding) {
      return {
        accepted: false,
        topologyError: "SYNC_TOPOLOGY_REQUIRES_COORDINATOR",
      };
    }

    if (!channelPrincipal || !channelPrincipal.channelAuthenticated) {
      return { accepted: false };
    }

    const ingestOutcome = await engineInstance.ingestRemoteOperation(operation, channelPrincipal);
    return { accepted: ingestOutcome.ok };
  }

  if (wireEnvelope.type === "cert" && wireEnvelope.payload) {
    const certOutcome = await engineInstance.ingestEpochTransitionCertificate(
      wireEnvelope.payload as EpochMembershipCertificate
    );
    return { accepted: certOutcome.ok };
  }

  return { accepted: false };
}

/**
 * Processes incoming mutations delivered through legacy channels or adapters.
 * On replicated, a remote change is accepted ONLY as a signed op through ingestRemoteOperation.
 * Plain legacy mutations are rejected.
 */
export async function processRemoteMutation(
  remoteMutation: Mutation<unknown>,
  engineInstance: ReplicationEngine,
  channelPrincipal?: TransportChannelPrincipal
): Promise<RemoteWireProcessingResult> {
  const candidateEnvelope =
    (remoteMutation as unknown as { replicationEnvelope?: WireEnvelope }).replicationEnvelope ??
    (remoteMutation as unknown as { envelope?: WireEnvelope }).envelope;

  if (candidateEnvelope) {
    return processRemoteWireEnvelope(candidateEnvelope, engineInstance, channelPrincipal);
  }

  return { accepted: false };
}
