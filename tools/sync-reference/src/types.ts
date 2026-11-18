/**
 * Sync-v33-reference: Protocol Types & Constants
 * Protocol Version: replicated.v3.3.1
 */

export type ProtocolVersion = "replicated.v3.3.1";
export type EpochNumber = number;
export type SequenceNumber = number;
export type ReplicaId = string;
export type CollectionId = string;
export type OperationKey = string; // `${collectionId}:${epochNumber}:${replicaId}:${sequence}`
export type OriginStreamKey = string; // `${epochNumber}:${replicaId}`
export type IncarnationId = string; // `${epochNumber}:${replicaId}:${sequence}`
export type SigningAlgorithm = "Ed25519" | "ECDSA_P256";

export interface CausalDot {
  readonly epochNumber: EpochNumber;
  readonly replicaId: ReplicaId;
  readonly sequence: SequenceNumber;
}

export interface LamportStamp {
  readonly lamport: number;
  readonly epochNumber: EpochNumber;
  readonly replicaId: ReplicaId;
  readonly sequence: SequenceNumber;
}

export type OperationKind = "insert" | "update" | "move" | "delete" | "clear";

export interface ClearBatchMetadata {
  readonly batchId: string;
  readonly chunkIndex: number;
  readonly totalChunks: number;
}

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
  readonly basePosSourceOpKey?: OperationKey;
}

export interface DeleteOperation extends BaseOperation {
  readonly kind: "delete";
}

export interface ClearOperation extends BaseOperation {
  readonly kind: "clear";
  readonly targetIncarnations: readonly CausalDot[];
  readonly clearBatchMeta: ClearBatchMetadata;
}

export type ReplicableOperation =
  | InsertOperation
  | UpdateOperation
  | MoveOperation
  | DeleteOperation
  | ClearOperation;

export interface FieldValueRegister {
  readonly value: unknown;
  readonly stamp: LamportStamp;
  readonly present: boolean;
}

export interface PositionRegister {
  readonly indexKey: string;
  readonly stamp: LamportStamp;
  readonly leftNeighbor: CausalDot | null;
  readonly rightNeighbor: CausalDot | null;
}

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
  | "SYNC_EPOCH_CLOSED";

export interface OperationApplyResult {
  readonly ok: boolean;
  readonly disposition?: OperationDisposition;
  readonly code?: string;
  readonly detail?: string;
}

export interface OperationDigestRecord {
  readonly opKey: OperationKey;
  readonly collectionId: CollectionId;
  readonly epochNumber: EpochNumber;
  readonly replicaId: ReplicaId;
  readonly sequence: SequenceNumber;
  readonly kind?: OperationKind;
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
  readonly revokedKeyIds?: readonly string[];
  readonly coordinatorSignature: string;
}

export interface ActiveEquivocationRecord {
  readonly streamKey: OriginStreamKey;
  readonly certifiedBaselineSeq: SequenceNumber;
  readonly firstEquivocatedSeq: SequenceNumber;
  readonly reason: string;
  readonly observedDigests: readonly string[];
  readonly conflictingOps?: readonly ReplicableOperation[];
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
  authorPrivateKeyHex?: string;
  securityStateVersion: number;
  localLamport: number;
  nextLocalSequence: SequenceNumber;
  nextQuarantineSeq: number;
  activeSnapshotSeq: number;
  baselineSnapshotSeq?: number;
  remoteSyncEnabled: boolean;
  lifecycleState: LifecycleState;
  activeReplayPlan?: ReplayPlanRecord;
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
  readonly rollingStreamDigestAnchors?: Record<OriginStreamKey, RollingDigestAnchor>;
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

export const SYNC_PROTOCOL_LIMITS = {
  MAX_OPERATION_PAYLOAD_BYTES: 65_536,
  MAX_ENTRY_TOTAL_BYTES: 65_536,
  MAX_INDEX_KEY_BYTES: 512,
  MAX_GAP_BUFFER_OPS_PER_COLLECTION: 1_000,
  MAX_GAP_BUFFER_BYTES_PER_COLLECTION: 16_777_216,
  MAX_DEPENDENCY_BUFFER_OPS_PER_COLLECTION: 1_000,
  MAX_DEPENDENCY_BUFFER_BYTES_PER_COLLECTION: 16_777_216,
  MAX_QUARANTINE_RECORDS: 500,
  MAX_DRAIN_BATCH: 250,
  MAX_OBSERVED_CONFLICT_DIGESTS_PER_DOT: 8,
  MAX_EQUIVOCATION_AUDIT_RECORDS: 256,
  MAX_UNCOMPACTED_JOURNAL_OPS_SOFT_LIMIT: 50_000,
  MAX_OUTBOX_OPS_SOFT_LIMIT: 50_000,
  MAX_JOURNAL_BYTE_USAGE_SOFT_LIMIT: 67_108_864,
  MAX_OUTBOX_BYTE_USAGE_SOFT_LIMIT: 16_777_216,
  MIN_DIGEST_RETENTION_ABOVE_COMPACTION: 1_024,
  TAB_LEASE_HEARTBEAT_INTERVAL_MS: 2_000,
  TAB_LEASE_TAKEOVER_STALE_MS: 10_000,
  CLEAR_MAX_TARGETS_PER_CHUNK: 2_000,
  MAX_LAMPORT_ADVANCE_PER_OP: 100_000,
} as const;
