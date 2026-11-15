/**
 * D137-v33-reference: Protocol Types & Constants
 * Protocol Version: D-137.v3.3.1
 */

export type ProtocolVersion = "D-137.v3.3.1";
export const PROTOCOL_VERSION: ProtocolVersion = "D-137.v3.3.1";
export const PROTOCOL_FAMILY_PREFIX = "D-137";
export type EpochNumber = number;
export type SequenceNumber = number;
export type ReplicaId = string;
export type CollectionId = string;
export type OperationKey = string; // `${collectionId}:${epochNumber}:${replicaId}:${sequence}`
export type OriginStreamKey = string; // `${epochNumber}:${replicaId}`
export type IncarnationId = string; // `${epochNumber}:${replicaId}:${sequence}`
export type SigningAlgorithm = "Ed25519" | "ECDSA_P256";

export interface CausalDot { readonly epochNumber: EpochNumber; readonly replicaId: ReplicaId; readonly sequence: SequenceNumber; }
export interface LamportStamp { readonly lamport: number; readonly epochNumber: EpochNumber; readonly replicaId: ReplicaId; readonly sequence: SequenceNumber; }
export type OperationKind = "insert" | "update" | "move" | "delete" | "clear";
export interface ClearBatchMetadata { readonly batchId: string; readonly chunkIndex: number; readonly totalChunks: number; }

export interface BaseOperation {
  readonly protocolVersion: ProtocolVersion;
  readonly collectionId: CollectionId;
  readonly epochNumber: EpochNumber;
  readonly epochCertificateId: string;
  readonly opDot: CausalDot;
  readonly targetIncarnation: CausalDot;
  readonly externalId: string;
  readonly stamp: LamportStamp;
  readonly authorKeyId: string;
  readonly payloadDigest: string;
  readonly authorSignature: string;
}

export interface InsertOperation extends BaseOperation {
  readonly kind: "insert";
  readonly indexKey: string;
  readonly leftNeighborIncarnation: CausalDot | null;
  readonly rightNeighborIncarnation: CausalDot | null;
  readonly initialFields: Record<string, unknown>;
}

export interface UpdateOperation extends BaseOperation {
  readonly kind: "update";
  readonly partialFields: Record<string, unknown>;
  readonly removedFields: readonly string[];
  readonly baseFieldStamps: Record<string, LamportStamp>;
}

export interface MoveOperation extends BaseOperation {
  readonly kind: "move";
  readonly newIndexKey: string;
  readonly leftNeighborIncarnation: CausalDot | null;
  readonly rightNeighborIncarnation: CausalDot | null;
  readonly basePosStamp: LamportStamp;
  readonly basePosSourceOpKey?: OperationKey | undefined;
}

export interface DeleteOperation extends BaseOperation { readonly kind: "delete"; }
export interface ClearOperation extends BaseOperation { readonly kind: "clear"; readonly targetIncarnations: readonly CausalDot[]; readonly clearBatchMeta: ClearBatchMetadata; }
export type ReplicableOperation = InsertOperation | UpdateOperation | MoveOperation | DeleteOperation | ClearOperation;
export interface FieldValueRegister { readonly value: unknown; readonly stamp: LamportStamp; readonly present: boolean; }
export interface PositionRegister { readonly indexKey: string; readonly stamp: LamportStamp; readonly leftNeighbor: CausalDot | null; readonly rightNeighbor: CausalDot | null; readonly sourceOpKey?: string | undefined; }
export interface EntryStateRecord {
  readonly targetBirthDot: CausalDot;
  readonly externalId: string;
  pos: PositionRegister;
  fields: Record<string, FieldValueRegister>;
  deleted: boolean;
  deleteDots: readonly CausalDot[];
}

export type OperationDisposition =
  | "APPLIED"
  | "IDEMPOTENT_DUPLICATE"
  | "BUFFERED_OUT_OF_ORDER"
  | "BUFFERED_CAUSAL_DEPENDENCY"
  | "FENCED_COMPACTED_TARGET"
  | "FENCED_EQUIVOCATED_TARGET"
  | "QUARANTINED_REJECTED"
  | "EXCISED_STREAM_QUARANTINED"
  | "EVICTED_STREAM_BLOCKED_SUCCESSOR"
  | "D137_EPOCH_CLOSED";

export interface OperationApplyResult {
  readonly ok: boolean;
  readonly disposition?: OperationDisposition | undefined;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
}

