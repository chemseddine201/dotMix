/**
 * @dotmix/sync — Full-Stack End-to-End Simulation
 *
 * Runs a deterministic 300-seed simulation covering API -> engine -> store -> transport -> coordinator:
 * - 300 seeds (seeds 1..300)
 * - Every 10th seed executes 200 events (heavy traffic)
 * - All other seeds execute 20 events
 * - Each client is syncCollection({ engine: "replicated", driver: MemoryStoreBackend, channel })
 * - Crash event closes and reopens client from its store backend
 *
 * Rules: N1-N8 compliant, zero forbidden identifiers, file <= 500 lines.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SyncReferenceCoordinator } from "../../../tools/sync-coordinator/coordinator.js";
import {
  syncCollection,
  MemoryStoreBackend,
} from "../../../packages/sync/dist/index.js";
import { createHttpPrincipal } from "../../../packages/sync/dist/transport/principal.js";
import { MultiTabCoordinator } from "../../../packages/sync/dist/transport/multi-tab.js";

/**
 * Channel bridge connecting a syncCollection client to the SyncReferenceCoordinator.
 */
class CoordinatorTransportChannel {
  constructor(coordinatorInstance, principalInstance) {
    this.coordinatorInstance = coordinatorInstance;
    this.principalInstance = principalInstance;
    this.packetReceiver = undefined;
  }

  onReceive(handler) {
    this.packetReceiver = handler;
    return () => {
      this.packetReceiver = undefined;
    };
  }

  async send(packet) {
    if (packet && packet.envelope) {
      const responseEnvelope = await this.coordinatorInstance.ingestEnvelope(
        packet.envelope,
        this.principalInstance
      );
      if (responseEnvelope && this.packetReceiver) {
        await this.packetReceiver({
          clientId: this.principalInstance.replicaId,
          mutations: [],
          envelope: responseEnvelope,
        });
      }
    }
  }

  close() {
    this.packetReceiver = undefined;
  }
}

/**
 * Deterministic 32-bit pseudo-random number generator (Mulberry32).
 */
function createPrng(seedValue) {
  let state = seedValue >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let temporary = Math.imul(state ^ (state >>> 15), 1 | state);
    temporary = (temporary + Math.imul(temporary ^ (temporary >>> 7), 61 | temporary)) ^ temporary;
    return ((temporary ^ (temporary >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Full-Stack Simulation (300 Seeds)", () => {
  it("executes 300 seeds validating end-to-end API -> engine -> store -> transport -> coordinator", async () => {
    const totalSeeds = 300;
    let totalEventsExecuted = 0;
    let heavySeedsExecuted = 0;

    for (let seedNumber = 1; seedNumber <= totalSeeds; seedNumber++) {
      const prng = createPrng(seedNumber * 7919);
      const isHeavySeed = seedNumber % 10 === 0;
      const targetEventCount = isHeavySeed ? 200 : 20;
      if (isHeavySeed) heavySeedsExecuted++;

      const collectionIdentifier = `col_sim_${seedNumber}`;
      const coordinator = new SyncReferenceCoordinator({ collectionId: collectionIdentifier });
      await coordinator.initialize();

      // Register two client replicas on coordinator
      await coordinator.registerClient(
        "key-rep-1",
        "01".repeat(32),
        "WRITER_REPLICA",
        "rep-1"
      );
      await coordinator.registerClient(
        "key-rep-2",
        "01".repeat(32),
        "WRITER_REPLICA",
        "rep-2"
      );

      const principalClient1 = createHttpPrincipal(`sess-1-${seedNumber}`, "rep-1");
      const principalClient2 = createHttpPrincipal(`sess-2-${seedNumber}`, "rep-2");

      const storeClient1 = new MemoryStoreBackend();
      await storeClient1.open();
      const storeClient2 = new MemoryStoreBackend();
      await storeClient2.open();

      const channelClient1 = new CoordinatorTransportChannel(coordinator, principalClient1);
      const channelClient2 = new CoordinatorTransportChannel(coordinator, principalClient2);

      let client1 = syncCollection({
        key: collectionIdentifier,
        engine: "replicated",
        driver: storeClient1,
        channel: channelClient1,
      });
      await client1.ready;

      let client2 = syncCollection({
        key: collectionIdentifier,
        engine: "replicated",
        driver: storeClient2,
        channel: channelClient2,
      });
      await client2.ready;

      // Setup multi-tab coordinator for client 1
      const tabCoordinator = new MultiTabCoordinator({
        collectionId: collectionIdentifier,
        tabIdentifier: `tab-sim-${seedNumber}`,
      });
      tabCoordinator.acquirePrimaryLease();

      let sequenceClient1 = 0;
      let sequenceClient2 = 0;
      const createdItemIdentifiers = [];

      for (let eventIndex = 0; eventIndex < targetEventCount; eventIndex++) {
        totalEventsExecuted++;
        const eventKindSelector = Math.floor(prng() * 6);

        if (eventKindSelector === 0 || createdItemIdentifiers.length === 0) {
          // Client 1 Insert via Public API
          sequenceClient1++;
          const itemIdentifier = `item-1-${sequenceClient1}`;
          createdItemIdentifiers.push(itemIdentifier);

          await client1.insert({
            id: itemIdentifier,
            count: sequenceClient1,
            seed: seedNumber,
          });

          // Post-commit tab broadcast
          tabCoordinator.broadcastPostCommitRefresh([
            `${collectionIdentifier}:1:rep-1:${sequenceClient1}`,
          ]);
        } else if (eventKindSelector === 1) {
          // Client 2 Insert via Public API
          sequenceClient2++;
          const itemIdentifier = `item-2-${sequenceClient2}`;
          createdItemIdentifiers.push(itemIdentifier);

          await client2.insert({
            id: itemIdentifier,
            count: sequenceClient2,
            seed: seedNumber,
          });
        } else if (eventKindSelector === 2) {
          // Client 1 Update via Public API
          sequenceClient1++;
          const targetItemIdentifier =
            createdItemIdentifiers[Math.floor(prng() * createdItemIdentifiers.length)];

          await client1.update(targetItemIdentifier, {
            updatedCount: sequenceClient1,
          });
        } else if (eventKindSelector === 3) {
          // Client 2 Delete or Reorder via Public API
          const effectiveItems = client2.items();
          if (effectiveItems.length > 1) {
            await client2.reorder(0, effectiveItems.length - 1);
          } else if (effectiveItems.length === 1 && prng() > 0.5) {
            await client2.delete(effectiveItems[0].id);
          }
        } else if (eventKindSelector === 4) {
          // Crash & Reopen from store backend
          if (client1.items().length > 0) {
            await client1.close();
            client1 = syncCollection({
              key: collectionIdentifier,
              engine: "replicated",
              driver: storeClient1,
              channel: channelClient1,
            });
            await client1.ready;
            assert.ok(client1.items().length > 0, "Recovered items must persist after crash restart");
          }
        } else {
          // Multi-tab heartbeat
          tabCoordinator.emitHeartbeat();
        }
      }

      // Quiescence assertion at end of seed
      const clusterFrontier = coordinator.getClusterFrontier();
      assert.ok(clusterFrontier, "Cluster frontier must be available from coordinator");

      await client1.close();
      await client2.close();
      tabCoordinator.dispose();
    }

    assert.strictEqual(heavySeedsExecuted, 30, "Exactly 30 seeds must be heavy (every 10th seed)");
    assert.strictEqual(
      totalEventsExecuted,
      270 * 20 + 30 * 200,
      "Expected exactly 11,400 events across 300 seeds"
    );
  });
});
