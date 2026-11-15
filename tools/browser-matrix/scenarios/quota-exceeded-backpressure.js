import { syncCollection, SyncEngine, collectionDatabaseName } from '/packages/sync/dist/index.js';

export default {
  name: 'quota-exceeded-backpressure',
  run: async (context) => {
    const parentWindow = context.window;
    const collectionKey = `quota_backpressure_${Date.now()}`;
    const targetDatabaseIdentifier = collectionDatabaseName(collectionKey);

    // Monkey-patch IDBObjectStore.prototype.put to simulate QuotaExceededError for test collection
    const originalPutMethod = parentWindow.IDBObjectStore.prototype.put;
    let simulateQuotaExceeded = false;

    parentWindow.IDBObjectStore.prototype.put = function (...putArguments) {
      if (simulateQuotaExceeded) {
        throw new parentWindow.DOMException('QuotaExceededError', 'QuotaExceededError');
      }
      return originalPutMethod.apply(this, putArguments);
    };

    let targetCollection = null;

    try {
      targetCollection = syncCollection({
        key: collectionKey,
        driver: 'indexeddb',
        syncEngine: new SyncEngine(),
      });

      await targetCollection.ready;

      // Enable simulated quota exceeded exception
      simulateQuotaExceeded = true;

      let caughtQuotaException = null;
      try {
        await targetCollection.insert({
          id: 'quota-intent-item-1',
          title: 'Pending payload requiring durable persistence',
          timestamp: Date.now()
        });
      } catch (insertFailureException) {
        caughtQuotaException = insertFailureException;
      }
      void caughtQuotaException;

      // 1. Verify storage backend / adapter entered backpressure state
      const adapterInBackpressure =
        targetCollection.isBackpressure === true && targetCollection.errorCode?.() === 'D137_STORAGE_QUOTA_EXCEEDED';

      // 2. Verify pending intent was NOT dropped
      const pendingCount = targetCollection.pendingCount();
      const hasPendingIntent = targetCollection.isPending();
      const pendingMutationsList = targetCollection.pendingMutations();
      const effectiveItemsList = targetCollection.items();

      const optimisticItemPresent = effectiveItemsList.some(
        (effectiveItem) => effectiveItem.id === 'quota-intent-item-1'
      );

      if (!adapterInBackpressure) {
        return {
          pass: false,
          detail: 'Backpressure failure: sync adapter did not enter backpressure state upon QuotaExceededError'
        };
      }

      if (pendingCount !== 1 || !hasPendingIntent || pendingMutationsList.length !== 1) {
        return {
          pass: false,
          detail: `Pending intent dropped: expected 1 pending intent, but found pendingCount=${pendingCount}`
        };
      }

      if (!optimisticItemPresent) {
        return {
          pass: false,
          detail: 'Optimistic projection lost: pending item is missing from collection.items()'
        };
      }

      // 3. Quota is available again: the next durable write succeeds and ends backpressure.
      simulateQuotaExceeded = false;
      await targetCollection.insert({ id: 'quota-recovery-item', title: 'Written after quota recovered' });
      if (targetCollection.isBackpressure !== false) {
        return { pass: false, detail: 'Backpressure did not clear after a successful durable write' };
      }

      return {
        pass: true,
        detail: `QuotaExceededError -> backpressure; pending intent retained (pending count: ${pendingCount}); cleared after the next durable write`
      };
    } finally {
      // Restore original put method
      simulateQuotaExceeded = false;
      parentWindow.IDBObjectStore.prototype.put = originalPutMethod;

      if (targetCollection) {
        await targetCollection.close();
      }

      // Remove test database
      await new Promise((resolveDeletion) => {
        const deleteRequest = parentWindow.indexedDB.deleteDatabase(targetDatabaseIdentifier);
        deleteRequest.onsuccess = () => resolveDeletion();
        deleteRequest.onerror = () => resolveDeletion();
        deleteRequest.onblocked = () => resolveDeletion();
      });
    }
  }
};