export interface OperationDigestRecord {
  readonly opKey: OperationKey;
  readonly collectionId: CollectionId;
  readonly epochNumber: EpochNumber;
  readonly replicaId: ReplicaId;
  readonly sequence: SequenceNumber;
  readonly kind?: OperationKind | undefined;
  status: OperationDisposition | "EQUIVOCATED";
  payloadDigest: string;
  observedDigests: readonly string[];
}

export interface MutationJournalRecord {
  readonly opKey: OperationKey;
  readonly collectionId: CollectionId;
  readonly epochNumber: EpochNumber;
  readonly replicaId: ReplicaId;
  readonly sequence: SequenceNumber;
  readonly operation: ReplicableOperation;
  disposition: OperationDisposition;
}

export interface InboundGapBufferRecord {
  readonly opKey: OperationKey;
  readonly collectionId: CollectionId;
  readonly streamKey: OriginStreamKey;
  readonly epochNumber: EpochNumber;
  readonly replicaId: ReplicaId;
  readonly sequence: SequenceNumber;
  readonly operation: ReplicableOperation;
  readonly byteSize: number;
}

export interface InboundDependencyBufferRecord {
  readonly opKey: OperationKey;
  readonly collectionId: CollectionId;
  readonly waitingForIncarnationKey: IncarnationId;
  readonly operation: ReplicableOperation;
  readonly byteSize: number;
}

export interface SyncOutboxRecord {
  readonly opKey: OperationKey;
  readonly collectionId: CollectionId;
  readonly epochNumber: EpochNumber;
  readonly replicaId: ReplicaId;
  readonly sequence: SequenceNumber;
  readonly operation: ReplicableOperation;
  readonly enqueuedAtStep: number;
}

export interface EpochMemberKeyBinding {
  readonly role: "WRITER_REPLICA" | "READ_ONLY_REPLICA" | "COORDINATOR" | "MIGRATION_AUTHORITY";
  readonly authorKeyId: string;
  readonly authorPublicKeyHex: string;
  readonly signingAlgorithm: SigningAlgorithm;
}

export interface EpochMembershipCertificate {
  readonly protocolVersion: ProtocolVersion;
  readonly collectionId: CollectionId;
  readonly epochNumber: EpochNumber;
  readonly epochCertificateId: string;
  readonly coordinatorReplicaId: ReplicaId;
  readonly coordinatorKeyId: string;
  readonly memberBindings: Record<ReplicaId, EpochMemberKeyBinding>;
  readonly baselineStableFrontier: Record<OriginStreamKey, SequenceNumber>;
  readonly revokedKeyIds?: readonly string[] | undefined;
  readonly coordinatorSignature: string;
}

export interface ActiveEquivocationRecord {
  readonly streamKey: OriginStreamKey;
  readonly certifiedBaselineSeq: SequenceNumber;
  readonly firstEquivocatedSeq: SequenceNumber;
  readonly reason: string;
  readonly observedDigests: readonly string[];
  readonly conflictingOps?: readonly ReplicableOperation[] | undefined;
}

export interface EquivocationAuditRecord {
  readonly epochNumber: EpochNumber;
  readonly replicaId: ReplicaId;
  readonly sequence: SequenceNumber;
  readonly observedDigests: readonly string[];
}

export interface QuarantineRecord {
  readonly storageKey: string;
  readonly collectionId: CollectionId;
  readonly quarantineSeq: number;
  readonly priorityTier: 1 | 2; // 1 = Critical Forensic, 2 = Transient Diagnostic
  readonly reasonCode: string;
  readonly detail: string;
  readonly offendingPayloadPreview: string;
  readonly recordedAtLogicalStep: number;
}

export interface TabLeaseRecord {
  readonly collectionId: CollectionId;
  readonly leaseHolderTabId: string;
  readonly leaseFencingTerm: number;
  readonly leaseAcquiredAtWallMs: number;
  readonly heartbeatCounter: number;
  readonly monotonicHeartbeatObservationMs: number;
}

export interface ReplayPlanRecord {
  readonly collectionId: CollectionId;
  readonly targetEpochNumber: EpochNumber;
  readonly cursorIndex: number;
  readonly steps: readonly ReplayStep[];
  readonly opIdentityMap: Record<OperationKey, OperationKey>;
  readonly incarnationMap: Record<IncarnationId, IncarnationId>;
  readonly stampMap: Record<string, LamportStamp>;
  readonly unresolvedConflicts: readonly string[];
  readonly replayCompleted: boolean;
}

