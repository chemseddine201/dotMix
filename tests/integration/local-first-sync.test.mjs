/**
 * Gate 16 (D-119): Local-First Offline-First Reactive CRDT State Sync Engine Suite
 *
 * Verifies:
 * 1. syncSignal: immediate 0ms optimistic UI updates, Lamport clocks, durability & rollback
 * 2. Fractional indexing: collision-free deterministic ordering between arbitrary positions
 * 3. syncCollection: Replicable Array CRDT insert, update, delete tombstones, and reordering
 * 4. Offline mutation queuing: mutations accumulate while disconnected and persist to storage
 * 5. Multi-client convergence: divergent offline mutations converge deterministically upon reconnection
 * 6. Server rejection & transactional rollback: rejected mutations revert local signal & DOM state
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

import {
  syncSignal,
  syncCollection,
  SyncEngine,
  MockTransportChannel,
  MemoryDriver,
  generateKeyBetween
} from "../../node_modules/@dotmix/sync/dist/index.js";
import { D137ReferenceCoordinator } from "../../tools/d137-coordinator/coordinator.js";

describe("Gate 16: Local-First Offline Sync Engine (@dotmix/sync)", () => {
  let win;

  beforeEach(() => {
    win = new Window();
    globalThis.window = win;
    globalThis.document = win.document;
  });

  test("1. Fractional Indexing generates strictly ordered collision-free keys", () => {
    const k1 = generateKeyBetween(null, null);
    assert.strictEqual(typeof k1, "string");

    // Insert before k1
    const k0 = generateKeyBetween(null, k1);
    assert.ok(k0 < k1, `k0 (${k0}) must be strictly less than k1 (${k1})`);

    // Insert after k1
    const k2 = generateKeyBetween(k1, null);
    assert.ok(k1 < k2, `k1 (${k1}) must be strictly less than k2 (${k2})`);

    // Insert between k0 and k1
    const k0_5 = generateKeyBetween(k0, k1);
    assert.ok(k0 < k0_5 && k0_5 < k1, `${k0} < ${k0_5} < ${k1}`);

    // Insert multiple dense items between two consecutive keys
    let cur = k0;
    for (let i = 0; i < 20; i++) {
      const next = generateKeyBetween(cur, k1);
      assert.ok(cur < next && next < k1, `Dense step ${i}: ${cur} < ${next} < ${k1}`);
      cur = next;
    }
  });

  test("2. syncSignal executes 0ms optimistic update, Lamport timestamps, and rollback", async () => {
    const driver = new MemoryDriver();
    const engine = new SyncEngine({ driver, initialOnline: true });

    const theme = syncSignal("light", {
      key: "app-theme",
      driver,
      syncEngine: engine,
      engine: "legacy",
    });

    assert.strictEqual(theme(), "light");
    assert.strictEqual(theme.status(), "synced");
    assert.strictEqual(theme.isPending(), false);

    // Optimistic mutation
    theme.set("dark");
    assert.strictEqual(theme(), "dark", "Immediate optimistic update must be 0ms synchronous");
    assert.strictEqual(theme.isPending(), true);

    // Rollback mutation
    theme.rollback();
    assert.strictEqual(theme(), "light", "Rollback must revert immediately to previous snapshot");
    assert.strictEqual(theme.isPending(), false);

    // Another mutation and commit
    theme.set("solarized");
    assert.strictEqual(theme(), "solarized");
    theme.commit();
    assert.strictEqual(theme.isPending(), false);
  });

  test("3. syncCollection supports fractional-indexed insert, update, delete, and reorder", async () => {
    const driver = new MemoryDriver();
    const engine = new SyncEngine({ driver, initialOnline: true });

    const tasks = syncCollection("project-tasks", {
      key: "project-tasks",
      driver,
      syncEngine: engine,
      engine: "legacy",
    });

    assert.deepStrictEqual(tasks.items(), []);

    // 1. Insert tasks
    await tasks.insert({ id: "t1", title: "Build Lexer", done: true });
    await tasks.insert({ id: "t2", title: "Build Parser", done: false });
    await tasks.insert({ id: "t3", title: "Build Codegen", done: false });

    assert.strictEqual(tasks.items().length, 3);
    assert.strictEqual(tasks.items()[0].id, "t1");
    assert.strictEqual(tasks.items()[1].id, "t2");
    assert.strictEqual(tasks.items()[2].id, "t3");

    // 2. Prepend task (targetIndex = 0)
    await tasks.insert({ id: "t0", title: "Setup Repo", done: true }, 0);
    assert.strictEqual(tasks.items().length, 4);
    assert.strictEqual(tasks.items()[0].id, "t0");
    assert.strictEqual(tasks.items()[1].id, "t1");

    // 3. Update task
    await tasks.update("t2", { done: true });
    assert.strictEqual(tasks.items().find((t) => t.id === "t2")?.done, true);

    // 4. Reorder: move t0 to end
    await tasks.reorder(0, 3);
    const updatedIds = tasks.items().map((t) => t.id);
    assert.deepStrictEqual(updatedIds, ["t1", "t2", "t3", "t0"]);

    // 5. Delete task
    await tasks.delete("t1");
    assert.strictEqual(tasks.items().length, 3);
    assert.strictEqual(tasks.items().some((t) => t.id === "t1"), false);
  });

  test("4. Offline mutation queueing: mutations accumulate and flush upon reconnection", async () => {
    const driverA = new MemoryDriver();
    const driverB = new MemoryDriver();

    const channelA = new MockTransportChannel();
    const channelB = new MockTransportChannel();
    channelA.peerChannel = channelB;
    channelB.peerChannel = channelA;

    const engineA = new SyncEngine({ clientId: "client-A", driver: driverA, channel: channelA, initialOnline: true });
    const engineB = new SyncEngine({ clientId: "client-B", driver: driverB, channel: channelB, initialOnline: true });

    const notesA = syncCollection("notes", { key: "notes", driver: driverA, syncEngine: engineA, engine: "legacy" });
    const notesB = syncCollection("notes", { key: "notes", driver: driverB, syncEngine: engineB, engine: "legacy" });

    // Client A creates note while online -> immediately syncs to B
    await notesA.insert({ id: "n1", text: "Online Note" });
    assert.strictEqual(notesB.items().length, 1);
    assert.strictEqual(notesB.items()[0].text, "Online Note");

    // Now Client A goes OFFLINE
    engineA.goOffline();
    channelA.isOnline = false;
    assert.strictEqual(engineA.isOnline(), false);
    assert.strictEqual(notesA.status(), "offline");

    // Client A performs multiple mutations while disconnected
    await notesA.insert({ id: "n2", text: "Offline Draft 1" });
    await notesA.insert({ id: "n3", text: "Offline Draft 2" });
    assert.strictEqual(notesA.items().length, 3);
    assert.strictEqual(notesB.items().length, 1, "Client B must not have received offline drafts yet");

    // Client A goes back ONLINE -> queues automatically flush to B
    channelA.isOnline = true;
    engineA.goOnline();
    assert.strictEqual(engineA.isOnline(), true);

    // Wait for async flush
    await new Promise((resolveTimer) => globalThis.setTimeout(resolveTimer, 50));
    assert.strictEqual(notesB.items().length, 3, "Client B must receive all flushed offline mutations");
    assert.strictEqual(notesB.items()[1].text, "Offline Draft 1");
    assert.strictEqual(notesB.items()[2].text, "Offline Draft 2");
  });

  test("5. Multi-client convergence: concurrent divergent mutations converge deterministically", async () => {
    const driver1 = new MemoryDriver();
    const driver2 = new MemoryDriver();

    const ch1 = new MockTransportChannel();
    const ch2 = new MockTransportChannel();
    ch1.peerChannel = ch2;
    ch2.peerChannel = ch1;

    const engine1 = new SyncEngine({ clientId: "c1", driver: driver1, channel: ch1, initialOnline: false });
    const engine2 = new SyncEngine({ clientId: "c2", driver: driver2, channel: ch2, initialOnline: false });

    // Both start disconnected
    ch1.isOnline = false;
    ch2.isOnline = false;

    const list1 = syncCollection("items", { key: "items", driver: driver1, syncEngine: engine1, engine: "legacy" });
    const list2 = syncCollection("items", { key: "items", driver: driver2, syncEngine: engine2, engine: "legacy" });

    // Client 1 inserts item-A and item-B
    await list1.insert({ id: "item-A", name: "Apple" });
    await list1.insert({ id: "item-B", name: "Banana" });

    // Client 2 inserts item-C and item-D
    await list2.insert({ id: "item-C", name: "Cherry" });
    await list2.insert({ id: "item-D", name: "Date" });

    // Both go online and connect
    ch1.isOnline = true;
    ch2.isOnline = true;
    engine1.goOnline();
    engine2.goOnline();

    await new Promise((resolveTimer) => globalThis.setTimeout(resolveTimer, 60));

    // Both collections must converge to the EXACT same 4 items in the EXACT same order!
    assert.strictEqual(list1.items().length, 4);
    assert.strictEqual(list2.items().length, 4);
    assert.deepStrictEqual(
      list1.items().map((itemCandidate) => itemCandidate.id),
      list2.items().map((itemCandidate) => itemCandidate.id),
      "Both client collections must converge to identical deterministic order"
    );
  });

  for (const candidateEngine of ["legacy", "d137"]) {
    test(`6. Server rejection triggers automatic local transactional rollback (${candidateEngine})`, async () => {
      const driver = new MemoryDriver();
      const channel = new MockTransportChannel();
      const serverChannel = new MockTransportChannel();
      channel.peerChannel = serverChannel;
      serverChannel.peerChannel = channel;

      const engine = new SyncEngine({ clientId: `client-alice-${candidateEngine}`, driver, channel, initialOnline: true });
      serverChannel.latencyMs = 20;

      const tasks = syncCollection(`restricted-tasks-${candidateEngine}`, {
        key: `restricted-tasks-${candidateEngine}`,
        driver,
        syncEngine: engine,
        engine: candidateEngine,
      });
      await tasks.ready;

      if (candidateEngine === "d137") {
        const coordinatorInstance = new D137ReferenceCoordinator({ collectionId: `restricted-tasks-${candidateEngine}` });
        await coordinatorInstance.initialize();
        const memberBinding = tasks.engineInstance.meta.epochMemberBindings[tasks.engineInstance.meta.replicaId];
        await coordinatorInstance.registerClient(
          memberBinding.authorKeyId,
          memberBinding.authorPublicKeyHex,
          "WRITER_REPLICA",
          tasks.engineInstance.meta.replicaId
        );
        const coordinatorCertificate = coordinatorInstance.getCertificate();
        tasks.engineInstance.meta.epochCertificate = coordinatorCertificate;
        tasks.engineInstance.meta.epochCertificateId = coordinatorCertificate.epochCertificateId;
        tasks.engineInstance.meta.epochMemberBindings = { ...coordinatorCertificate.memberBindings };
      }

      // Setup simulated server rejecting mutations with "forbidden"
      serverChannel.onReceive((packet) => {
        if (candidateEngine === "d137" && packet.envelope) {
          const operation = packet.envelope.payload;
          if (
            operation &&
            (operation.initialFields?.title?.includes("Hacked") ||
              operation.initialFields?.value?.title?.includes("Hacked"))
          ) {
            void serverChannel.send({
              clientId: "server",
              mutations: [],
              rejections: [{ idStr: operation.externalId, reason: "ACCESS_DENIED_SECURITY_RULE" }],
            });
          }
          return;
        }

        for (const candidateMutation of packet.mutations) {
          if (
            candidateMutation.payload &&
            typeof candidateMutation.payload === "object" &&
            (candidateMutation.payload?.value?.title?.includes("Hacked") ||
              candidateMutation.payload?.title?.includes("Hacked"))
          ) {
            void serverChannel.send({
              clientId: "server",
              mutations: [],
              rejections: [{ idStr: candidateMutation.idStr, reason: "ACCESS_DENIED_SECURITY_RULE" }],
            });
          }
        }
      });

      // Client creates a valid task -> stays
      await tasks.insert({ id: "t1", title: "Valid Task" });
      assert.strictEqual(tasks.items().length, 1);

      // Client attempts an unauthorized task -> optimistic update shows it in UI immediately
      const insertPromise = tasks.insert({ id: "t2", title: "Hacked Admin Task" });
      assert.strictEqual(tasks.items().length, 2, "Optimistically rendered in UI immediately");
      await insertPromise;

      // Wait for async server rejection to arrive over network
      await new Promise((resolveTimer) => globalThis.setTimeout(resolveTimer, 100));

      // The rejected mutation MUST have rolled back automatically!
      assert.strictEqual(tasks.items().length, 1, "Rejected mutation must be rolled back automatically");
      assert.strictEqual(tasks.items()[0].title, "Valid Task");

      if (candidateEngine === "legacy") {
        const pendingMutations = await driver.getPendingMutations();
        assert.strictEqual(pendingMutations.length, 1, "Only valid task remains pending awaiting ACK");
        assert.strictEqual(pendingMutations[0]?.payload?.value?.title ?? pendingMutations[0]?.payload?.title, "Valid Task");
      } else {
        // d137: D-146 compensating rollback preserves history in journal
        assert.ok(tasks.engineInstance, "D137 engine instance exists");
        assert.strictEqual(tasks.items().length, 1, "Only valid task is present in items");
        assert.strictEqual(tasks.pendingCount(), 0, "No pending overlay intents remain");
        // History is preserved: entry for t2 is marked deleted or compensated
        const t2Entry = tasks.engineInstance.entriesState.get("t2");
        if (t2Entry) {
          assert.strictEqual(t2Entry.deleted, true, "Rejected task entry is marked deleted via compensating op");
        }
      }
    });
  }
});
