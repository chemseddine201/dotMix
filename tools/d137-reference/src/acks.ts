/**
 * D137-v33-reference: Durable ACK Message Ingestion & Stable Frontier Advance (S93, S64, S78)
 */

import { computeAckSigningPayload, signPayloadAsync, verifySignatureAsync } from "./crypto.js";
import { recomputeStableFrontier } from "./frontiers.js";
import type { D137Engine } from "./engine.js";
import type { DurableAckMessage, OriginStreamKey, SequenceNumber } from "./types.js";

export interface IngestAckResult {
  ok: boolean;
  code?: string;
  detail?: string;
}

/**
 * Validates and ingests a peer DurableAckMessage into the local engine (S93, S64, S78).
 * 
 * Invariants enforced:
 * - Sender MUST be an authorized WRITER_REPLICA in current epoch membership.
 * - ACK signature MUST be valid under sender's bound public key.
 * - CollectionId and EpochNumber MUST match local engine state.
 * - Origin stream keys MUST be syntactically valid (${epoch}:${replicaId}) with epoch <= current epoch.
 * - Rolling digest for each stream at sequence seq MUST match local rolling digest if seq <= localDurableFrontier.
 * - Updates meta.clusterAcks monotonically and triggers recomputeStableFrontier.
 */
export async function ingestDurableAck(
  engine: D137Engine,
  ack: DurableAckMessage
): Promise<IngestAckResult> {
  // 1. Protocol version check
  if (!ack.protocolVersion || !ack.protocolVersion.startsWith("D-137")) {
    return {
      ok: false,
      code: "D137_ACK_PROTOCOL_VERSION_INVALID",
      detail: `Unsupported protocol version: ${ack.protocolVersion}`,
    };
  }

  // 2. Collection ID check
  if (ack.collectionId !== engine.meta.collectionId) {
    return {
      ok: false,
      code: "D137_ACK_COLLECTION_MISMATCH",
      detail: `ACK collectionId ${ack.collectionId} does not match engine ${engine.meta.collectionId}`,
    };
  }

  // 3. Epoch number check
  if (ack.epochNumber !== engine.meta.epochNumber) {
    return {
      ok: false,
      code: "D137_ACK_EPOCH_MISMATCH",
      detail: `ACK epochNumber ${ack.epochNumber} does not match engine epoch ${engine.meta.epochNumber}`,
    };
  }

  // 4. Sender membership binding & role check (S93)
  const binding = engine.meta.epochMemberBindings?.[ack.fromReplicaId];
  if (!binding) {
    return {
      ok: false,
      code: "D137_ACK_MEMBER_INVALID",
      detail: `Sender ${ack.fromReplicaId} is not a member of epoch ${ack.epochNumber}`,
    };
  }
  if (binding.role !== "WRITER_REPLICA" && binding.role !== "COORDINATOR") {
    return {
      ok: false,
      code: "D137_ACK_MEMBER_ROLE_INVALID",
      detail: `Sender ${ack.fromReplicaId} has non-writer role ${binding.role}`,
    };
  }
  if (binding.authorKeyId !== ack.authorKeyId) {
    return {
      ok: false,
      code: "D137_ACK_KEY_ID_MISMATCH",
      detail: `ACK authorKeyId ${ack.authorKeyId} does not match bound key ${binding.authorKeyId}`,
    };
  }

  // 5. Signature verification (S93)
  const signingPayload = computeAckSigningPayload(ack);
  const sigValid = await verifySignatureAsync(
    signingPayload,
    ack.authorSignature,
    binding.authorPublicKeyHex,
    binding.signingAlgorithm ?? "Ed25519"
  );
  if (!sigValid) {
    return {
      ok: false,
      code: "D137_ACK_SIGNATURE_INVALID",
      detail: `Cryptographic signature verification failed for ACK from ${ack.fromReplicaId}`,
    };
  }

  // 6. Validate streams and sequence bounds (S64, S78, S93)
  const streamKeys = Object.keys(ack.durableFrontier);
  if (streamKeys.length > 1000) {
    return {
      ok: false,
      code: "D137_ACK_MALFORMED",
      detail: `ACK contains excessive stream keys (${streamKeys.length})`,
    };
  }

  for (const streamKey of streamKeys) {
    const parts = streamKey.split(":");
    if (parts.length !== 2) {
      return {
        ok: false,
        code: "D137_ACK_MALFORMED",
        detail: `Malformed streamKey: ${streamKey}`,
      };
    }
    const streamEpoch = parseInt(parts[0]!, 10);
    if (Number.isNaN(streamEpoch) || streamEpoch < 0 || streamEpoch > engine.meta.epochNumber) {
      return {
        ok: false,
        code: "D137_ACK_MALFORMED",
        detail: `Invalid streamKey epoch in ${streamKey}`,
      };
    }

    const ackSeq = ack.durableFrontier[streamKey];
    if (typeof ackSeq !== "number" || !Number.isInteger(ackSeq) || ackSeq < 0) {
      return {
        ok: false,
        code: "D137_ACK_MALFORMED",
        detail: `Invalid sequence ${ackSeq} for stream ${streamKey}`,
      };
    }

    if (ackSeq > 0) {
      const ackDigest = ack.rollingStreamDigests?.[streamKey];
      if (!ackDigest || typeof ackDigest !== "string") {
        return {
          ok: false,
          code: "D137_ACK_DIGEST_MISSING",
          detail: `Missing rolling digest for positive sequence ${ackSeq} on stream ${streamKey}`,
        };
      }

      // S93 Rolling digest match: if ackSeq <= local durable sequence
      const localDurable = engine.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
      if (ackSeq <= localDurable) {
        let expectedDigest: string | undefined;
        const localDigests = engine.meta.rollingStreamDigests?.[streamKey];
        if (localDigests && localDigests[ackSeq]) {
          expectedDigest = localDigests[ackSeq];
        } else {
          const anchor = engine.meta.rollingStreamDigestAnchors?.[streamKey];
          if (anchor && anchor.sequence === ackSeq) {
            expectedDigest = anchor.digest;
          }
        }

        if (expectedDigest && expectedDigest !== ackDigest) {
          return {
            ok: false,
            code: "D137_ACK_DIGEST_MISMATCH",
            detail: `Rolling digest mismatch for stream ${streamKey} at sequence ${ackSeq}: expected ${expectedDigest}, received ${ackDigest}`,
          };
        }
      }
    }
  }

  // 7. Update clusterAcks monotonically
  if (!engine.meta.clusterAcks[ack.fromReplicaId]) {
    engine.meta.clusterAcks[ack.fromReplicaId] = {};
  }
  for (const [streamKey, ackSeq] of Object.entries(ack.durableFrontier)) {
    const cur = engine.meta.clusterAcks[ack.fromReplicaId][streamKey] ?? 0;
    if (ackSeq > cur) {
      engine.meta.clusterAcks[ack.fromReplicaId][streamKey] = ackSeq;
    }
  }

  // 8. Recompute stable frontier driven by ACKs
  recomputeStableFrontier(engine.meta);

  return { ok: true };
}

