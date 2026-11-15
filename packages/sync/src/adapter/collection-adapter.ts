/**
 * @dotmix/sync — D-137 Collection Adapter (Gate 34 / T-34.1)
 *
 * Implements the SyncCollection<T> facade backed by the D-137 protocol engine,
 * optimistic overlay reconciliation, D-146 compensating rollback, and
 * microtask transaction coalescing.
 * Zero external dependencies.
 */

import { signal } from "@dotmix/runtime";
import type {
  Mutation,
  SyncChannel,
  SyncCollectionOptions,
  SyncStatus,
} from "../types.js";
import { getDefaultSyncEngine, type SyncEngine as SyncEngineType } from "../engine/engine.js";
import { generateKeyBetween } from "../crdt/fractional.js";
import type { D137Engine } from "../protocol/engine.js";
import type { CausalDot, ReplicableOperation } from "../protocol/types.js";
import type { StoreBackend } from "../storage/memory-backend.js";
import { ProductionV1MigrationRunner } from "../migration/runner.js";
import type { MultiTabCoordinator } from "../transport/multi-tab.js";
import type {
  D137CollectionAdapter,
  MigrationRunner,
  OverlayHost,
  TransportHost,
} from "./contract.js";
import { DefaultOverlayHost } from "../overlay/host.js";
import {
  buildMutationRecord, buildPendingIntent, createCompensatingAllocationInput,
  resolveItemIdentifier, type RecordedMutationHistoryEntry,
} from "./compensation.js";
import {
  computeCommittedItems, detectConflictedExternalIds, findAllLiveEntries,
  findWinningLiveEntry, populateInitialEntries, resolveNeighborPositions,
} from "./projection.js";
import { processRemoteMutation } from "./remote-handler.js";
import {
  createInitialTemporaryEngine, flushBatchOperations, flushBatchWithBackpressure, initializeAdapterStorage,
} from "./storage-init.js";

let hasWarnedCompactDeprecation = false;

export class D137CollectionAdapterImpl<T> implements D137CollectionAdapter<T> {
  public engineInstance: D137Engine;
  public readonly overlayHost: OverlayHost<T>;
  public readonly migrationRunner: MigrationRunner = new ProductionV1MigrationRunner();
  public readonly transportHost?: TransportHost | undefined;
  public readonly options: SyncCollectionOptions<T>;
  public readonly ready: Promise<void>;
  private storeBackend?: StoreBackend | undefined;
  public isBackpressure: boolean = false;
  private multiTabCoordinator?: MultiTabCoordinator | undefined;
  private activeSyncChannel?: SyncChannel | undefined;
  private readonly boundSyncEngine?: SyncEngineType | undefined;
  private readonly unregisterSyncStore?: (() => void) | undefined;
  private readonly mutationHistory = new Map<string, RecordedMutationHistoryEntry<T>>();
  private readonly allocatedBirthDots = new Map<string, CausalDot>();

  private statusSignal = signal<SyncStatus>("synced");
  private errorCodeSignal = signal<string | undefined>(undefined);
  private committedItemsSignal = signal<readonly T[]>([]);
  private sequenceCounter = 0;

  // Microtask batching queue for async durable commits
  private scheduledCommitQueue: Array<{
    actionTask: () => Promise<ReplicableOperation | undefined>;
    resolve: () => void;
    reject: (err: unknown) => void;
    intentId?: string | undefined;
  }> = [];
  private microtaskBatchScheduled = false;
  private batchedTransactionCounter = 0;

  public get transactionCount(): number { return this.batchedTransactionCounter; }
  public get engine(): unknown { return this.boundSyncEngine ?? getDefaultSyncEngine(); }

