/* global setTimeout */
import {
  syncCollection,
  SyncEngine,
  LEGACY_DB_NAME,
  collectionDatabaseName,
  finalizeMigration,
} from '/packages/sync/dist/index.js';

const SEED_ITEMS = [
  { id: 'doc-1', title: 'Legacy document one' },
  { id: 'doc-2', title: 'Legacy document two' },
  { id: 'doc-3', title: 'Legacy document three' },
];

function pause(milliseconds) {
  return new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
}

async function waitUntil(condition, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await pause(50);
  }
  return condition();
}

/** Reads one collection's snapshot record from the legacy database, without creating it. */
function readLegacySnapshot(environmentWindow, collectionKey) {
  return new Promise((resolveRead) => {
    const openRequest = environmentWindow.indexedDB.open(LEGACY_DB_NAME);
    openRequest.onupgradeneeded = () => openRequest.transaction?.abort();
    openRequest.onerror = () => resolveRead(undefined);
    openRequest.onsuccess = () => {
      const legacyDatabase = openRequest.result;
      if (!legacyDatabase.objectStoreNames.contains('snapshots')) {
        legacyDatabase.close();
        resolveRead(undefined);
        return;
      }
      const readRequest = legacyDatabase.transaction(['snapshots'], 'readonly').objectStore('snapshots').get(collectionKey);
      readRequest.onsuccess = () => {
        legacyDatabase.close();
        resolveRead(readRequest.result);
      };
      readRequest.onerror = () => {
        legacyDatabase.close();
        resolveRead(undefined);
      };
    };
  });
}

function openCollection(collectionKey, engineName) {
  return syncCollection({
    key: collectionKey,
    driver: 'indexeddb',
    syncEngine: new SyncEngine(),
    ...(engineName ? { engine: engineName } : {}),
  });
}

function itemIdentifiers(collection) {
  return collection.items().map((item) => item.id).sort().join(',');
}

export default {
  name: 'rollback-rehearsal',
  run: async (context) => {
    const environmentWindow = context.window;
    const collectionKey = `rehearsal_${Date.now()}`;
    const expectedIdentifiers = SEED_ITEMS.map((item) => item.id).sort().join(',');

    // 1. The legacy engine writes v1 data into mix_sync_db.
    const legacyCollection = openCollection(collectionKey, 'legacy');
    await legacyCollection.ready;
    for (const seedItem of SEED_ITEMS) await legacyCollection.insert(seedItem);
    const legacyWritten = await waitUntil(async () => {
      const legacyRecord = await readLegacySnapshot(environmentWindow, collectionKey);
      return Array.isArray(legacyRecord?.value) && legacyRecord.value.length === SEED_ITEMS.length;
    }, 5000);
    await legacyCollection.close();
    if (!legacyWritten) return { pass: false, detail: 'The legacy engine did not persist its v1 snapshot' };

    // 2. The D-137 engine (default) migrates on boot.
    const migratedCollection = openCollection(collectionKey);
    await migratedCollection.ready;
    const migratedIdentifiers = itemIdentifiers(migratedCollection);
    const migratedStatus = migratedCollection.status();
    await migratedCollection.close();
    if (migratedIdentifiers !== expectedIdentifiers || migratedStatus === 'error') {
      return { pass: false, detail: `Migration result: items=[${migratedIdentifiers}], status=${migratedStatus}` };
    }

    // 3. Before finalize: the legacy data is intact and engine "legacy" still reads it (rollback).
    const legacyRecordBeforeFinalize = await readLegacySnapshot(environmentWindow, collectionKey);
    if (legacyRecordBeforeFinalize?.value?.length !== SEED_ITEMS.length) {
      return { pass: false, detail: 'Legacy snapshot changed or missing before finalize' };
    }
    const rollbackCollection = openCollection(collectionKey, 'legacy');
    await rollbackCollection.ready;
    await waitUntil(() => rollbackCollection.items().length === SEED_ITEMS.length, 3000);
    const rollbackIdentifiers = itemIdentifiers(rollbackCollection);
    await rollbackCollection.close();
    if (rollbackIdentifiers !== expectedIdentifiers) {
      return { pass: false, detail: `Rollback to engine "legacy" read [${rollbackIdentifiers}]` };
    }

    // 4. finalizeMigration() verifies the checkpoint, then deletes this collection's legacy data.
    const finalizeOutcome = await finalizeMigration(collectionKey);
    if (!finalizeOutcome.ok) {
      return { pass: false, detail: `finalizeMigration failed: ${finalizeOutcome.code} ${finalizeOutcome.detail ?? ''}` };
    }
    const legacyRecordAfterFinalize = await readLegacySnapshot(environmentWindow, collectionKey);
    const finalCollection = openCollection(collectionKey);
    await finalCollection.ready;
    const finalIdentifiers = itemIdentifiers(finalCollection);
    await finalCollection.close();

    await new Promise((resolveDeletion) => {
      const deleteRequest = environmentWindow.indexedDB.deleteDatabase(collectionDatabaseName(collectionKey));
      deleteRequest.onsuccess = () => resolveDeletion();
      deleteRequest.onerror = () => resolveDeletion();
      deleteRequest.onblocked = () => resolveDeletion();
    });

    if (legacyRecordAfterFinalize !== undefined || finalIdentifiers !== expectedIdentifiers) {
      return {
        pass: false,
        detail: `After finalize: legacyRecord=${legacyRecordAfterFinalize ? 'still present' : 'deleted'}, d137 items=[${finalIdentifiers}]`,
      };
    }
    return {
      pass: true,
      detail: 'Legacy v1 data migrated; rollback to engine "legacy" read it intact; finalizeMigration removed it after a verified checkpoint',
    };
  },
};