export interface ReplayStep {
  readonly originalOpKey: OperationKey;
  readonly kind: OperationKind;
  readonly payload: unknown;
  committed: boolean;
}

export interface RollingDigestAnchor {
  readonly sequence: SequenceNumber;
  readonly digest: string;
}

export interface ReplicaFrontiers {
  localDurableFrontier: Record<OriginStreamKey, SequenceNumber>;
  knownProducedFrontier: Record<OriginStreamKey, SequenceNumber>;
  snapshotIncludedFrontier: Record<OriginStreamKey, SequenceNumber>;
  stableFrontier: Record<OriginStreamKey, SequenceNumber>;
  compactionFrontier: Record<OriginStreamKey, SequenceNumber>;
  digestPrunedFrontier: Record<OriginStreamKey, SequenceNumber>;
  serverAcceptedFrontier: Record<OriginStreamKey, SequenceNumber>;
  replayCompletedWatermark: Record<OriginStreamKey, SequenceNumber>;
}

export type LifecycleState =
  | "INITIALIZING"
  | "ACTIVE"
  | "REPLAYING_OFFLINE_OUTBOX"
  | "READ_ONLY_COMPACTION_BACKPRESSURE"
  | "FOUNDING_SNAPSHOT_STAGED"
  | "COORDINATOR_ACCEPTANCE_PENDING"
  | "BOOTSTRAP_REJUVENATION_REQUIRED"
  | "CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED";

export interface VerifiedEnvelope {
  op: ReplicableOperation;
  securityStateVersion: number;
}

export interface ReplicaMetaRecord {
  protocolVersion: ProtocolVersion;
  collectionId: CollectionId;
  replicaId: ReplicaId;
  epochNumber: EpochNumber;
  epochCertificateId: string;
  epochCertificate: EpochMembershipCertificate;
  epochMemberBindings: Record<ReplicaId, EpochMemberKeyBinding>;
  revokedKeyIds: readonly string[];
  authorKeyId: string;
  authorPrivateKeyHex?: string | undefined;
  securityStateVersion: number;
  localLamport: number;
  nextLocalSequence: SequenceNumber;
  nextQuarantineSeq: number;
  activeSnapshotSeq: number;
  baselineSnapshotSeq?: number | undefined;
  remoteSyncEnabled: boolean;
  lifecycleState: LifecycleState;
  activeReplayPlan?: ReplayPlanRecord | undefined;
  leaseHolderTabId: string;
  leaseFencingTerm: number;
  frontiers: ReplicaFrontiers;
  clusterAcks: Record<ReplicaId, Record<OriginStreamKey, SequenceNumber>>;
  rollingStreamDigests: Record<OriginStreamKey, Record<SequenceNumber, string>>;
  rollingStreamDigestAnchors: Record<OriginStreamKey, RollingDigestAnchor>;
  foldedEpochBaseline: Record<ReplicaId, { maxFoldedEpoch: number; frontierAtMaxFoldedEpoch: number }>;
  activeEpochEquivocations: Record<OriginStreamKey, ActiveEquivocationRecord>;
  historicalEquivocationAudit: EquivocationAuditRecord[];
  quarantineEvictedCriticalCount: number;
  totalGapBufferOps: number;
  totalGapBufferBytes: number;
  totalDependencyBufferOps: number;
  totalDependencyBufferBytes: number;
}

export interface SnapshotRecord {
  readonly protocolVersion: ProtocolVersion;
  readonly collectionId: CollectionId;
  readonly snapshotSeq: number;
  readonly epochNumber: EpochNumber;
  readonly epochCertificateId: string;
  readonly epochCertificate: EpochMembershipCertificate;
  readonly members: readonly ReplicaId[];
  readonly revokedKeyIds: readonly string[];
  readonly baselineStableFrontier: Record<OriginStreamKey, SequenceNumber>;
  readonly foldedEpochBaseline: Record<ReplicaId, { maxFoldedEpoch: number; frontierAtMaxFoldedEpoch: number }>;
  readonly frontiers: ReplicaFrontiers;
  readonly rollingStreamDigestAnchors?: Record<OriginStreamKey, RollingDigestAnchor> | undefined;
  readonly activeEpochEquivocations: Record<OriginStreamKey, ActiveEquivocationRecord>;
  readonly historicalEquivocationAudit: readonly EquivocationAuditRecord[];
  readonly entries: readonly EntryStateRecord[];
  readonly snapshotDigest: string;
}

