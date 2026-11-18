/**
 * Sync-v33-reference: Cryptographic Signing, Verification & WebCrypto Decoupling
 */

import { webcrypto } from "node:crypto";
import { canonicalizeValue, sha256Hex } from "./canonicalization.js";
import { validateOperationSize } from "./storage-bounds.js";
import type {
  BaseOperation,
  DurableAckMessage,
  EpochMembershipCertificate,
  ReplicaId,
  ReplicaMetaRecord,
  ReplicableOperation,
  SigningAlgorithm,
  TransportChannelPrincipal,
  VerifiedEnvelope,
} from "./types.js";

const subtle = webcrypto.subtle;

export interface GeneratedKeyPair {
  readonly publicKeyHex: string;
  readonly privateKeyHex: string;
  readonly algorithm: SigningAlgorithm;
}

export async function generateSigningKeyPair(alg: SigningAlgorithm = "Ed25519"): Promise<GeneratedKeyPair> {
  if (alg === "Ed25519") {
    try {
      const keyPair = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as {
        publicKey: webcrypto.CryptoKey;
        privateKey: webcrypto.CryptoKey;
      };
      const pubRaw = await subtle.exportKey("raw", keyPair.publicKey);
      const privPkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);
      return {
        publicKeyHex: Buffer.from(pubRaw).toString("hex"),
        privateKeyHex: Buffer.from(privPkcs8).toString("hex"),
        algorithm: "Ed25519",
      };
    } catch {
      // Fallback to ECDSA P-256
      return generateSigningKeyPair("ECDSA_P256");
    }
  }

  const keyPair = (await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as unknown as { publicKey: webcrypto.CryptoKey; privateKey: webcrypto.CryptoKey };
  const pubRaw = await subtle.exportKey("raw", keyPair.publicKey);
  const privPkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);
  return {
    publicKeyHex: Buffer.from(pubRaw).toString("hex"),
    privateKeyHex: Buffer.from(privPkcs8).toString("hex"),
    algorithm: "ECDSA_P256",
  };
}

export function computeOperationSigningPayload(op: ReplicableOperation): string {
  const { authorSignature: _ignored, ...rest } = op;
  return canonicalizeValue(rest);
}

export function computeOperationDigest(op: ReplicableOperation): string {
  const { authorSignature: _ignored, payloadDigest: _ignored2, ...rest } = op;
  return sha256Hex(canonicalizeValue(rest));
}

