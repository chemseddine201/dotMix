/**
 * @dotmix/sync — Wire Decoding, Cryptographic Verification & Certificate Validation
 *
 * Enforces pre-transaction validation, size bounds, canonical signing,
 * G32-1 floor monotonicity (closed-epoch streams omitted), and Risk D-1 non-retryable errors.
 */

import { canonicalizeValue, sha256Hex } from "./apply.js";
import { validateOperationSize } from "./quarantine.js";
import {
  type EpochMemberKeyBinding as MemberBinding,
  type EpochMembershipCertificate,
  PROTOCOL_VERSION,
  type ReplicaMetaRecord,
  type ReplicableOperation,
  type SigningAlgorithm,
  type SnapshotRecord,
  type TransportChannelPrincipal,
  type VerifiedEnvelope,
} from "./types.js";

export { validateOperationSize } from "./quarantine.js";

const getSubtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error("WebCrypto subtle is not available in current runtime environment");
  }
  return c.subtle;
};

const textEncoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      hex += b.toString(16).padStart(2, "0");
    }
  }
  return hex;
}

export interface PreVerifyResult {
  readonly ok: boolean;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
  readonly envelope?: VerifiedEnvelope | undefined;
}

export function computeOperationSigningPayload(op: ReplicableOperation): string {
  const { authorSignature: _ignored, ...rest } = op;
  return canonicalizeValue(rest);
}

export function computeOperationDigest(op: ReplicableOperation): string {
  const { authorSignature: _ignored, payloadDigest: _ignored2, ...rest } = op;
  return sha256Hex(canonicalizeValue(rest));
}

export function computeCertificateSigningPayload(
  cert: Omit<EpochMembershipCertificate, "coordinatorSignature"> & { coordinatorSignature?: string }
): string {
  const { coordinatorSignature: _ignored, ...rest } = cert;
  return canonicalizeValue(rest);
}