export interface DurableAckMessage {
  readonly protocolVersion: ProtocolVersion;
  readonly collectionId: CollectionId;
  readonly epochNumber: EpochNumber;
  readonly fromReplicaId: ReplicaId;
  readonly durableFrontier: Record<OriginStreamKey, SequenceNumber>;
  readonly rollingStreamDigests: Record<OriginStreamKey, string>;
  readonly authorKeyId: string;
  readonly authorSignature: string;
}

export interface TransportChannelPrincipal {
  readonly channelId: string;
  readonly channelAuthenticated: boolean;
  readonly transportSenderReplicaId: ReplicaId;
}

export interface InTransactionContext {
  meta: ReplicaMetaRecord;
  entriesState: Map<string, EntryStateRecord>;
  mutationJournal: Map<string, MutationJournalRecord>;
  operationDigests: Map<string, OperationDigestRecord>;
  syncOutbox: Map<string, SyncOutboxRecord>;
  inboundGapBuffer: Map<string, InboundGapBufferRecord>;
  inboundDependencyBuffer: Map<string, InboundDependencyBufferRecord>;
  quarantineJournal: Map<string, QuarantineRecord>;
  snapshotsV2?: Map<number, SnapshotRecord> | undefined;
}

import { D137_V331_LIMITS } from "./limits.js";
import { computeCanonicalByteSize } from "./canonical.js";

export { D137_V331_LIMITS };

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail: string };

function isObject(targetValue: unknown): targetValue is Record<string, unknown> {
  return typeof targetValue === "object" && targetValue !== null && !Array.isArray(targetValue);
}

function checkUnknownKeys(targetObject: Record<string, unknown>, allowedKeys: Set<string>): string | null {
  for (const propertyKey of Object.keys(targetObject)) {
    if (!allowedKeys.has(propertyKey)) return propertyKey;
  }
  return null;
}

function validateDot(raw: unknown, label: string): DecodeResult<CausalDot> {
  if (!isObject(raw)) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `${label} must be an object` };
  const unknownKey = checkUnknownKeys(raw, new Set(["epochNumber", "replicaId", "sequence"]));
  if (unknownKey) return { ok: false, code: "D137_WIRE_UNKNOWN_FIELD", detail: `Unknown field '${unknownKey}' in ${label}` };
  const { epochNumber, replicaId, sequence } = raw;
  if (typeof epochNumber !== "number" || !Number.isInteger(epochNumber) || epochNumber < 1) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `${label}.epochNumber must be positive integer` };
  if (typeof replicaId !== "string" || !replicaId) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `${label}.replicaId must be non-empty string` };
  if (replicaId.includes(":")) return { ok: false, code: "D137_INVALID_REPLICA_ID", detail: `${label}.replicaId cannot contain ':'` };
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `${label}.sequence must be positive integer` };
  return { ok: true, value: { epochNumber, replicaId, sequence } };
}

function validateStamp(raw: unknown, label: string): DecodeResult<LamportStamp> {
  if (!isObject(raw)) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `${label} must be an object` };
  const unknownKey = checkUnknownKeys(raw, new Set(["lamport", "epochNumber", "replicaId", "sequence"]));
  if (unknownKey) return { ok: false, code: "D137_WIRE_UNKNOWN_FIELD", detail: `Unknown field '${unknownKey}' in ${label}` };
  const { lamport } = raw;
  if (typeof lamport !== "number" || !Number.isInteger(lamport) || lamport < 0) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `${label}.lamport must be non-negative integer` };
  const dotResult = validateDot({ epochNumber: raw["epochNumber"], replicaId: raw["replicaId"], sequence: raw["sequence"] }, label);
  if (!dotResult.ok) return dotResult;
  return { ok: true, value: { lamport, ...dotResult.value } };
}

