/* global setTimeout */
/**
 * @dotmix/sync — API Overlay Test (Gate 34 / T-34.1 & T-34.2)
 *
 * Verifies that D-137 collection adapter provides immediate 0ms optimistic UI updates
 * via the overlay host, followed by asynchronous durable commit, without UI flicker
 * or duplicate rendering, and cleanly rolls back on mutation failure or rejection.
 *
 * Rules: N1-N8 compliant, zero forbidden identifiers, file <= 500 lines.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  syncCollection,
  SyncEngine,
  MemoryDriver,
} from "../../../packages/sync/dist/index.js";

describe("API: Optimistic Overlay & Reconciliation", () => {
  it("provides 0ms synchronous visible update on insert, update, delete, and reorder", async () => {
    const memoryDriverInstance = new MemoryDriver();
    const syncEngineInstance = new SyncEngine({
      clientId: "overlay-client-1",
      driver: memoryDriverInstance,
      initialOnline: true,
    });

    const collection = syncCollection({
      key: "overlay-todos",
      engine: "d137",
      driver: memoryDriverInstance,
      syncEngine: syncEngineInstance,
      initialItems: [
        { id: "item-init", title: "Existing Task", completed: false },
      ],
    });

    assert.strictEqual(collection.items().length, 1);
    assert.strictEqual(collection.isPending(), false);
    assert.strictEqual(collection.pendingCount(), 0);

    // 1. Synchronous visible insert (0ms before await)
    const insertPromise = collection.insert({
      id: "item-overlay-1",
      title: "Optimistic Insert",
      completed: false,
    });

    // Verification: visible in collection.items() IMMEDIATELY, before insertPromise finishes!
    const itemsImmediatelyAfterInsert = collection.items();
    assert.strictEqual(itemsImmediatelyAfterInsert.length, 2);
    assert.strictEqual(itemsImmediatelyAfterInsert[1].id, "item-overlay-1");
    assert.strictEqual(itemsImmediatelyAfterInsert[1].title, "Optimistic Insert");

    const insertMutationRecord = await insertPromise;
    assert.strictEqual(insertMutationRecord.op, "insert");

    // 2. Synchronous visible update (0ms before await)
    const updatePromise = collection.update("item-overlay-1", {
      title: "Updated Title Immediately",
      completed: true,
    });

    const itemsImmediatelyAfterUpdate = collection.items();
    const updatedTargetItem = itemsImmediatelyAfterUpdate.find(
      (candidateItem) => candidateItem.id === "item-overlay-1"
    );
    assert.ok(updatedTargetItem);
    assert.strictEqual(updatedTargetItem.title, "Updated Title Immediately");
    assert.strictEqual(updatedTargetItem.completed, true);

    await updatePromise;

    // 3. Synchronous visible reorder (0ms before await)
    const reorderPromise = collection.reorder(1, 0);
    const itemsImmediatelyAfterReorder = collection.items();
    assert.strictEqual(itemsImmediatelyAfterReorder[0].id, "item-overlay-1");
    assert.strictEqual(itemsImmediatelyAfterReorder[1].id, "item-init");

    await reorderPromise;

    // 4. Synchronous visible delete (0ms before await)
    const deletePromise = collection.delete("item-overlay-1");
    const itemsImmediatelyAfterDelete = collection.items();
    assert.strictEqual(itemsImmediatelyAfterDelete.length, 1);
    assert.strictEqual(itemsImmediatelyAfterDelete[0].id, "item-init");

    await deletePromise;
  });

  it("maintains authoritative items upon commit without duplicate entries", async () => {
    const memoryDriverInstance = new MemoryDriver();
    const syncEngineInstance = new SyncEngine({
      clientId: "commit-client-1",
      driver: memoryDriverInstance,
      initialOnline: true,
    });

    const collection = syncCollection({
      key: "commit-todos",
      engine: "d137",
      driver: memoryDriverInstance,
      syncEngine: syncEngineInstance,
    });

    const insertMutationRecord = await collection.insert({
      id: "item-committed",
      title: "Committed Task",
    });

    // In a standalone collection with memory driver, SyncEngine commits mutations locally
    // Verify item remains visible and no duplicate rendering occurs
    const currentItems = collection.items();
    const matchingEntries = currentItems.filter(
      (candidateItem) => candidateItem.id === "item-committed"
    );
    assert.strictEqual(matchingEntries.length, 1);
    assert.strictEqual(matchingEntries[0].title, "Committed Task");
    assert.strictEqual(insertMutationRecord.op, "insert");
  });

  it("cleanly reverts state upon rollback without corrupting remaining items", async () => {
    const memoryDriverInstance = new MemoryDriver();
    const syncEngineInstance = new SyncEngine({
      clientId: "rollback-client-1",
      driver: memoryDriverInstance,
      initialOnline: true,
    });

    const collection = syncCollection({
      key: "rollback-todos",
      engine: "d137",
      driver: memoryDriverInstance,
      syncEngine: syncEngineInstance,
      initialItems: [
        { id: "item-stable-1", title: "Stable Alpha" },
        { id: "item-stable-2", title: "Stable Beta" },
      ],
    });

    // Insert an item then rollback
    const invalidInsertRecord = await collection.insert({
      id: "item-transient",
      title: "Should Be Reverted",
    });

    assert.strictEqual(collection.items().length, 3);

    collection.rollback(invalidInsertRecord.idStr);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));

    const itemsAfterRollback = collection.items();
    assert.strictEqual(itemsAfterRollback.length, 2);
    assert.strictEqual(
      itemsAfterRollback.some((candidateItem) => candidateItem.id === "item-transient"),
      false
    );
    assert.strictEqual(itemsAfterRollback[0].id, "item-stable-1");
    assert.strictEqual(itemsAfterRollback[1].id, "item-stable-2");
  });
});
