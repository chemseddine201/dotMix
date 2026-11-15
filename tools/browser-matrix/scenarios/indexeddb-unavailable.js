export default {
  name: 'indexeddb-unavailable',
  run: async (context) => {
    // 1. Create an isolated iframe
    const iframeContext = await context.createIframe();
    const iframeWindow = iframeContext.contentWindow;

    // 2. Delete / undefine indexedDB in the iframe environment
    Object.defineProperty(iframeWindow, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    // 3. Intercept console.warn on the iframe window to verify warning count
    const recordedWarnings = [];
    const originalWarnMethod = iframeWindow.console.warn;
    iframeWindow.console.warn = (...warningArguments) => {
      recordedWarnings.push(warningArguments.map(String).join(' '));
      originalWarnMethod.apply(iframeWindow.console, warningArguments);
    };

    let testCollection = null;

    try {
      // 4. Open syncCollection with driver: 'indexeddb' in the iframe context
      const syncModule = await iframeWindow.eval("import('/packages/sync/dist/index.js')");
      testCollection = syncModule.syncCollection({
        key: 'unavailable_fallback_collection',
        driver: 'indexeddb',
      });

      await testCollection.ready;

      // 5. Verify fallback to MemoryStoreBackend
      const backendName = testCollection.storeBackend?.name;
      const isMemoryBackend = backendName === 'memory';

      // 6. Verify exactly ONE warning was emitted
      const warningCount = recordedWarnings.length;

      // 7. Verify collection functions in memory
      await testCollection.insert({
        id: 'memory-fallback-item-1',
        title: 'Item created in memory store'
      });

      const effectiveItems = testCollection.items();
      const memoryItemPresent = effectiveItems.some(
        (effectiveItem) => effectiveItem.id === 'memory-fallback-item-1'
      );

      if (!isMemoryBackend) {
        return {
          pass: false,
          detail: `Fallback failure: expected store backend 'memory', but got '${backendName}'`
        };
      }

      if (warningCount !== 1) {
        return {
          pass: false,
          detail: `Warning count mismatch: expected exactly 1 warning, observed ${warningCount} (${recordedWarnings.join('; ')})`
        };
      }

      if (!memoryItemPresent) {
        return {
          pass: false,
          detail: 'Memory store failure: inserted item was not reflected in collection.items()'
        };
      }

      return {
        pass: true,
        detail: `MemoryStoreBackend fallback successful with exactly 1 warning emitted: "${recordedWarnings[0]}"`
      };
    } finally {
      iframeWindow.console.warn = originalWarnMethod;
      if (testCollection) {
        await testCollection.close();
      }
      iframeContext.remove();
    }
  }
};

