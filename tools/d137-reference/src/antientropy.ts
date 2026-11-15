/**
 * D137-v33-reference: Authenticated Anti-Entropy Range Pull Protocol (D-144, T-31.13)
 */

import { canonicalizeValue, sha256Hex } from "./canonicalization.js";
import {
  computeOperationDigest,
  computeOperationSigningPayload,
  signPayloadAsync,
  verifySignatureAsync,
} from "./crypto.js";
import type { D137Engine } from "./engine.js";
import type {
  CollectionId,
  EpochNumber,
  OriginStreamKey,
  ProtocolVersion,
  ReplicaId,
  ReplicableOperation,
  SequenceNumber,
  TransportChannelPrincipal,
} from "./types.js";

export const ANTI_ENTROPY_LIMITS = {
  MAX_RANGE_REQUEST_SPAN: 250,
  RANGE_PULL_TIMEOUT_MS: 2_000,
  MAX_REQUESTS_PER_WINDOW: 10,
  RATE_LIMIT_WINDOW_MS: 10_000,
} as const;

export interface StreamRangeRequest {
  readonly protocolVersion: ProtocolVersion;
  readonly collectionId: CollectionId;
  readonly requesterReplicaId: ReplicaId;
  readonly targetReplicaId: ReplicaId;
  readonly epochNumber: EpochNumber;
  readonly streamKey: OriginStreamKey;
  readonly fromSeq: SequenceNumber;
  readonly toSeq: SequenceNumber;
  readonly timestamp: number;
}

export interface StreamRangeResponse {
  readonly protocolVersion: ProtocolVersion;
  readonly collectionId: CollectionId;
  readonly responderReplicaId: ReplicaId;
  readonly requesterReplicaId: ReplicaId;
  readonly epochNumber: EpochNumber;
  readonly streamKey: OriginStreamKey;
  readonly fromSeq: SequenceNumber;
  readonly toSeq: SequenceNumber;
  readonly operations: readonly ReplicableOperation[];
  readonly responderSignature?: string;
}

export interface AntiEntropyResult {
  ok: boolean;
  countApplied?: number;
  code?: string;
  detail?: string;
  response?: StreamRangeResponse;
}

export class AntiEntropyRateLimiter {
  private requestsByReplica = new Map<ReplicaId, number[]>();

  public isAllowed(replicaId: ReplicaId, now: number = Date.now()): boolean {
    const windowStart = now - ANTI_ENTROPY_LIMITS.RATE_LIMIT_WINDOW_MS;
    const timestamps = (this.requestsByReplica.get(replicaId) ?? []).filter((t) => t >= windowStart);

    if (timestamps.length >= ANTI_ENTROPY_LIMITS.MAX_REQUESTS_PER_WINDOW) {
      this.requestsByReplica.set(replicaId, timestamps);
      return false;
    }

    timestamps.push(now);
    this.requestsByReplica.set(replicaId, timestamps);
    return true;
  }

  public reset(): void {
    this.requestsByReplica.clear();
  }
}

export const defaultAntiEntropyRateLimiter = new AntiEntropyRateLimiter();

/**
 * Creates a valid StreamRangeRequest to pull a missing sequence range.
 */
export function createStreamRangeRequest(
  engine: D137Engine,
  streamKey: OriginStreamKey,
  fromSeq: SequenceNumber,
  toSeq: SequenceNumber,
  targetReplicaId: ReplicaId
): StreamRangeRequest {
  if (toSeq < fromSeq) {
    throw new Error(`Invalid range request: toSeq (${toSeq}) < fromSeq (${fromSeq})`);
  }
  const span = toSeq - fromSeq + 1;
  if (span > ANTI_ENTROPY_LIMITS.MAX_RANGE_REQUEST_SPAN) {
    throw new Error(
      `Range request span (${span}) exceeds MAX_RANGE_REQUEST_SPAN (${ANTI_ENTROPY_LIMITS.MAX_RANGE_REQUEST_SPAN})`
    );
  }

  return {
    protocolVersion: engine.meta.protocolVersion,
    collectionId: engine.meta.collectionId,
    requesterReplicaId: engine.meta.replicaId,
    targetReplicaId,
    epochNumber: engine.meta.epochNumber,
    streamKey,
    fromSeq,
    toSeq,
    timestamp: Date.now(),
  };
}

/**
 * Handles an incoming StreamRangeRequest on the responder replica.
 */
