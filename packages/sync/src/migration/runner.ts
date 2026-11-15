/**
 * @dotmix/sync — Production v1 -> v2 Migration Engine & Idempotent Runner (Gate 34 / T-34.3)
 *
 * Implements non-destructive extraction from v1 snapshots and mutation_log,
 * zero-loss pending offline mutation replay plans, legacy archiving,
 * and crash-resilient multi-stage finalization.
 * Zero external dependencies.
 */

import type { MigrationResult, MigrationRunner, MigrationStatus } from "../adapter/contract.js";
import type { StoreBackend } from "../storage/memory-backend.js";
import { runTx11LegacyMigration } from "../storage/idb-tx.js";
import { D137Engine } from "../protocol/engine.js";
import { commitCheckpoint } from "../protocol/snapshots.js";
import { toIncarnationId } from "../protocol/apply.js";
import {
  type CausalDot,
  type EntryStateRecord,
  type LamportStamp,
  PROTOCOL_VERSION,
} from "../protocol/types.js";
import type {
  LegacyArchiveRecord,
  LegacyV1EntryPayload,
  LegacyV1MutationRecord,
  V1MigrationExecutionResult,
  V1MigrationPlan,
} from "./types.js";
import { buildV1MigrationPlan } from "./plan.js";
import { replayPendingMutations } from "./pending-replay.js";
import {
  createMigrationSigningIdentity,
  signMigrationOperation,
  type MigrationSigningIdentity,
} from "./signing-identity.js";

export interface ProductionMigrationOptions {
  /** The replica identity that authors the migrated operations. Generated when absent. */
  readonly signingIdentity?: MigrationSigningIdentity | undefined;
  readonly legacySnapshotPayload?: readonly LegacyV1EntryPayload[] | { value: readonly LegacyV1EntryPayload[] } | undefined;
  readonly legacyMutationsPayload?: readonly LegacyV1MutationRecord[] | undefined;
  readonly interruptAtStage?: "archive_written" | "entries_migrated" | undefined;
}

export class ProductionV1MigrationRunner implements MigrationRunner {
  private currentMigrationStatus: MigrationStatus = "uninitialized";

  status(): MigrationStatus {
    return this.currentMigrationStatus;
  }

  /**
   * Migration is required when legacy data exists and no completed archive is recorded,
   * or when an earlier run stopped before its checkpoint.
   */
  async isMigrationRequired(
    collectionId: string,
    backend?: StoreBackend | undefined,
    hasLegacyData: boolean = false
  ): Promise<boolean> {
    if (!backend || !backend.isOpen()) {
      return false;
    }
    try {
      const existingArchive = await backend.runTransaction(
        ["legacy_archive"],
        "readonly",
        async (transaction) => transaction.get<LegacyArchiveRecord>("legacy_archive", collectionId)
      );
      if (existingArchive) {
        return existingArchive.stage === "archive_written" || existingArchive.stage === "entries_migrated";
      }
      return hasLegacyData;
    } catch {
      return false;
    }
  }

  buildPlan(
    collectionId: string,
    rawSnapshot: readonly LegacyV1EntryPayload[] | { value: readonly LegacyV1EntryPayload[] } | undefined,
    rawMutations: readonly LegacyV1MutationRecord[] | undefined
  ): V1MigrationPlan {
    return buildV1MigrationPlan(collectionId, rawSnapshot, rawMutations);
  }

  async runV1Migration(
    collectionId: string,
    backendOrOptions?: unknown,
    optionsParameter?: ProductionMigrationOptions
  ): Promise<MigrationResult> {
    const backendInstance =
      backendOrOptions && typeof backendOrOptions === "object" && "runTransaction" in backendOrOptions
        ? (backendOrOptions as StoreBackend)
        : undefined;

    const migrationOptions =
      optionsParameter ??
      (backendOrOptions && typeof backendOrOptions === "object" && !("runTransaction" in backendOrOptions)
        ? (backendOrOptions as ProductionMigrationOptions)
        : undefined);

    if (!backendInstance) {
      return {
        ok: false,
        status: "failed",
        code: "D137_MIGRATION_NO_BACKEND",
        detail: "StoreBackend instance required for production migration",
      };
    }

    this.currentMigrationStatus = "migrating";

    try {
      const executionResult = await this.executeMigrationInternal(
        collectionId,
        backendInstance,
        migrationOptions
      );
      this.currentMigrationStatus = executionResult.status;
      return {
        ok: executionResult.ok,
        status: executionResult.status,
        migratedCount: executionResult.migratedCount,
        code: executionResult.code,
        detail: executionResult.detail,
      };
    } catch (unhandledMigrationError) {
      this.currentMigrationStatus = "failed";
      return {
        ok: false,
        status: "failed",
        code: "D137_MIGRATION_ERROR",
        detail:
          unhandledMigrationError instanceof Error
            ? unhandledMigrationError.message
            : String(unhandledMigrationError),
      };
    }
  }

