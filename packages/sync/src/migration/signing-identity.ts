/**
 * @dotmix/sync — Signing identity for v1 -> v2 migration.
 *
 * Migrated operations are signed like any local operation: ECDSA P-256 with a
 * non-extractable key, under a self-signed founding certificate that boot recovery
 * verifies. No placeholder signatures.
 */

import { createSelfSignedFoundingCertificateAsync } from "../adapter/compensation.js";
import { computeOperationDigest, computeOperationSigningPayload } from "../protocol/preverify.js";
import { generateSigningKeyPair, signPayloadAsync } from "../protocol/signing.js";
import type { EpochMembershipCertificate, ReplicableOperation } from "../protocol/types.js";

export interface MigrationSigningIdentity {
  readonly replicaIdentifier: string;
  readonly certificate: EpochMembershipCertificate;
  readonly privateKey: CryptoKey;
}

function createReplicaIdentifier(): string {
  const randomSource =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2);
  return `rep_${randomSource.slice(0, 10)}`;
}

export async function createMigrationSigningIdentity(
  collectionId: string
): Promise<MigrationSigningIdentity> {
  const replicaIdentifier = createReplicaIdentifier();
  const keyPair = await generateSigningKeyPair("ECDSA_P256", false);
  const certificate = await createSelfSignedFoundingCertificateAsync(
    collectionId,
    replicaIdentifier,
    keyPair
  );
  return { replicaIdentifier, certificate, privateKey: keyPair.privateKey };
}

/**
 * Computes the payload digest and the author signature of a migrated operation.
 * The incoming payloadDigest and authorSignature values are ignored and replaced.
 */
export async function signMigrationOperation(
  draftOperation: ReplicableOperation,
  privateKey: CryptoKey
): Promise<ReplicableOperation> {
  const payloadDigest = computeOperationDigest(draftOperation);
  const authorSignature = await signPayloadAsync(
    computeOperationSigningPayload({ ...draftOperation, payloadDigest }),
    privateKey,
    "ECDSA_P256"
  );
  return { ...draftOperation, payloadDigest, authorSignature };
}
