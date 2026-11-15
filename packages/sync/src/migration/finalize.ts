/**
 * @dotmix/sync — finalizeMigration(): removes a collection's legacy data after the first
 * verified D-137 checkpoint (HAA-19).
 *
 * Until it runs, the legacy database is untouched and `engine: "legacy"` still reads the
 * old data (rollback). After it runs, rollback is no longer possible for that collection.
 */

import type { StoreBackend } from "../storage/memory-backend.js";
import { IndexedDbStoreBackend } from "../storage/idb-tx.js";
import { collectionDatabaseName } from "../storage/idb-schema.js";
import { recoverFromStoreOnBoot } from "../storage/boot-recovery.js";
import { deleteLegacyCollection } from "./legacy-source.js";
import type { LegacyArchiveRecord } from "./types.js";

export interface FinalizeMigrationOptions {
  /** The collection's D-137 store. Defaults to its IndexedDB database. */
  readonly store?: StoreBackend | undefined;
  /** The IndexedDB factory that holds the legacy database. Defaults to globalThis.indexedDB. */
  readonly legacyFactory?: IDBFactory | undefined;
}

export interface FinalizeMigrationResult {
  readonly ok: boolean;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
}

const MIGRATION_FAILED_CODE = "D137_MIGRATION_FAILED";

function resolveStore(collectionId: string, explicitStore?: StoreBackend): StoreBackend | undefined {
  if (explicitStore) return explicitStore;
  if (typeof globalThis.indexedDB === "undefined" || globalThis.indexedDB === null) return undefined;
  return new IndexedDbStoreBackend(collectionDatabaseName(collectionId));
}

export async function finalizeMigration(
  collectionId: string,
  options?: FinalizeMigrationOptions
): Promise<FinalizeMigrationResult> {
  const store = resolveStore(collectionId, options?.store);
  if (!store) {
    return { ok: false, code: MIGRATION_FAILED_CODE, detail: "No sync store is available for this collection" };
  }
  if (!store.isOpen()) {
    await store.open();
  }

  const archiveRecord = await store.runTransaction(["legacy_archive"], "readonly", async (transaction) =>
    transaction.get<LegacyArchiveRecord>("legacy_archive", collectionId)
  );
  if (archiveRecord?.stage === "finalized") {
    return { ok: true };
  }
  if (archiveRecord?.stage !== "checkpoint_committed") {
    return {
      ok: false,
      code: MIGRATION_FAILED_CODE,
      detail: `Migration has not committed its checkpoint (stage: ${archiveRecord?.stage ?? "none"})`,
    };
  }

  // The checkpoint must pass the same digest and certificate checks as a normal boot.
  let verification: Awaited<ReturnType<typeof recoverFromStoreOnBoot>>;
  try {
    verification = await recoverFromStoreOnBoot(store, collectionId);
  } catch (verificationError) {
    return {
      ok: false,
      code: MIGRATION_FAILED_CODE,
      detail: verificationError instanceof Error ? verificationError.message : String(verificationError),
    };
  }
  if (!verification.ok) {
    return {
      ok: false,
      code: verification.code ?? MIGRATION_FAILED_CODE,
      detail: verification.detail ?? "The migrated checkpoint failed verification",
    };
  }

  await deleteLegacyCollection(collectionId, options?.legacyFactory);

  const finalizedRecord: LegacyArchiveRecord = {
    ...archiveRecord,
    stage: "finalized",
    finalizedAt: Date.now(),
  };
  await store.runTransaction(["legacy_archive"], "readwrite", async (transaction) => {
    await transaction.put("legacy_archive", collectionId, finalizedRecord);
  });
  return { ok: true };
}
