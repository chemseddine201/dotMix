/**
 * @dotmix/sync — Storage Resolution & Engine Boot Initialization
 *
 * Implements store backend resolution, v1->v2 migration invocation,
 * boot recovery, unique replica ID allocation, ECDSA P-256 self-signed
 * founding certificate generation, multi-tab coordination, and batch flushing.
 * Zero external dependencies.
 */

import type { SyncChannel, SyncCollectionOptions, SyncStatus } from "../types.js";
import { ReplicationEngine } from "../protocol/engine.js";
import type { ReplicableOperation, TransportChannelPrincipal } from "../protocol/types.js";
import { generateSigningKeyPair } from "../protocol/signing.js";
import { type StoreBackend, MemoryStoreBackend } from "../storage/memory-backend.js";
import { IndexedDbStoreBackend } from "../storage/idb-tx.js";
import { persistEngineToStore, recoverFromStoreOnBoot } from "../storage/boot-recovery.js";
import { ProductionV1MigrationRunner } from "../migration/runner.js";
import { readLegacyCollection } from "../migration/legacy-source.js";
import { createMigrationSigningIdentity } from "../migration/signing-identity.js";
import { collectionDatabaseName } from "../storage/idb-schema.js";
import { loadSigningKey, saveSigningKey } from "./signing-key-store.js";
import { MultiTabCoordinator } from "../transport/multi-tab.js";
import { createWireEnvelope } from "../transport/envelope.js";
import { createDiagnosticsController, type DiagnosticsController } from "../diagnostics/index.js";
import {
  createDefaultFoundingCertificate,
  createSelfSignedFoundingCertificateAsync,
} from "./compensation.js";
import { populateInitialEntries } from "./projection.js";
import { processRemoteWireEnvelope } from "./remote-handler.js";

export function resolveStoreBackend(driverOption: unknown, collectionIdentifier: string): StoreBackend {
  if (
    driverOption &&
    typeof driverOption === "object" &&
    typeof (driverOption as StoreBackend).runTransaction === "function"
  ) {
    return driverOption as StoreBackend;
  }
  if (driverOption === "memory") {
    return new MemoryStoreBackend();
  }
  if (driverOption === "indexeddb") {
    if (typeof globalThis.indexedDB !== "undefined" && globalThis.indexedDB !== null) {
      return new IndexedDbStoreBackend(collectionDatabaseName(collectionIdentifier));
    }
    console.warn("@dotmix/sync: IndexedDB is not available in the current environment; falling back to MemoryStoreBackend.");
    return new MemoryStoreBackend();
  }
  if (typeof globalThis.indexedDB !== "undefined") {
    return new IndexedDbStoreBackend(collectionDatabaseName(collectionIdentifier));
  }
  return new MemoryStoreBackend();
}

export interface AdapterStorageContext {
  storeBackend: StoreBackend;
  engineInstance: ReplicationEngine;
  multiTabCoordinator?: MultiTabCoordinator | undefined;
  activeSyncChannel?: SyncChannel | undefined;
  initialErrorStatus?: SyncStatus | undefined;
  initialErrorCode?: string | undefined;
  diagnosticsController?: DiagnosticsController | undefined;
}

export function createInitialTemporaryEngine(
  collectionIdentifier: string,
  syncEngineOption?: unknown
): ReplicationEngine {
  const initialReplicaId =
    (syncEngineOption as { clientId?: string })?.clientId ?? "init-replica";
  const temporaryCert = createDefaultFoundingCertificate(
    collectionIdentifier,
    initialReplicaId
  );
  return new ReplicationEngine(
    collectionIdentifier,
    initialReplicaId,
    1,
    temporaryCert,
    `key:${initialReplicaId}:v1`
  );
}

