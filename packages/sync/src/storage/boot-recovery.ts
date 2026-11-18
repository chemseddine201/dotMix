/**
 * @dotmix/sync — Boot Recovery on Storage (S59, S91)
 *
 * Implements snapshot verification, fallback from snapshot N to N-1 (S59),
 * and fail-closed CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED (S91).
 * Zero external dependencies.
 */

import type { StoreBackend } from "./memory-backend.js";
import { computeDigestSync } from "./idb-tx.js";
import {
  toIncarnationId,
  toOperationKey,
  applyOperationToState,
} from "../protocol/apply.js";
import {
  recomputeStableFrontier,
  updateRollingStreamDigest,
} from "../protocol/frontiers.js";
import { computeCanonicalSnapshotDigest } from "../protocol/snapshots.js";
import { validateEpochMembershipCertificate } from "../protocol/preverify.js";
import { ReplicationEngine } from "../protocol/engine.js";
import type {
  InTransactionContext,
  MutationJournalRecord,
  OperationDigestRecord,
  SnapshotRecord,
  SyncOutboxRecord,
} from "../protocol/types.js";

export interface SnapshotRecordLike {
  snapshotSeq: number;
  collectionId: string;
  snapshotDigest: string;
  epochCertificate?: {
    collectionId: string;
    epochNumber: number;
    coordinatorSignature?: string;
    tampered?: boolean;
    memberBindings?: Record<string, { authorKeyId: string; authorPublicKeyHex: string }>;
  };
  state?: unknown;
}

export interface BootRecoveryOptions {
  authorPrivateKeyHex?: string;
}

export interface BootRecoveryResult {
  ok: boolean;
  acceptedSnapSeq?: number;
  fallbackUsed?: boolean;
  code?: string;
  detail?: string;
  snapshot?: SnapshotRecordLike;
  engine?: ReplicationEngine;
}

export function computeSnapshotDigestSync(snapshotRecord: SnapshotRecordLike): string {
  const normalizedPayload = {
    snapshotSeq: snapshotRecord.snapshotSeq,
    collectionId: snapshotRecord.collectionId,
    epochCertificate: snapshotRecord.epochCertificate,
    state: snapshotRecord.state,
  };
  return computeDigestSync(JSON.stringify(normalizedPayload));
}

function isFullSnapshotRecord(candidateRecord: SnapshotRecordLike): candidateRecord is SnapshotRecord {
  return "frontiers" in (candidateRecord as unknown as Record<string, unknown>);
}

/**
 * Recovers engine state from storage on boot with N -> N-1 fallback (S59)
 * and fail-closed corrupt store error (S91).
 */
