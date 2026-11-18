/* global setTimeout */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncCollection,
  MemoryStoreBackend,
  SyncEngine
} from '../../../packages/sync/dist/index.js';
import {
  SyncReferenceCoordinator,
  createMockPrincipal
} from '../../../tools/sync-coordinator/coordinator.js';

class DirectTransportChannel {
  constructor(senderReplicaIdentifier) {
    this.senderReplicaIdentifier = senderReplicaIdentifier;
    this.principal = createMockPrincipal(senderReplicaIdentifier, senderReplicaIdentifier);
    this.packetReceiverCallback = undefined;
    this.capturedEnvelopes = [];
  }

  onReceive(receiverCallback) {
    this.packetReceiverCallback = receiverCallback;
    return () => {
      this.packetReceiverCallback = undefined;
    };
  }

  async send(outgoingPacket) {
    if (outgoingPacket?.envelope) {
      this.capturedEnvelopes.push(outgoingPacket.envelope);
    }
    if (this.peerChannel && this.peerChannel.packetReceiverCallback) {
      await this.peerChannel.packetReceiverCallback({
        clientId: this.senderReplicaIdentifier,
        mutations: [],
        envelope: outgoingPacket.envelope,
        principal: this.principal
      });
    }
  }

  setPeerChannel(peerChannelInstance) {
    this.peerChannel = peerChannelInstance;
  }
}

test('security: replayed signed operation changes nothing and is not applied twice', async () => {
  const collectionIdentifier = 'replay-security-test-collection';
  const referenceCoordinator = new SyncReferenceCoordinator({
    collectionId: collectionIdentifier,
    epochNumber: 1
  });
  await referenceCoordinator.initialize();

  const primaryChannel = new DirectTransportChannel('primary-replica');
  const secondaryChannel = new DirectTransportChannel('secondary-replica');
  primaryChannel.setPeerChannel(secondaryChannel);
  secondaryChannel.setPeerChannel(primaryChannel);

  const primaryStore = new MemoryStoreBackend();
  const secondaryStore = new MemoryStoreBackend();
  await primaryStore.open();
  await secondaryStore.open();

  const primarySyncEngine = new SyncEngine({
    driver: primaryStore,
    channel: primaryChannel,
    clientId: 'primary-replica',
    initialOnline: true
  });

  const secondarySyncEngine = new SyncEngine({
    driver: secondaryStore,
    channel: secondaryChannel,
    clientId: 'secondary-replica',
    initialOnline: true
  });

  const primaryCollection = syncCollection({
    key: collectionIdentifier,
    engine: 'replicated',
    driver: primaryStore,
    syncEngine: primarySyncEngine
  });

  const secondaryCollection = syncCollection({
    key: collectionIdentifier,
    engine: 'replicated',
    driver: secondaryStore,
    syncEngine: secondarySyncEngine
  });

  await primaryCollection.ready;
  await secondaryCollection.ready;

  // Authorize both replicas in coordinator epoch certificate
  const primaryEngine = primaryCollection.engineInstance;
  const secondaryEngine = secondaryCollection.engineInstance;

  const primaryBinding = primaryEngine.meta.epochMemberBindings[primaryEngine.meta.replicaId];
  const secondaryBinding = secondaryEngine.meta.epochMemberBindings[secondaryEngine.meta.replicaId];

  await referenceCoordinator.registerClient(
    primaryBinding.authorKeyId,
    primaryBinding.authorPublicKeyHex,
    'WRITER_REPLICA',
    primaryEngine.meta.replicaId
  );

  await referenceCoordinator.registerClient(
    secondaryBinding.authorKeyId,
    secondaryBinding.authorPublicKeyHex,
    'WRITER_REPLICA',
    secondaryEngine.meta.replicaId
  );

  const sharedCertificate = referenceCoordinator.getCertificate();
  primaryEngine.meta.epochCertificate = sharedCertificate;
  primaryEngine.meta.epochCertificateId = sharedCertificate.epochCertificateId;
  primaryEngine.meta.epochMemberBindings = { ...sharedCertificate.memberBindings };

  secondaryEngine.meta.epochCertificate = sharedCertificate;
  secondaryEngine.meta.epochCertificateId = sharedCertificate.epochCertificateId;
  secondaryEngine.meta.epochMemberBindings = { ...sharedCertificate.memberBindings };

  // 1. Primary commits legitimate insert
  await primaryCollection.insert({
    id: 'document-original',
    title: 'First Edition Content',
    revision: 1
  });

  // Allow asynchronous microtask batch and delivery
  await new Promise((resolveDelivery) => setTimeout(resolveDelivery, 100));

  const secondaryItemsInitial = secondaryCollection.items();
  assert.equal(secondaryItemsInitial.length, 1, 'Secondary must have received exactly one item');
  assert.equal(secondaryItemsInitial[0]?.id, 'document-original');
  assert.equal(secondaryItemsInitial[0]?.title, 'First Edition Content');

  // Verify captured envelope
  assert.ok(primaryChannel.capturedEnvelopes.length > 0, 'Captured envelope list must not be empty');
  const originalSignedEnvelope = primaryChannel.capturedEnvelopes[0];

  // 2. Adversary replays the exact same signed wire envelope
  await secondaryChannel.packetReceiverCallback({
    clientId: 'primary-replica',
    mutations: [],
    envelope: originalSignedEnvelope,
    principal: primaryChannel.principal
  });

  await new Promise((resolveReplay) => setTimeout(resolveReplay, 50));

  // 3. Assert secondary collection remains identical with zero duplication
  const secondaryItemsAfterReplay = secondaryCollection.items();
  assert.equal(
    secondaryItemsAfterReplay.length,
    1,
    'Replayed operation must not create duplicate items'
  );
  assert.equal(secondaryItemsAfterReplay[0]?.id, 'document-original');
  assert.equal(secondaryItemsAfterReplay[0]?.title, 'First Edition Content');

  // Verify internal engine entriesState count is strictly 1
  assert.equal(
    secondaryEngine.entriesState.size,
    1,
    'Internal engine entriesState must contain exactly 1 entry'
  );
});
