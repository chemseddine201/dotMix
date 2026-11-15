/* global setTimeout */
import { MultiTabCoordinator } from '/packages/sync/dist/transport/multi-tab.js';

export default {
  name: 'multi-tab-lease-failover',
  run: async (context) => {
    const parentWindow = context.window;
    const databaseFactory = parentWindow.indexedDB;
    const databaseIdentifier = 'mix_multitab_shared_db';
    const storeIdentifier = 'committed_items';
    const leaseChannelName = 'mix_multitab_lease_broadcast_channel';
    const collectionIdentifier = 'collection_lease_failover_test';

    const removeExistingDatabase = () => new Promise((resolveDeletion) => {
      const deleteRequest = databaseFactory.deleteDatabase(databaseIdentifier);
      deleteRequest.onsuccess = () => resolveDeletion();
      deleteRequest.onerror = () => resolveDeletion();
      deleteRequest.onblocked = () => resolveDeletion();
    });

    await removeExistingDatabase();

    // 1. Prepare shared database schema
    await new Promise((resolveSchema, rejectSchema) => {
      const setupRequest = databaseFactory.open(databaseIdentifier, 1);
      setupRequest.onupgradeneeded = (upgradeEvent) => {
        const upgradeDatabase = upgradeEvent.target.result;
        if (!upgradeDatabase.objectStoreNames.contains(storeIdentifier)) {
          upgradeDatabase.createObjectStore(storeIdentifier, { keyPath: 'id' });
        }
      };
      setupRequest.onsuccess = () => {
        setupRequest.result.close();
        resolveSchema();
      };
      setupRequest.onerror = () => rejectSchema(setupRequest.error);
    });

    // 2. Create two iframes (Tab A and Tab B)
    const tabAContext = await context.createIframe();
    const tabBContext = await context.createIframe();

    const coordinatorA = new MultiTabCoordinator({
      collectionId: collectionIdentifier,
      tabIdentifier: 'tab-iframe-window-A',
      channelName: leaseChannelName,
      broadcastChannelFactory: (channelName) => new tabAContext.contentWindow.BroadcastChannel(channelName),
    });

    const coordinatorB = new MultiTabCoordinator({
      collectionId: collectionIdentifier,
      tabIdentifier: 'tab-iframe-window-B',
      channelName: leaseChannelName,
      broadcastChannelFactory: (channelName) => new tabBContext.contentWindow.BroadcastChannel(channelName),
    });

    // 3. Tab A acquires leader lease
    const acquiredByTabA = coordinatorA.acquirePrimaryLease();
    if (!acquiredByTabA || coordinatorA.getRole() !== 'primary') {
      coordinatorA.dispose();
      coordinatorB.dispose();
      tabAContext.remove();
      tabBContext.remove();
      return {
        pass: false,
        detail: 'Initial lease acquisition failed: Tab A failed to become primary'
      };
    }

    // 4. Tab A writes and commits data to shared IndexedDB
    await new Promise((resolveWrite, rejectWrite) => {
      const openRequestA = tabAContext.contentWindow.indexedDB.open(databaseIdentifier, 1);
      openRequestA.onerror = () => rejectWrite(openRequestA.error);
      openRequestA.onsuccess = () => {
        const databaseA = openRequestA.result;
        const writeTransaction = databaseA.transaction([storeIdentifier], 'readwrite');
        const writeStore = writeTransaction.objectStore(storeIdentifier);
        writeStore.put({
          id: 'document-alpha',
          payloadText: 'committed-by-tab-a',
          createdAt: Date.now()
        });
        writeTransaction.oncomplete = () => {
          databaseA.close();
          resolveWrite();
        };
        writeTransaction.onerror = () => rejectWrite(writeTransaction.error);
      };
    });

    coordinatorA.broadcastPostCommitRefresh(['document-alpha']);

    // 5. Start follower monitoring on Tab B
    coordinatorB.startFollowerMonitoring();

    // 6. Stop Tab A's heartbeat (tab stalls)
    coordinatorA.stopHeartbeat();

    // 7. Wait for heartbeat timeout to allow Tab B to take over as new leader
    const takeoverStartTimestamp = Date.now();
    let tabBIsNewLeader = false;

    while (Date.now() - takeoverStartTimestamp < 15000) {
      if (coordinatorB.getRole() === 'primary') {
        tabBIsNewLeader = true;
        break;
      }
      await new Promise((resolveTick) => setTimeout(resolveTick, 100));
    }

    if (!tabBIsNewLeader) {
      coordinatorA.dispose();
      coordinatorB.dispose();
      tabAContext.remove();
      tabBContext.remove();
      return {
        pass: false,
        detail: 'Failover timeout: Tab B failed to acquire lease after Tab A heartbeat stopped'
      };
    }

    // Tab B emits heartbeat at its new fencing term to notify other tabs
    coordinatorB.emitHeartbeat();

    // Small delay for BroadcastChannel message delivery to Tab A
    await new Promise((resolveTick) => setTimeout(resolveTick, 40));

    // 8. Late write attempted from Tab A is fenced / rejected
    const lateAssertionOutcome = coordinatorA.assertActivePrimary();
    const lateBroadcastOutcome = coordinatorA.broadcastPostCommitRefresh(['late-document']);

    if (lateAssertionOutcome.ok !== false || lateBroadcastOutcome !== false) {
      coordinatorA.dispose();
      coordinatorB.dispose();
      tabAContext.remove();
      tabBContext.remove();
      return {
        pass: false,
        detail: 'Fencing failure: stale Tab A was not rejected from asserting primary or broadcasting'
      };
    }

    // 9. Tab B reads Tab A's previously committed data
    let committedRecordRetrieved = null;
    await new Promise((resolveRead, rejectRead) => {
      const openRequestB = tabBContext.contentWindow.indexedDB.open(databaseIdentifier, 1);
      openRequestB.onerror = () => rejectRead(openRequestB.error);
      openRequestB.onsuccess = () => {
        const databaseB = openRequestB.result;
        const readTransaction = databaseB.transaction([storeIdentifier], 'readonly');
        const readStore = readTransaction.objectStore(storeIdentifier);
        const getRequest = readStore.get('document-alpha');
        getRequest.onsuccess = () => {
          committedRecordRetrieved = getRequest.result;
        };
        readTransaction.oncomplete = () => {
          databaseB.close();
          resolveRead();
        };
        readTransaction.onerror = () => rejectRead(readTransaction.error);
      };
    });

    // Clean up
    coordinatorA.dispose();
    coordinatorB.dispose();
    tabAContext.remove();
    tabBContext.remove();
    await removeExistingDatabase();

    if (!committedRecordRetrieved || committedRecordRetrieved.payloadText !== 'committed-by-tab-a') {
      return {
        pass: false,
        detail: 'Data consistency failure: Tab B could not read data committed by Tab A'
      };
    }

    return {
      pass: true,
      detail: `Leader failover succeeded: Tab B acquired lease at fencing term ${coordinatorB.getFencingTerm()} after Tab A heartbeat stopped; stale write fenced; committed data read back successfully`
    };
  }
};