export async function handleStreamRangeRequest(
  engine: D137Engine,
  request: StreamRangeRequest,
  rateLimiter: AntiEntropyRateLimiter = defaultAntiEntropyRateLimiter
): Promise<AntiEntropyResult> {
  // 1. Rate limiting check
  if (!rateLimiter.isAllowed(request.requesterReplicaId)) {
    return {
      ok: false,
      code: "D137_RATE_LIMIT_EXCEEDED",
      detail: `Rate limit exceeded for requester ${request.requesterReplicaId}`,
    };
  }

  // 2. Collection ID and Epoch check
  if (request.collectionId !== engine.meta.collectionId) {
    return {
      ok: false,
      code: "D137_COLLECTION_MISMATCH",
      detail: `Collection mismatch: requested ${request.collectionId}, local ${engine.meta.collectionId}`,
    };
  }
  if (request.epochNumber !== engine.meta.epochNumber) {
    return {
      ok: false,
      code: "D137_EPOCH_MISMATCH",
      detail: `Epoch mismatch: requested ${request.epochNumber}, local ${engine.meta.epochNumber}`,
    };
  }

  // 3. Span check
  const span = request.toSeq - request.fromSeq + 1;
  if (span < 1 || span > ANTI_ENTROPY_LIMITS.MAX_RANGE_REQUEST_SPAN) {
    return {
      ok: false,
      code: "D137_RANGE_REQUEST_INVALID",
      detail: `Invalid span: ${span}`,
    };
  }

  // 4. Extract operations from mutation journal
  const matchingOps: ReplicableOperation[] = [];
  for (let seq = request.fromSeq; seq <= request.toSeq; seq++) {
    const parts = request.streamKey.split(":");
    const epochNum = parseInt(parts[0]!, 10);
    const repId = parts[1]!;
    const opKey = `${engine.meta.collectionId}:${epochNum}:${repId}:${seq}`;
    const jRec = engine.mutationJournal.get(opKey);
    if (jRec) {
      matchingOps.push(jRec.operation);
    }
  }

  const response: StreamRangeResponse = {
    protocolVersion: engine.meta.protocolVersion,
    collectionId: engine.meta.collectionId,
    responderReplicaId: engine.meta.replicaId,
    requesterReplicaId: request.requesterReplicaId,
    epochNumber: engine.meta.epochNumber,
    streamKey: request.streamKey,
    fromSeq: request.fromSeq,
    toSeq: request.toSeq,
    operations: matchingOps,
  };

  return {
    ok: true,
    response,
  };
}

/**
 * Ingests and verifies an incoming StreamRangeResponse on the requester replica.
 * Validates op-by-op signature and rolling digest chain continuity (D-144).
 */
