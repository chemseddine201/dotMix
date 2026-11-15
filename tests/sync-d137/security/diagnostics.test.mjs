import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiagnosticsController,
  D137Engine
} from '../../../packages/sync/dist/index.js';
import { createDefaultFoundingCertificate } from '../../../packages/sync/dist/adapter/compensation.js';

test('security diagnostics: diagnostics signal receives emitted events with D137_* codes', () => {
  const collectionIdentifier = 'diagnostics-signal-test-collection';
  const replicaIdentifier = 'diagnostics-replica-alpha';
  const foundingCertificate = createDefaultFoundingCertificate(collectionIdentifier, replicaIdentifier);
  const engineInstance = new D137Engine(
    collectionIdentifier,
    replicaIdentifier,
    1,
    foundingCertificate,
    `key:${replicaIdentifier}:v1`
  );

  const diagnosticsController = createDiagnosticsController(engineInstance);

  // 1. Assert initial state is empty
  const initialEvents = diagnosticsController.diagnostics();
  assert.equal(Array.isArray(initialEvents), true, 'Diagnostics signal must return an array');
  assert.equal(initialEvents.length, 0, 'Initial diagnostics event array must be empty');

  // 2. Record first diagnostic event with D137 code
  diagnosticsController.recordDiagnosticEvent(
    'D137_VERSION_MISMATCH',
    'Received peer operation with unsupported protocol version: D-137.v2.0.0',
    { attemptedProtocolVersion: 'D-137.v2.0.0' }
  );

  const eventsAfterFirstEmission = diagnosticsController.diagnostics();
  assert.equal(eventsAfterFirstEmission.length, 1, 'Signal must contain exactly one event after first recording');
  const firstEmittedEvent = eventsAfterFirstEmission[0];
  assert.equal(firstEmittedEvent.code, 'D137_VERSION_MISMATCH', 'Event code must match emitted D137 code');
  assert.equal(
    firstEmittedEvent.detail,
    'Received peer operation with unsupported protocol version: D-137.v2.0.0',
    'Event detail message must match'
  );
  assert.equal(typeof firstEmittedEvent.timestamp, 'number', 'Event timestamp must be a valid numeric timestamp');
  assert.equal(firstEmittedEvent.timestamp > 0, true, 'Event timestamp must be positive');
  assert.equal(typeof firstEmittedEvent.payloadPreview, 'string', 'Payload preview must be serialized as string');

  // 3. Record second diagnostic event with another D137 code
  diagnosticsController.recordDiagnosticEvent(
    'D137_DEPENDENCY_BUFFER_OVERFLOW',
    'Inbound dependency buffer exceeded maximum limit of 1000 operations',
    { currentBufferSize: 1001 }
  );

  const eventsAfterSecondEmission = diagnosticsController.diagnostics();
  assert.equal(eventsAfterSecondEmission.length, 2, 'Signal must contain two events');
  const secondEmittedEvent = eventsAfterSecondEmission[1];
  assert.equal(
    secondEmittedEvent.code,
    'D137_DEPENDENCY_BUFFER_OVERFLOW',
    'Second event code must match emitted D137 code'
  );
  assert.equal(
    secondEmittedEvent.detail,
    'Inbound dependency buffer exceeded maximum limit of 1000 operations',
    'Second event detail must match'
  );
});