export async function initializeAdapterStorage<T>(
  options: SyncCollectionOptions<T>,
  onStoreRefresh: (refreshedEngine: ReplicationEngine) => void,
  onRemoteMessageAccepted: () => Promise<void>,
  onTopologyError: (topologyErrorCode: string) => void
): Promise<AdapterStorageContext> {
  const collectionIdentifier = options.key ?? "default_collection";

  // C4: OPFS persistence is legacy-engine only in release 1
  if (options.driver === "opfs") {
    return {
      storeBackend: new MemoryStoreBackend(),
      engineInstance: createInitialTemporaryEngine(collectionIdentifier, options.syncEngine),
      initialErrorStatus: "error",
      initialErrorCode: "SYNC_OPFS_NOT_SUPPORTED",
    };
  }

  const store = resolveStoreBackend(options.driver, collectionIdentifier);
  if (!store.isOpen()) {
    await store.open();
  }

  // C3: Migration error handling
  try {
    const migrationRunner = new ProductionV1MigrationRunner();
    // The legacy database is read-only input; only IndexedDB stores can have one.
    const legacyData =
      store instanceof IndexedDbStoreBackend ? await readLegacyCollection(collectionIdentifier) : undefined;
    if (await migrationRunner.isMigrationRequired(collectionIdentifier, store, legacyData !== undefined)) {
      const signingIdentity = await createMigrationSigningIdentity(collectionIdentifier);
      const migrationOutcome = await migrationRunner.runV1Migration(collectionIdentifier, store, {
        signingIdentity,
        legacySnapshotPayload: legacyData?.snapshotEntries,
        legacyMutationsPayload: legacyData?.mutations,
      });
      if (migrationOutcome.ok) {
        await saveSigningKey(
          store,
          collectionIdentifier,
          signingIdentity.replicaIdentifier,
          signingIdentity.privateKey
        );
      } else {
        return {
          storeBackend: store,
          engineInstance: createInitialTemporaryEngine(collectionIdentifier, options.syncEngine),
          initialErrorStatus: "error",
          initialErrorCode: migrationOutcome.code ?? "SYNC_MIGRATION_FAILED",
        };
      }
    }
  } catch {
    return {
      storeBackend: store,
      engineInstance: createInitialTemporaryEngine(collectionIdentifier, options.syncEngine),
      initialErrorStatus: "error",
      initialErrorCode: "SYNC_MIGRATION_FAILED",
    };
  }

  // B1: Recover from store on boot
  let recoveredEngine: ReplicationEngine | undefined;
  try {
    const bootOutcome = await recoverFromStoreOnBoot(store, collectionIdentifier);
    if (bootOutcome.ok && bootOutcome.engine) {
      recoveredEngine = bootOutcome.engine;
      const storedSigningKey = await loadSigningKey(
        store,
        collectionIdentifier,
        recoveredEngine.meta.replicaId
      );
      if (storedSigningKey) recoveredEngine.authorPrivateKey = storedSigningKey;
    }
  } catch {
    // Clean start on uninitialized store
  }

  let activeEngine: ReplicationEngine;

  if (recoveredEngine) {
    activeEngine = recoveredEngine;
  } else {
    // B10: Unique random replica ID generated once per store
    const uniqueReplicaId =
      (options.syncEngine as { clientId?: string })?.clientId ??
      `rep_${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "").slice(0, 10) : Math.random().toString(36).slice(2, 10)}`;

    // B2: Non-extractable ECDSA P-256 keys and self-signed founding certificate
    const keyPair = await generateSigningKeyPair("ECDSA_P256", false);
    const foundingCert = await createSelfSignedFoundingCertificateAsync(
      collectionIdentifier,
      uniqueReplicaId,
      keyPair
    );
    activeEngine = new ReplicationEngine(
      collectionIdentifier,
      uniqueReplicaId,
      1,
      foundingCert,
      `key:${uniqueReplicaId}:v1`,
      undefined,
      keyPair.privateKey
    );

    if (options.initialItems && options.initialItems.length > 0) {
      const initialOutcome = populateInitialEntries(
        activeEngine.entriesState,
        options.initialItems,
        activeEngine.meta.replicaId,
        options.idField
      );
      activeEngine.meta.nextLocalSequence = initialOutcome.lastSequence + 1;
      const initialStreamKey = `${activeEngine.meta.epochNumber}:${activeEngine.meta.replicaId}`;
      activeEngine.meta.frontiers.localDurableFrontier[initialStreamKey] = initialOutcome.lastSequence;
      activeEngine.meta.frontiers.knownProducedFrontier[initialStreamKey] = initialOutcome.lastSequence;
    }

    await persistEngineToStore(store, activeEngine);
    await saveSigningKey(store, collectionIdentifier, uniqueReplicaId, keyPair.privateKey);
  }

  // B3: Multi-tab coordination
  let multiTabCoordinator: MultiTabCoordinator | undefined;
  if (typeof globalThis.BroadcastChannel !== "undefined") {
    try {
      const tabIdentifier = `tab_${activeEngine.meta.replicaId}_${Date.now()}`;
      multiTabCoordinator = new MultiTabCoordinator({
        collectionId: collectionIdentifier,
        tabIdentifier,
      });
      multiTabCoordinator.onFollowerRefresh(async () => {
        try {
          const refreshResult = await recoverFromStoreOnBoot(store, collectionIdentifier);
          if (refreshResult.ok && refreshResult.engine) {
            const refreshedSigningKey = await loadSigningKey(
              store,
              collectionIdentifier,
              refreshResult.engine.meta.replicaId
            );
            if (refreshedSigningKey) refreshResult.engine.authorPrivateKey = refreshedSigningKey;
            onStoreRefresh(refreshResult.engine);
          }
        } catch {
          // Ignore refresh race
        }
      });
    } catch {
      // Multi-tab not available in environment
    }
  }

  // C6 S1: Take channel strictly from options.syncEngine
  const candidateChannel =
    (options.syncEngine as unknown as { getChannel?: () => SyncChannel })?.getChannel?.() ??
    (options.syncEngine as unknown as { channel?: SyncChannel })?.channel;

  let activeSyncChannel: SyncChannel | undefined;
  if (candidateChannel) {
    activeSyncChannel = candidateChannel;
    const receiveHandler = async (incomingPacket: unknown) => {
      const candidateEnvelope =
        (incomingPacket as { envelope?: unknown }).envelope ?? incomingPacket;
      const channelPrincipal =
        (candidateChannel as { principal?: TransportChannelPrincipal })?.principal ??
        (incomingPacket as { principal?: TransportChannelPrincipal })?.principal;
      const processingOutcome = await processRemoteWireEnvelope(
        candidateEnvelope,
        activeEngine,
        channelPrincipal
      );

      if (processingOutcome.topologyError) {
        onTopologyError(processingOutcome.topologyError);
      } else if (processingOutcome.accepted) {
        await persistEngineToStore(store, activeEngine);
        await onRemoteMessageAccepted();
      }
    };

    if (typeof candidateChannel.onReceive === "function") {
      candidateChannel.onReceive(receiveHandler);
    } else if (typeof (candidateChannel as { onMessage?: unknown }).onMessage === "function") {
      (candidateChannel as unknown as { onMessage: (h: typeof receiveHandler) => void }).onMessage(receiveHandler);
    }
  }

  const diagnosticsController = createDiagnosticsController(activeEngine);

  return {
    storeBackend: store,
    engineInstance: activeEngine,
    multiTabCoordinator,
    activeSyncChannel,
    diagnosticsController,
  };
}

