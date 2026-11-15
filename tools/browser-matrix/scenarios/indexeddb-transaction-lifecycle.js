/* global performance */
import {
  syncCollection,
  SyncEngine,
  collectionDatabaseName,
} from '/packages/sync/dist/index.js';

const BURST_SIZE = 1000;

function deleteDatabase(environmentWindow, databaseName) {
  return new Promise((resolveDeletion) => {
    const deleteRequest = environmentWindow.indexedDB.deleteDatabase(databaseName);
    deleteRequest.onsuccess = () => resolveDeletion();
    deleteRequest.onerror = () => resolveDeletion();
    deleteRequest.onblocked = () => resolveDeletion();
  });
}

/**
 * Audit-kit probe: awaiting WebCrypto inside an IndexedDB transaction deactivates the
 * transaction. This is why the store computes SHA-256 synchronously.
 */
async function probeWebCryptoInsideTransaction(environmentWindow) {
  const probeDatabaseName = `mix_webcrypto_probe_${Date.now()}`;
  const probeDatabase = await new Promise((resolveOpen, rejectOpen) => {
    const openRequest = environmentWindow.indexedDB.open(probeDatabaseName, 1);
    openRequest.onupgradeneeded = () => openRequest.result.createObjectStore('records');
    openRequest.onsuccess = () => resolveOpen(openRequest.result);
    openRequest.onerror = () => rejectOpen(openRequest.error);
  });
  const observedOutcome = await new Promise((resolveProbe) => {
    const probeTransaction = probeDatabase.transaction(['records'], 'readwrite');
    const probeStore = probeTransaction.objectStore('records');
    const firstRequest = probeStore.get('missing');
    firstRequest.onsuccess = async () => {
      await environmentWindow.crypto.subtle.digest('SHA-256', new Uint8Array([1, 2, 3]));
      await new Promise((resolveYield) => environmentWindow.setTimeout(resolveYield, 0));
      try {
        probeStore.put({ written: true }, 'after-webcrypto');
        resolveProbe('put-accepted');
      } catch (probeError) {
        resolveProbe(String(probeError?.name || probeError));
      }
    };
    probeTransaction.onabort = () => resolveProbe('transaction-aborted');
  });
  probeDatabase.close();
  await deleteDatabase(environmentWindow, probeDatabaseName);
  return observedOutcome;
}

export default {
  name: 'indexeddb-transaction-lifecycle',
  run: async (context) => {
    const collectionKey = `lifecycle_${Date.now()}`;

    const writerCollection = syncCollection({
      key: collectionKey,
      driver: 'indexeddb',
      syncEngine: new SyncEngine(),
    });
    await writerCollection.ready;
    if (writerCollection.status() === 'error') {
      return { pass: false, detail: `Writer failed to boot: ${writerCollection.errorCode?.() ?? 'error'}` };
    }

    // Durable burst: each insert promise resolves only after its batch is committed to IndexedDB.
    const burstStart = performance.now();
    const pendingInsertions = [];
    for (let itemIndex = 0; itemIndex < BURST_SIZE; itemIndex++) {
      pendingInsertions.push(writerCollection.insert({ id: `item-${itemIndex}`, title: `Item ${itemIndex}` }));
    }
    await Promise.all(pendingInsertions);
    const burstDurableMilliseconds = Math.round(performance.now() - burstStart);

    // Measure time of ONE insert into a collection that already holds 1,000 items
    const single1kStart = performance.now();
    await writerCollection.insert({ id: 'item-1000', title: 'Single insert at 1000' });
    const singleInsertAt1kMilliseconds = Number((performance.now() - single1kStart).toFixed(2));

    // Populate the collection so it already holds 10,000 items
    for (let batchStart = 1001; batchStart < 10000; batchStart += 1000) {
      const batchEnd = Math.min(batchStart + 1000, 10000);
      const batchInsertions = [];
      for (let itemIndex = batchStart; itemIndex < batchEnd; itemIndex++) {
        batchInsertions.push(writerCollection.insert({ id: `item-${itemIndex}`, title: `Item ${itemIndex}` }));
      }
      await Promise.all(batchInsertions);
    }

    // Measure time of ONE insert into a collection that already holds 10,000 items
    const single10kStart = performance.now();
    await writerCollection.insert({ id: 'item-10000', title: 'Single insert at 10000' });
    const singleInsertAt10kMilliseconds = Number((performance.now() - single10kStart).toFixed(2));

    const expectedTotalItemCount = 10001;
    await writerCollection.close();

    // Reopen through the product: boot recovery must return every committed item.
    const readerCollection = syncCollection({
      key: collectionKey,
      driver: 'indexeddb',
      syncEngine: new SyncEngine(),
    });
    await readerCollection.ready;
    const reopenedCount = readerCollection.items().length;
    const readerStatus = readerCollection.status();
    await readerCollection.close();
    await deleteDatabase(context.window, collectionDatabaseName(collectionKey));

    if (reopenedCount !== expectedTotalItemCount || readerStatus === 'error') {
      return {
        pass: false,
        detail: `Commit not durable: reopened ${reopenedCount}/${expectedTotalItemCount} items, status ${readerStatus}`,
      };
    }

    const probeOutcome = await probeWebCryptoInsideTransaction(context.window);
    if (probeOutcome === 'put-accepted') {
      return { pass: false, detail: 'WebCrypto probe: the transaction stayed active after an awaited digest' };
    }

    return {
      pass: true,
      detail: `durableBurstMs=${burstDurableMilliseconds}; singleInsertAt1kMs=${singleInsertAt1kMilliseconds}; singleInsertAt10kMs=${singleInsertAt10kMilliseconds}; ${expectedTotalItemCount} inserts via syncCollection reopened intact; WebCrypto await inside a transaction -> ${probeOutcome}`,
    };
  },
};
