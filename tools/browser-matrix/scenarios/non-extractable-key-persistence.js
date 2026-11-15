/* global setTimeout, clearTimeout, CryptoKey */
import {
  syncCollection,
  SyncEngine,
  STORE_NAMES,
  collectionDatabaseName,
  signPayloadAsync,
  verifySignatureAsync,
} from '/packages/sync/dist/index.js';
import { computeOperationSigningPayload } from '/packages/sync/dist/protocol/preverify.js';

const PRIVATE_KEY_FIELD_PATTERN = /"(privateKeyHex|authorPrivateKeyHex|pkcs8|d)"\s*:\s*"/;

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

function openDatabase(environmentWindow, databaseName) {
  return new Promise((resolveOpen, rejectOpen) => {
    const openRequest = environmentWindow.indexedDB.open(databaseName);
    openRequest.onsuccess = () => resolveOpen(openRequest.result);
    openRequest.onerror = () => rejectOpen(openRequest.error);
  });
}

function readAll(database, storeName) {
  return new Promise((resolveRead, rejectRead) => {
    const readRequest = database.transaction([storeName], 'readonly').objectStore(storeName).getAll();
    readRequest.onsuccess = () => resolveRead(readRequest.result);
    readRequest.onerror = () => rejectRead(readRequest.error);
  });
}

function readOne(database, storeName, recordKey) {
  return new Promise((resolveRead, rejectRead) => {
    const readRequest = database.transaction([storeName], 'readonly').objectStore(storeName).get(recordKey);
    readRequest.onsuccess = () => resolveRead(readRequest.result);
    readRequest.onerror = () => rejectRead(readRequest.error);
  });
}

export default {
  name: 'non-extractable-key-persistence',
  run: async (context) => {
    const collectionKey = `signing_${Date.now()}`;
    const tab = await context.createIframe();

    // Tab 1 boots the collection: the engine generates and stores its key, then writes once.
    const firstWrite = waitForTabMessage(context.window, 'first-write-done', collectionKey, 10000);
    const tabScript = tab.contentDocument.createElement('script');
    tabScript.type = 'module';
    tabScript.textContent = `
      import { syncCollection } from '@dotmix/sync';
      const collection = syncCollection({ key: ${JSON.stringify(collectionKey)}, driver: 'indexeddb' });
      await collection.ready;
      await collection.insert({ id: 'before-reload', title: 'written before reload' });
      await collection.close();
      parent.postMessage({ type: 'first-write-done', key: ${JSON.stringify(collectionKey)} }, '*');
    `;
    tab.contentDocument.head.appendChild(tabScript);
    await firstWrite;
    await tab.reload();
    tab.remove();

    // After the reload the product must sign new writes with the stored key.
    const reopenedCollection = syncCollection({
      key: collectionKey,
      driver: 'indexeddb',
      syncEngine: new SyncEngine(),
    });
    await reopenedCollection.ready;
    await reopenedCollection.insert({ id: 'after-reload', title: 'written after reload' });
    await reopenedCollection.close();

    const database = await openDatabase(context.window, collectionDatabaseName(collectionKey));
    try {
      const keyRecord = await readOne(database, 'replica_meta', `signing-key:${collectionKey}`);
      const replicaMeta = await readOne(database, 'replica_meta', collectionKey);
      const storedKey = keyRecord?.privateKey;
      if (!(storedKey instanceof context.window.CryptoKey || storedKey instanceof CryptoKey)) {
        return { pass: false, detail: 'No CryptoKey stored in replica_meta after reload' };
      }
      if (storedKey.extractable !== false || storedKey.type !== 'private' || storedKey.algorithm?.name !== 'ECDSA') {
        return {
          pass: false,
          detail: `Stored key is wrong: extractable=${storedKey.extractable}, type=${storedKey.type}, algorithm=${storedKey.algorithm?.name}`,
        };
      }

      const replicaBinding = replicaMeta?.epochMemberBindings?.[keyRecord.replicaIdentifier];
      if (!replicaBinding?.authorPublicKeyHex) {
        return { pass: false, detail: 'No member binding for the stored key replica' };
      }

      // The stored key still signs, and the published public key verifies it.
      const probePayload = `probe:${collectionKey}`;
      const probeSignature = await signPayloadAsync(probePayload, storedKey, 'ECDSA_P256');
      const probeVerified = await verifySignatureAsync(
        probePayload,
        probeSignature,
        replicaBinding.authorPublicKeyHex,
        'ECDSA_P256'
      );

      // The operation written after the reload carries a real, verifiable signature.
      const journalRecords = await readAll(database, 'mutation_journal');
      const afterReloadOperation = journalRecords
        .map((journalRecord) => journalRecord.operation)
        .find((operation) => operation?.externalId === 'after-reload');
      const operationVerified = afterReloadOperation
        ? await verifySignatureAsync(
            computeOperationSigningPayload(afterReloadOperation),
            afterReloadOperation.authorSignature,
            replicaBinding.authorPublicKeyHex,
            'ECDSA_P256'
          )
        : false;

      // No private-key bytes anywhere in the 13 stores.
      let privateKeyFieldStore = '';
      for (const storeName of STORE_NAMES) {
        const storeRecords = await readAll(database, storeName);
        if (storeRecords.some((storeRecord) => PRIVATE_KEY_FIELD_PATTERN.test(JSON.stringify(storeRecord)))) {
          privateKeyFieldStore = storeName;
          break;
        }
      }

      if (!probeVerified || !operationVerified || privateKeyFieldStore) {
        return {
          pass: false,
          detail: `probeVerified=${probeVerified}, afterReloadOpVerified=${operationVerified}, keyBytesFoundIn=${privateKeyFieldStore || 'none'}`,
        };
      }
      return {
        pass: true,
        detail: 'Stored CryptoKey (extractable=false) signs after reload; the post-reload op verifies; no key bytes in any store',
      };
    } finally {
      database.close();
    }
  },
};
