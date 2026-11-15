/**
 * @dotmix/sync — Production Protocol Engine & Facade (Gate 33 / D-137)
 */

import {
  allocateLocalMutation as allocateLocal,
  enqueueCollectionAllocation,
  type LocalMutationPayloadInput,
} from "./allocate.js";
import {
  ingestRemoteOperation as ingestRemote,
  recordEpochClosed as recordClosed,
} from "./ingest.js";
import {
  createInitialReplicaMeta,
  executeEnableRemoteSync,
  executeSelfCertifiedEpochAdvance,
  ingestEpochTransitionCertificate as ingestTransition,
  resumeActivation as resumeAct,
} from "./lifecycle.js";
import { createFoundingSnapshot } from "./snapshots.js";
import type {
  EntryStateRecord,
  EpochMembershipCertificate,
  InboundDependencyBufferRecord,
  InboundGapBufferRecord,
  InTransactionContext,
  MutationJournalRecord,
  OperationDigestRecord,
  OperationDisposition,
  QuarantineRecord,
  ReplicaMetaRecord,
  ReplicableOperation,
  SnapshotRecord,
  SyncOutboxRecord,
  TabLeaseRecord,
  TransportChannelPrincipal,
} from "./types.js";

const SECURITY_KEYS = new Set([
  "epochNumber",
  "epochCertificateId",
  "epochCertificate",
  "epochMemberBindings",
  "revokedKeyIds",
  "leaseHolderTabId",
  "leaseFencingTerm",
]);

function deepFreeze<T>(targetObject: T): T {
  if (targetObject && typeof targetObject === "object" && !Object.isFrozen(targetObject)) {
    Object.freeze(targetObject);
    for (const key of Object.keys(targetObject)) {
      deepFreeze((targetObject as Record<string, unknown>)[key]);
    }
  }
  return targetObject;
}

export function makeReactiveMeta(raw: ReplicaMetaRecord): ReplicaMetaRecord {
  if (raw.securityStateVersion === undefined) {
    raw.securityStateVersion = 1;
  }
  for (const key of SECURITY_KEYS) {
    const fieldValue = (raw as unknown as Record<string, unknown>)[key];
    if (fieldValue && typeof fieldValue === "object") {
      deepFreeze(fieldValue);
    }
  }
  return new Proxy(raw, {
    set(target, prop, value, receiver) {
      if (SECURITY_KEYS.has(prop as string)) {
        target.securityStateVersion = (target.securityStateVersion ?? 0) + 1;
        if (value && typeof value === "object") {
          deepFreeze(value);
        }
      }
      return Reflect.set(target, prop, value, receiver);
    },
  });
}

export class D137Engine {
  public meta: ReplicaMetaRecord;
  public entriesState = new Map<string, EntryStateRecord>();
  public snapshotsV2 = new Map<number, SnapshotRecord>();
  public mutationJournal = new Map<string, MutationJournalRecord>();
  public operationDigests = new Map<string, OperationDigestRecord>();
  public syncOutbox = new Map<string, SyncOutboxRecord>();
  public inboundGapBuffer = new Map<string, InboundGapBufferRecord>();
  public inboundDependencyBuffer = new Map<string, InboundDependencyBufferRecord>();
  public quarantineJournal = new Map<string, QuarantineRecord>();
  public tabLeases = new Map<string, TabLeaseRecord>();
  public authorPrivateKey?: CryptoKey | string | undefined;

  public enqueueAllocation<T>(actionTask: () => Promise<T>): Promise<T> {
    return enqueueCollectionAllocation(this.meta.collectionId, this.meta.replicaId, actionTask);
  }

  constructor(
    collectionId: string,
    replicaId: string,
    epochNumber: number,
    epochCertificate: EpochMembershipCertificate,
    authorKeyId: string,
    authorPrivateKeyHex?: string,
    authorPrivateKey?: CryptoKey | string
  ) {
    this.authorPrivateKey = authorPrivateKey ?? authorPrivateKeyHex;
    this.meta = makeReactiveMeta(
      createInitialReplicaMeta(
        collectionId,
        replicaId,
        epochNumber,
        epochCertificate,
        authorKeyId,
        authorPrivateKeyHex
      )
    );
    this.snapshotsV2.set(0, createFoundingSnapshot(collectionId, epochNumber, epochCertificate));
  }

  public async selfCertifyEpochAdvance(): Promise<{ ok: boolean; code?: string | undefined; detail?: string | undefined }> {
    return executeSelfCertifiedEpochAdvance(this);
  }

  public async ingestEpochTransitionCertificate(
    cert: EpochMembershipCertificate
  ): Promise<{ ok: boolean; code?: string | undefined; detail?: string | undefined }> {
    return ingestTransition(this, cert);
  }

  public async resumeActivation(
    coordinatorCert?: EpochMembershipCertificate | undefined
  ): Promise<{ ok: boolean; code?: string | undefined; detail?: string | undefined }> {
    return resumeAct(this, coordinatorCert);
  }

  public getTxContext(): InTransactionContext {
    return {
      meta: this.meta,
      entriesState: this.entriesState,
      mutationJournal: this.mutationJournal,
      operationDigests: this.operationDigests,
      syncOutbox: this.syncOutbox,
      inboundGapBuffer: this.inboundGapBuffer,
      inboundDependencyBuffer: this.inboundDependencyBuffer,
      quarantineJournal: this.quarantineJournal,
      snapshotsV2: this.snapshotsV2,
    };
  }

  public allocateLocalMutation(
    input: LocalMutationPayloadInput,
    callerTabId = "tab-primary",
    expectedFencingTerm = 1
  ): Promise<{ ok: boolean; op?: ReplicableOperation | undefined; code?: string | undefined; detail?: string | undefined }> {
    return allocateLocal(this, input, callerTabId, expectedFencingTerm);
  }

  public async ingestRemoteOperation(
    op: ReplicableOperation,
    channelPrincipal: TransportChannelPrincipal,
    callerTabId = "tab-primary",
    expectedFencingTerm = 1
  ): Promise<{ ok: boolean; disposition?: OperationDisposition | undefined; code?: string | undefined; detail?: string | undefined }> {
    return ingestRemote(this, op, channelPrincipal, callerTabId, expectedFencingTerm);
  }

  public recordEpochClosed(
    op: ReplicableOperation,
    detail?: string | undefined
  ): { ok: false; code: string; disposition: "D137_EPOCH_CLOSED"; detail?: string | undefined } {
    return recordClosed(this, op, detail);
  }

  public async enableRemoteSync(
    mode: "SEED_NEW_REMOTE_EPOCH" | "JOIN_EXISTING_REMOTE_CLUSTER",
    coordinatorCertOrRemoteSnapshot?: EpochMembershipCertificate | SnapshotRecord | undefined,
    assignedReplicaId?: string | undefined
  ): Promise<{ ok: boolean; code?: string | undefined; detail?: string | undefined }> {
    return executeEnableRemoteSync(this, mode, coordinatorCertOrRemoteSnapshot, assignedReplicaId);
  }
}