/**
 * Creates a signed DurableAckMessage representing the engine's current durable state.
 */
export async function createDurableAckMessage(
  engine: D137Engine,
  privateKeyHex?: string
): Promise<DurableAckMessage> {
  const privKey = privateKeyHex ?? engine.meta.authorPrivateKeyHex;
  if (!privKey) {
    throw new Error("Cannot create DurableAckMessage: no private signing key available");
  }

  const durableFrontier: Record<OriginStreamKey, SequenceNumber> = {
    ...engine.meta.frontiers.localDurableFrontier,
  };

  const rollingStreamDigests: Record<OriginStreamKey, string> = {};
  for (const [streamKey, seq] of Object.entries(durableFrontier)) {
    if (seq > 0) {
      const digest =
        engine.meta.rollingStreamDigests?.[streamKey]?.[seq] ??
        engine.meta.rollingStreamDigestAnchors?.[streamKey]?.digest;
      if (digest) {
        rollingStreamDigests[streamKey] = digest;
      }
    }
  }

  const unsignedAck: Omit<DurableAckMessage, "authorSignature"> = {
    protocolVersion: engine.meta.protocolVersion,
    collectionId: engine.meta.collectionId,
    epochNumber: engine.meta.epochNumber,
    fromReplicaId: engine.meta.replicaId,
    durableFrontier,
    rollingStreamDigests,
    authorKeyId: engine.meta.authorKeyId,
  };

  const payload = computeAckSigningPayload(unsignedAck as DurableAckMessage);
  const binding = engine.meta.epochMemberBindings[engine.meta.replicaId];
  const alg = binding?.signingAlgorithm ?? "Ed25519";
  const authorSignature = await signPayloadAsync(payload, privKey, alg);

  return {
    ...unsignedAck,
    authorSignature,
  };
}
