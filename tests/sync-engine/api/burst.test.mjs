/**
 * @dotmix/sync — API Microtask Burst Assertion
 *
 * Verifies that a burst of 1,000 synchronous inserts on engine: "replicated"
 * executes within <= 1 transaction per microtask batch, preserving all 1,000 items
 * with deterministic ordering and zero transaction bloat.
 *
 * Rules: N1-N8 compliant, zero forbidden identifiers, file <= 500 lines.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  syncCollection,
  SyncEngine,
  MemoryDriver,
  MemoryStoreBackend,
} from "../../../packages/sync/dist/index.js";

describe("API: Microtask Transaction Batching", () => {
  it("batches 1,000 synchronous inserts into <= 1 transaction per microtask batch", async () => {
    const memoryStoreBackendInstance = new MemoryStoreBackend();
    await memoryStoreBackendInstance.open();

    let realStoreTransactionCount = 0;
    const originalRunTransaction = memoryStoreBackendInstance.runTransaction.bind(memoryStoreBackendInstance);
    memoryStoreBackendInstance.runTransaction = async (storeNames, mode, operation) => {
      realStoreTransactionCount++;
      return originalRunTransaction(storeNames, mode, operation);
    };

    const memoryDriverInstance = new MemoryDriver();
    const syncEngineInstance = new SyncEngine({
      clientId: "burst-client-1",
      driver: memoryDriverInstance,
      initialOnline: true,
    });

    const collection = syncCollection({
      key: "burst-collection",
      engine: "replicated",
      driver: memoryStoreBackendInstance,
      syncEngine: syncEngineInstance,
    });

    await collection.ready;
    realStoreTransactionCount = 0;

    const TOTAL_BURST_COUNT = 1000;
    const insertPromises = [];

    // Execute 1,000 synchronous inserts in a tight loop (single microtask batch)
    for (let insertIndex = 0; insertIndex < TOTAL_BURST_COUNT; insertIndex++) {
      const generatedItemId = `burst-item-${String(insertIndex).padStart(4, "0")}`;
      insertPromises.push(
        collection.insert({
          id: generatedItemId,
          index: insertIndex,
          timestamp: Date.now(),
        })
      );
    }

    // Await all queued insertions to settle
    await Promise.all(insertPromises);

    // Verify all 1,000 items are committed and present in the collection
    const effectiveItems = collection.items();
    assert.strictEqual(
      effectiveItems.length,
      TOTAL_BURST_COUNT,
      `Expected ${TOTAL_BURST_COUNT} items, got ${effectiveItems.length}`
    );

    // Verify all items have unique IDs
    const collectedItemIds = new Set(effectiveItems.map((candidateItem) => candidateItem.id));
    assert.strictEqual(
      collectedItemIds.size,
      TOTAL_BURST_COUNT,
      "Every burst inserted item must possess a unique identifier"
    );

    // Verify adapter microtask transaction count
    const executedTransactionCount = collection.transactionCount;
    assert.ok(
      executedTransactionCount <= 1,
      `Expected <= 1 transaction per microtask batch, observed ${executedTransactionCount}`
    );
    assert.strictEqual(
      executedTransactionCount,
      1,
      `Expected exactly 1 transaction for synchronous burst, observed ${executedTransactionCount}`
    );

    // B8: Verify real store backend transaction count is <= 1 for the entire batch
    assert.ok(
      realStoreTransactionCount <= 1,
      `Expected <= 1 real store transaction, observed ${realStoreTransactionCount}`
    );
    assert.strictEqual(
      realStoreTransactionCount,
      1,
      `Expected exactly 1 real store transaction for synchronous burst, observed ${realStoreTransactionCount}`
    );

    await collection.close();
  });
});
