/**
 * @dotmix/sync — Reference Coordinator Test Tooling
 *
 * Implements a standalone Node test coordinator for distributed clusters:
 * - Issues genesis & epoch transition certificates with ECDSA P-256 signatures.
 * - Assigns replica IDs to joining nodes.
 * - Validates, journals, ACKs, and relays operations.
 * - Generates serverRejections with compensation details.
 * - Serves bootstrap payloads and anti-entropy range pulls.
 * - Coordinates cluster epoch transitions.
 *
 * NOTE: This is test harness tooling only. Never imported by packages/**.
 */

import {
  createWireEnvelope,
  decodeWireEnvelope,
  type BootstrapPayload,
  type ServerAckPayload,
  type ServerRejectPayload,
  type WireEnvelope,
} from "../../packages/sync/dist/transport/envelope.js";
import {
  generateSigningKeyPair,
  signPayloadAsync,
  type LocalKeyPair,
} from "../../packages/sync/dist/protocol/signing.js";
import { canonicalizeValue } from "../../packages/sync/dist/protocol/canonical.js";
import {
  type EpochMemberKeyBinding,
  type EpochMembershipCertificate,
  type OriginStreamKey,
  PROTOCOL_VERSION,
  type ReplicableOperation,
  type SequenceNumber,
  type TransportChannelPrincipal,
} from "../../packages/sync/dist/protocol/types.js";
import type { StreamRangeRequest, StreamRangeResponse } from "../../packages/sync/dist/protocol/antientropy.js";

export interface RegisteredClientSession {
  readonly replicaId: string;
  readonly authorKeyId: string;
  readonly authorPublicKeyHex: string;
  readonly role: "WRITER_REPLICA" | "READ_ONLY_REPLICA";
  readonly registeredTimestamp: number;
}

export interface CoordinatorOptions {
  readonly collectionId: string;
  readonly coordinatorReplicaId?: string | undefined;
  readonly coordinatorKeyId?: string | undefined;
}

export class SyncReferenceCoordinator {
  public readonly collectionId: string;
  public readonly coordinatorReplicaId: string;
  public readonly coordinatorKeyId: string;

  private currentEpochNumber: number = 1;
  private coordinatorKeyPair: LocalKeyPair | null = null;
  private currentCertificate: EpochMembershipCertificate | null = null;

  private registeredClients = new Map<string, RegisteredClientSession>();
  private clientCounter: number = 0;

  private mutationJournal = new Map<string, ReplicableOperation>();
  private clusterFrontier: Record<OriginStreamKey, SequenceNumber> = {};
  private connectedListeners = new Set<(envelope: WireEnvelope) => void>();

  constructor(options: CoordinatorOptions) {
    this.collectionId = options.collectionId;
    this.coordinatorReplicaId = options.coordinatorReplicaId ?? "coord-master";
    this.coordinatorKeyId = options.coordinatorKeyId ?? "key-coord-1";
  }

  public async initialize(): Promise<void> {
    this.coordinatorKeyPair = await generateSigningKeyPair("ECDSA_P256", true);
    await this.issueGenesisCertificate();
  }

  public getEpochNumber(): number {
    return this.currentEpochNumber;
  }

  public getCertificate(): EpochMembershipCertificate {
    if (!this.currentCertificate) {
      throw new Error("Coordinator uninitialized: call initialize() first");
    }
    return this.currentCertificate;
  }

  public getClusterFrontier(): Record<OriginStreamKey, SequenceNumber> {
    return { ...this.clusterFrontier };
  }

  public evictClient(clientId: string): void {
    this.registeredClients.delete(clientId);
  }