  constructor(options: SyncCollectionOptions<T>) {
    this.options = options;
    const collectionIdentifier = options.key ?? "default_collection";
    this.overlayHost = new DefaultOverlayHost<T>();

    // Initial temporary engine so items() is immediately callable synchronously
    this.engineInstance = createInitialTemporaryEngine(collectionIdentifier, options.syncEngine);

    if (options.syncEngine && typeof (options.syncEngine as { registerStore?: unknown }).registerStore === "function") {
      this.boundSyncEngine = options.syncEngine as SyncEngineType;
      this.unregisterSyncStore = (options.syncEngine as unknown as {
        registerStore: (storeKey: string, handler: unknown) => () => void;
      }).registerStore(collectionIdentifier, {
        applyRemoteMutation: (remoteMutation: Mutation<unknown>): void => {
          void processRemoteMutation(remoteMutation, this.engineInstance).then((outcome) => {
            if (outcome.topologyError) {
              this.statusSignal.set("error");
              this.errorCodeSignal.set(outcome.topologyError);
            } else if (outcome.accepted) {
              this.committedItemsSignal.set(
                computeCommittedItems(this.engineInstance.entriesState, this.options.idField)
              );
              if (this.storeBackend) {
                void flushBatchOperations(
                  this.engineInstance,
                  this.storeBackend,
                  this.activeSyncChannel,
                  this.multiTabCoordinator,
                  []
                );
              }
            }
          });
        },
        rollbackMutation: (mutationIdStr: string): void => this.rollback(mutationIdStr),
        commitMutation: (mutationIdStr: string): void => this.overlayHost.removeIntent(mutationIdStr),
        compact: (_ackWatermarkClock: number): number => this.compact(),
      });
    }

    if (options.initialItems && options.initialItems.length > 0) {
      populateInitialEntries(
        this.engineInstance.entriesState,
        options.initialItems,
        this.engineInstance.meta.replicaId,
        options.idField
      );
      this.committedItemsSignal.set(
        computeCommittedItems(this.engineInstance.entriesState, options.idField)
      );
    }

    this.ready = this.bootStorageContext();
  }

  private async bootStorageContext(): Promise<void> {
    const storageContext = await initializeAdapterStorage<T>(
      this.options,
      (refreshedEngine: D137Engine) => {
        this.engineInstance = refreshedEngine;
        this.committedItemsSignal.set(computeCommittedItems(this.engineInstance.entriesState, this.options.idField));
      },
      async () => {
        this.committedItemsSignal.set(computeCommittedItems(this.engineInstance.entriesState, this.options.idField));
      },
      (topologyError: string) => {
        this.statusSignal.set("error");
        this.errorCodeSignal.set(topologyError);
      }
    );

    this.storeBackend = storageContext.storeBackend;
    this.engineInstance = storageContext.engineInstance;
    this.multiTabCoordinator = storageContext.multiTabCoordinator;
    this.activeSyncChannel = storageContext.activeSyncChannel;

    if (storageContext.initialErrorStatus) {
      this.statusSignal.set(storageContext.initialErrorStatus);
      if (storageContext.initialErrorCode) this.errorCodeSignal.set(storageContext.initialErrorCode);
    }

    this.committedItemsSignal.set(
      computeCommittedItems(this.engineInstance.entriesState, this.options.idField)
    );
  }

