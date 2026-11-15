/**
 * @dotmix/sync — Persists the replica's non-extractable signing key (D-147).
 *
 * The CryptoKey object itself is stored (IndexedDB structured clone keeps it
 * non-extractable). No key bytes are ever written. Without this, a reloaded page
 * recovered its engine with no signing key.
 */

import type { StoreBackend } from "../storage/memory-backend.js";

interface StoredSigningKeyRecord {
  readonly replicaIdentifier: string;
  readonly privateKey: CryptoKey;
}

function signingKeyRecordKey(collectionId: string): string {
  return `signing-key:${collectionId}`;
}

function isCryptoKeyLike(candidate: unknown): candidate is CryptoKey {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "algorithm" in candidate &&
    "type" in candidate &&
    (candidate as { type: unknown }).type === "private"
  );
}

export async function saveSigningKey(
  store: StoreBackend,
  collectionId: string,
  replicaIdentifier: string,
  privateKey: CryptoKey
): Promise<void> {
  const keyRecord: StoredSigningKeyRecord = { replicaIdentifier, privateKey };
  await store.runTransaction(["replica_meta"], "readwrite", async (transaction) => {
    await transaction.put("replica_meta", signingKeyRecordKey(collectionId), keyRecord);
  });
}

/** Returns the stored key when it belongs to the given replica; otherwise undefined. */
export async function loadSigningKey(
  store: StoreBackend,
  collectionId: string,
  replicaIdentifier: string
): Promise<CryptoKey | undefined> {
  const keyRecord = await store.runTransaction(["replica_meta"], "readonly", async (transaction) =>
    transaction.get<StoredSigningKeyRecord>("replica_meta", signingKeyRecordKey(collectionId))
  );
  if (!keyRecord || keyRecord.replicaIdentifier !== replicaIdentifier) return undefined;
  return isCryptoKeyLike(keyRecord.privateKey) ? keyRecord.privateKey : undefined;
}