test('security diagnostics: quarantine inspector exposes sanitized entries with bounded preview and no raw user fields', () => {
  const collectionIdentifier = 'quarantine-security-test-collection';
  const replicaIdentifier = 'quarantine-replica-beta';
  const foundingCertificate = createDefaultFoundingCertificate(collectionIdentifier, replicaIdentifier);
  const engineInstance = new D137Engine(
    collectionIdentifier,
    replicaIdentifier,
    1,
    foundingCertificate,
    `key:${replicaIdentifier}:v1`
  );

  const diagnosticsController = createDiagnosticsController(engineInstance);
  const quarantineInspector = diagnosticsController.getQuarantineInspector();

  // 1. Assert initial quarantine is empty
  assert.equal(quarantineInspector.getEntryCount(), 0, 'Initial quarantine count must be zero');
  assert.deepEqual(quarantineInspector.getQuarantinedEntries(), [], 'Initial quarantined entries list must be empty');

  // 2. Populate engine quarantine journal with a mock malformed/unauthorized record
  const storageRecordIdentifier = `${collectionIdentifier}:1`;
  const longOffendingPayload = 'payload-overflow-sequence-'.repeat(20); // Exceeds 80 characters ceiling
  const testQuarantineRecord = {
    storageKey: storageRecordIdentifier,
    collectionId: collectionIdentifier,
    quarantineSeq: 1,
    priorityTier: 1,
    reasonCode: 'D137_SIGNATURE_VERIFICATION_FAILED',
    detail: 'Author signature invalid for key:attacker:v1',
    offendingPayloadPreview: longOffendingPayload,
    recordedAtLogicalStep: 77,
    // Sensitive user fields that must NEVER leak to SanitizedQuarantineEntry
    rawUserSecretData: 'PRIVATE_CREDENTIALS_AND_TOKEN_12345',
    userCreditCardNumber: '4000-1234-5678-9010'
  };

  engineInstance.quarantineJournal.set(storageRecordIdentifier, testQuarantineRecord);

  // 3. Assert getEntryCount returns correct count
  assert.equal(quarantineInspector.getEntryCount(), 1, 'Quarantine entry count must equal 1');

  // 4. Assert getQuarantinedEntries exposes sanitized fields
  const quarantinedEntriesList = quarantineInspector.getQuarantinedEntries();
  assert.equal(quarantinedEntriesList.length, 1, 'Must return exactly one sanitized quarantine entry');

  const sanitizedQuarantineEntry = quarantinedEntriesList[0];
  assert.equal(sanitizedQuarantineEntry.identifier, storageRecordIdentifier);
  assert.equal(sanitizedQuarantineEntry.replicaIdentifier, collectionIdentifier);
  assert.equal(sanitizedQuarantineEntry.sequenceNumber, 1);
  assert.equal(sanitizedQuarantineEntry.reasonCode, 'D137_SIGNATURE_VERIFICATION_FAILED');
  assert.equal(sanitizedQuarantineEntry.tierLevel, 1);
  assert.equal(sanitizedQuarantineEntry.timestamp, 77);

  // 5. Assert boundedPreview is bounded to <= 80 characters
  assert.equal(
    sanitizedQuarantineEntry.boundedPreview.length <= 80,
    true,
    `boundedPreview length (${sanitizedQuarantineEntry.boundedPreview.length}) must be <= 80 characters`
  );
  assert.equal(
    sanitizedQuarantineEntry.boundedPreview.endsWith('...'),
    true,
    'Truncated boundedPreview must end with ellipsis (...)'
  );

  // 6. Assert no raw user fields leaked into sanitized entry
  assert.equal(
    sanitizedQuarantineEntry.rawUserSecretData,
    undefined,
    'Sanitized entry must not contain rawUserSecretData'
  );
  assert.equal(
    sanitizedQuarantineEntry.userCreditCardNumber,
    undefined,
    'Sanitized entry must not contain userCreditCardNumber'
  );
  assert.equal(
    sanitizedQuarantineEntry.detail,
    undefined,
    'Sanitized entry must not leak full internal detail'
  );

  const exposedPropertyNames = Object.keys(sanitizedQuarantineEntry).sort();
  const allowedPropertyNames = [
    'boundedPreview',
    'identifier',
    'reasonCode',
    'replicaIdentifier',
    'sequenceNumber',
    'tierLevel',
    'timestamp'
  ].sort();
  assert.deepEqual(
    exposedPropertyNames,
    allowedPropertyNames,
    'Sanitized entry must contain only allowed sanitized property names'
  );

  // 7. Clear quarantined entries and assert quarantine count and entries are empty
  quarantineInspector.clearQuarantinedEntries();
  assert.equal(quarantineInspector.getEntryCount(), 0, 'Quarantine entry count must be zero after clearing');
  assert.deepEqual(
    quarantineInspector.getQuarantinedEntries(),
    [],
    'Quarantined entries list must be empty after clearing'
  );
  assert.equal(
    engineInstance.quarantineJournal.size,
    0,
    'Underlying engine quarantineJournal map must be cleared'
  );
});