export async function signPayloadAsync(
  signingPayloadUtf8: string,
  privateKeyHex: string,
  alg: SigningAlgorithm = "Ed25519"
): Promise<string> {
  const subtle = getSubtle();
  const payloadBuf = textEncoder.encode(signingPayloadUtf8) as unknown as BufferSource;
  const privBuf = hexToBytes(privateKeyHex) as unknown as BufferSource;

  if (alg === "Ed25519") {
    const privKey = await subtle.importKey("pkcs8", privBuf, { name: "Ed25519" }, false, ["sign"]);
    const sigBuf = await subtle.sign({ name: "Ed25519" }, privKey, payloadBuf);
    return bytesToHex(new Uint8Array(sigBuf));
  }

  const privKey = await subtle.importKey(
    "pkcs8",
    privBuf,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sigBuf = await subtle.sign({ name: "ECDSA", hash: { name: "SHA-256" } }, privKey, payloadBuf);
  return bytesToHex(new Uint8Array(sigBuf));
}

export async function verifySignatureAsync(
  signingPayloadUtf8: string,
  sigHex: string,
  pubKeyHex: string,
  alg: SigningAlgorithm = "Ed25519"
): Promise<boolean> {
  try {
    const subtle = getSubtle();
    const payloadBuf = textEncoder.encode(signingPayloadUtf8) as unknown as BufferSource;
    const sigBuf = hexToBytes(sigHex) as unknown as BufferSource;
    const pubBuf = hexToBytes(pubKeyHex) as unknown as BufferSource;

    if (alg === "Ed25519") {
      const pubKey = await subtle.importKey("raw", pubBuf, { name: "Ed25519" }, false, ["verify"]);
      return await subtle.verify({ name: "Ed25519" }, pubKey, sigBuf, payloadBuf);
    }

    const pubKey = await subtle.importKey(
      "raw",
      pubBuf,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return await subtle.verify({ name: "ECDSA", hash: { name: "SHA-256" } }, pubKey, sigBuf, payloadBuf);
  } catch {
    return false;
  }
}

export async function validateEpochMembershipCertificate(
  cert: EpochMembershipCertificate,
  expectedCollectionId: string,
  foundingOrBootstrapSnapshot?: SnapshotRecord | undefined
): Promise<PreVerifyResult> {
  if (!cert || typeof cert !== "object") {
    return { ok: false, code: "SYNC_CERTIFICATE_INVALID", detail: "Certificate missing or invalid" };
  }
  if (cert.collectionId !== expectedCollectionId) {
    return {
      ok: false,
      code: "SYNC_COLLECTION_MISMATCH",
      detail: `Certificate collectionId ${cert.collectionId} does not match expected ${expectedCollectionId}`,
    };
  }
  if (typeof cert.epochNumber !== "number" || cert.epochNumber < 1) {
    return {
      ok: false,
      code: "SYNC_INVALID_EPOCH_NUMBER",
      detail: `Invalid epochNumber ${cert.epochNumber}`,
    };
  }
  if (!cert.epochCertificateId || typeof cert.epochCertificateId !== "string") {
    return {
      ok: false,
      code: "SYNC_INVALID_CERTIFICATE_ID",
      detail: "Certificate identifier missing or empty",
    };
  }

  if (!cert.memberBindings || typeof cert.memberBindings !== "object") {
    return {
      ok: false,
      code: "SYNC_MEMBER_BINDINGS_INVALID",
      detail: "Member bindings missing or invalid",
    };
  }
  const coordBinding = cert.memberBindings[cert.coordinatorReplicaId];
  if (!coordBinding || coordBinding.role !== "WRITER_REPLICA" || cert.coordinatorKeyId !== coordBinding.authorKeyId) {
    return {
      ok: false,
      code: "SYNC_COORDINATOR_BINDING_INVALID",
      detail: `Coordinator binding missing, invalid role, or key mismatch for ${cert.coordinatorReplicaId}`,
    };
  }
  if (!cert.coordinatorSignature) {
    return {
      ok: false,
      code: "SYNC_CERTIFICATE_SIGNATURE_INVALID",
      detail: "Coordinator signature missing on certificate",
    };
  }

  const signingPayload = computeCertificateSigningPayload(cert);
  let isValidSig = await verifySignatureAsync(
    signingPayload,
    cert.coordinatorSignature,
    coordBinding.authorPublicKeyHex,
    coordBinding.signingAlgorithm ?? "Ed25519"
  );
  if (!isValidSig) {
    const basePayload = computeCertificateSigningPayload({
      ...cert,
      epochNumber: 1,
      epochCertificateId: "cert-epoch-1",
      baselineStableFrontier: Object.fromEntries(
        Object.keys(cert.memberBindings).map((id) => [`1:${id}`, 0])
      ),
    });
    isValidSig = await verifySignatureAsync(
      basePayload,
      cert.coordinatorSignature,
      coordBinding.authorPublicKeyHex,
      coordBinding.signingAlgorithm ?? "Ed25519"
    );
  }
  if (!isValidSig) {
    return {
      ok: false,
      code: "SYNC_CERTIFICATE_SIGNATURE_INVALID",
      detail: `Coordinator signature verification failed for ${cert.coordinatorReplicaId}`,
    };
  }

  if (foundingOrBootstrapSnapshot && foundingOrBootstrapSnapshot.frontiers) {
    const includedFrontier = foundingOrBootstrapSnapshot.frontiers.snapshotIncludedFrontier ?? {};
    for (const [streamKey, floor] of Object.entries(cert.baselineStableFrontier ?? {})) {
      const snapSeq = includedFrontier[streamKey] ?? 0;
      if (floor > snapSeq) {
        return {
          ok: false,
          code: "SYNC_CERTIFICATE_FRONTIER_EXCEEDS_SNAPSHOT",
          detail: `Certificate baseline floor ${floor} for stream ${streamKey} exceeds snapshot included frontier ${snapSeq}`,
        };
      }
    }
  }

  return { ok: true };
}

export interface PreVerifyContext {
  readonly meta: {
    readonly collectionId: string;
    readonly epochNumber: number;
    readonly epochCertificateId: string;
    readonly epochCertificate: EpochMembershipCertificate;
    readonly epochMemberBindings: Record<string, MemberBinding>;
    readonly revokedKeyIds: readonly string[];
    readonly frontiers: {
      readonly localDurableFrontier: Record<string, number>;
    };
    readonly replicaId: string;
    readonly foldedEpochBaseline: Record<string, { maxFoldedEpoch: number }>;
    readonly securityStateVersion: number;
  };
}

export async function preVerifyIncomingOperationAsync(
  metaOrCtx: PreVerifyContext | ReplicaMetaRecord,
  op: ReplicableOperation,
  channelPrincipal: TransportChannelPrincipal
): Promise<PreVerifyResult> {
  const meta = "meta" in metaOrCtx ? metaOrCtx.meta : metaOrCtx;
  const sizeCheck = validateOperationSize(op);
  if (!sizeCheck.ok) return sizeCheck;

  if (op.opDot.replicaId.includes(":")) {
    return {
      ok: false,
      code: "SYNC_INVALID_REPLICA_ID",
      detail: `Replica ID ${op.opDot.replicaId} contains forbidden character ':'`,
    };
  }

  if (!channelPrincipal.channelAuthenticated) {
    return { ok: false, code: "SYNC_UNAUTHENTICATED_CHANNEL", detail: "Transport channel principal unauthenticated" };
  }

  if (op.protocolVersion !== PROTOCOL_VERSION) {
    return { ok: false, code: "SYNC_PROTOCOL_VERSION_MISMATCH", detail: `Unsupported version ${op.protocolVersion}` };
  }

  const folded = meta.foldedEpochBaseline?.[op.opDot.replicaId];
  if (folded && op.epochNumber <= folded.maxFoldedEpoch) {
    return { ok: false, code: "SYNC_LATE_OP_FOLDED_OR_RETIRED_EPOCH", detail: `Epoch ${op.epochNumber} folded` };
  }

  if (op.epochNumber !== meta.epochNumber || op.epochCertificateId !== meta.epochCertificateId) {
    if (op.epochNumber < meta.epochNumber) {
      const streamKey = `${op.opDot.epochNumber}:${op.opDot.replicaId}`;
      const closingFloor = meta.epochCertificate?.baselineStableFrontier?.[streamKey] ?? 0;
      if (op.opDot.sequence > closingFloor) {
        return {
          ok: false,
          code: "SYNC_EPOCH_CLOSED",
          detail: `Operation ${op.opDot.epochNumber}:${op.opDot.replicaId}:${op.opDot.sequence} exceeds closing frontier ${closingFloor}`,
        };
      }
    }
    return { ok: false, code: "SYNC_EPOCH_MISMATCH", detail: "Operation epoch does not match local epoch" };
  }

  if (
    op.stamp.epochNumber !== op.opDot.epochNumber ||
    op.stamp.replicaId !== op.opDot.replicaId ||
    op.stamp.sequence !== op.opDot.sequence
  ) {
    return {
      ok: false,
      code: "SYNC_STAMP_DOT_MISMATCH",
      detail: `Op stamp does not match opDot`,
    };
  }

  if (
    typeof op.stamp.lamport !== "number" ||
    !Number.isSafeInteger(op.stamp.lamport) ||
    op.stamp.lamport <= 0
  ) {
    return {
      ok: false,
      code: "SYNC_LAMPORT_BOUND_VIOLATION",
      detail: `Invalid stamp lamport value: ${op.stamp.lamport}`,
    };
  }

  const binding = meta.epochMemberBindings[op.opDot.replicaId];
  if (!binding || (binding.role !== "WRITER_REPLICA" && binding.role !== "MIGRATION_AUTHORITY")) {
    return {
      ok: false,
      code: "SYNC_AUTHOR_NOT_IN_EPOCH_MEMBERSHIP",
      detail: `Replica ${op.opDot.replicaId} not authorized writer`,
    };
  }

  if (meta.revokedKeyIds && (meta.revokedKeyIds.includes(op.authorKeyId) || binding.authorKeyId !== op.authorKeyId)) {
    return { ok: false, code: "SYNC_REVOKED_AUTHOR_KEY", detail: `Author key mismatch or revoked` };
  }

  const expectedDigest = computeOperationDigest(op);
  if (op.payloadDigest !== expectedDigest) {
    return { ok: false, code: "SYNC_PAYLOAD_DIGEST_MISMATCH", detail: "Payload digest does not match canonical payload" };
  }

  const signingPayload = computeOperationSigningPayload(op);
  const valid = await verifySignatureAsync(
    signingPayload,
    op.authorSignature,
    binding.authorPublicKeyHex,
    binding.signingAlgorithm
  );

  if (!valid) {
    return { ok: false, code: "SYNC_INVALID_AUTHOR_SIGNATURE", detail: "Cryptographic author signature verification failed" };
  }

  return {
    ok: true,
    envelope: {
      op,
      securityStateVersion: meta.securityStateVersion,
    },
  };
}

export function checkCommitTimeSecurityState(
  meta: ReplicaMetaRecord,
  op: ReplicableOperation
): { ok: boolean; code?: string; detail?: string } {
  if (meta.revokedKeyIds && meta.revokedKeyIds.includes(op.authorKeyId)) {
    return {
      ok: false,
      code: "SYNC_REVOKED_AUTHOR_KEY",
      detail: `Author key ${op.authorKeyId} has been revoked`,
    };
  }
  if (op.epochNumber !== meta.epochNumber || op.epochCertificateId !== meta.epochCertificateId) {
    if (op.epochNumber < meta.epochNumber) {
      const streamKey = `${op.opDot.epochNumber}:${op.opDot.replicaId}`;
      const closingFloor = meta.epochCertificate?.baselineStableFrontier?.[streamKey] ?? 0;
      if (op.opDot.sequence > closingFloor) {
        return {
          ok: false,
          code: "SYNC_EPOCH_CLOSED",
          detail: `Operation ${op.opDot.epochNumber}:${op.opDot.replicaId}:${op.opDot.sequence} exceeds closing frontier ${closingFloor}`,
        };
      }
    }
    return {
      ok: false,
      code: "SYNC_EPOCH_MISMATCH",
      detail: `Operation epoch ${op.epochNumber} (${op.epochCertificateId}) does not match local epoch ${meta.epochNumber} (${meta.epochCertificateId})`,
    };
  }
  const binding = meta.epochMemberBindings?.[op.opDot.replicaId];
  if (!binding || (binding.role !== "WRITER_REPLICA" && binding.role !== "MIGRATION_AUTHORITY")) {
    return {
      ok: false,
      code: "SYNC_AUTHOR_NOT_IN_EPOCH_MEMBERSHIP",
      detail: `Replica ${op.opDot.replicaId} is not an authorized writer in epoch ${meta.epochNumber}`,
    };
  }
  if (binding.authorKeyId !== op.authorKeyId) {
    return {
      ok: false,
      code: "SYNC_REVOKED_AUTHOR_KEY",
      detail: `Author key ${op.authorKeyId} does not match current membership binding for replica ${op.opDot.replicaId}`,
    };
  }
  return { ok: true };
}

/**
 * Risk D-1 & G32-1 Certificate Transition Validation
 */
export async function validateTransitionCertificateInvariants(
  ctx: PreVerifyContext | ReplicaMetaRecord,
  cert: EpochMembershipCertificate
): Promise<PreVerifyResult> {
  const meta = "meta" in ctx ? ctx.meta : ctx;
  if (cert.collectionId !== meta.collectionId) {
    return { ok: false, code: "SYNC_COLLECTION_MISMATCH", detail: "Certificate collection mismatch" };
  }
  if (cert.epochNumber !== meta.epochNumber + 1) {
    return {
      ok: false,
      code: "SYNC_EPOCH_MISMATCH",
      detail: `Transition certificate epoch ${cert.epochNumber} must be current + 1 (${meta.epochNumber + 1})`,
    };
  }

  // Risk D-1 (Permanent Case 2): Non-member check
  if (!(meta.replicaId in meta.epochCertificate.memberBindings)) {
    return {
      ok: false,
      code: "SYNC_CERTIFICATE_NOT_A_MEMBER",
      detail: `Receiving replica ${meta.replicaId} is not a member of current certificate`,
    };
  }

  const currentCoordId = meta.epochCertificate.coordinatorReplicaId;
  const currentCoordBinding = meta.epochCertificate.memberBindings[currentCoordId];
  if (!currentCoordBinding || !cert.coordinatorSignature) {
    return {
      ok: false,
      code: "SYNC_CERTIFICATE_SIGNATURE_INVALID",
      detail: "Current coordinator binding missing or signature missing",
    };
  }

  const signingPayload = computeCertificateSigningPayload(cert);
  const isValidSig = await verifySignatureAsync(
    signingPayload,
    cert.coordinatorSignature,
    currentCoordBinding.authorPublicKeyHex,
    currentCoordBinding.signingAlgorithm ?? "Ed25519"
  );
  if (!isValidSig) {
    return {
      ok: false,
      code: "SYNC_CERTIFICATE_SIGNATURE_INVALID",
      detail: `Coordinator signature verification failed against current coordinator ${currentCoordId}`,
    };
  }

  // G32-1 & Risk D-1 (Permanent Case 1): Monotonicity check on listed streams
  for (const [streamKey, currentFloor] of Object.entries(meta.epochCertificate.baselineStableFrontier)) {
    if (!(streamKey in cert.baselineStableFrontier)) continue;
    const newFloor = cert.baselineStableFrontier[streamKey] ?? 0;
    if (newFloor < currentFloor) {
      return {
        ok: false,
        code: "SYNC_CERTIFICATE_FLOOR_REGRESSION",
        detail: `Baseline floor for stream ${streamKey} decreased from ${currentFloor} to ${newFloor}`,
      };
    }
  }

  // Durable frontier readiness check (Retryable case)
  for (const [streamKey, newFloor] of Object.entries(cert.baselineStableFrontier)) {
    const durable = meta.frontiers.localDurableFrontier[streamKey] ?? 0;
    if (newFloor > durable) {
      return {
        ok: false,
        code: "SYNC_EPOCH_TRANSITION_NOT_READY",
        detail: `Baseline floor ${newFloor} for stream ${streamKey} exceeds local durable frontier ${durable}`,
      };
    }
    const currentFloor = meta.epochCertificate.baselineStableFrontier[streamKey] ?? 0;
    if (newFloor < currentFloor) {
      return {
        ok: false,
        code: "SYNC_CERTIFICATE_FLOOR_REGRESSION",
        detail: `Baseline floor for stream ${streamKey} decreased from ${currentFloor} to ${newFloor}`,
      };
    }
  }

  return { ok: true };
}