  /**
   * Registers a client replica into the membership certificate.
   */
  public async registerClient(
    authorKeyId: string,
    authorPublicKeyHex: string,
    role: "WRITER_REPLICA" | "READ_ONLY_REPLICA" = "WRITER_REPLICA",
    requestedReplicaId?: string
  ): Promise<RegisteredClientSession> {
    this.clientCounter++;
    const assignedReplicaId = requestedReplicaId ?? `client-${this.clientCounter}`;

    const session: RegisteredClientSession = {
      replicaId: assignedReplicaId,
      authorKeyId,
      authorPublicKeyHex,
      role,
      registeredTimestamp: Date.now(),
    };
    this.registeredClients.set(assignedReplicaId, session);

    // Re-issue certificate with updated member bindings
    await this.updateMembershipBindings();
    return session;
  }

  /**
   * Generates a bootstrap envelope for an onboarding replica.
   */
  public getBootstrapPayload(replicaId: string): BootstrapPayload {
    return {
      certificate: this.getCertificate(),
      assignedReplicaId: replicaId,
      initialFrontier: { ...this.clusterFrontier },
    };
  }

  /**
   * Ingests an incoming client envelope and produces a response envelope.
   */
  public async ingestEnvelope(
    rawEnvelope: unknown,
    principal: TransportChannelPrincipal
  ): Promise<WireEnvelope | null> {
    const decodeResult = decodeWireEnvelope(rawEnvelope);
    if (!decodeResult.ok) {
      return createWireEnvelope<ServerRejectPayload>(
        "serverReject",
        this.collectionId,
        this.coordinatorReplicaId,
        {
          errorCode: decodeResult.code,
          reason: decodeResult.detail,
        }
      );
    }

    const envelope = decodeResult.value;

    if (envelope.type === "op") {
      return this.handleOperationEnvelope(envelope.payload as ReplicableOperation, principal);
    }

    if (envelope.type === "rangeRequest") {
      const rangeResponse = this.serveStreamRangeRequest(envelope.payload as StreamRangeRequest);
      return createWireEnvelope<StreamRangeResponse>(
        "rangeResponse",
        this.collectionId,
        this.coordinatorReplicaId,
        rangeResponse
      );
    }

    if (envelope.type === "ack") {
      return createWireEnvelope<ServerAckPayload>(
        "serverAck",
        this.collectionId,
        this.coordinatorReplicaId,
        {
          serverTimestamp: Date.now(),
        }
      );
    }

    return null;
  }

  /**
   * Handles an incoming operation: validates epoch, checks duplicates, updates journal,
   * emits serverAck, and broadcasts to peer listeners.
   */
  private async handleOperationEnvelope(
    operation: ReplicableOperation,
    principal: TransportChannelPrincipal
  ): Promise<WireEnvelope> {
    if (!principal.channelAuthenticated) {
      return createWireEnvelope<ServerRejectPayload>(
        "serverReject",
        this.collectionId,
        this.coordinatorReplicaId,
        {
          opKey: `${operation.collectionId}:${operation.epochNumber}:${operation.opDot.replicaId}:${operation.opDot.sequence}`,
          errorCode: "SYNC_UNAUTHENTICATED_PRINCIPAL",
          reason: "Transport channel principal is not authenticated",
        }
      );
    }
    // 1. Epoch check: reject late epoch operations
    if (operation.epochNumber < this.currentEpochNumber) {
      return createWireEnvelope<ServerRejectPayload>(
        "serverReject",
        this.collectionId,
        this.coordinatorReplicaId,
        {
          opKey: `${operation.collectionId}:${operation.epochNumber}:${operation.opDot.replicaId}:${operation.opDot.sequence}`,
          errorCode: "SYNC_EPOCH_CLOSED",
          reason: `Epoch ${operation.epochNumber} is closed (active: ${this.currentEpochNumber})`,
          compensationAction: "DISCARD_AND_PULL_NEW_EPOCH",
        }
      );
    }

    const opKey = `${operation.collectionId}:${operation.epochNumber}:${operation.opDot.replicaId}:${operation.opDot.sequence}`;

    // 2. Idempotent duplicate check
    if (this.mutationJournal.has(opKey)) {
      return createWireEnvelope<ServerAckPayload>(
        "serverAck",
        this.collectionId,
        this.coordinatorReplicaId,
        {
          opKey,
          serverTimestamp: Date.now(),
        }
      );
    }

    // 3. Commit to coordinator journal and advance cluster frontier
    this.mutationJournal.set(opKey, operation);
    const streamKey = `${operation.epochNumber}:${operation.opDot.replicaId}`;
    const previousSequence = this.clusterFrontier[streamKey] ?? 0;
    if (operation.opDot.sequence > previousSequence) {
      this.clusterFrontier[streamKey] = operation.opDot.sequence;
    }

    // 4. Relay operation envelope to connected listeners
    const relayedEnvelope = createWireEnvelope<ReplicableOperation>(
      "op",
      this.collectionId,
      operation.opDot.replicaId,
      operation
    );
    for (const listener of this.connectedListeners) {
      try {
        listener(relayedEnvelope);
      } catch {
        // Suppress listener broadcast error
      }
    }

    // 5. Return signed server acknowledgement
    return createWireEnvelope<ServerAckPayload>(
      "serverAck",
      this.collectionId,
      this.coordinatorReplicaId,
      {
        opKey,
        originStreamKey: streamKey,
        sequenceNumber: operation.opDot.sequence,
        serverTimestamp: Date.now(),
      }
    );
  }

