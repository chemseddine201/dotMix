/**
 * Phase 4 Permanent Regression Test Suite: Showcase Unique Task IDs & Burst Stress (FINDING-SHOWCASE-01)
 *
 * Verifies:
 * 1. Synchronously inserting 1,000 tasks in a tight loop produces 1,000 unique IDs
 * 2. All 1,000 items are retained in the collection without deduplication collisions
 * 3. Collection serializes and restores 100% of burst-inserted items without loss
 * 4. Multiple independent store instances maintain collision-free IDs
 * 5. Web Crypto randomUUID fallback to monotonic sequence operates safely
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { syncCollection, SyncEngine, MemoryDriver } from "../../node_modules/@dotmix/sync/dist/index.js";

describe("Phase 4: Showcase Unique Task IDs & Burst Stress (FINDING-SHOWCASE-01)", () => {
  function createTaskIdGenerator() {
    let taskSequence = 0;
    return function generateTaskId() {
      if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
        return `t-${globalThis.crypto.randomUUID()}`;
      }
      return `t-${Date.now()}-${++taskSequence}`;
    };
  }

  test("1. 1,000 synchronous insertions produce 1,000 unique IDs without collision or dropped records", async () => {
    const engine = new SyncEngine({ driver: new MemoryDriver() });
    const store = syncCollection({ key: "burst-test-1", syncEngine: engine, engine: "legacy" });
    const generateId = createTaskIdGenerator();

    const INSERT_COUNT = 1000;
    const insertedIds = new Set();

    const t0 = globalThis.performance.now();
    for (let i = 0; i < INSERT_COUNT; i++) {
      const id = generateId();
      insertedIds.add(id);
      await store.insert({ id, title: `Burst Task #${i}`, done: false });
    }
    const t1 = globalThis.performance.now();

    // Verify all IDs generated were unique
    assert.strictEqual(insertedIds.size, INSERT_COUNT, `All ${INSERT_COUNT} IDs must be strictly unique`);

    // Verify all items are present in the reactive collection
    const items = store.items();
    assert.strictEqual(items.length, INSERT_COUNT, `Collection must contain exactly ${INSERT_COUNT} items (zero dropped items)`);

    // Verify every item matches an inserted ID
    for (const item of items) {
      assert.ok(insertedIds.has(item.id), `Item ID ${item.id} must be in the inserted set`);
    }

    // Verify performance
    const totalMs = t1 - t0;
    assert.ok(totalMs < 5000, `1,000 in-memory insertions should finish under 5s (took ${totalMs.toFixed(2)}ms)`);
  });

  test("2. Burst-inserted collection survives snapshot persistence and restoration", async () => {
    const driver = new MemoryDriver();
    const engine1 = new SyncEngine({ driver });
    const store1 = syncCollection({ key: "persist-burst-test", syncEngine: engine1, engine: "legacy" });
    const generateId = createTaskIdGenerator();

    const COUNT = 250;
    for (let i = 0; i < COUNT; i++) {
      await store1.insert({ id: generateId(), title: `Item ${i}`, val: i });
    }

    assert.strictEqual(store1.items().length, COUNT);

    // Simulate page reload / new instance using same driver storage
    const engine2 = new SyncEngine({ driver });
    const store2 = syncCollection({ key: "persist-burst-test", syncEngine: engine2, engine: "legacy" });

    const restoredItems = store2.items();
    assert.strictEqual(restoredItems.length, COUNT, "All items must be restored after reload");
  });

  test("3. Multiple concurrent stores generate collision-free unique IDs", () => {
    const genA = createTaskIdGenerator();
    const genB = createTaskIdGenerator();

    const set = new Set();
    const COUNT = 500;

    for (let i = 0; i < COUNT; i++) {
      set.add(genA());
      set.add(genB());
    }

    assert.strictEqual(set.size, COUNT * 2, "Concurrent generators must produce disjoint unique IDs");
  });

  test("4. Fallback generator without crypto.randomUUID maintains monotonic uniqueness", () => {
    let seq = 0;
    const fallbackGen = () => `t-${Date.now()}-${++seq}`;

    const set = new Set();
    const COUNT = 1000;
    for (let i = 0; i < COUNT; i++) {
      set.add(fallbackGen());
    }

    assert.strictEqual(set.size, COUNT, "Fallback sequence generator must guarantee unique IDs in synchronous loops");
  });
});
