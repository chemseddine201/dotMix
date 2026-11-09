/**
 * Gate 22 (D-125): CRDT Epoch Compaction, Tombstone GC & Network Transports Suite
 *
 * Verifies:
 * 1. `ReplicableArray.compact(watermark)`: purges deleted tombstones while preserving active items and fractional sequence
 * 2. `SyncEngine.compact(watermark)`: compacts registered CRDT stores and prunes committed log entries from storage driver
 * 3. `HttpBatchSyncTransport`: batches outgoing mutations, posts JSON to endpoint, and delivers incoming packet updates
 * 4. `WebSocketSyncTransport`: queues packets while offline/connecting and delivers frames
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ReplicableArray,
  SyncEngine,
  syncCollection,
  MemoryDriver,
  HttpBatchSyncTransport,
  WebSocketSyncTransport
} from "../../packages/sync/dist/index.js";

describe("Gate 22: CRDT Epoch Compaction & Network Transports (@mix/sync)", () => {
  test("1. ReplicableArray compacts deleted tombstones while preserving active item sequence", () => {
    const array = new ReplicableArray();

    // Insert 4 items with increasing clocks
    array.insert("task-1", { title: "Arch 1" }, { timestamp: 10, clientId: "c1", sequence: 1 });
    array.insert("task-2", { title: "Arch 2" }, { timestamp: 20, clientId: "c1", sequence: 2 });
    array.insert("task-3", { title: "Arch 3" }, { timestamp: 30, clientId: "c1", sequence: 3 });
    array.insert("task-4", { title: "Arch 4" }, { timestamp: 40, clientId: "c1", sequence: 4 });

    assert.strictEqual(array.length, 4);

    // Delete task-1 at timestamp 25 and task-3 at timestamp 50
    array.delete("task-1", { timestamp: 25, clientId: "c1", sequence: 5 });
    array.delete("task-3", { timestamp: 50, clientId: "c1", sequence: 6 });

    assert.strictEqual(array.length, 2);
    // Before compaction, internal entries Map has 4 entries (2 active + 2 tombstones)
    assert.strictEqual(array.toJSON().length, 4);

    // Run compaction with watermark = 30
    // task-1 was deleted at 25 (<= 30) -> purged!
    // task-3 was deleted at 50 (> 30) -> retained (watermark hasn't acknowledged it yet)
    const purged = array.compact(30);
    assert.strictEqual(purged, 1, "Should purge exactly 1 tombstone older than watermark");

    // Internal size reduced to 3 entries
    assert.strictEqual(array.toJSON().length, 3);
    assert.strictEqual(array.getEntry("task-1"), null, "task-1 tombstone should be completely removed");
    assert.ok(array.getEntry("task-3")?.deleted, "task-3 tombstone should remain until watermark >= 50");

    // Active items and sequence order are unchanged
    const items = array.toArray();
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].title, "Arch 2");
    assert.strictEqual(items[1].title, "Arch 4");
  });

  test("2. SyncEngine.compact purges collection tombstones and prunes driver mutation log", async () => {
    const driver = new MemoryDriver();
    const engine = new SyncEngine({ driver, initialOnline: false });

    const collection = syncCollection({
      key: "enterprise_tasks",
      syncEngine: engine,
      driver
    });

    // Insert 2 items and delete 1
    const m1 = await collection.insert({ id: "t1", title: "Task 1" });
    const m2 = await collection.insert({ id: "t2", title: "Task 2" });
    const m3 = await collection.delete("t1");

    // Mark mutations committed (as if server ACKed)
    await driver.markMutationsCommitted([m1.idStr, m2.idStr, m3.idStr]);

    const maxClock = Math.max(m1.id.timestamp, m2.id.timestamp, m3.id.timestamp);

    // Run compaction on engine
    const res = await engine.compact(maxClock);

    assert.strictEqual(res.purgedTombstones, 1, "Should purge t1 tombstone");
    assert.strictEqual(res.prunedLogEntries, 3, "Should prune all 3 committed log entries from storage driver");

    // Active item t2 remains
    const active = collection.items();
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].title, "Task 2");
  });

  test("3. HttpBatchSyncTransport batches mutations and delivers server packet", async () => {
    let capturedBody = null;
    let deliveredPacket = null;

    const mockFetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          clientId: "server",
          mutations: [],
          acks: ["mut_ack_1", "mut_ack_2"]
        })
      };
    };

    const transport = new HttpBatchSyncTransport({
      endpoint: "https://api.mix.dev/sync",
      batchIntervalMs: 20,
      fetchFn: mockFetch
    });

    transport.onReceive((packet) => {
      deliveredPacket = packet;
    });

    // Queue 2 mutations
    await transport.send({
      clientId: "client-a",
      mutations: [
        { idStr: "mut_1", storeKey: "test", op: "set", payload: 10, state: "pending", createdAt: Date.now(), id: { timestamp: 1, clientId: "a", sequence: 1 } },
        { idStr: "mut_2", storeKey: "test", op: "set", payload: 20, state: "pending", createdAt: Date.now(), id: { timestamp: 2, clientId: "a", sequence: 2 } }
      ]
    });

    // Wait for batchIntervalMs (20ms) to trigger auto-flush
    await new Promise((resolve) => globalThis.setTimeout(resolve, 40));

    assert.ok(capturedBody);
    assert.strictEqual(capturedBody.mutations.length, 2);
    assert.strictEqual(capturedBody.mutations[0].idStr, "mut_1");
    assert.strictEqual(capturedBody.mutations[1].idStr, "mut_2");

    // Incoming ACK delivered to onReceive handlers
    assert.ok(deliveredPacket);
    assert.deepStrictEqual(deliveredPacket.acks, ["mut_ack_1", "mut_ack_2"]);

    transport.close();
  });

  test("4. WebSocketSyncTransport queues packets and sends upon connect", async () => {
    const sentFrames = [];

    // Mock WebSocket class
    class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING
        globalThis.setTimeout(() => {
          this.readyState = 1; // OPEN
          this.onopen?.();
        }, 20);
      }
      send(data) {
        sentFrames.push(JSON.parse(data));
      }
      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }
    MockWebSocket.OPEN = 1;

    globalThis.WebSocket = MockWebSocket;

    const wsTransport = new WebSocketSyncTransport({
      url: "wss://sync.mix.dev/stream"
    });

    // Send while connecting -> should queue
    await wsTransport.send({
      clientId: "client-ws",
      mutations: [{ idStr: "ws_mut_1", storeKey: "notes", op: "insert", payload: "Hello WS", state: "pending", createdAt: Date.now(), id: { timestamp: 1, clientId: "w", sequence: 1 } }]
    });

    assert.strictEqual(sentFrames.length, 0, "Packet must be queued before socket opens");

    // Wait for mock connection to open (30ms)
    await new Promise((resolve) => globalThis.setTimeout(resolve, 40));

    assert.strictEqual(sentFrames.length, 1, "Queued packet must be flushed upon connection");
    assert.strictEqual(sentFrames[0].mutations[0].idStr, "ws_mut_1");

    wsTransport.close();
  });
});

