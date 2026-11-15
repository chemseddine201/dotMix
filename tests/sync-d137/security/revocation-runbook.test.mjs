/* global setTimeout */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncCollection,
  MemoryStoreBackend,
  SyncEngine,
  PROTOCOL_VERSION
} from '../../../packages/sync/dist/index.js';
import {
  D137ReferenceCoordinator,
  createMockPrincipal
} from '../../../tools/d137-coordinator/coordinator.js';
import { createWireEnvelope } from '../../../packages/sync/dist/transport/envelope.js';

class MockRelayChannel {
  constructor(senderReplicaIdentifier) {
    this.senderReplicaIdentifier = senderReplicaIdentifier;
    this.principal = createMockPrincipal(senderReplicaIdentifier, senderReplicaIdentifier);
    this.receiverHandler = undefined;
    this.sentEnvelopes = [];
  }

  onReceive(handler) {
    this.receiverHandler = handler;
    return () => {
      this.receiverHandler = undefined;
    };
  }

  async send(outgoingPacket) {
    if (outgoingPacket?.envelope) {
      this.sentEnvelopes.push(outgoingPacket.envelope);
    }
    if (this.coordinatorInstance) {
      await this.coordinatorInstance.handleClientPacket(this.senderReplicaIdentifier, outgoingPacket);
    }
  }

  setCoordinator(coordinatorInstance) {
    this.coordinatorInstance = coordinatorInstance;
  }
}