  private scheduleDurableCommit(
    actionTask: () => Promise<ReplicableOperation | undefined>,
    intentId?: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.scheduledCommitQueue.push({ actionTask, resolve, reject, intentId });

      if (!this.microtaskBatchScheduled) {
        this.microtaskBatchScheduled = true;
        queueMicrotask(async () => {
          this.microtaskBatchScheduled = false;
          await this.ready;

          const currentBatch = [...this.scheduledCommitQueue];
          this.scheduledCommitQueue = [];
          const newlyCommittedOps: ReplicableOperation[] = [];

          for (const item of currentBatch) {
            try {
              const committedOp = await item.actionTask();
              if (committedOp) newlyCommittedOps.push(committedOp);
            } catch (executionError) {
              item.reject(executionError);
            }
          }

          if (this.storeBackend) {
            this.batchedTransactionCounter++;
          }

          try {
            await flushBatchWithBackpressure(
              this.engineInstance, this.storeBackend, this.activeSyncChannel, this.multiTabCoordinator, newlyCommittedOps,
              () => { this.isBackpressure = true; this.statusSignal.set("error"); this.errorCodeSignal.set("D137_STORAGE_QUOTA_EXCEEDED"); }
            );
            // A successful durable flush ends the QuotaExceededError backpressure state.
            if (this.isBackpressure) { this.isBackpressure = false; this.statusSignal.set("synced"); this.errorCodeSignal.set(undefined); }
            this.committedItemsSignal.set(computeCommittedItems(this.engineInstance.entriesState, this.options.idField));
            for (const item of currentBatch) {
              if (item.intentId) this.overlayHost.removeIntent(item.intentId);
              item.resolve();
            }
          } catch (flushError: unknown) {
            for (const item of currentBatch) item.reject(flushError);
          }
        });
      }
    });
  }

  public readonly items = (): T[] => this.overlayHost.getEffectiveItems(this.committedItemsSignal());
  public readonly status = (): SyncStatus => (this.boundSyncEngine && this.boundSyncEngine.isOnline() === false) ? "offline" : (this.isPending() ? "syncing" : this.statusSignal());
  public readonly errorCode = (): string | undefined => this.errorCodeSignal();
  public readonly isPending = (): boolean => this.pendingCount() > 0;
  public readonly pendingCount = (): number => this.overlayHost.pendingIntents().length;
  public readonly pendingMutations = (): Mutation<unknown>[] => this.overlayHost.pendingIntents().map((pendingIntent) => pendingIntent.associatedMutation);

  public conflictedIds(): string[] {
    return detectConflictedExternalIds(this.engineInstance.entriesState, this.engineInstance.quarantineJournal);
  }

  public compact(_ackWatermarkClock?: number): number {
    if (!hasWarnedCompactDeprecation) {
      hasWarnedCompactDeprecation = true;
      console.warn("@dotmix/sync: compact() is deprecated and no-op under the active sync engine. Storage compaction is managed automatically by certified checkpoints.");
    }
    return 0;
  }

  public async insert(itemToInsert: T, targetIndex?: number): Promise<Mutation<T>> {
    const externalIdentifier = resolveItemIdentifier(itemToInsert, this.options.idField);
    const effectiveItems = this.items();
    const computedTargetIndex = targetIndex !== undefined
      ? Math.max(0, Math.min(targetIndex, effectiveItems.length))
      : effectiveItems.length;

    const { previousKey, nextKey, leftDot, rightDot } = resolveNeighborPositions(
      effectiveItems, computedTargetIndex, this.options.idField, this.engineInstance.entriesState, this.overlayHost
    );
    const computedIndexKey = generateKeyBetween(previousKey, nextKey);
    const mutationPayload = {
      ...(itemToInsert as Record<string, unknown>),
      value: itemToInsert,
      __indexKey: computedIndexKey,
    } as unknown as T;

    const mutationRecord = buildMutationRecord<T>(
      this.engineInstance.meta.replicaId, this.engineInstance.meta.collectionId, "insert", mutationPayload, ++this.sequenceCounter
    );

    this.mutationHistory.set(mutationRecord.idStr, {
      mutationRecord, targetExternalId: externalIdentifier, priorIndexKey: computedIndexKey, createdAt: mutationRecord.createdAt,
    });

    this.overlayHost.addIntent(
      buildPendingIntent<T>(this.engineInstance.meta.collectionId, "insert", externalIdentifier, mutationRecord, {
        indexKey: computedIndexKey, targetIndex: computedTargetIndex, fullFields: itemToInsert,
      })
    );

    await this.scheduleDurableCommit(async () => {
      const outcome = await this.engineInstance.allocateLocalMutation({
        kind: "insert",
        externalId: externalIdentifier,
        indexKey: computedIndexKey,
        leftNeighborIncarnation: leftDot,
        rightNeighborIncarnation: rightDot,
        initialFields: itemToInsert as Record<string, unknown>,
      });
      if (outcome.ok && outcome.op) {
        this.allocatedBirthDots.set(externalIdentifier, outcome.op.opDot);
        return outcome.op;
      }
      return undefined;
    }, mutationRecord.idStr);

    return mutationRecord;
  }

  public async update(itemIdentifier: string, partialUpdate: Partial<T>): Promise<Mutation<Partial<T>>> {
    const winningEntry = findWinningLiveEntry(this.engineInstance.entriesState, itemIdentifier);
    const recordedPriorFields: Record<string, unknown> = {};

    if (winningEntry) {
      for (const fieldName of Object.keys(partialUpdate)) {
        const existingRegister = winningEntry.fields[fieldName];
        recordedPriorFields[fieldName] = existingRegister && existingRegister.present ? existingRegister.value : undefined;
      }
    }

    const mutationPayload = {
      id: itemIdentifier, changes: partialUpdate, value: partialUpdate, ...(partialUpdate as Record<string, unknown>),
    } as unknown as Partial<T>;

    const mutationRecord = buildMutationRecord<Partial<T>>(
      this.engineInstance.meta.replicaId, this.engineInstance.meta.collectionId, "update", mutationPayload, ++this.sequenceCounter
    );

    this.mutationHistory.set(mutationRecord.idStr, {
      mutationRecord, targetExternalId: itemIdentifier, priorFields: recordedPriorFields, createdAt: mutationRecord.createdAt,
    });

    this.overlayHost.addIntent(
      buildPendingIntent<T>(this.engineInstance.meta.collectionId, "update", itemIdentifier, mutationRecord, {
        partialFields: partialUpdate,
      })
    );

    await this.scheduleDurableCommit(async () => {
      const winning = findWinningLiveEntry(this.engineInstance.entriesState, itemIdentifier);
      const targetDot = winning?.targetBirthDot ?? this.allocatedBirthDots.get(itemIdentifier);
      if (!targetDot) return undefined;

      const outcome = await this.engineInstance.allocateLocalMutation({
        kind: "update",
        externalId: itemIdentifier,
        targetIncarnation: targetDot,
        partialFields: partialUpdate as Record<string, unknown>,
      });
      return (outcome.ok && outcome.op) ? outcome.op : undefined;
    }, mutationRecord.idStr);

    return mutationRecord;
  }

  public async delete(itemIdentifier: string): Promise<Mutation<string>> {
    const liveEntries = findAllLiveEntries(this.engineInstance.entriesState, itemIdentifier);
    const winningEntry = findWinningLiveEntry(this.engineInstance.entriesState, itemIdentifier);
    const recordedPriorFields: Record<string, unknown> = {};

    if (winningEntry) {
      for (const [fieldName, fieldRegister] of Object.entries(winningEntry.fields)) {
        if (fieldRegister.present) recordedPriorFields[fieldName] = fieldRegister.value;
      }
    }

    const mutationRecord = buildMutationRecord<string>(
      this.engineInstance.meta.replicaId, this.engineInstance.meta.collectionId, "delete", itemIdentifier, ++this.sequenceCounter
    );

    this.mutationHistory.set(mutationRecord.idStr, {
      mutationRecord, targetExternalId: itemIdentifier, priorFields: recordedPriorFields, createdAt: mutationRecord.createdAt,
    });
    this.overlayHost.addIntent(
      buildPendingIntent<T>(this.engineInstance.meta.collectionId, "delete", itemIdentifier, mutationRecord)
    );

    await this.scheduleDurableCommit(async () => {
      const currentLive = findAllLiveEntries(this.engineInstance.entriesState, itemIdentifier);
      const targetEntries = currentLive.length > 0 ? currentLive : liveEntries;
      if (targetEntries.length === 0) return undefined;
      let lastDeletedOp: ReplicableOperation | undefined;

      for (const liveEntry of targetEntries) {
        const outcome = await this.engineInstance.allocateLocalMutation({
          kind: "delete",
          externalId: itemIdentifier,
          targetIncarnation: liveEntry.targetBirthDot,
        });
        if (outcome.ok && outcome.op) lastDeletedOp = outcome.op;
      }
      return lastDeletedOp;
    }, mutationRecord.idStr);

    return mutationRecord;
  }

  public async reorder(fromIndex: number, toIndex: number): Promise<Mutation<unknown>> {
    const currentEffective = this.items();
    if (fromIndex < 0 || fromIndex >= currentEffective.length || toIndex < 0 || toIndex >= currentEffective.length) {
      throw new Error(`[syncCollection] Invalid fromIndex ${fromIndex}`);
    }
    if (fromIndex === toIndex) {
      return buildMutationRecord<{ fromIndex: number; toIndex: number }>(
        this.engineInstance.meta.replicaId, this.engineInstance.meta.collectionId, "move", { fromIndex, toIndex }, ++this.sequenceCounter
      ) as unknown as Mutation<unknown>;
    }

    const itemToMove = currentEffective[fromIndex]!;
    const itemIdentifier = resolveItemIdentifier(itemToMove, this.options.idField);
    const remainingItems = currentEffective.filter((_, itemCandidateIndex) => itemCandidateIndex !== fromIndex);
    const clampedTargetIndex = Math.max(0, Math.min(toIndex, remainingItems.length));

    const { previousKey, nextKey, leftDot, rightDot } = resolveNeighborPositions(
      remainingItems, clampedTargetIndex, this.options.idField, this.engineInstance.entriesState, this.overlayHost
    );
    const computedNewIndexKey = generateKeyBetween(previousKey, nextKey);
    const winningEntry = findWinningLiveEntry(this.engineInstance.entriesState, itemIdentifier);

    const mutationRecord = buildMutationRecord<{ fromIndex: number; toIndex: number; id: string; __indexKey: string }>(
      this.engineInstance.meta.replicaId,
      this.engineInstance.meta.collectionId,
      "move",
      { fromIndex, toIndex, id: itemIdentifier, __indexKey: computedNewIndexKey },
      ++this.sequenceCounter
    );

    this.mutationHistory.set(mutationRecord.idStr, {
      mutationRecord: mutationRecord as unknown as Mutation<T>,
      targetExternalId: itemIdentifier,
      priorIndexKey: winningEntry?.pos.indexKey,
      createdAt: mutationRecord.createdAt,
    });

    this.overlayHost.addIntent(
      buildPendingIntent<T>(this.engineInstance.meta.collectionId, "move", itemIdentifier, mutationRecord as unknown as Mutation<T>, {
        indexKey: computedNewIndexKey, targetIndex: clampedTargetIndex,
      })
    );

    await this.scheduleDurableCommit(async () => {
      const winning = findWinningLiveEntry(this.engineInstance.entriesState, itemIdentifier);
      const targetDot = winning?.targetBirthDot ?? this.allocatedBirthDots.get(itemIdentifier);
      if (!targetDot) return undefined;

      const outcome = await this.engineInstance.allocateLocalMutation({
        kind: "move",
        externalId: itemIdentifier,
        targetIncarnation: targetDot,
        newIndexKey: computedNewIndexKey,
        leftNeighborIncarnation: leftDot,
        rightNeighborIncarnation: rightDot,
      });
      return (outcome.ok && outcome.op) ? outcome.op : undefined;
    }, mutationRecord.idStr);

    return mutationRecord as unknown as Mutation<unknown>;
  }

  public async clear(): Promise<void> {
    const liveIncarnations = [...this.engineInstance.entriesState.values()]
      .filter((entryCandidate) => !entryCandidate.deleted)
      .map((entryCandidate) => entryCandidate.targetBirthDot);

    const mutationRecord = buildMutationRecord<null>(
      this.engineInstance.meta.replicaId, this.engineInstance.meta.collectionId, "clear", null, ++this.sequenceCounter
    );
    this.overlayHost.addIntent(
      buildPendingIntent<T>(this.engineInstance.meta.collectionId, "clear", "*", mutationRecord as unknown as Mutation<T>)
    );

    await this.scheduleDurableCommit(async () => {
      const chunkSize = 2000;
      let lastClearOp: ReplicableOperation | undefined;
      for (let chunkOffset = 0; chunkOffset < liveIncarnations.length; chunkOffset += chunkSize) {
        const targetChunk = liveIncarnations.slice(chunkOffset, chunkOffset + chunkSize);
        const outcome = await this.engineInstance.allocateLocalMutation({ kind: "clear", targetIncarnations: targetChunk });
        if (outcome.ok && outcome.op) lastClearOp = outcome.op;
      }
      return lastClearOp;
    }, mutationRecord.idStr);
  }

  public rollback(targetMutationIdStr?: string): void {
    if (targetMutationIdStr) {
      let historyEntry = this.mutationHistory.get(targetMutationIdStr);
      let foundKey = targetMutationIdStr;
      if (!historyEntry) {
        for (const [recordedKey, candidateEntry] of this.mutationHistory.entries()) {
          if (candidateEntry.targetExternalId === targetMutationIdStr) { historyEntry = candidateEntry; foundKey = recordedKey; break; }
        }
      }
      if (historyEntry) {
        const winning = findWinningLiveEntry(this.engineInstance.entriesState, historyEntry.targetExternalId);
        const compensatingInput = createCompensatingAllocationInput(historyEntry, winning);
        if (compensatingInput) {
          void this.scheduleDurableCommit(async () => {
            const outcome = await this.engineInstance.allocateLocalMutation(compensatingInput);
            return outcome.ok ? outcome.op : undefined;
          });
        }
        this.overlayHost.removeIntent(foundKey);
        this.mutationHistory.delete(foundKey);
      }
    } else {
      this.overlayHost.clearIntents();
    }
    this.committedItemsSignal.set(computeCommittedItems(this.engineInstance.entriesState, this.options.idField));
  }

  public async close(): Promise<void> {
    await this.ready;
    this.unregisterSyncStore?.();
    this.multiTabCoordinator?.dispose();
    if (this.storeBackend) await this.storeBackend.close();
  }
}

export const createD137CollectionAdapter = <T>(options: SyncCollectionOptions<T>): D137CollectionAdapter<T> =>
  new D137CollectionAdapterImpl<T>(options);