  private async executeMigrationInternal(
    collectionId: string,
    backend: StoreBackend,
    options?: ProductionMigrationOptions
  ): Promise<V1MigrationExecutionResult> {
    if (!backend.isOpen()) {
      await backend.open();
    }

    // 1. Check idempotency: check if already finalized in legacy_archive
    const existingArchive = await backend.runTransaction(
      ["legacy_archive"],
      "readonly",
      async (transaction) => transaction.get<LegacyArchiveRecord>("legacy_archive", collectionId)
    );

    if (
      existingArchive &&
      (existingArchive.stage === "checkpoint_committed" || existingArchive.stage === "finalized")
    ) {
      return {
        ok: true,
        status: "completed",
        migratedCount: existingArchive.rawEntriesCount,
        pendingReplayedCount: existingArchive.rawPendingMutationsCount,
      };
    }

    // 2. Extract v1 data
    const effectiveSnapshotPayload = options?.legacySnapshotPayload;
    const migrationPlan = this.buildPlan(collectionId, effectiveSnapshotPayload, options?.legacyMutationsPayload);

    // A resumed run starts from an empty D-137 store: a partial run wrote its entries under
    // another signing identity, and keeping them would duplicate every item.
    const migratedStateStores = ["entries_state", "mutation_journal", "operation_digests", "sync_outbox", "snapshots"] as const;
    await backend.runTransaction([...migratedStateStores], "readwrite", async (transaction) => {
      for (const storeName of migratedStateStores) await transaction.clear(storeName);
    });

    // 3. Stage 1: Write legacy_archive record
    const archiveRecord: LegacyArchiveRecord = {
      collectionId,
      stage: "archive_written",
      archivedAt: Date.now(),
      rawEntriesCount: migrationPlan.activeEntries.length + migrationPlan.deletedEntries.length,
      rawPendingMutationsCount: migrationPlan.pendingMutations.length,
      replayPlan: [...migrationPlan.pendingMutations],
      rawSnapshotData: effectiveSnapshotPayload,
    };

    await backend.runTransaction(
      ["legacy_archive"],
      "readwrite",
      async (transaction) => transaction.put("legacy_archive", collectionId, archiveRecord)
    );

    if (options?.interruptAtStage === "archive_written") {
      return {
        ok: false,
        status: "pending",
        migratedCount: 0,
        pendingReplayedCount: 0,
        code: "D137_MIGRATION_INTERRUPTED_STAGE_1",
        detail: "Migration safely paused at archive_written stage for recovery testing",
      };
    }

    // 4. Initialize the D-137 engine under a verifiable signing identity
    const signingIdentity = options?.signingIdentity ?? (await createMigrationSigningIdentity(collectionId));
    const migrationReplicaIdentifier = signingIdentity.replicaIdentifier;
    const migrationCertificate = signingIdentity.certificate;
    const migrationEpochNumber = migrationCertificate.epochNumber;
    const migrationKeyIdentifier =
      migrationCertificate.memberBindings[migrationReplicaIdentifier]?.authorKeyId ??
      `key:${migrationReplicaIdentifier}:v1`;

    const targetEngine = new D137Engine(
      collectionId,
      migrationReplicaIdentifier,
      migrationEpochNumber,
      migrationCertificate,
      migrationKeyIdentifier,
      undefined,
      signingIdentity.privateKey
    );

    let currentSequence = 1;
    let migratedTotalCount = 0;
    const combinedEntries = [...migrationPlan.activeEntries, ...migrationPlan.deletedEntries];

    // 5. Migrate entries into D137Engine state
    for (let entryIndex = 0; entryIndex < combinedEntries.length; entryIndex++) {
      const rawEntry = combinedEntries[entryIndex]!;
      const insertDot: CausalDot = {
        epochNumber: migrationEpochNumber,
        replicaId: migrationReplicaIdentifier,
        sequence: currentSequence++,
      };
      const insertStamp: LamportStamp = { lamport: insertDot.sequence, ...insertDot };

      // Legacy snapshot entries are ArrayEntry records (crdt/array.ts): { id, indexKey, value, deleted }.
      const legacyItemValue = rawEntry["value"];
      const itemPayload: Record<string, unknown> =
        rawEntry.fields ??
        (typeof legacyItemValue === "object" && legacyItemValue !== null && !Array.isArray(legacyItemValue)
          ? (legacyItemValue as Record<string, unknown>)
          : {});
      const itemIndexKey =
        rawEntry.indexKey ??
        (combinedEntries.length <= 1 ? "a0" : `a${String(entryIndex).padStart(6, "0")}`);

      const insertOperation = await signMigrationOperation({
        protocolVersion: PROTOCOL_VERSION,
        collectionId,
        epochNumber: migrationEpochNumber,
        epochCertificateId: migrationCertificate.epochCertificateId,
        opDot: insertDot,
        targetIncarnation: insertDot,
        externalId: rawEntry.id,
        stamp: insertStamp,
        kind: "insert",
        indexKey: itemIndexKey,
        leftNeighborIncarnation: null,
        rightNeighborIncarnation: null,
        initialFields: itemPayload,
        authorKeyId: migrationKeyIdentifier,
        payloadDigest: "",
        authorSignature: "",
      }, signingIdentity.privateKey);
      const operationPayloadDigest = insertOperation.payloadDigest;

      const operationIdentifier = `${collectionId}:${insertDot.epochNumber}:${insertDot.replicaId}:${insertDot.sequence}`;
      targetEngine.mutationJournal.set(operationIdentifier, {
        opKey: operationIdentifier,
        collectionId,
        epochNumber: migrationEpochNumber,
        replicaId: migrationReplicaIdentifier,
        sequence: insertDot.sequence,
        operation: insertOperation,
        disposition: "APPLIED",
      });

      targetEngine.operationDigests.set(operationIdentifier, {
        opKey: operationIdentifier,
        collectionId,
        epochNumber: migrationEpochNumber,
        replicaId: migrationReplicaIdentifier,
        sequence: insertDot.sequence,
        status: "APPLIED",
        payloadDigest: operationPayloadDigest,
        observedDigests: [operationPayloadDigest],
      });

      const fieldRegisters: EntryStateRecord["fields"] = {};
      for (const [fieldName, fieldValue] of Object.entries(itemPayload)) {
        fieldRegisters[fieldName] = { value: fieldValue, stamp: insertStamp, present: true };
      }

      const incarnationIdentifier = toIncarnationId(insertDot);
      const createdEntryRecord: EntryStateRecord = {
        targetBirthDot: insertDot,
        externalId: rawEntry.id,
        pos: {
          indexKey: itemIndexKey,
          stamp: insertStamp,
          leftNeighbor: null,
          rightNeighbor: null,
        },
        fields: fieldRegisters,
        deleted: false,
        deleteDots: [],
      };

      targetEngine.entriesState.set(incarnationIdentifier, createdEntryRecord);
      migratedTotalCount++;

      // If entry was deleted, apply delete operation
      if (rawEntry.deleted === true) {
        const deleteDot: CausalDot = {
          epochNumber: migrationEpochNumber,
          replicaId: migrationReplicaIdentifier,
          sequence: currentSequence++,
        };
        const deleteStamp: LamportStamp = { lamport: deleteDot.sequence, ...deleteDot };
        const deleteOperation = await signMigrationOperation({
          protocolVersion: PROTOCOL_VERSION,
          collectionId,
          epochNumber: migrationEpochNumber,
          epochCertificateId: migrationCertificate.epochCertificateId,
          opDot: deleteDot,
          targetIncarnation: insertDot,
          externalId: rawEntry.id,
          stamp: deleteStamp,
          kind: "delete",
          authorKeyId: migrationKeyIdentifier,
          payloadDigest: "",
          authorSignature: "",
        }, signingIdentity.privateKey);

        const deleteIdentifier = `${collectionId}:${deleteDot.epochNumber}:${deleteDot.replicaId}:${deleteDot.sequence}`;
        targetEngine.mutationJournal.set(deleteIdentifier, {
          opKey: deleteIdentifier,
          collectionId,
          epochNumber: migrationEpochNumber,
          replicaId: migrationReplicaIdentifier,
          sequence: deleteDot.sequence,
          operation: deleteOperation,
          disposition: "APPLIED",
        });

        createdEntryRecord.deleted = true;
        createdEntryRecord.deleteDots = [deleteDot];
      }
    }

    // 6. Replay pending offline mutations: never dropped, local-only (D-142 / I19)
    const replayedPendingCount = replayPendingMutations(
      targetEngine.entriesState,
      migrationPlan.pendingMutations,
      () => ({ epochNumber: migrationEpochNumber, replicaId: migrationReplicaIdentifier, sequence: currentSequence++ })
    );

    // Advance the local stream past every dot used above, so new writes never reuse one.
    const lastUsedSequence = currentSequence - 1;
    const localStreamKey = `${migrationEpochNumber}:${migrationReplicaIdentifier}`;
    targetEngine.meta.nextLocalSequence = Math.max(targetEngine.meta.nextLocalSequence, currentSequence);
    targetEngine.meta.localLamport = Math.max(targetEngine.meta.localLamport, lastUsedSequence);
    targetEngine.meta.frontiers.localDurableFrontier[localStreamKey] = lastUsedSequence;
    targetEngine.meta.frontiers.knownProducedFrontier[localStreamKey] = lastUsedSequence;

    // 7. Commit first verified checkpoint (snapshots v2)
    commitCheckpoint(
      targetEngine.meta,
      targetEngine.entriesState,
      targetEngine.snapshotsV2,
      targetEngine.mutationJournal
    );

    // 8. Write state to backend within Tx #11 legacy migration transaction
    await runTx11LegacyMigration(backend, async (transaction) => {
      // Persist entries_state
      for (const [incarnationKey, entryRecord] of targetEngine.entriesState.entries()) {
        await transaction.put("entries_state", incarnationKey, entryRecord);
      }
      // Persist mutation_journal
      for (const [operationKey, journalRecord] of targetEngine.mutationJournal.entries()) {
        await transaction.put("mutation_journal", operationKey, journalRecord);
      }
      // Persist replica_meta
      await transaction.put("replica_meta", collectionId, targetEngine.meta);
    });

    // Stage 2: entries are durable; the checkpoint is not yet committed.
    await backend.runTransaction(["legacy_archive"], "readwrite", async (transaction) => {
      await transaction.put("legacy_archive", collectionId, { ...archiveRecord, stage: "entries_migrated" });
    });
    if (options?.interruptAtStage === "entries_migrated") {
      return {
        ok: false,
        status: "pending",
        migratedCount: migratedTotalCount,
        pendingReplayedCount: replayedPendingCount,
        code: "D137_MIGRATION_INTERRUPTED_STAGE_2",
        detail: "Migration paused at entries_migrated stage for recovery testing",
      };
    }

    // Write snapshots within checkpoint transaction
    await backend.runTransaction(["snapshots"], "readwrite", async (transaction) => {
      for (const [sequenceNumber, snapshotRecord] of targetEngine.snapshotsV2.entries()) {
        await transaction.put("snapshots", sequenceNumber, snapshotRecord);
      }
    });

    // 9. Record the committed checkpoint. finalizeMigration() deletes the legacy data later.
    const checkpointArchiveRecord: LegacyArchiveRecord = {
      ...archiveRecord,
      stage: "checkpoint_committed",
    };

    await backend.runTransaction(["legacy_archive"], "readwrite", async (transaction) => {
      await transaction.put("legacy_archive", collectionId, checkpointArchiveRecord);
    });

    return {
      ok: true,
      status: "completed",
      migratedCount: migratedTotalCount,
      pendingReplayedCount: replayedPendingCount,
    };
  }
}