export async function recoverFromStoreOnBoot(
  backend: StoreBackend,
  collectionId: string,
  replicaIdOrValidateCert?: string | ((certificatePayload: unknown) => boolean),
  recoveryOptions?: { authorPrivateKeyHex?: string }
): Promise<BootRecoveryResult> {
  if (!backend.isOpen()) {
    await backend.open();
  }

  const storedSnapshots = await backend.runTransaction(
    ["snapshots"],
    "readonly",
    async (transaction) => transaction.getAll<SnapshotRecordLike>("snapshots")
  );

  const matchingSnapshots = storedSnapshots
    .filter((candidateRecord) => candidateRecord.collectionId === collectionId)
    .sort((snapshotAlpha, snapshotBeta) => snapshotBeta.snapshotSeq - snapshotAlpha.snapshotSeq);

  if (matchingSnapshots.length === 0) {
    throw new Error(`CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED: No snapshots found for collection ${collectionId}`);
  }

  const snapshotLatestN = matchingSnapshots[0]!;
  const snapshotFallbackNMinus1 = matchingSnapshots.length > 1 ? matchingSnapshots[1] : undefined;

  let acceptedSnapshot: SnapshotRecordLike | undefined;
  let fallbackUsed = false;

  const certificateValidationHook =
    typeof replicaIdOrValidateCert === "function" ? replicaIdOrValidateCert : undefined;
  const explicitReplicaId =
    typeof replicaIdOrValidateCert === "string" ? replicaIdOrValidateCert : undefined;

  const verifySnapshotCandidate = async (candidateRecord: SnapshotRecordLike): Promise<boolean> => {
    if (isFullSnapshotRecord(candidateRecord)) {
      const canonicalDigest = computeCanonicalSnapshotDigest(candidateRecord);
      if (canonicalDigest !== candidateRecord.snapshotDigest) {
        return false;
      }
      if ((candidateRecord.epochCertificate as { tampered?: boolean })?.tampered) {
        return false;
      }
      if (certificateValidationHook) {
        return certificateValidationHook(candidateRecord.epochCertificate);
      }
      const certificateVerificationResult = await validateEpochMembershipCertificate(
        candidateRecord.epochCertificate,
        collectionId,
        candidateRecord.snapshotSeq === 0 ? candidateRecord : undefined
      );
      return certificateVerificationResult.ok;
    } else {
      const synchronousDigest = computeSnapshotDigestSync(candidateRecord);
      const digestMatches = synchronousDigest === candidateRecord.snapshotDigest;
      const certificateValid =
        !candidateRecord.epochCertificate?.tampered &&
        (!certificateValidationHook || certificateValidationHook(candidateRecord.epochCertificate));
      return digestMatches && certificateValid;
    }
  };

  if (await verifySnapshotCandidate(snapshotLatestN)) {
    acceptedSnapshot = snapshotLatestN;
  } else if (snapshotFallbackNMinus1 && (await verifySnapshotCandidate(snapshotFallbackNMinus1))) {
    acceptedSnapshot = snapshotFallbackNMinus1;
    fallbackUsed = true;
  }

  if (!acceptedSnapshot) {
    throw new Error("CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED: Both latest snapshot N and N-1 failed verification");
  }

  // If this is a minimal snapshot (not full protocol snapshot), return early
  if (!isFullSnapshotRecord(acceptedSnapshot)) {
    return {
      ok: true,
      acceptedSnapSeq: acceptedSnapshot.snapshotSeq,
      fallbackUsed,
      snapshot: acceptedSnapshot,
    };
  }

  // Full protocol snapshot recovery
  const journalEntries = await backend.runTransaction(
    ["mutation_journal"],
    "readonly",
    async (transaction) => transaction.getAll<MutationJournalRecord>("mutation_journal")
  );

  const collectionJournalEntries = journalEntries.filter(
    (journalRecord) => journalRecord.collectionId === collectionId
  );

  if (fallbackUsed) {
    for (const [streamIdentifier, includedSequence] of Object.entries(
      acceptedSnapshot.frontiers.snapshotIncludedFrontier
    )) {
      const streamEntries = collectionJournalEntries
        .filter(
          (journalRecord) => `${journalRecord.epochNumber}:${journalRecord.replicaId}` === streamIdentifier
        )
        .sort((entryAlpha, entryBeta) => entryAlpha.sequence - entryBeta.sequence);

      if (streamEntries.length > 0 && streamEntries[0]!.sequence > includedSequence + 1) {
        throw new Error(
          `CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED: Truncated journal gap on fallback from seq ${includedSequence} to ${streamEntries[0]!.sequence}`
        );
      }
    }
  }

  const selectedReplicaId =
    explicitReplicaId ?? acceptedSnapshot.members[0] ?? "A";
  const memberBinding = acceptedSnapshot.epochCertificate.memberBindings[selectedReplicaId];
  const assignedAuthorKeyId = memberBinding?.authorKeyId ?? "key-default";

  const reconstructedEngine = new ReplicationEngine(
    collectionId,
    selectedReplicaId,
    acceptedSnapshot.epochNumber,
    acceptedSnapshot.epochCertificate,
    assignedAuthorKeyId,
    recoveryOptions?.authorPrivateKeyHex
  );

  reconstructedEngine.snapshotsV2.clear();
  reconstructedEngine.snapshotsV2.set(acceptedSnapshot.snapshotSeq, acceptedSnapshot);
  if (!fallbackUsed && snapshotFallbackNMinus1 && isFullSnapshotRecord(snapshotFallbackNMinus1)) {
    reconstructedEngine.snapshotsV2.set(snapshotFallbackNMinus1.snapshotSeq, snapshotFallbackNMinus1);
  }

  reconstructedEngine.meta.activeSnapshotSeq = acceptedSnapshot.snapshotSeq;
  reconstructedEngine.meta.epochNumber = acceptedSnapshot.epochNumber;
  reconstructedEngine.meta.epochCertificateId = acceptedSnapshot.epochCertificateId;
  reconstructedEngine.meta.frontiers = JSON.parse(JSON.stringify(acceptedSnapshot.frontiers));
  reconstructedEngine.meta.rollingStreamDigestAnchors = {
    ...(acceptedSnapshot.rollingStreamDigestAnchors ?? {}),
  };
  reconstructedEngine.meta.activeEpochEquivocations = {
    ...acceptedSnapshot.activeEpochEquivocations,
  };
  reconstructedEngine.meta.historicalEquivocationAudit = [
    ...acceptedSnapshot.historicalEquivocationAudit,
  ];

  reconstructedEngine.entriesState.clear();
  for (const itemRecord of acceptedSnapshot.entries) {
    reconstructedEngine.entriesState.set(
      toIncarnationId(itemRecord.targetBirthDot),
      JSON.parse(JSON.stringify(itemRecord))
    );
  }

  const [persistedOutboxEntries, persistedDigestRecords, persistedReplicaMeta] =
    await backend.runTransaction(
      ["sync_outbox", "operation_digests", "replica_meta"],
      "readonly",
      async (transaction) => {
        const outboxItems = await transaction.getAll<SyncOutboxRecord>("sync_outbox");
        const digestItems = await transaction.getAll<OperationDigestRecord>("operation_digests");
        const metaItem = await transaction.get<Record<string, unknown>>("replica_meta", collectionId);
        return [outboxItems, digestItems, metaItem];
      }
    );

  if (persistedReplicaMeta) {
    if (typeof persistedReplicaMeta["authorKeyId"] === "string") {
      reconstructedEngine.meta.authorKeyId = persistedReplicaMeta["authorKeyId"];
    }
    const persistedNextSequence = persistedReplicaMeta["nextLocalSequence"];
    if (
      typeof persistedNextSequence === "number" &&
      persistedNextSequence > reconstructedEngine.meta.nextLocalSequence
    ) {
      reconstructedEngine.meta.nextLocalSequence = persistedNextSequence;
    }
    const persistedLamportTimestamp = persistedReplicaMeta["localLamport"];
    if (
      typeof persistedLamportTimestamp === "number" &&
      persistedLamportTimestamp > reconstructedEngine.meta.localLamport
    ) {
      reconstructedEngine.meta.localLamport = persistedLamportTimestamp;
    }
  }

  for (const outboxEntry of persistedOutboxEntries.filter(
    (itemCandidate) => itemCandidate.collectionId === collectionId
  )) {
    reconstructedEngine.syncOutbox.set(
      toOperationKey(outboxEntry.collectionId, outboxEntry.operation.opDot),
      outboxEntry
    );
  }

  for (const digestEntry of persistedDigestRecords.filter(
    (itemCandidate) => itemCandidate.collectionId === collectionId
  )) {
    reconstructedEngine.operationDigests.set(digestEntry.opKey, digestEntry);
  }

  const replayContext: InTransactionContext = {
    meta: reconstructedEngine.meta,
    entriesState: reconstructedEngine.entriesState,
    mutationJournal: reconstructedEngine.mutationJournal,
    operationDigests: reconstructedEngine.operationDigests,
    syncOutbox: reconstructedEngine.syncOutbox,
    inboundGapBuffer: reconstructedEngine.inboundGapBuffer,
    inboundDependencyBuffer: reconstructedEngine.inboundDependencyBuffer,
    quarantineJournal: reconstructedEngine.quarantineJournal,
  };

  const sortedJournalOperations = collectionJournalEntries.sort(
    (operationAlpha, operationBeta) => {
      if (operationAlpha.operation.stamp.lamport !== operationBeta.operation.stamp.lamport) {
        return operationAlpha.operation.stamp.lamport - operationBeta.operation.stamp.lamport;
      }
      return operationAlpha.sequence - operationBeta.sequence;
    }
  );

  for (const journalRecord of sortedJournalOperations) {
    reconstructedEngine.mutationJournal.set(journalRecord.opKey, journalRecord);

    if (journalRecord.epochNumber < acceptedSnapshot.epochNumber) {
      continue;
    }

    const streamIdentifier = `${journalRecord.epochNumber}:${journalRecord.replicaId}`;
    const includedSequence =
      acceptedSnapshot.frontiers.snapshotIncludedFrontier[streamIdentifier] ?? 0;

    if (journalRecord.sequence > includedSequence) {
      applyOperationToState(replayContext, journalRecord.operation, false);
      const currentDurableSequence =
        reconstructedEngine.meta.frontiers.localDurableFrontier[streamIdentifier] ?? 0;
      if (journalRecord.sequence > currentDurableSequence) {
        reconstructedEngine.meta.frontiers.localDurableFrontier[streamIdentifier] =
          journalRecord.sequence;
        reconstructedEngine.meta.frontiers.knownProducedFrontier[streamIdentifier] =
          journalRecord.sequence;
        updateRollingStreamDigest(
          reconstructedEngine.meta,
          streamIdentifier,
          journalRecord.sequence,
          journalRecord.operation.payloadDigest
        );
      }
    }
  }

  const localStreamIdentifier = `${reconstructedEngine.meta.epochNumber}:${reconstructedEngine.meta.replicaId}`;
  const localDurableSequence =
    reconstructedEngine.meta.frontiers.localDurableFrontier[localStreamIdentifier] ?? 0;
  if (localDurableSequence >= reconstructedEngine.meta.nextLocalSequence) {
    reconstructedEngine.meta.nextLocalSequence = localDurableSequence + 1;
  }

  recomputeStableFrontier(reconstructedEngine.meta);

  return {
    ok: true,
    engine: reconstructedEngine,
    acceptedSnapSeq: acceptedSnapshot.snapshotSeq,
    fallbackUsed,
    snapshot: acceptedSnapshot,
  };
}

