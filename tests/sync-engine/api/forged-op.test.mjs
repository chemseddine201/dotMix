/**
 * @dotmix/sync — Cryptographic Verification of Remote Operations Test
 *
 * Verifies that forged or untrusted operations arriving over a network channel
 * are strictly rejected by the protocol engine and do not mutate collection items.
 *
 * Rules: N1-N8 compliant, zero forbidden identifiers, file <= 500 lines.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  syncCollection,
  MemoryStoreBackend,
  SyncEngine,
  MemoryDriver,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/index.js";
import { createWireEnvelope } from "../../../packages/sync/dist/transport/envelope.js";

class MockDuplexChannel {
  constructor() {
    this.packetReceiver = undefined;
  }

  onReceive(handler) {
    this.packetReceiver = handler;
    return () => {
      this.packetReceiver = undefined;
    };
  }

  async send(_outgoingPacket) {
    void _outgoingPacket;
    // Outgoing packets handled in tests as needed
  }

  async deliverIncomingPacket(incomingPacket) {
    if (this.packetReceiver) {
      await this.packetReceiver(incomingPacket);
    }
  }

  close() {
    this.packetReceiver = undefined;
  }
}

describe("API: Cryptographic Verification and Forged Operation Rejection", () => {
  it("rejects forged remote operations arriving over channel and preserves collection items", async () => {
    const memoryStoreBackendInstance = new MemoryStoreBackend();
    await memoryStoreBackendInstance.open();

    const mockChannelInstance = new MockDuplexChannel();
    const collectionIdentifier = "authenticated-channel-collection";

    const syncEngineInstance = new SyncEngine({
      clientId: "authorized-local-user",
      driver: new MemoryDriver(),
      channel: mockChannelInstance,
      initialOnline: true,
    });

    const collection = syncCollection({
      key: collectionIdentifier,
      engine: "replicated",
      driver: memoryStoreBackendInstance,
      syncEngine: syncEngineInstance,
    });
    await collection.ready;

    // 1. Insert a legitimate local item
    await collection.insert({
      id: "legitimate-item-001",
      title: "Legitimate Document",
      author: "authorized-local-user",
    });

    const itemsAfterLocalInsert = collection.items();
    assert.strictEqual(itemsAfterLocalInsert.length, 1, "Should have 1 legitimate local item");
    assert.strictEqual(itemsAfterLocalInsert[0]?.id, "legitimate-item-001");

    // 2. Craft a forged operation signed by an unauthorized key
    const forgedOperation = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: collectionIdentifier,
      epochNumber: 1,
      epochCertificateId: "cert:forged:1",
      opDot: { epochNumber: 1, replicaId: "attacker-replica", sequence: 999 },
      targetIncarnation: { epochNumber: 1, replicaId: "attacker-replica", sequence: 999 },
      externalId: "forged-item-999",
      stamp: {
        lamport: 999,
        epochNumber: 1,
        replicaId: "attacker-replica",
        sequence: 999,
      },
      authorKeyId: "key:attacker-replica:v1",
      payloadDigest: "0".repeat(64),
      authorSignature: "bad_signature_hex_".padEnd(128, "0"),
      kind: "insert",
      indexKey: "z9",
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: {
        id: "forged-item-999",
        title: "Malicious Injected Document",
      },
    };

    const forgedWireEnvelope = createWireEnvelope(
      "op",
      collectionIdentifier,
      "attacker-replica",
      forgedOperation
    );

    // 3. Deliver forged wire envelope through the active channel
    await mockChannelInstance.deliverIncomingPacket({
      clientId: "attacker-replica",
      mutations: [],
      envelope: forgedWireEnvelope,
    });

    // 4. Assert collection items are unchanged: forged item was rejected
    const itemsAfterForgedAttempt = collection.items();
    assert.strictEqual(
      itemsAfterForgedAttempt.length,
      1,
      "Forged operation must not be applied to collection items"
    );
    assert.strictEqual(
      itemsAfterForgedAttempt[0]?.id,
      "legitimate-item-001",
      "Only legitimate items should remain in collection"
    );

    // 5. C1 step 6: Deliver 3 plain unsigned mutations (insert, update, clear) over channel
    await mockChannelInstance.deliverIncomingPacket({
      clientId: "untrusted-sender",
      mutations: [
        {
          id: { wallMs: Date.now(), clientId: "untrusted-sender", sequence: 1 },
          idStr: "1:untrusted-sender:1",
          storeName: collectionIdentifier,
          op: "insert",
          payload: { id: "forged-item", title: "forged" },
          createdAt: Date.now(),
        },
        {
          id: { wallMs: Date.now(), clientId: "untrusted-sender", sequence: 2 },
          idStr: "1:untrusted-sender:2",
          storeName: collectionIdentifier,
          op: "update",
          payload: { id: "legitimate-item-001", partial: { title: "hacked" } },
          createdAt: Date.now(),
        },
        {
          id: { wallMs: Date.now(), clientId: "untrusted-sender", sequence: 3 },
          idStr: "1:untrusted-sender:3",
          storeName: collectionIdentifier,
          op: "clear",
          payload: null,
          createdAt: Date.now(),
        },
      ],
    });

    // Assert that the 3 plain unsigned mutations change nothing
    const itemsAfterPlainMutations = collection.items();
    assert.strictEqual(
      itemsAfterPlainMutations.length,
      1,
      "Plain unsigned mutations must not modify replicated collection"
    );
    assert.strictEqual(
      itemsAfterPlainMutations[0]?.id,
      "legitimate-item-001",
      "Item id must remain legitimate-item-001"
    );
    assert.strictEqual(
      itemsAfterPlainMutations[0]?.title,
      "Legitimate Document",
      "Item title must not be overwritten by plain update"
    );

    await collection.close();
  });
});