const BASE_OP_KEYS = new Set([
  "protocolVersion", "collectionId", "epochNumber", "epochCertificateId",
  "opDot", "targetIncarnation", "externalId", "stamp", "authorKeyId", "payloadDigest", "authorSignature", "kind"
]);
const INSERT_KEYS = new Set([...BASE_OP_KEYS, "indexKey", "leftNeighborIncarnation", "rightNeighborIncarnation", "initialFields"]);
const UPDATE_KEYS = new Set([...BASE_OP_KEYS, "partialFields", "removedFields", "baseFieldStamps"]);
const MOVE_KEYS = new Set([...BASE_OP_KEYS, "newIndexKey", "leftNeighborIncarnation", "rightNeighborIncarnation", "basePosStamp", "basePosSourceOpKey"]);
const DELETE_KEYS = new Set([...BASE_OP_KEYS]);
const CLEAR_KEYS = new Set([...BASE_OP_KEYS, "targetIncarnations", "clearBatchMeta"]);

export function decodeWireOperation(raw: unknown): DecodeResult<ReplicableOperation> {
  if (!isObject(raw)) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Operation must be an object" };
  if (raw["kind"] === "clear" && Array.isArray(raw["targetIncarnations"]) && raw["targetIncarnations"].length > D137_V331_LIMITS.CLEAR_MAX_TARGETS_PER_CHUNK) {
    return { ok: false, code: "D137_CLEAR_CHUNK_TARGETS_EXCEEDED", detail: `clear targets exceed ${D137_V331_LIMITS.CLEAR_MAX_TARGETS_PER_CHUNK}` };
  }
  const byteSize = computeCanonicalByteSize(raw);
  if (byteSize > D137_V331_LIMITS.MAX_OPERATION_PAYLOAD_BYTES) {
    return { ok: false, code: "D137_OPERATION_PAYLOAD_TOO_LARGE", detail: `Payload ${byteSize} exceeds limit` };
  }
  if (raw["protocolVersion"] !== PROTOCOL_VERSION) {
    return { ok: false, code: "D137_PROTOCOL_VERSION_MISMATCH", detail: `Unsupported version '${String(raw["protocolVersion"])}'` };
  }
  const kind = raw["kind"];
  if (kind !== "insert" && kind !== "update" && kind !== "move" && kind !== "delete" && kind !== "clear") {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `Invalid kind '${String(kind)}'` };
  }
  const allowedKeys = kind === "insert" ? INSERT_KEYS : kind === "update" ? UPDATE_KEYS : kind === "move" ? MOVE_KEYS : kind === "delete" ? DELETE_KEYS : CLEAR_KEYS;
  const unknownKey = checkUnknownKeys(raw, allowedKeys);
  if (unknownKey) return { ok: false, code: "D137_WIRE_UNKNOWN_FIELD", detail: `Unknown field '${unknownKey}' in ${kind}` };

  for (const requiredField of ["collectionId", "epochCertificateId", "authorKeyId", "payloadDigest", "authorSignature"]) {
    if (typeof raw[requiredField] !== "string" || !raw[requiredField]) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `Invalid ${requiredField}` };
  }
  if (typeof raw["externalId"] !== "string" || (kind !== "clear" && !raw["externalId"])) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Invalid externalId" };
  }
  if (typeof raw["epochNumber"] !== "number" || !Number.isInteger(raw["epochNumber"]) || raw["epochNumber"] < 1) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Invalid epochNumber" };
  }

  const opDot = validateDot(raw["opDot"], "opDot");
  if (!opDot.ok) return opDot;
  const target = validateDot(raw["targetIncarnation"], "targetIncarnation");
  if (!target.ok) return target;
  const stamp = validateStamp(raw["stamp"], "stamp");
  if (!stamp.ok) return stamp;

  const encoder = new TextEncoder();
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: raw["collectionId"] as string,
    epochNumber: raw["epochNumber"] as number,
    epochCertificateId: raw["epochCertificateId"] as string,
    opDot: opDot.value,
    targetIncarnation: target.value,
    externalId: raw["externalId"] as string,
    stamp: stamp.value,
    authorKeyId: raw["authorKeyId"] as string,
    payloadDigest: raw["payloadDigest"] as string,
    authorSignature: raw["authorSignature"] as string,
  };

  if (kind === "insert") {
    if (typeof raw["indexKey"] !== "string") return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "indexKey must be string" };
    if (encoder.encode(raw["indexKey"]).length > D137_V331_LIMITS.MAX_INDEX_KEY_BYTES) return { ok: false, code: "D137_INDEX_KEY_TOO_LONG", detail: "indexKey too long" };
    if (!isObject(raw["initialFields"])) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "initialFields must be object" };
    const left = raw["leftNeighborIncarnation"] !== null ? validateDot(raw["leftNeighborIncarnation"], "leftNeighbor") : { ok: true as const, value: null };
    if (!left.ok) return left;
    const right = raw["rightNeighborIncarnation"] !== null ? validateDot(raw["rightNeighborIncarnation"], "rightNeighbor") : { ok: true as const, value: null };
    if (!right.ok) return right;
    return { ok: true, value: { ...base, kind: "insert", indexKey: raw["indexKey"], leftNeighborIncarnation: left.value, rightNeighborIncarnation: right.value, initialFields: raw["initialFields"] } };
  }

  if (kind === "update") {
    if (!isObject(raw["partialFields"]) || !Array.isArray(raw["removedFields"]) || !isObject(raw["baseFieldStamps"])) {
      return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Invalid update fields structure" };
    }
    const baseFieldStamps: Record<string, LamportStamp> = {};
    for (const [fieldName, stampValue] of Object.entries(raw["baseFieldStamps"])) {
      const stampValidationResult = validateStamp(stampValue, `baseFieldStamps.${fieldName}`);
      if (!stampValidationResult.ok) return stampValidationResult;
      baseFieldStamps[fieldName] = stampValidationResult.value;
    }
    return { ok: true, value: { ...base, kind: "update", partialFields: raw["partialFields"], removedFields: raw["removedFields"] as readonly string[], baseFieldStamps } };
  }

  if (kind === "move") {
    if (typeof raw["newIndexKey"] !== "string") return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "newIndexKey must be string" };
    if (encoder.encode(raw["newIndexKey"]).length > D137_V331_LIMITS.MAX_INDEX_KEY_BYTES) return { ok: false, code: "D137_INDEX_KEY_TOO_LONG", detail: "newIndexKey too long" };
    const basePos = validateStamp(raw["basePosStamp"], "basePosStamp");
    if (!basePos.ok) return basePos;
    const left = raw["leftNeighborIncarnation"] !== null ? validateDot(raw["leftNeighborIncarnation"], "leftNeighbor") : { ok: true as const, value: null };
    if (!left.ok) return left;
    const right = raw["rightNeighborIncarnation"] !== null ? validateDot(raw["rightNeighborIncarnation"], "rightNeighbor") : { ok: true as const, value: null };
    if (!right.ok) return right;
    return { ok: true, value: { ...base, kind: "move", newIndexKey: raw["newIndexKey"], leftNeighborIncarnation: left.value, rightNeighborIncarnation: right.value, basePosStamp: basePos.value, basePosSourceOpKey: typeof raw["basePosSourceOpKey"] === "string" ? raw["basePosSourceOpKey"] : undefined } };
  }

  if (kind === "delete") return { ok: true, value: { ...base, kind: "delete" } };

  // Clear
  if (!Array.isArray(raw["targetIncarnations"])) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "targetIncarnations must be array" };
  const targets: CausalDot[] = [];
  for (let targetIndex = 0; targetIndex < raw["targetIncarnations"].length; targetIndex++) {
    const dotValidationResult = validateDot(raw["targetIncarnations"][targetIndex], `targetIncarnations[${targetIndex}]`);
    if (!dotValidationResult.ok) return dotValidationResult;
    targets.push(dotValidationResult.value);
  }
  if (!isObject(raw["clearBatchMeta"])) return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "clearBatchMeta must be object" };
  const meta = raw["clearBatchMeta"];
  const unknownMetaKey = checkUnknownKeys(meta, new Set(["batchId", "chunkIndex", "totalChunks"]));
  if (unknownMetaKey) return { ok: false, code: "D137_WIRE_UNKNOWN_FIELD", detail: `Unknown field '${unknownMetaKey}' in clearBatchMeta` };
  if (typeof meta["batchId"] !== "string" || !meta["batchId"] || typeof meta["chunkIndex"] !== "number" || !Number.isInteger(meta["chunkIndex"]) || meta["chunkIndex"] < 0 || typeof meta["totalChunks"] !== "number" || !Number.isInteger(meta["totalChunks"]) || meta["totalChunks"] < 1) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Invalid clearBatchMeta fields" };
  }

  return { ok: true, value: { ...base, kind: "clear", targetIncarnations: targets, clearBatchMeta: { batchId: meta["batchId"], chunkIndex: meta["chunkIndex"], totalChunks: meta["totalChunks"] } } };
}
