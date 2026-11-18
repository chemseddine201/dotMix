import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeWireOperation, PROTOCOL_VERSION } from "../../../packages/sync/dist/protocol/types.js";
import { SYNC_PROTOCOL_LIMITS } from "../../../packages/sync/dist/protocol/limits.js";

function makeBase(kind) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: "items",
    epochNumber: 1,
    epochCertificateId: "cert-1",
    opDot: { epochNumber: 1, replicaId: "rep-1", sequence: 1 },
    targetIncarnation: { epochNumber: 1, replicaId: "rep-1", sequence: 1 },
    externalId: "ext-1",
    stamp: { lamport: 10, epochNumber: 1, replicaId: "rep-1", sequence: 1 },
    authorKeyId: "key-1",
    payloadDigest: "digest-1",
    authorSignature: "sig-1",
    kind,
  };
}

function makeValidInsert() {
  return {
    ...makeBase("insert"),
    indexKey: "a0",
    leftNeighborIncarnation: null,
    rightNeighborIncarnation: null,
    initialFields: { title: "Test Item" },
  };
}

describe(": Strict Wire Decoding (Table-Driven)", () => {
  const table = [
    {
      name: "valid insert operation passes",
      input: makeValidInsert(),
      expectedOk: true,
    },
    {
      name: "valid update operation passes",
      input: {
        ...makeBase("update"),
        partialFields: { title: "Updated Title" },
        removedFields: ["oldField"],
        baseFieldStamps: {
          title: { lamport: 5, epochNumber: 1, replicaId: "rep-1", sequence: 1 },
        },
      },
      expectedOk: true,
    },
    {
      name: "valid move operation passes",
      input: {
        ...makeBase("move"),
        newIndexKey: "a1",
        leftNeighborIncarnation: null,
        rightNeighborIncarnation: null,
        basePosStamp: { lamport: 8, epochNumber: 1, replicaId: "rep-1", sequence: 1 },
      },
      expectedOk: true,
    },
    {
      name: "valid delete operation passes",
      input: {
        ...makeBase("delete"),
      },
      expectedOk: true,
    },
    {
      name: "valid clear operation passes",
      input: {
        ...makeBase("clear"),
        targetIncarnations: [{ epochNumber: 1, replicaId: "rep-1", sequence: 1 }],
        clearBatchMeta: { batchId: "b-1", chunkIndex: 0, totalChunks: 1 },
      },
      expectedOk: true,
    },
    {
      name: "fails closed on non-object payload",
      input: "not-an-object",
      expectedOk: false,
      expectedCode: "SYNC_WIRE_TYPE_MISMATCH",
    },
    {
      name: "fails closed on null payload",
      input: null,
      expectedOk: false,
      expectedCode: "SYNC_WIRE_TYPE_MISMATCH",
    },
    {
      name: "enforces payload size limit before deep parsing",
      input: {
        ...makeValidInsert(),
        initialFields: {
          hugeBlob: "X".repeat(SYNC_PROTOCOL_LIMITS.MAX_OPERATION_PAYLOAD_BYTES + 100),
        },
      },
      expectedOk: false,
      expectedCode: "SYNC_OPERATION_PAYLOAD_TOO_LARGE",
    },
    {
      name: "rejects protocol version downgrade or mismatch",
      input: {
        ...makeValidInsert(),
        protocolVersion: "replicated.v3.3.0",
      },
      expectedOk: false,
      expectedCode: "SYNC_PROTOCOL_VERSION_MISMATCH",
    },
    {
      name: "rejects unknown top-level field",
      input: {
        ...makeValidInsert(),
        maliciousExtraField: 42,
      },
      expectedOk: false,
      expectedCode: "SYNC_WIRE_UNKNOWN_FIELD",
    },
    {
      name: "rejects unknown field inside clearBatchMeta",
      input: {
        ...makeBase("clear"),
        targetIncarnations: [],
        clearBatchMeta: { batchId: "b1", chunkIndex: 0, totalChunks: 1, unexpected: "hack" },
      },
      expectedOk: false,
      expectedCode: "SYNC_WIRE_UNKNOWN_FIELD",
    },
    {
      name: "rejects replicaId containing colon character (:)",
      input: {
        ...makeValidInsert(),
        opDot: { epochNumber: 1, replicaId: "rep:colon", sequence: 1 },
      },
      expectedOk: false,
      expectedCode: "SYNC_INVALID_REPLICA_ID",
    },
    {
      name: "rejects indexKey exceeding MAX_INDEX_KEY_BYTES",
      input: {
        ...makeValidInsert(),
        indexKey: "K".repeat(SYNC_PROTOCOL_LIMITS.MAX_INDEX_KEY_BYTES + 1),
      },
      expectedOk: false,
      expectedCode: "SYNC_INDEX_KEY_TOO_LONG",
    },
    {
      name: "rejects move newIndexKey exceeding MAX_INDEX_KEY_BYTES",
      input: {
        ...makeBase("move"),
        newIndexKey: "M".repeat(SYNC_PROTOCOL_LIMITS.MAX_INDEX_KEY_BYTES + 1),
        leftNeighborIncarnation: null,
        rightNeighborIncarnation: null,
        basePosStamp: { lamport: 8, epochNumber: 1, replicaId: "rep-1", sequence: 1 },
      },
      expectedOk: false,
      expectedCode: "SYNC_INDEX_KEY_TOO_LONG",
    },
    {
      name: "rejects clear with targetIncarnations exceeding CLEAR_MAX_TARGETS_PER_CHUNK",
      input: {
        ...makeBase("clear"),
        targetIncarnations: Array.from(
          { length: SYNC_PROTOCOL_LIMITS.CLEAR_MAX_TARGETS_PER_CHUNK + 1 },
          (_, i) => ({ epochNumber: 1, replicaId: "r1", sequence: i + 1 })
        ),
        clearBatchMeta: { batchId: "b1", chunkIndex: 0, totalChunks: 1 },
      },
      expectedOk: false,
      expectedCode: "SYNC_CLEAR_CHUNK_TARGETS_EXCEEDED",
    },
    {
      name: "rejects negative lamport in stamp",
      input: {
        ...makeValidInsert(),
        stamp: { lamport: -1, epochNumber: 1, replicaId: "rep-1", sequence: 1 },
      },
      expectedOk: false,
      expectedCode: "SYNC_WIRE_TYPE_MISMATCH",
    },
    {
      name: "rejects sequence <= 0 in opDot",
      input: {
        ...makeValidInsert(),
        opDot: { epochNumber: 1, replicaId: "rep-1", sequence: 0 },
      },
      expectedOk: false,
      expectedCode: "SYNC_WIRE_TYPE_MISMATCH",
    },
  ];

  it("fails closed across all table-driven vectors", () => {
    for (const testCase of table) {
      const result = decodeWireOperation(testCase.input);
      if (testCase.expectedOk) {
        assert.equal(result.ok, true, `Expected ok=true for '${testCase.name}'`);
      } else {
        assert.equal(result.ok, false, `Expected ok=false for '${testCase.name}'`);
        assert.equal(
          result.code,
          testCase.expectedCode,
          `Expected code '${testCase.expectedCode}', got '${result.code}' for '${testCase.name}'`
        );
      }
    }
  });
});
