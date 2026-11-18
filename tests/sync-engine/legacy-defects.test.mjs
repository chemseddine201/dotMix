/* global setTimeout, structuredClone */
/**
 *: production @dotmix/sync defects as regression tests (public API only).
 *
 * Each test states the CORRECT behavior.
 * - On the legacy engine the tests are marked `todo` (known defects, recorded in the TAP output),
 *   so the root suite stays green.
 * - On the engine they must pass. That variant runs when MIX_SYNC_Sync=1, which the
 *   agents enable once the adapter (`engine: "replicated"`) lands. At acceptance it
 *   becomes the default.
 *
 * Covered here: P1, P2, P3 (directive §2.2), R-1, R-5, and R-6.
 * Covered elsewhere: R-2 and R-3.
 * R-4 (constructor.name detection) is internal, not observable through the public API.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syncCollection, SyncEngine, MemoryDriver } from "../../node_modules/@dotmix/sync/dist/index.js";
import { SyncReferenceCoordinator, createMockPrincipal } from "../../tools/sync-coordinator/coordinator.js";

const ENGINES = ["legacy", "replicated"];

/** Test-only network: every mutation is queued per receiver, and the test chooses delivery order. */
class Hub {
  constructor() {
    this.channels = new Map();
    this.queue = [];
    this.connectedCollections = new Map();
    this.coordinatorInstance = null;
    this.coordinatorInitializationPromise = null;
    this.membershipPromise = null;
    this.registeredReplicaIds = new Set();
  }

  ensureMembership() {
    if (!this.membershipPromise) {
      this.membershipPromise = (async () => {
        await this.coordinatorInitializationPromise;
        // Yield one tick so all client() invocations in the current test body attach
        await new Promise((resolveTick) => setTimeout(resolveTick, 0));
        for (const [attachedId, attachedCollection] of this.connectedCollections.entries()) {
          await attachedCollection._initialReadyPromise;
          const attachedEngine = attachedCollection.engineInstance;
          if (attachedEngine && !this.registeredReplicaIds.has(attachedId)) {
            this.registeredReplicaIds.add(attachedId);
            const memberBinding = attachedEngine.meta.epochMemberBindings[attachedEngine.meta.replicaId];
            if (memberBinding) {
              await this.coordinatorInstance.registerClient(
                memberBinding.authorKeyId,
                memberBinding.authorPublicKeyHex,
                "WRITER_REPLICA",
                attachedEngine.meta.replicaId
              );
            }
          }
        }
        const updatedCertificate = this.coordinatorInstance.getCertificate();
        for (const attachedCollection of this.connectedCollections.values()) {
          if (attachedCollection.engineInstance) {
            attachedCollection.engineInstance.meta.epochCertificate = updatedCertificate;
            attachedCollection.engineInstance.meta.epochCertificateId = updatedCertificate.epochCertificateId;
            attachedCollection.engineInstance.meta.epochMemberBindings = { ...updatedCertificate.memberBindings };
          }
        }
      })();
    }
    return this.membershipPromise;
  }

  attach(clientId, targetCollection) {
    this.connectedCollections.set(clientId, targetCollection);
    if (!this.coordinatorInstance) {
      this.coordinatorInstance = new SyncReferenceCoordinator({ collectionId: "items" });
      this.coordinatorInitializationPromise = this.coordinatorInstance.initialize();
    }
    const initialReadyPromise = targetCollection.ready;
    targetCollection._initialReadyPromise = initialReadyPromise;
    targetCollection.ready = (async () => {
      await initialReadyPromise;
      await this.ensureMembership();
    })();
  }

  channel(clientId) {
    const channels = this.channels;
    const enqueue = (entry) => this.queue.push(entry);
    const packetReceivers = new Set();
    const channelInstance = {
      principal: createMockPrincipal(clientId, clientId),
      async send(packet) {
        for (const recipientClientId of channels.keys()) {
          if (recipientClientId === clientId) continue;
          const segmentedPackets = packet.mutations.length > 0
            ? packet.mutations.map((singleMutation) => ({ ...packet, mutations: [singleMutation] }))
            : [packet];
          for (const individualPacket of segmentedPackets) {
            enqueue({ to: recipientClientId, packet: structuredClone(individualPacket) });
          }
        }
      },
      onReceive(receiverHandler) {
        packetReceivers.add(receiverHandler);
        return () => packetReceivers.delete(receiverHandler);
      },
      close() { packetReceivers.clear(); },
      async receive(packet) {
        for (const receiverHandler of packetReceivers) {
          await receiverHandler(packet);
        }
      }
    };
    this.channels.set(clientId, channelInstance);
    return channelInstance;
  }

  /** Delivers this receiver's queued packets in queue order, or reversed. */
  async deliver(recipientClientId, { reverse = false } = {}) {
    const recipientPackets = this.queue.filter((queueEntry) => queueEntry.to === recipientClientId);
    this.queue = this.queue.filter((queueEntry) => queueEntry.to !== recipientClientId);
    for (const queueEntry of reverse ? recipientPackets.reverse() : recipientPackets) {
      await this.channels.get(recipientClientId).receive(queueEntry.packet);
    }
    await settle();
  }

