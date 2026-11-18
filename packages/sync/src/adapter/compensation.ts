/**
 * @dotmix/sync — Compensating Mutation Helpers
 *
 * Computes compensating operations upon coordinator rejection or client rollback.
 * Guarantees monotonic append-only CRDT history: prior register values are restored
 * without destructive deletion of historical journal entries.
 * Zero external dependencies.
 */

import type { Mutation, MutationId } from "../types.js";
import {
  type EntryStateRecord,
  type EpochMemberKeyBinding,
  type EpochMembershipCertificate,
  PROTOCOL_VERSION,
} from "../protocol/types.js";
import type { LocalMutationPayloadInput } from "../protocol/allocate.js";
import { canonicalizeValue } from "../protocol/canonical.js";
import { signPayloadAsync, type LocalKeyPair } from "../protocol/signing.js";
import type { PendingIntent, PendingIntentKind } from "./contract.js";

export interface RecordedMutationHistoryEntry<T = unknown> {
  readonly mutationRecord: Mutation<T>;
  readonly targetExternalId: string;
  readonly priorFields?: Record<string, unknown> | undefined;
  readonly priorIndexKey?: string | undefined;
  readonly createdAt: number;
}

export function resolveItemIdentifier<T>(
  itemRecord: T,
  identifierField?: keyof T | ((candidateItem: T) => string)
): string {
  if (typeof identifierField === "function") {
    return identifierField(itemRecord);
  }
  if (typeof identifierField === "string" && itemRecord && typeof itemRecord === "object") {
    return String((itemRecord as Record<string, unknown>)[identifierField as string]);
  }
  const candidateRecord = itemRecord as { id?: unknown; key?: unknown };
  if (candidateRecord?.id !== undefined) return String(candidateRecord.id);
  if (candidateRecord?.key !== undefined) return String(candidateRecord.key);
  return String(itemRecord);
}

export async function createSelfSignedFoundingCertificateAsync(
  collectionIdentifier: string,
  replicaIdentifier: string,
  keyPair: LocalKeyPair
): Promise<EpochMembershipCertificate> {
  const authorKeyId = `key:${replicaIdentifier}:v1`;
  const memberBindings: Record<string, EpochMemberKeyBinding> = {
    [replicaIdentifier]: {
      role: "WRITER_REPLICA",
      authorKeyId,
      authorPublicKeyHex: keyPair.publicKeyHex,
      signingAlgorithm: "ECDSA_P256",
    },
  };
  const baselineStableFrontier: Record<string, number> = {
    [`1:${replicaIdentifier}`]: 0,
  };
  const unsignedPayload = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: collectionIdentifier,
    epochNumber: 1,
    epochCertificateId: `cert:${collectionIdentifier}:1`,
    coordinatorReplicaId: replicaIdentifier,
    coordinatorKeyId: authorKeyId,
    memberBindings,
    baselineStableFrontier,
  };
  const canonicalPayload = canonicalizeValue(unsignedPayload);
  const coordinatorSignature = await signPayloadAsync(
    canonicalPayload,
    keyPair.privateKey,
    "ECDSA_P256"
  );
  return {
    ...unsignedPayload,
    coordinatorSignature,
  };
}

export function createDefaultFoundingCertificate(
  collectionIdentifier: string,
  replicaIdentifier: string,
  publicKeyHex = "00".repeat(64),
  coordinatorSignature = "00".repeat(64)
): EpochMembershipCertificate {
  const authorKeyId = `key:${replicaIdentifier}:v1`;
  return {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: collectionIdentifier,
    epochNumber: 1,
    epochCertificateId: `cert:${collectionIdentifier}:1`,
    coordinatorReplicaId: replicaIdentifier,
    coordinatorKeyId: authorKeyId,
    memberBindings: {
      [replicaIdentifier]: {
        role: "WRITER_REPLICA",
        authorKeyId,
        authorPublicKeyHex: publicKeyHex,
        signingAlgorithm: "ECDSA_P256",
      },
    },
    baselineStableFrontier: {
      [`1:${replicaIdentifier}`]: 0,
    },
    coordinatorSignature,
  };
}

export function buildMutationRecord<T>(
  replicaIdentifier: string,
  collectionIdentifier: string,
  operationKind: "insert" | "update" | "delete" | "move" | "clear",
  payloadData: T,
  sequenceCounter: number
): Mutation<T> {
  const mutationIdentifier: MutationId = {
    timestamp: Date.now(),
    clientId: replicaIdentifier,
    sequence: sequenceCounter,
  };
  return {
    id: mutationIdentifier,
    idStr: `${mutationIdentifier.timestamp}-${mutationIdentifier.clientId}-${mutationIdentifier.sequence}`,
    storeKey: collectionIdentifier,
    op: operationKind,
    payload: payloadData,
    state: "pending",
    createdAt: Date.now(),
  };
}

export function buildPendingIntent<T>(
  collectionIdentifier: string,
  intentKind: PendingIntentKind,
  targetExternalId: string,
  associatedMutation: Mutation<unknown>,
  intentDetails?: {
    indexKey?: string | undefined;
    targetIndex?: number | undefined;
    fullFields?: T | undefined;
    partialFields?: Partial<T> | undefined;
  }
): PendingIntent<T> {
  return {
    intentId: associatedMutation.idStr,
    collectionId: collectionIdentifier,
    kind: intentKind,
    externalId: targetExternalId,
    createdAt: associatedMutation.createdAt,
    indexKey: intentDetails?.indexKey,
    targetIndex: intentDetails?.targetIndex,
    fullFields: intentDetails?.fullFields,
    partialFields: intentDetails?.partialFields,
    associatedMutation,
  };
}

export function createCompensatingAllocationInput<T>(
  historyEntry: RecordedMutationHistoryEntry<T>,
  winningLiveEntry?: EntryStateRecord | undefined
): LocalMutationPayloadInput | undefined {
  const targetExternalId = historyEntry.targetExternalId;
  const originalOperation = historyEntry.mutationRecord.op;

  switch (originalOperation) {
    case "insert": {
      if (!winningLiveEntry || winningLiveEntry.deleted) return undefined;
      return {
        kind: "delete",
        externalId: targetExternalId,
        targetIncarnation: winningLiveEntry.targetBirthDot,
      };
    }

    case "update": {
      if (!winningLiveEntry || winningLiveEntry.deleted || !historyEntry.priorFields) return undefined;
      return {
        kind: "update",
        externalId: targetExternalId,
        targetIncarnation: winningLiveEntry.targetBirthDot,
        partialFields: historyEntry.priorFields,
      };
    }

    case "move": {
      if (!winningLiveEntry || winningLiveEntry.deleted || !historyEntry.priorIndexKey) return undefined;
      return {
        kind: "move",
        externalId: targetExternalId,
        targetIncarnation: winningLiveEntry.targetBirthDot,
        newIndexKey: historyEntry.priorIndexKey,
        basePosStamp: winningLiveEntry.pos.stamp,
      };
    }

    case "delete": {
      if (!historyEntry.priorFields) return undefined;
      return {
        kind: "insert",
        externalId: targetExternalId,
        indexKey: historyEntry.priorIndexKey ?? "a0",
        initialFields: historyEntry.priorFields,
      };
    }

    default:
      return undefined;
  }
}
