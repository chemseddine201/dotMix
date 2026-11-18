/**
 * @dotmix/sync — Durable ACK Message Ingestion & Stable Frontier Advance
 */

import { canonicalizeValue } from "./apply.js";
import { signPayloadAsync, verifySignatureAsync } from "./preverify.js";
import { recomputeStableFrontier } from "./frontiers.js";
import { PROTOCOL_FAMILY_PREFIX } from "./types.js";
import type {
  DurableAckMessage,
  OriginStreamKey,
  SequenceNumber,
  ReplicaMetaRecord,
} from "./types.js";

export interface IngestAckResult {
  ok: boolean;
  code?: string;
  detail?: string;
}

export function computeAckSigningPayload(ack: DurableAckMessage): string {
  const { authorSignature: _ignored, ...rest } = ack;
  return canonicalizeValue(rest);
}

export interface AckEngineTarget {
  meta: ReplicaMetaRecord;
}

export async function ingestDurableAck(
  engine: AckEngineTarget,
  ack: DurableAckMessage
): Promise<IngestAckResult> {
  if (!ack.protocolVersion || !ack.protocolVersion.startsWith(PROTOCOL_FAMILY_PREFIX)) {
    return {
      ok: false,
      code: "SYNC_ACK_PROTOCOL_VERSION_INVALID",
      detail: `Unsupported protocol version: ${ack.protocolVersion}`,
    };
  }

  if (ack.collectionId !== engine.meta.collectionId) {
    return {
      ok: false,
      code: "SYNC_ACK_COLLECTION_MISMATCH",
      detail: `ACK collectionId ${ack.collectionId} does not match engine ${engine.meta.collectionId}`,
    };
  }

  if (ack.epochNumber !== engine.meta.epochNumber) {
    return {
      ok: false,
      code: "SYNC_ACK_EPOCH_MISMATCH",
      detail: `ACK epochNumber ${ack.epochNumber} does not match engine epochNumber ${engine.meta.epochNumber}`,
    };
  }

  const binding = engine.meta.epochMemberBindings[ack.fromReplicaId];
  if (!binding || (binding.role !== "WRITER_REPLICA" && binding.role !== "COORDINATOR")) {
    return {
      ok: false,
      code: "SYNC_ACK_SENDER_UNAUTHORIZED",
      detail: `ACK sender ${ack.fromReplicaId} is not an authorized member in epoch ${engine.meta.epochNumber}`,
    };
  }

  if (engine.meta.revokedKeyIds && engine.meta.revokedKeyIds.includes(ack.authorKeyId)) {
    return {
      ok: false,
      code: "SYNC_ACK_KEY_REVOKED",
      detail: `ACK signing key ${ack.authorKeyId} has been revoked`,
    };
  }

  if (binding.authorKeyId !== ack.authorKeyId) {
    return {
      ok: false,
      code: "SYNC_ACK_KEY_MISMATCH",
      detail: `ACK signing key ${ack.authorKeyId} does not match binding key ${binding.authorKeyId}`,
    };
  }

  const payload = computeAckSigningPayload(ack);
  const isValidSig = await verifySignatureAsync(
    payload,
    ack.authorSignature,
    binding.authorPublicKeyHex,
    binding.signingAlgorithm ?? "Ed25519"
  );

  if (!isValidSig) {
    return {
      ok: false,
      code: "SYNC_ACK_SIGNATURE_INVALID",
      detail: `Cryptographic signature verification failed for ACK from ${ack.fromReplicaId}`,
    };
  }

  for (const [streamKey, ackSeq] of Object.entries(ack.durableFrontier)) {
    const parts = streamKey.split(":");
    if (parts.length !== 2) {
      return {
        ok: false,
        code: "SYNC_ACK_STREAM_KEY_INVALID",
        detail: `Invalid stream key syntax: ${streamKey}`,
      };
    }

    const streamEpoch = parseInt(parts[0]!, 10);
    if (isNaN(streamEpoch) || streamEpoch > engine.meta.epochNumber) {
      return {
        ok: false,
        code: "SYNC_ACK_STREAM_EPOCH_INVALID",
        detail: `Stream epoch ${streamEpoch} exceeds current epoch ${engine.meta.epochNumber}`,
      };
    }

    if (ackSeq > 0) {
      const ackDigest = ack.rollingStreamDigests?.[streamKey];
      if (!ackDigest) {
        return {
          ok: false,
          code: "SYNC_ACK_MISSING_DIGEST",
          detail: `Missing rolling digest for positive sequence ${ackSeq} on stream ${streamKey}`,
        };
      }

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
            code: "SYNC_ACK_DIGEST_MISMATCH",
            detail: `Rolling digest mismatch for stream ${streamKey} at sequence ${ackSeq}: expected ${expectedDigest}, received ${ackDigest}`,
          };
        }
      }
    }
  }

  if (!engine.meta.clusterAcks[ack.fromReplicaId]) {
    engine.meta.clusterAcks[ack.fromReplicaId] = {};
  }
  const peerAcks = engine.meta.clusterAcks[ack.fromReplicaId]!;
  for (const [streamKey, ackSeq] of Object.entries(ack.durableFrontier)) {
    const cur = peerAcks[streamKey] ?? 0;
    if (ackSeq > cur) {
      peerAcks[streamKey] = ackSeq;
    }
  }

  recomputeStableFrontier(engine.meta);

  return { ok: true };
}

export async function createDurableAckMessage(
  engine: AckEngineTarget,
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