export function computeAckSigningPayload(ack: DurableAckMessage): string {
  const { authorSignature: _ignored, ...rest } = ack;
  return canonicalizeValue(rest);
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
  const payloadBuf = Buffer.from(signingPayloadUtf8, "utf8");
  const privBuf = Buffer.from(privateKeyHex, "hex");

  if (alg === "Ed25519") {
    const privKey = await subtle.importKey("pkcs8", privBuf, { name: "Ed25519" }, false, ["sign"]);
    const sigBuf = await subtle.sign({ name: "Ed25519" }, privKey, payloadBuf);
    return Buffer.from(sigBuf).toString("hex");
  }

  const privKey = await subtle.importKey(
    "pkcs8",
    privBuf,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sigBuf = await subtle.sign({ name: "ECDSA", hash: { name: "SHA-256" } }, privKey, payloadBuf);
  return Buffer.from(sigBuf).toString("hex");
}

export async function verifySignatureAsync(
  signingPayloadUtf8: string,
  sigHex: string,
  pubKeyHex: string,
  alg: SigningAlgorithm = "Ed25519"
): Promise<boolean> {
  try {
    const payloadBuf = Buffer.from(signingPayloadUtf8, "utf8");
    const sigBuf = Buffer.from(sigHex, "hex");
    const pubBuf = Buffer.from(pubKeyHex, "hex");

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

export interface PreVerifyResult {
  ok: boolean;
  code?: string;
  detail?: string;
  envelope?: VerifiedEnvelope;
}

/**
 * Pre-Transaction Validation Pipeline (Async outside of IndexedDB transaction)
 * Decouples WebCrypto verification from synchronous atomic database transactions.
 */
export async function preVerifyIncomingOperationAsync(
  meta: ReplicaMetaRecord,
  op: ReplicableOperation,
  channelPrincipal: TransportChannelPrincipal
): Promise<PreVerifyResult> {
  const verifiedSecurityVersion = meta.securityStateVersion;

  // Step 0: Structural size and limit validation on remote operations (Fixes AUD-C7)
  const sizeCheck = validateOperationSize(op);
  if (!sizeCheck.ok) {
    return sizeCheck;
  }

  // Step 0.5: Validate replicaId character set (no ':' allowed per rule 3.8)
  if (op.opDot.replicaId.includes(":")) {
    return {
      ok: false,
      code: "SYNC_INVALID_REPLICA_ID",
      detail: `Replica ID ${op.opDot.replicaId} contains forbidden character ':'`,
    };
  }

  // Step 1: Transport channel principal check
  if (!channelPrincipal.channelAuthenticated) {
    return { ok: false, code: "SYNC_UNAUTHENTICATED_CHANNEL", detail: "Transport channel principal unauthenticated" };
  }

  // Step 2: Protocol version and epoch check
  if (op.protocolVersion !== "replicated.v3.3.1") {
    return { ok: false, code: "SYNC_PROTOCOL_VERSION_MISMATCH", detail: `Unsupported version ${op.protocolVersion}` };
  }

  // Check folded or retired epochs
  const folded = meta.foldedEpochBaseline[op.opDot.replicaId];
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

  // Step 2.5: Verify stamp is bound to opDot and Lamport is valid
  if (
    op.stamp.epochNumber !== op.opDot.epochNumber ||
    op.stamp.replicaId !== op.opDot.replicaId ||
    op.stamp.sequence !== op.opDot.sequence
  ) {
    return {
      ok: false,
      code: "SYNC_STAMP_DOT_MISMATCH",
      detail: `Op stamp (${op.stamp.epochNumber}:${op.stamp.replicaId}:${op.stamp.sequence}) does not match opDot (${op.opDot.epochNumber}:${op.opDot.replicaId}:${op.opDot.sequence})`,
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

  // Step 3: Member key binding check
  const binding = meta.epochMemberBindings[op.opDot.replicaId];
  if (!binding || (binding.role !== "WRITER_REPLICA" && binding.role !== "MIGRATION_AUTHORITY")) {
    return { ok: false, code: "SYNC_AUTHOR_NOT_IN_EPOCH_MEMBERSHIP", detail: `Replica ${op.opDot.replicaId} not authorized writer` };
  }

  // Step 4: Key revocation check
  if (meta.revokedKeyIds.includes(op.authorKeyId) || binding.authorKeyId !== op.authorKeyId) {
    return { ok: false, code: "SYNC_REVOKED_AUTHOR_KEY", detail: `Author key ${op.authorKeyId} mismatch or revoked` };
  }

  // Step 5: Verify canonical payload digest match
  const expectedDigest = computeOperationDigest(op);
  if (op.payloadDigest !== expectedDigest) {
    return { ok: false, code: "SYNC_PAYLOAD_DIGEST_MISMATCH", detail: "Payload digest does not match canonical payload" };
  }

  // Step 6: Verify asymmetric author signature asynchronously using WebCrypto
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
      securityStateVersion: verifiedSecurityVersion,
    },
  };
}

/**
 * Re-validates security state at the commit boundary.
 */
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

const SECURITY_KEYS = new Set([
  "epochNumber",
  "epochCertificateId",
  "epochCertificate",
  "epochMemberBindings",
  "revokedKeyIds",
  "leaseHolderTabId",
  "leaseFencingTerm",
]);

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
  }
  return obj;
}

/**
 * Wraps meta in a reactive Proxy that automatically advances securityStateVersion on security transitions.
 * Deep-freezes security-critical objects and arrays on assignment to prevent in-place mutation.
 */
export function makeReactiveMeta(raw: ReplicaMetaRecord): ReplicaMetaRecord {
  if (raw.securityStateVersion === undefined) {
    raw.securityStateVersion = 1;
  }
  for (const key of SECURITY_KEYS) {
    const val = (raw as unknown as Record<string, unknown>)[key];
    if (val && typeof val === "object") {
      deepFreeze(val);
    }
  }
  return new Proxy(raw, {
    set(target, prop, value, receiver) {
      if (SECURITY_KEYS.has(prop as string)) {
        target.securityStateVersion = (target.securityStateVersion ?? 0) + 1;
        if (value && typeof value === "object") {
          deepFreeze(value);
        }
      }
      return Reflect.set(target, prop, value, receiver);
    },
  });
}