  async deliverAll() {
    while (this.queue.length > 0) {
      const queueEntry = this.queue.shift();
      await this.channels.get(queueEntry.to).receive(queueEntry.packet);
      await settle();
    }
  }
}

async function settle() {
  for (let settleIteration = 0; settleIteration < 5; settleIteration++) {
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
  }
}

function client(hub, clientId, selectedEngine) {
  const memoryDriverInstance = new MemoryDriver();
  const syncEngineInstance = new SyncEngine({
    clientId,
    driver: memoryDriverInstance,
    channel: hub.channel(clientId),
    initialOnline: true
  });
  const collectionOptions = { key: "items", driver: memoryDriverInstance, syncEngine: syncEngineInstance };
  if (selectedEngine !== "legacy") collectionOptions.engine = selectedEngine;
  const activeCollection = syncCollection("items", collectionOptions);
  if (selectedEngine === "replicated") {
    hub.attach(clientId, activeCollection);
  }
  return activeCollection;
}

const view = (list) => list.items().map((item) => ({ ...item }));
const ids = (list) => list.items().map((item) => item.id);

for (const engine of ENGINES) {
  const todo = engine === "legacy" ? "known legacy defect; must pass on engine replicated" : false;

  describe(`legacy sync defects [engine=${engine}]`, () => {
    it("concurrent updates to different fields both survive and converge", { todo }, async () => {
      const hub = new Hub();
      const a = client(hub, "c1", engine);
      const b = client(hub, "c2", engine);
      await a.insert({ id: "x", a: 0, b: 0 });
      await settle();
      await hub.deliverAll();
      await a.update("x", { a: 1 });
      await b.update("x", { b: 1 });
      await settle();
      await hub.deliverAll();
      assert.deepStrictEqual(view(a), view(b), "replicas diverged");
      assert.deepStrictEqual(view(a), [{ id: "x", a: 1, b: 1 }], "a concurrent field update was lost");
    });

    it("an update delivered before its insert is applied, not lost", { todo }, async () => {
      const hub = new Hub();
      const a = client(hub, "c1", engine);
      const b = client(hub, "c2", engine);
      await a.insert({ id: "x", v: 0 });
      await a.update("x", { v: 1 });
      await settle();
      await hub.deliver("c2", { reverse: true });
      await hub.deliverAll();
      assert.deepStrictEqual(view(b), [{ id: "x", v: 1 }]);
    });

    it("a remote reorder moves the same item on every replica", { todo }, async () => {
      const hub = new Hub();
      const a = client(hub, "c1", engine);
      const b = client(hub, "c2", engine);
      for (const id of ["A", "B", "C", "D"]) await a.insert({ id });
      await settle();
      await hub.deliverAll();
      await b.insert({ id: "E" }, 0);
      await a.reorder(0, 3);
      await settle();
      await hub.deliverAll();
      assert.deepStrictEqual(ids(a), ids(b), "replicas ordered differently");
      const order = ids(a);
      assert.ok(order.indexOf("A") > order.indexOf("D"), `item A was not the one moved: ${order.join(",")}`);
    });

    it("rollback of a local mutation keeps concurrent remote mutations", { todo }, async () => {
      const hub = new Hub();
      const a = client(hub, "c1", engine);
      const b = client(hub, "c2", engine);
      await a.insert({ id: "x", v: 0 });
      await settle();
      await hub.deliverAll();
      const local = await a.update("x", { v: 9 });
      await b.insert({ id: "y", v: 1 });
      await settle();
      await hub.deliver("c1");
      a.rollback(local.idStr);
      await settle();
      assert.ok(ids(a).includes("y"), "rollback discarded a concurrent remote insert");
    });

    it("clear() is replicated to every replica", { todo }, async () => {
      const hub = new Hub();
      const a = client(hub, "c1", engine);
      const b = client(hub, "c2", engine);
      await a.insert({ id: "x" });
      await a.insert({ id: "y" });
      await settle();
      await hub.deliverAll();
      await a.clear();
      await settle();
      await hub.deliverAll();
      assert.deepStrictEqual(ids(b), [], "clear() did not reach the other replica");
    });

    it("an insert with a newer id resurrects a deleted entry", { todo }, async () => {
      const hub = new Hub();
      const a = client(hub, "c1", engine);
      const b = client(hub, "c2", engine);
      await a.insert({ id: "x", v: 1 });
      await settle();
      await hub.deliverAll();
      await a.delete("x");
      await settle();
      await hub.deliverAll();
      await b.insert({ id: "x", v: 2 });
      await settle();
      await hub.deliverAll();
      assert.deepStrictEqual(view(a), view(b), "replicas diverged");
      assert.deepStrictEqual(view(a), [{ id: "x", v: 2 }], "deleted entry was not resurrected by newer insert");
    });
  });
}