test('security: key compromise, revocation and epoch advance reject stale operations', async () => {
  const collectionIdentifier = 'revocation-security-test-collection';
  const referenceCoordinator = new D137ReferenceCoordinator({
    collectionId: collectionIdentifier,
    epochNumber: 1
  });
  await referenceCoordinator.initialize();

  const compromisedClientChannel = new MockRelayChannel('compromised-replica');
  const secureClientChannel = new MockRelayChannel('secure-replica');

  const channelRegistry = new Map([
    ['compromised-replica', compromisedClientChannel],
    ['secure-replica', secureClientChannel]
  ]);

  const relayCoordinator = {
    handleClientPacket: async (senderReplicaIdentifier, packet) => {
      if (!packet?.envelope) return;
      const responseEnvelope = await referenceCoordinator.ingestEnvelope(
        packet.envelope,
        createMockPrincipal(senderReplicaIdentifier, senderReplicaIdentifier)
      );

      // If op is accepted, relay to other peers
      if (packet.envelope.type === 'op' && responseEnvelope?.type === 'serverAck') {
        for (const [replicaIdentifier, peerChannel] of channelRegistry.entries()) {
          if (replicaIdentifier !== senderReplicaIdentifier && peerChannel.receiverHandler) {
            await peerChannel.receiverHandler({
              clientId: senderReplicaIdentifier,
              mutations: [],
              envelope: packet.envelope,
              principal: createMockPrincipal(senderReplicaIdentifier, senderReplicaIdentifier)
            });
          }
        }
      }
    }
  };

  compromisedClientChannel.setCoordinator(relayCoordinator);
  secureClientChannel.setCoordinator(relayCoordinator);

  const compromisedStore = new MemoryStoreBackend();
  const secureStore = new MemoryStoreBackend();
  await compromisedStore.open();
  await secureStore.open();

  const compromisedSyncEngine = new SyncEngine({
    driver: compromisedStore,
    channel: compromisedClientChannel,
    clientId: 'compromised-replica',
    initialOnline: true
  });

  const secureSyncEngine = new SyncEngine({
    driver: secureStore,
    channel: secureClientChannel,
    clientId: 'secure-replica',
    initialOnline: true
  });

  const compromisedCollection = syncCollection({
    key: collectionIdentifier,
    engine: 'd137',
    driver: compromisedStore,
    syncEngine: compromisedSyncEngine
  });

  const secureCollection = syncCollection({
    key: collectionIdentifier,
    engine: 'd137',
    driver: secureStore,
    syncEngine: secureSyncEngine
  });

  await compromisedCollection.ready;
  await secureCollection.ready;

  const compromisedEngine = compromisedCollection.engineInstance;
  const secureEngine = secureCollection.engineInstance;

  const compromisedBinding = compromisedEngine.meta.epochMemberBindings[compromisedEngine.meta.replicaId];
  const secureBinding = secureEngine.meta.epochMemberBindings[secureEngine.meta.replicaId];

  await referenceCoordinator.registerClient(
    compromisedBinding.authorKeyId,
    compromisedBinding.authorPublicKeyHex,
    'WRITER_REPLICA',
    compromisedEngine.meta.replicaId
  );

  await referenceCoordinator.registerClient(
    secureBinding.authorKeyId,
    secureBinding.authorPublicKeyHex,
    'WRITER_REPLICA',
    secureEngine.meta.replicaId
  );

  const initialEpochCertificate = referenceCoordinator.getCertificate();
  compromisedEngine.meta.epochCertificate = initialEpochCertificate;
  compromisedEngine.meta.epochCertificateId = initialEpochCertificate.epochCertificateId;
  compromisedEngine.meta.epochMemberBindings = { ...initialEpochCertificate.memberBindings };

  secureEngine.meta.epochCertificate = initialEpochCertificate;
  secureEngine.meta.epochCertificateId = initialEpochCertificate.epochCertificateId;
  secureEngine.meta.epochMemberBindings = { ...initialEpochCertificate.memberBindings };

  // 1. Initial valid operation in Epoch 1
  await compromisedCollection.insert({
    id: 'document-pre-compromise',
    content: 'Legitimate document during epoch 1'
  });

  await new Promise((resolveDelivery) => setTimeout(resolveDelivery, 100));

  const secureItemsPreCompromise = secureCollection.items();
  assert.equal(secureItemsPreCompromise.length, 1, 'Secure replica must receive legitimate epoch 1 document');
  assert.equal(secureItemsPreCompromise[0]?.id, 'document-pre-compromise');

  // 2. Incident response: Key Compromise Runbook Triggered
  // Evict compromised replica and transition coordinator to Epoch 2
  referenceCoordinator.evictClient(compromisedEngine.meta.replicaId);
  const epochTwoCertificate = await referenceCoordinator.transitionToNextEpoch();

  assert.equal(epochTwoCertificate.epochNumber, 2, 'New certificate must advance to epoch 2');
  assert.equal(
    Boolean(epochTwoCertificate.memberBindings[compromisedEngine.meta.replicaId]),
    false,
    'Compromised replica key must be omitted from epoch 2 member bindings'
  );

  // Secure client ingests Epoch 2 transition certificate
  secureEngine.meta.epochCertificate = epochTwoCertificate;
  secureEngine.meta.epochCertificateId = epochTwoCertificate.epochCertificateId;
  secureEngine.meta.epochMemberBindings = { ...epochTwoCertificate.memberBindings };
  secureEngine.meta.epochNumber = 2;

  // 3. Attack attempt: operation crafted under the revoked Epoch 1 key
  const staleOperationEnvelope = createWireEnvelope(
    'op',
    collectionIdentifier,
    compromisedEngine.meta.replicaId,
    {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: collectionIdentifier,
      epochNumber: 1,
      epochCertificateId: initialEpochCertificate.epochCertificateId,
      opDot: { epochNumber: 1, replicaId: compromisedEngine.meta.replicaId, sequence: 50 },
      targetIncarnation: { epochNumber: 1, replicaId: compromisedEngine.meta.replicaId, sequence: 50 },
      externalId: 'stale-forged-item',
      stamp: {
        lamport: 50,
        epochNumber: 1,
        replicaId: compromisedEngine.meta.replicaId,
        sequence: 50
      },
      authorKeyId: compromisedBinding.authorKeyId,
      payloadDigest: '0'.repeat(64),
      authorSignature: 'invalid_or_revoked_signature_hex_'.padEnd(128, '0'),
      kind: 'insert',
      indexKey: 'b0',
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields: {
        id: 'stale-forged-item',
        content: 'Malicious post-revocation injection'
      }
    }
  );

  // Deliver revoked operation to secure client
  await secureClientChannel.receiverHandler({
    clientId: compromisedEngine.meta.replicaId,
    mutations: [],
    envelope: staleOperationEnvelope,
    principal: createMockPrincipal(compromisedEngine.meta.replicaId, compromisedEngine.meta.replicaId)
  });

  await new Promise((resolveProcessing) => setTimeout(resolveProcessing, 50));

  // 4. Verification: Secure client rejects revoked operation, items unchanged
  const secureItemsPostAttack = secureCollection.items();
  assert.equal(
    secureItemsPostAttack.length,
    1,
    'Secure replica must reject revoked operation and keep original item count'
  );
  assert.equal(secureItemsPostAttack[0]?.id, 'document-pre-compromise');
  assert.equal(
    secureItemsPostAttack.some((itemRecord) => itemRecord.id === 'stale-forged-item'),
    false,
    'Revoked operation must never appear in collection items'
  );
});