type PersistedStoreName = "snapshots" | "mutation_journal" | "sync_outbox" | "operation_digests" | "entries_state";

interface PersistedRecordEntry {
  readonly ref: unknown;
  readonly serialized: string;
}

interface PersistedRecordCache {
  readonly backend: StoreBackend;
  readonly recordsByStore: Map<PersistedStoreName, Map<string | number, PersistedRecordEntry>>;
}

/** What each engine last wrote, per store: record key -> entry (ref + serialized). */
const persistedRecordCaches = new WeakMap<ReplicationEngine, PersistedRecordCache>();

/**
 * Persists engine state into a StoreBackend in one atomic transaction.
 *
 * The first write for an engine replaces the mirrored stores completely. Later writes put
 * only the records whose serialized form changed and delete the records the engine dropped,
 * so a single insert no longer rewrites every stored record. The cache is updated only
 * after the transaction succeeds, so a failed write (for example QuotaExceededError) is
 * retried in full by the next flush.
 */
export async function persistEngineToStore(
  backend: StoreBackend,
  engine: ReplicationEngine
): Promise<void> {
  if (!backend.isOpen()) {
    await backend.open();
  }

  const previousCache = persistedRecordCaches.get(engine);
  const isFirstPersist = previousCache === undefined || previousCache.backend !== backend;
  const recordSources: ReadonlyArray<readonly [PersistedStoreName, ReadonlyMap<string | number, unknown>, boolean]> = [
    // [store, engine records, the store mirrors the engine map (dropped records are deleted)]
    ["snapshots", engine.snapshotsV2, false],
    ["mutation_journal", engine.mutationJournal, true],
    ["sync_outbox", engine.syncOutbox, true],
    ["operation_digests", engine.operationDigests, true],
    ["entries_state", engine.entriesState, true],
  ];
  const nextRecordsByStore = new Map<PersistedStoreName, Map<string | number, PersistedRecordEntry>>();

  await backend.runTransaction(
    [
      "snapshots",
      "mutation_journal",
      "sync_outbox",
      "operation_digests",
      "entries_state",
      "replica_meta",
    ],
    "readwrite",
    async (transaction) => {
      for (const [storeName, engineRecords, mirrorsEngine] of recordSources) {
        const previousRecords = isFirstPersist ? undefined : previousCache.recordsByStore.get(storeName);
        const nextRecords = new Map<string | number, PersistedRecordEntry>();
        if (isFirstPersist && mirrorsEngine) {
          await transaction.clear(storeName);
        }
        for (const [recordKey, engineRecord] of engineRecords.entries()) {
          const previousEntry = previousRecords?.get(recordKey);
          if (previousEntry !== undefined && previousEntry.ref === engineRecord) {
            nextRecords.set(recordKey, previousEntry);
          } else {
            const serializedRecord = JSON.stringify(engineRecord);
            nextRecords.set(recordKey, { ref: engineRecord, serialized: serializedRecord });
            if (previousEntry === undefined || previousEntry.serialized !== serializedRecord) {
              await transaction.put(storeName, recordKey, JSON.parse(serializedRecord));
            }
          }
        }
        if (previousRecords && mirrorsEngine) {
          for (const previousKey of previousRecords.keys()) {
            if (!nextRecords.has(previousKey)) {
              await transaction.delete(storeName, previousKey);
            }
          }
        }
        nextRecordsByStore.set(storeName, nextRecords);
      }
      await transaction.put("replica_meta", engine.meta.collectionId, JSON.parse(JSON.stringify(engine.meta)));
    }
  );

  persistedRecordCaches.set(engine, { backend, recordsByStore: nextRecordsByStore });
}