  /**
   * Serves an anti-entropy stream range request from the mutation journal.
   */
  public serveStreamRangeRequest(request: StreamRangeRequest): StreamRangeResponse {
    const matchingOperations: ReplicableOperation[] = [];

    for (let sequenceNumber = request.fromSeq; sequenceNumber <= request.toSeq; sequenceNumber++) {
      const parts = request.streamKey.split(":");
      const epochNumber = parseInt(parts[0]!, 10);
      const replicaIdentifier = parts[1]!;
      const targetOpKey = `${this.collectionId}:${epochNumber}:${replicaIdentifier}:${sequenceNumber}`;
      const foundOperation = this.mutationJournal.get(targetOpKey);
      if (foundOperation) {
        matchingOperations.push(foundOperation);
      }
    }

    return {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: this.collectionId,
      responderReplicaId: this.coordinatorReplicaId,
      requesterReplicaId: request.requesterReplicaId,
      epochNumber: request.epochNumber,
      streamKey: request.streamKey,
      fromSeq: request.fromSeq,
      toSeq: request.toSeq,
      operations: matchingOperations,
    };
  }

  /**
   * Runs an epoch transition: closes current epoch, establishes baseline frontier,
   * signs transition certificate, and broadcasts certificate envelope.
   */
  public async transitionToNextEpoch(): Promise<EpochMembershipCertificate> {
    this.currentEpochNumber++;

    const memberBindingsRecord: Record<string, EpochMemberKeyBinding> = {};
    for (const [clientId, session] of this.registeredClients.entries()) {
      memberBindingsRecord[clientId] = {
        role: session.role,
        authorKeyId: session.authorKeyId,
        authorPublicKeyHex: session.authorPublicKeyHex,
        signingAlgorithm: "ECDSA_P256",
      };
    }

    const baselineFrontier = { ...this.clusterFrontier };
    const certificatePayload = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: this.collectionId,
      epochNumber: this.currentEpochNumber,
      epochCertificateId: `cert:${this.collectionId}:${this.currentEpochNumber}`,
      coordinatorReplicaId: this.coordinatorReplicaId,
      coordinatorKeyId: this.coordinatorKeyId,
      memberBindings: memberBindingsRecord,
      baselineStableFrontier: baselineFrontier,
    };

    const canonicalCertificatePayload = canonicalizeValue(certificatePayload);
    const coordinatorSignature = await signPayloadAsync(
      canonicalCertificatePayload,
      this.coordinatorKeyPair!.privateKey,
      "ECDSA_P256"
    );