export async function flushBatchOperations(
  engineInstance: ReplicationEngine,
  storeBackend: StoreBackend | undefined,
  activeSyncChannel: SyncChannel | undefined,
  multiTabCoordinator: MultiTabCoordinator | undefined,
  newlyCommittedOps: readonly ReplicableOperation[]
): Promise<void> {
  // B1 & B8: Persist the entire microtask batch in ONE store transaction!
  if (storeBackend) {
    await persistEngineToStore(storeBackend, engineInstance);
  }

  // B3: Broadcast wire envelopes
  if (newlyCommittedOps.length > 0) {
    const committedKeys: string[] = [];
    for (const committedOp of newlyCommittedOps) {
      committedKeys.push(
        `${committedOp.epochNumber}:${committedOp.opDot.replicaId}:${committedOp.opDot.sequence}`
      );
      const wireEnvelope = createWireEnvelope(
        "op",
        engineInstance.meta.collectionId,
        engineInstance.meta.replicaId,
        committedOp
      );
      if (activeSyncChannel) {
        await activeSyncChannel.send({
          clientId: engineInstance.meta.replicaId,
          mutations: [],
          envelope: wireEnvelope,
        });
      }
    }
    if (multiTabCoordinator) {
      multiTabCoordinator.broadcastPostCommitRefresh(committedKeys);
    }
  }
}

export async function flushBatchWithBackpressure(
  engineInstance: ReplicationEngine,
  storeBackend: StoreBackend | undefined,
  activeSyncChannel: SyncChannel | undefined,
  multiTabCoordinator: MultiTabCoordinator | undefined,
  newlyCommittedOps: readonly ReplicableOperation[],
  onQuotaExceeded: () => void
): Promise<void> {
  try {
    await flushBatchOperations(
      engineInstance,
      storeBackend,
      activeSyncChannel,
      multiTabCoordinator,
      newlyCommittedOps
    );
  } catch (flushError: unknown) {
    const isQuotaExceeded =
      (flushError instanceof DOMException && flushError.name === "QuotaExceededError") ||
      (flushError instanceof Error &&
        (flushError.name === "QuotaExceededError" || flushError.message.includes("QuotaExceeded")));
    if (isQuotaExceeded) {
      onQuotaExceeded();
    }
    throw flushError;
  }
}