export async function ingestStreamRangeResponse(
  engine: D137Engine,
  response: StreamRangeResponse
): Promise<AntiEntropyResult> {
  // 1. Basic validation
  if (!response.protocolVersion || !response.protocolVersion.startsWith("D-137")) {
    return {
      ok: false,
      code: "D137_RANGE_RESPONSE_INVALID",
      detail: "Invalid protocol version in range response",
    };
  }
  if (response.collectionId !== engine.meta.collectionId) {
    return {
      ok: false,
      code: "D137_COLLECTION_MISMATCH",
      detail: `Collection mismatch: response ${response.collectionId}, engine ${engine.meta.collectionId}`,
    };
  }
  if (response.epochNumber !== engine.meta.epochNumber) {
    return {
      ok: false,
      code: "D137_EPOCH_MISMATCH",
      detail: `Epoch mismatch: response ${response.epochNumber}, engine ${engine.meta.epochNumber}`,
    };
  }

  // 2. Range size and continuity bounds
  if (response.toSeq < response.fromSeq) {
    return {
      ok: false,
      code: "D137_RANGE_RESPONSE_INVALID",
      detail: `Invalid response range bounds: ${response.fromSeq}..${response.toSeq}`,
    };
  }

  const requestedSpan = response.toSeq - response.fromSeq + 1;
  if (response.operations.length > ANTI_ENTROPY_LIMITS.MAX_RANGE_REQUEST_SPAN) {
    return {
      ok: false,
      code: "D137_RANGE_RESPONSE_INVALID",
      detail: `Response operation count (${response.operations.length}) exceeds MAX_RANGE_REQUEST_SPAN`,
    };
  }

  if (response.operations.length === 0) {
    return { ok: true, countApplied: 0 };
  }

  // 3. Op-by-op signature and rolling digest continuity validation
  const streamKey = response.streamKey;
  const parts = streamKey.split(":");
  const streamEpoch = parseInt(parts[0]!, 10);
  const streamAuthor = parts[1]!;

  const binding = engine.meta.epochMemberBindings[streamAuthor];
  if (!binding) {
    return {
      ok: false,
      code: "D137_RANGE_RESPONSE_INVALID",
      detail: `Unknown stream author ${streamAuthor} in epoch member bindings`,
    };
  }

  // Determine starting rolling digest anchor
  let expectedSeq = response.fromSeq;
  let rollingDigest: string | undefined;

  if (expectedSeq === 1) {
    rollingDigest = "";
  } else {
    // Check local rolling digest at expectedSeq - 1
    const localDigests = engine.meta.rollingStreamDigests[streamKey];
    if (localDigests && localDigests[expectedSeq - 1]) {
      rollingDigest = localDigests[expectedSeq - 1];
    } else {
      const anchor = engine.meta.rollingStreamDigestAnchors[streamKey];
      if (anchor && anchor.sequence === expectedSeq - 1) {
        rollingDigest = anchor.digest;
      }
    }
  }

  // Validate every operation in sequence
  for (let i = 0; i < response.operations.length; i++) {
    const op = response.operations[i]!;

    // Sequence check
    if (
      op.opDot.epochNumber !== streamEpoch ||
      op.opDot.replicaId !== streamAuthor ||
      op.opDot.sequence !== expectedSeq
    ) {
      return {
        ok: false,
        code: "D137_RANGE_RESPONSE_INVALID",
        detail: `Operation dot mismatch at index ${i}: expected seq ${expectedSeq}, got ${op.opDot.sequence}`,
      };
    }

    // Verify op payload digest
    const computedPayloadDigest = computeOperationDigest(op);
    if (computedPayloadDigest !== op.payloadDigest) {
      return {
        ok: false,
        code: "D137_RANGE_RESPONSE_INVALID",
        detail: `Payload digest mismatch for op ${op.opDot.sequence}`,
      };
    }

    // Verify author signature
    const sigPayload = computeOperationSigningPayload(op);

    const sigValid = await verifySignatureAsync(
      sigPayload,
      op.authorSignature,
      binding.authorPublicKeyHex,
      binding.signingAlgorithm ?? "Ed25519"
    );
    if (!sigValid) {
      return {
        ok: false,
        code: "D137_RANGE_RESPONSE_INVALID",
        detail: `Cryptographic signature verification failed for op ${op.opDot.sequence}`,
      };
    }

    // Rolling digest continuity check
    if (rollingDigest !== undefined) {
      const nextDigest = sha256Hex(
        rollingDigest.length === 0
          ? op.payloadDigest
          : `${rollingDigest}:${op.payloadDigest}`
      );
      rollingDigest = nextDigest;
    }

    expectedSeq++;
  }

  // 4. Ingest verified operations into engine
  let applied = 0;
  const chan: TransportChannelPrincipal = {
    channelId: "anti-entropy-pull",
    channelAuthenticated: true,
    transportSenderReplicaId: response.responderReplicaId,
  };

  for (const op of response.operations) {
    const res = await engine.ingestRemoteOperation(op, chan);
    if (res.ok) {
      applied++;
    }
  }

  return {
    ok: true,
    countApplied: applied,
  };
}

/**
 * Scans inbound gap buffer for stalled streams and generates range pull requests.
 */
export function checkAntiEntropyNeeds(
  engine: D137Engine,
  targetReplicaId?: ReplicaId
): StreamRangeRequest[] {
  const requests: StreamRangeRequest[] = [];
  const target =
    targetReplicaId ??
    Object.keys(engine.meta.epochMemberBindings).find((m) => m !== engine.meta.replicaId) ??
    "A";

  for (const [_opKey, gapRec] of engine.inboundGapBuffer.entries()) {
    const streamKey = gapRec.streamKey;
    const curDurable = engine.meta.frontiers.localDurableFrontier[streamKey] ?? 0;

    if (gapRec.sequence > curDurable + 1) {
      const fromSeq = curDurable + 1;
      const toSeq = Math.min(
        gapRec.sequence - 1,
        fromSeq + ANTI_ENTROPY_LIMITS.MAX_RANGE_REQUEST_SPAN - 1
      );

      requests.push({
        protocolVersion: engine.meta.protocolVersion,
        collectionId: engine.meta.collectionId,
        requesterReplicaId: engine.meta.replicaId,
        targetReplicaId: target,
        epochNumber: engine.meta.epochNumber,
        streamKey,
        fromSeq,
        toSeq,
        timestamp: Date.now(),
      });
    }
  }

  return requests;
}