    const transitionCertificate: EpochMembershipCertificate = {
      ...certificatePayload,
      coordinatorSignature,
    };

    this.currentCertificate = transitionCertificate;

    // Broadcast new certificate envelope to all peers
    const certificateEnvelope = createWireEnvelope<EpochMembershipCertificate>(
      "cert",
      this.collectionId,
      this.coordinatorReplicaId,
      transitionCertificate
    );
    for (const listener of this.connectedListeners) {
      try {
        listener(certificateEnvelope);
      } catch {
        // Suppress listener error
      }
    }

    return transitionCertificate;
  }

  /**
   * Subscribes to relayed broadcast envelopes.
   */
  public subscribeRelay(listener: (envelope: WireEnvelope) => void): () => void {
    this.connectedListeners.add(listener);
    return () => {
      this.connectedListeners.delete(listener);
    };
  }

  private async issueGenesisCertificate(): Promise<void> {
    const memberBindingsRecord: Record<string, EpochMemberKeyBinding> = {
      [this.coordinatorReplicaId]: {
        role: "COORDINATOR",
        authorKeyId: this.coordinatorKeyId,
        authorPublicKeyHex: this.coordinatorKeyPair!.publicKeyHex,
        signingAlgorithm: "ECDSA_P256",
      },
    };

    const genesisPayload = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: this.collectionId,
      epochNumber: 1,
      epochCertificateId: `cert:${this.collectionId}:1`,
      coordinatorReplicaId: this.coordinatorReplicaId,
      coordinatorKeyId: this.coordinatorKeyId,
      memberBindings: memberBindingsRecord,
      baselineStableFrontier: {},
    };

    const canonicalGenesisPayload = canonicalizeValue(genesisPayload);
    const coordinatorSignature = await signPayloadAsync(
      canonicalGenesisPayload,
      this.coordinatorKeyPair!.privateKey,
      "ECDSA_P256"
    );

    this.currentCertificate = {
      ...genesisPayload,
      coordinatorSignature,
    };
  }

  private async updateMembershipBindings(): Promise<void> {
    const memberBindingsRecord: Record<string, EpochMemberKeyBinding> = {
      [this.coordinatorReplicaId]: {
        role: "COORDINATOR",
        authorKeyId: this.coordinatorKeyId,
        authorPublicKeyHex: this.coordinatorKeyPair!.publicKeyHex,
        signingAlgorithm: "ECDSA_P256",
      },
    };

    for (const [clientId, session] of this.registeredClients.entries()) {
      memberBindingsRecord[clientId] = {
        role: session.role,
        authorKeyId: session.authorKeyId,
        authorPublicKeyHex: session.authorPublicKeyHex,
        signingAlgorithm: "ECDSA_P256",
      };
    }

    const updatedPayload = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: this.collectionId,
      epochNumber: this.currentEpochNumber,
      epochCertificateId: `cert:${this.collectionId}:${this.currentEpochNumber}`,
      coordinatorReplicaId: this.coordinatorReplicaId,
      coordinatorKeyId: this.coordinatorKeyId,
      memberBindings: memberBindingsRecord,
      baselineStableFrontier: { ...this.clusterFrontier },
    };

    const canonicalPayload = canonicalizeValue(updatedPayload);
    const coordinatorSignature = await signPayloadAsync(
      canonicalPayload,
      this.coordinatorKeyPair!.privateKey,
      "ECDSA_P256"
    );

    this.currentCertificate = {
      ...updatedPayload,
      coordinatorSignature,
    };
  }
}

export function createMockPrincipal(
  simulatedPeerIdentifier: string,
  transportSenderReplicaId: string
): TransportChannelPrincipal & { simulatedPeerIdentifier: string; transportMedium: "mock" } {
  return {
    channelId: `mock:${simulatedPeerIdentifier}`,
    channelAuthenticated: true,
    transportSenderReplicaId,
    transportMedium: "mock",
    simulatedPeerIdentifier,
  };
}
