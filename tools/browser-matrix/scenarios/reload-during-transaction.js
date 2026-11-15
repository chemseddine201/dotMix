/* global setTimeout, clearTimeout */
import {
  syncCollection,
  SyncEngine,
  IndexedDbStoreBackend,
  collectionDatabaseName,
  recoverFromStoreOnBoot,
} from '/packages/sync/dist/index.js';

const BATCH_SIZE = 200;

function waitForTabMessage(parentWindow, messageType, collectionKey, timeoutMilliseconds) {
  return new Promise((resolveMessage, rejectMessage) => {
    const timeoutHandle = setTimeout(() => {
      parentWindow.removeEventListener('message', onMessage);
      rejectMessage(new Error(`Tab did not send ${messageType} within ${timeoutMilliseconds} ms`));
    }, timeoutMilliseconds);
    function onMessage(messageEvent) {
      if (messageEvent.data?.type === messageType && messageEvent.data?.key === collectionKey) {
        clearTimeout(timeoutHandle);
        parentWindow.removeEventListener('message', onMessage);
        resolveMessage(messageEvent.data);
      }
    }
    parentWindow.addEventListener('message', onMessage);
  });
}

export default {
  name: 'reload-during-transaction',
  run: async (context) => {
    const collectionKey = `reload_${Date.now()}`;
    const tab = await context.createIframe();

    const batchStarted = waitForTabMessage(context.window, 'batch-started', collectionKey, 10000);
    const tabScript = tab.contentDocument.createElement('script');
    tabScript.type = 'module';
    tabScript.textContent = `
      import { syncCollection } from '@dotmix/sync';
      const collection = syncCollection({ key: ${JSON.stringify(collectionKey)}, driver: 'indexeddb' });
      await collection.ready;
      for (let itemIndex = 0; itemIndex < ${BATCH_SIZE}; itemIndex++) {
        void collection.insert({ id: 'row-' + itemIndex, title: 'Row ' + itemIndex });
      }
      parent.postMessage({ type: 'batch-started', key: ${JSON.stringify(collectionKey)} }, '*');
    `;
    tab.contentDocument.head.appendChild(tabScript);
    await batchStarted;

    // Kill the tab while its batch is being written.
    await tab.reload();
    tab.remove();

    const reopenedCollection = syncCollection({
      key: collectionKey,
      driver: 'indexeddb',
      syncEngine: new SyncEngine(),
    });
    await reopenedCollection.ready;
    const reopenedCount = reopenedCollection.items().length;
    const reopenedStatus = reopenedCollection.status();
    await reopenedCollection.close();

    const inspectionStore = new IndexedDbStoreBackend(collectionDatabaseName(collectionKey));
    const bootOutcome = await recoverFromStoreOnBoot(inspectionStore, collectionKey);
    await inspectionStore.close();

    const isAtomic = reopenedCount === 0 || reopenedCount === BATCH_SIZE;
    if (!isAtomic || reopenedStatus === 'error' || !bootOutcome.ok) {
      return {
        pass: false,
        detail: `items=${reopenedCount} (expected 0 or ${BATCH_SIZE}), status=${reopenedStatus}, bootRecovery=${bootOutcome.ok ? 'ok' : bootOutcome.code}`,
      };
    }
    return {
      pass: true,
      detail: `Reload mid-batch left ${reopenedCount} of ${BATCH_SIZE} items (all or nothing); boot recovery ok`,
    };
  },
};
