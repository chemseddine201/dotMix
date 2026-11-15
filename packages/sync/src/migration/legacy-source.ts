/**
 * @dotmix/sync — Read-only access to the legacy engine's IndexedDB database.
 *
 * The legacy engine stores one database, `mix_sync_db` (version 1), with the stores
 * `snapshots` ({ key, value: ArrayEntry[] }) and `mutation_log` (keyPath `idStr`).
 * D-137 never upgrades that database (HAA-19). Migration reads it; finalization removes
 * one collection's records from it.
 */

import { LEGACY_DB_NAME } from "../storage/idb-schema.js";
import type { LegacyV1EntryPayload, LegacyV1MutationRecord } from "./types.js";

const LEGACY_SNAPSHOT_STORE = "snapshots";
const LEGACY_MUTATION_STORE = "mutation_log";

export interface LegacyCollectionData {
  readonly snapshotEntries: readonly LegacyV1EntryPayload[];
  readonly mutations: readonly LegacyV1MutationRecord[];
}

function resolveFactory(factoryOverride?: IDBFactory): IDBFactory | undefined {
  if (factoryOverride) return factoryOverride;
  const globalFactory = (globalThis as { indexedDB?: IDBFactory | null }).indexedDB;
  return globalFactory ?? undefined;
}

/** Opens the legacy database only if it already exists; never creates it. */
function openExistingLegacyDatabase(factory: IDBFactory): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    let openRequest: IDBOpenDBRequest;
    try {
      openRequest = factory.open(LEGACY_DB_NAME);
    } catch {
      resolve(undefined);
      return;
    }
    openRequest.onupgradeneeded = () => {
      // The database did not exist. Abort so that nothing is created.
      openRequest.transaction?.abort();
    };
    openRequest.onsuccess = () => {
      const legacyDatabase = openRequest.result;
      const hasLegacyStores =
        legacyDatabase.objectStoreNames.contains(LEGACY_SNAPSHOT_STORE) &&
        legacyDatabase.objectStoreNames.contains(LEGACY_MUTATION_STORE);
      if (!hasLegacyStores) {
        legacyDatabase.close();
        resolve(undefined);
        return;
      }
      resolve(legacyDatabase);
    };
    openRequest.onerror = () => resolve(undefined);
    openRequest.onblocked = () => resolve(undefined);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Returns the legacy snapshot and mutations for one collection, or undefined when the
 * legacy database or the collection's snapshot does not exist.
 */
export async function readLegacyCollection(
  collectionId: string,
  factoryOverride?: IDBFactory
): Promise<LegacyCollectionData | undefined> {
  const factory = resolveFactory(factoryOverride);
  if (!factory) return undefined;
  const legacyDatabase = await openExistingLegacyDatabase(factory);
  if (!legacyDatabase) return undefined;
  try {
    const readTransaction = legacyDatabase.transaction(
      [LEGACY_SNAPSHOT_STORE, LEGACY_MUTATION_STORE],
      "readonly"
    );
    const snapshotRecord = (await requestToPromise(
      readTransaction.objectStore(LEGACY_SNAPSHOT_STORE).get(collectionId)
    )) as { key?: string; value?: unknown } | undefined;
    const mutationRecords = (await requestToPromise(
      readTransaction.objectStore(LEGACY_MUTATION_STORE).getAll()
    )) as LegacyV1MutationRecord[];
    if (!snapshotRecord || !Array.isArray(snapshotRecord.value)) return undefined;
    return {
      snapshotEntries: snapshotRecord.value as LegacyV1EntryPayload[],
      mutations: mutationRecords.filter((mutationRecord) => mutationRecord.storeKey === collectionId),
    };
  } finally {
    legacyDatabase.close();
  }
}

/** Deletes one collection's snapshot and mutation records from the legacy database. */
export async function deleteLegacyCollection(
  collectionId: string,
  factoryOverride?: IDBFactory
): Promise<void> {
  const factory = resolveFactory(factoryOverride);
  if (!factory) return;
  const legacyDatabase = await openExistingLegacyDatabase(factory);
  if (!legacyDatabase) return;
  try {
    const writeTransaction = legacyDatabase.transaction(
      [LEGACY_SNAPSHOT_STORE, LEGACY_MUTATION_STORE],
      "readwrite"
    );
    const transactionDone = new Promise<void>((resolve, reject) => {
      writeTransaction.oncomplete = () => resolve();
      writeTransaction.onerror = () => reject(writeTransaction.error);
      writeTransaction.onabort = () => reject(writeTransaction.error);
    });
    writeTransaction.objectStore(LEGACY_SNAPSHOT_STORE).delete(collectionId);
    const mutationStore = writeTransaction.objectStore(LEGACY_MUTATION_STORE);
    const mutationRecords = (await requestToPromise(mutationStore.getAll())) as LegacyV1MutationRecord[];
    for (const mutationRecord of mutationRecords) {
      if (mutationRecord.storeKey === collectionId) {
        mutationStore.delete(mutationRecord.idStr);
      }
    }
    await transactionDone;
  } finally {
    legacyDatabase.close();
  }
}
