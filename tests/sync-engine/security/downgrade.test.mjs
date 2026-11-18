import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeWireEnvelope,
  decodeWireOperation,
  PROTOCOL_VERSION
} from '@dotmix/sync';

test('security: protocol version downgrade is rejected', async (testContext) => {
  await testContext.test('decodeWireEnvelope rejects downgraded protocol versions', () => {
    const invalidVersions = [
      'replicated.v1.0.0',
      'replicated.v2.0.0',
      'replicated.v3.0.0',
      'replicated.v3.3.0',
      'legacy-v1',
      ''
    ];

    for (const forbiddenVersion of invalidVersions) {
      const forgedEnvelopePayload = {
        protocolVersion: forbiddenVersion,
        collectionId: 'security-collection',
        senderReplicaId: 'replica-attacker',
        type: 'op',
        timestamp: Date.now(),
        payload: {
          kind: 'insert',
          externalId: 'target-item',
          replicaId: 'replica-attacker',
          seq: 1,
          epoch: 1,
          value: { content: 'malicious-data' }
        }
      };

      const decodingOutcome = decodeWireEnvelope(forgedEnvelopePayload);
      assert.equal(decodingOutcome.ok, false, `Downgraded version "${forbiddenVersion}" must be rejected`);
      assert.equal(
        decodingOutcome.code,
        'SYNC_PROTOCOL_VERSION_MISMATCH',
        `Downgraded version "${forbiddenVersion}" must fail the protocol version check`
      );
    }
  });

  await testContext.test('decodeWireOperation rejects downgraded protocol versions', () => {
    const forgedOperationPayload = {
      protocolVersion: 'replicated.v1.0.0',
      kind: 'insert',
      externalId: 'target-item',
      replicaId: 'replica-attacker',
      seq: 1,
      epoch: 1,
      value: { content: 'downgraded-payload' },
      indexKey: 'a0'
    };

    const operationDecodingOutcome = decodeWireOperation(forgedOperationPayload);
    assert.equal(operationDecodingOutcome.ok, false, 'Downgraded operation must be rejected');
    assert.equal(
      operationDecodingOutcome.code,
      'SYNC_PROTOCOL_VERSION_MISMATCH',
      'Downgraded operation must fail the protocol version check'
    );
  });

  await testContext.test('accepts authentic protocol version', () => {
    const authenticEnvelopePayload = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'serverReject',
      collectionId: 'security-collection',
      senderReplicaId: 'replica-coordinator',
      timestamp: Date.now(),
      payload: {
        errorCode: 'SYNC_WIRE_TYPE_MISMATCH',
        reason: 'Validation rejection for test',
        serverTimestamp: Date.now()
      }
    };

    const authenticOutcome = decodeWireEnvelope(authenticEnvelopePayload);
    assert.equal(authenticOutcome.ok, true, 'Authentic protocol version must decode successfully');
  });
});
