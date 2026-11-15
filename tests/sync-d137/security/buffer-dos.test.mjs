import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCausalDependency,
  D137_V331_LIMITS,
  D137Engine,
  PROTOCOL_VERSION
} from '../../../packages/sync/dist/index.js';
import { createDefaultFoundingCertificate } from '../../../packages/sync/dist/adapter/compensation.js';

test('security: buffer DoS protection bounds dependency buffer at declared limit', () => {
  const collectionIdentifier = 'buffer-dos-test-collection';
  const peerReplicaIdentifier = 'peer-sender-replica';
  const foundingCertificate = createDefaultFoundingCertificate(collectionIdentifier, 'target-replica');
  foundingCertificate.memberBindings[peerReplicaIdentifier] = {
    role: 'WRITER_REPLICA',
    authorKeyId: `key:${peerReplicaIdentifier}:v1`,
    authorPublicKeyHex: '00',
    signingAlgorithm: 'ECDSA_P256'
  };

  const engineInstance = new D137Engine(
    collectionIdentifier,
    'target-replica',
    1,
    foundingCertificate,
    'key:target-replica:v1'
  );

  const transactionContext = {
    meta: engineInstance.meta,
    entriesState: engineInstance.entriesState,
    snapshotsV2: engineInstance.snapshotsV2,
    mutationJournal: engineInstance.mutationJournal,
    operationDigests: engineInstance.operationDigests,
    syncOutbox: engineInstance.syncOutbox,
    inboundGapBuffer: engineInstance.inboundGapBuffer,
    inboundDependencyBuffer: engineInstance.inboundDependencyBuffer,
    quarantineJournal: engineInstance.quarantineJournal,
    tabLeases: engineInstance.tabLeases
  };

  const maximumBufferedOperations = D137_V331_LIMITS.MAX_DEPENDENCY_BUFFER_OPS_PER_COLLECTION;
  assert.equal(maximumBufferedOperations, 1000, 'Declared dependency buffer ceiling must be 1,000 ops');

  // 1. Fill dependency buffer to its maximum limit
  for (let sequenceIndex = 1; sequenceIndex <= maximumBufferedOperations; sequenceIndex += 1) {
    const dependencyOperation = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: collectionIdentifier,
      epochNumber: 1,
      epochCertificateId: 'cert:test:1',
      opDot: { epochNumber: 1, replicaId: peerReplicaIdentifier, sequence: sequenceIndex },
      targetIncarnation: { epochNumber: 1, replicaId: peerReplicaIdentifier, sequence: 999999 },
      externalId: `item-${sequenceIndex}`,
      stamp: {
        lamport: sequenceIndex,
        epochNumber: 1,
        replicaId: peerReplicaIdentifier,
        sequence: sequenceIndex
      },
      authorKeyId: `key:${peerReplicaIdentifier}:v1`,
      payloadDigest: '0'.repeat(64),
      authorSignature: 'dummy-sig',
      kind: 'update',
      partialFields: { status: 'pending' }
    };

    const classificationResult = classifyCausalDependency(transactionContext, dependencyOperation, true);
    assert.equal(
      classificationResult.ok,
      true,
      `Operation ${sequenceIndex} must be buffered successfully before ceiling is reached`
    );
    assert.equal(
      classificationResult.disposition,
      'BUFFERED_CAUSAL_DEPENDENCY',
      'Disposition must be BUFFERED_CAUSAL_DEPENDENCY'
    );
  }

  assert.equal(
    transactionContext.inboundDependencyBuffer.size,
    maximumBufferedOperations,
    'Buffer must contain exactly 1,000 operations'
  );
  assert.equal(
    transactionContext.meta.totalDependencyBufferOps,
    maximumBufferedOperations,
    'totalDependencyBufferOps counter must equal 1,000'
  );

  // 2. Attempt buffer overflow attack (1,001st operation)
  const overflowAttackOperation = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: collectionIdentifier,
    epochNumber: 1,
    epochCertificateId: 'cert:test:1',
    opDot: { epochNumber: 1, replicaId: peerReplicaIdentifier, sequence: maximumBufferedOperations + 1 },
    targetIncarnation: { epochNumber: 1, replicaId: peerReplicaIdentifier, sequence: 999999 },
    externalId: 'overflow-attempt-item',
    stamp: {
      lamport: maximumBufferedOperations + 1,
      epochNumber: 1,
      replicaId: peerReplicaIdentifier,
      sequence: maximumBufferedOperations + 1
    },
    authorKeyId: `key:${peerReplicaIdentifier}:v1`,
    payloadDigest: '0'.repeat(64),
    authorSignature: 'dummy-sig',
    kind: 'update',
    partialFields: { status: 'dos-overflow' }
  };

  const overflowResult = classifyCausalDependency(transactionContext, overflowAttackOperation, true);

  // 3. Assert fail closed with D137_DEPENDENCY_BUFFER_OVERFLOW
  assert.equal(overflowResult.ok, false, 'Overflow operation must be rejected');
  assert.equal(
    overflowResult.code,
    'D137_DEPENDENCY_BUFFER_OVERFLOW',
    'Rejection code must strictly be D137_DEPENDENCY_BUFFER_OVERFLOW'
  );

  // 4. Verify memory stays strictly bounded
  assert.equal(
    transactionContext.inboundDependencyBuffer.size,
    maximumBufferedOperations,
    'Inbound dependency buffer size must remain strictly bounded at 1,000'
  );
  assert.equal(
    transactionContext.meta.totalDependencyBufferOps,
    maximumBufferedOperations,
    'totalDependencyBufferOps must not increment beyond limit'
  );
});
