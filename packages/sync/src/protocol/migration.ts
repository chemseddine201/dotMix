/**
 * @dotmix/sync — Legacy v1 Migration with Full Deleted-State & Cryptographic Identity Preservation
 * Ratified: Migration ops are local-only, preserve order/indexKey, replay pending mutations, use meta.epochNumber.
 */

import { toIncarnationId, toOperationKey } from "./apply.js";
import { computeOperationDigest, computeOperationSigningPayload, signPayloadAsync } from "./signing.js";
import { commitCheckpoint } from "./snapshots.js";
import { PROTOCOL_VERSION } from "./types.js";
import type {
  CausalDot,
  EntryStateRecord,
  LamportStamp,
  MutationJournalRecord,
  OperationDigestRecord,
  ReplicaMetaRecord,
  ReplicableOperation,
  SnapshotRecord,
} from "./types.js";

export interface LegacyV1EntryInput {
  id: string;
  fields?: Record<string, unknown> | undefined;
  deleted: boolean;
  indexKey?: string | undefined;
  mutationId?: { wallMs?: number | undefined; timestamp?: number | undefined; clientId: string; sequence: number } | undefined;
}

export interface LegacyV1PendingMutationInput {
  id?: string | undefined;
  targetId?: string | undefined;
  op: "insert" | "update" | "delete" | "move" | "set";
  fields?: Record<string, unknown> | undefined;
  partial?: Record<string, unknown> | undefined;
  value?: unknown;
  indexKey?: string | undefined;
  newIndexKey?: string | undefined;
  mutationId?: { wallMs?: number | undefined; timestamp?: number | undefined; clientId: string; sequence: number } | undefined;
}

async function recordMigrationOp(
  meta: ReplicaMetaRecord,
  mutationJournal: Map<string, MutationJournalRecord>,
  operationDigests: Map<string, OperationDigestRecord>,
  draftOp: ReplicableOperation,
  migrationPrivateKeyHex: string
): Promise<ReplicableOperation> {
  const digest = computeOperationDigest(draftOp);
  const sigPayload = computeOperationSigningPayload({ ...draftOp, payloadDigest: digest });
  const sig = await signPayloadAsync(sigPayload, migrationPrivateKeyHex, "Ed25519");
  const signedOp: ReplicableOperation = {
    ...draftOp,
    payloadDigest: digest,
    authorSignature: sig,
  };
  const opKey = toOperationKey(meta.collectionId, draftOp.opDot);
  mutationJournal.set(opKey, {
    opKey,
    collectionId: meta.collectionId,
    epochNumber: draftOp.epochNumber,
    replicaId: draftOp.opDot.replicaId,
    sequence: draftOp.opDot.sequence,
    operation: signedOp,
    disposition: "APPLIED",
  });
  operationDigests.set(opKey, {
    opKey,
    collectionId: meta.collectionId,
    epochNumber: draftOp.epochNumber,
    replicaId: draftOp.opDot.replicaId,
    sequence: draftOp.opDot.sequence,
    status: "APPLIED",
    payloadDigest: digest,
    observedDigests: [digest],
  });
  return signedOp;
}

export async function migrateLegacyV1Store(
  meta: ReplicaMetaRecord,
  entriesState: Map<string, EntryStateRecord>,
  snapshotsV2: Map<number, SnapshotRecord>,
  mutationJournal: Map<string, MutationJournalRecord>,
  operationDigests: Map<string, OperationDigestRecord>,
  legacyEntries: readonly LegacyV1EntryInput[],
  migrationKeyPair: { publicKeyHex: string; privateKeyHex: string },
  pendingMutations?: readonly LegacyV1PendingMutationInput[] | undefined
): Promise<{ ok: boolean; migratedCount: number; snapshot: SnapshotRecord }> {
  const migrationReplicaId = "LEGACY_MIGRATION";
  const migrationKeyId = "key:LEGACY_MIGRATION:v1";
  const epochNumber = meta.epochNumber;

  // Step 1: Formally bind LEGACY_MIGRATION in epochMemberBindings
  meta.epochMemberBindings = {
    ...meta.epochMemberBindings,
    [migrationReplicaId]: {
      role: "MIGRATION_AUTHORITY",
      authorKeyId: migrationKeyId,
      authorPublicKeyHex: migrationKeyPair.publicKeyHex,
      signingAlgorithm: "Ed25519",
    },
  };

  let currentSeq = 1;
  let migratedCount = 0;

  // Step 2: Preserve input order; assign zero-padded fractional index keys if unindexed
  for (let i = 0; i < legacyEntries.length; i++) {
    const raw = legacyEntries[i]!;
    const insertDot: CausalDot = { epochNumber, replicaId: migrationReplicaId, sequence: currentSeq++ };
    const insertStamp: LamportStamp = { lamport: insertDot.sequence, ...insertDot };

    const initialFields = raw.fields ?? (raw.deleted ? {} : { id: raw.id });
    const itemIndexKey = raw.indexKey ?? (legacyEntries.length <= 1 ? "a0" : `a${String(i).padStart(6, "0")}`);

    const draftInsert: ReplicableOperation = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: meta.collectionId,
      epochNumber,
      epochCertificateId: meta.epochCertificateId,
      opDot: insertDot,
      targetIncarnation: insertDot,
      externalId: raw.id,
      stamp: insertStamp,
      kind: "insert",
      indexKey: itemIndexKey,
      leftNeighborIncarnation: null,
      rightNeighborIncarnation: null,
      initialFields,
      authorKeyId: migrationKeyId,
      payloadDigest: "0".repeat(64),
      authorSignature: "0".repeat(128),
    };

    await recordMigrationOp(meta, mutationJournal, operationDigests, draftInsert, migrationKeyPair.privateKeyHex);

    const incKey = toIncarnationId(insertDot);
    const fieldRegisters: EntryStateRecord["fields"] = {};
    for (const [k, v] of Object.entries(initialFields)) {
      fieldRegisters[k] = { value: v, stamp: insertStamp, present: true };
    }

    const entryRecord: EntryStateRecord = {
      targetBirthDot: insertDot,
      externalId: raw.id,
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
    entriesState.set(incKey, entryRecord);
    migratedCount++;

    // Step 3: If raw entry was deleted, emit DeleteOperation
    if (raw.deleted) {
      const deleteDot: CausalDot = { epochNumber, replicaId: migrationReplicaId, sequence: currentSeq++ };
      const deleteStamp: LamportStamp = { lamport: deleteDot.sequence, ...deleteDot };

      const draftDelete: ReplicableOperation = {
        protocolVersion: PROTOCOL_VERSION,
        collectionId: meta.collectionId,
        epochNumber,
        epochCertificateId: meta.epochCertificateId,
        opDot: deleteDot,
        targetIncarnation: insertDot,
        externalId: raw.id,
        stamp: deleteStamp,
        kind: "delete",
        authorKeyId: migrationKeyId,
        payloadDigest: "0".repeat(64),
        authorSignature: "0".repeat(128),
      };

      await recordMigrationOp(meta, mutationJournal, operationDigests, draftDelete, migrationKeyPair.privateKeyHex);

      entryRecord.deleted = true;
      entryRecord.deleteDots = [deleteDot];
    }
  }

  // Step 4: Replay pending uncommitted v1 mutations
  if (pendingMutations && pendingMutations.length > 0) {
    for (const mut of pendingMutations) {
      const targetId = mut.id ?? mut.targetId;
      if (!targetId) continue;

      let targetEntry: EntryStateRecord | undefined;
      for (const e of entriesState.values()) {
        if (e.externalId === targetId) {
          targetEntry = e;
          break;
        }
      }

      if (mut.op === "insert") {
        if (!targetEntry) {
          const insertDot: CausalDot = { epochNumber, replicaId: migrationReplicaId, sequence: currentSeq++ };
          const insertStamp: LamportStamp = { lamport: insertDot.sequence, ...insertDot };
          const valFields =
            typeof mut.value === "object" && mut.value !== null
              ? (mut.value as Record<string, unknown>)
              : (mut.fields ?? {});
          const initialFields: Record<string, unknown> = { ...valFields };
          if (!("id" in initialFields)) initialFields.id = targetId;
          const itemIndexKey = mut.indexKey ?? (mut.newIndexKey ?? "a999999");

          const draftInsert: ReplicableOperation = {
            protocolVersion: PROTOCOL_VERSION,
            collectionId: meta.collectionId,
            epochNumber,
            epochCertificateId: meta.epochCertificateId,
            opDot: insertDot,
            targetIncarnation: insertDot,
            externalId: targetId,
            stamp: insertStamp,
            kind: "insert",
            indexKey: itemIndexKey,
            leftNeighborIncarnation: null,
            rightNeighborIncarnation: null,
            initialFields,
            authorKeyId: migrationKeyId,
            payloadDigest: "0".repeat(64),
            authorSignature: "0".repeat(128),
          };

          await recordMigrationOp(meta, mutationJournal, operationDigests, draftInsert, migrationKeyPair.privateKeyHex);

          const incKey = toIncarnationId(insertDot);
          const fieldRegisters: EntryStateRecord["fields"] = {};
          for (const [k, v] of Object.entries(initialFields)) {
            fieldRegisters[k] = { value: v, stamp: insertStamp, present: true };
          }
          const newRec: EntryStateRecord = {
            targetBirthDot: insertDot,
            externalId: targetId,
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
          entriesState.set(incKey, newRec);
          migratedCount++;
        }
      } else if (mut.op === "update" || mut.op === "set") {
        if (targetEntry) {
          const updateDot: CausalDot = { epochNumber, replicaId: migrationReplicaId, sequence: currentSeq++ };
          const updateStamp: LamportStamp = { lamport: updateDot.sequence, ...updateDot };
          const partialFields =
            mut.partial ??
            mut.fields ??
            (typeof mut.value === "object" && mut.value !== null ? (mut.value as Record<string, unknown>) : {});

          const draftUpdate: ReplicableOperation = {
            protocolVersion: PROTOCOL_VERSION,
            collectionId: meta.collectionId,
            epochNumber,
            epochCertificateId: meta.epochCertificateId,
            opDot: updateDot,
            targetIncarnation: targetEntry.targetBirthDot,
            externalId: targetId,
            stamp: updateStamp,
            kind: "update",
            partialFields,
            removedFields: [],
            baseFieldStamps: {},
            authorKeyId: migrationKeyId,
            payloadDigest: "0".repeat(64),
            authorSignature: "0".repeat(128),
          };

          await recordMigrationOp(meta, mutationJournal, operationDigests, draftUpdate, migrationKeyPair.privateKeyHex);

          for (const [k, v] of Object.entries(partialFields)) {
            targetEntry.fields[k] = { value: v, stamp: updateStamp, present: true };
          }
        }
      } else if (mut.op === "delete") {
        if (targetEntry && !targetEntry.deleted) {
          const deleteDot: CausalDot = { epochNumber, replicaId: migrationReplicaId, sequence: currentSeq++ };
          const deleteStamp: LamportStamp = { lamport: deleteDot.sequence, ...deleteDot };

          const draftDelete: ReplicableOperation = {
            protocolVersion: PROTOCOL_VERSION,
            collectionId: meta.collectionId,
            epochNumber,
            epochCertificateId: meta.epochCertificateId,
            opDot: deleteDot,
            targetIncarnation: targetEntry.targetBirthDot,
            externalId: targetId,
            stamp: deleteStamp,
            kind: "delete",
            authorKeyId: migrationKeyId,
            payloadDigest: "0".repeat(64),
            authorSignature: "0".repeat(128),
          };

          await recordMigrationOp(meta, mutationJournal, operationDigests, draftDelete, migrationKeyPair.privateKeyHex);

          targetEntry.deleted = true;
          targetEntry.deleteDots = [...targetEntry.deleteDots, deleteDot];
        }
      } else if (mut.op === "move") {
        if (targetEntry) {
          const moveDot: CausalDot = { epochNumber, replicaId: migrationReplicaId, sequence: currentSeq++ };
          const moveStamp: LamportStamp = { lamport: moveDot.sequence, ...moveDot };
          const newIndexKey = mut.newIndexKey ?? (mut.indexKey ?? targetEntry.pos.indexKey);

          const draftMove: ReplicableOperation = {
            protocolVersion: PROTOCOL_VERSION,
            collectionId: meta.collectionId,
            epochNumber,
            epochCertificateId: meta.epochCertificateId,
            opDot: moveDot,
            targetIncarnation: targetEntry.targetBirthDot,
            externalId: targetId,
            stamp: moveStamp,
            kind: "move",
            newIndexKey,
            basePosStamp: targetEntry.pos.stamp,
            leftNeighborIncarnation: null,
            rightNeighborIncarnation: null,
            authorKeyId: migrationKeyId,
            payloadDigest: "0".repeat(64),
            authorSignature: "0".repeat(128),
          };

          await recordMigrationOp(meta, mutationJournal, operationDigests, draftMove, migrationKeyPair.privateKeyHex);

          targetEntry.pos = {
            ...targetEntry.pos,
            indexKey: newIndexKey,
            stamp: moveStamp,
          };
        }
      }
    }
  }

  // Step 5: Update frontiers for LEGACY_MIGRATION stream
  const streamKey = `${epochNumber}:${migrationReplicaId}`;
  const finalSeq = currentSeq - 1;
  meta.frontiers.localDurableFrontier[streamKey] = finalSeq;
  meta.frontiers.knownProducedFrontier[streamKey] = finalSeq;
  meta.frontiers.stableFrontier[streamKey] = finalSeq;
  meta.localLamport = Math.max(meta.localLamport, finalSeq);

  // Step 6: Persist migrated snapshot
  const snapshot = commitCheckpoint(meta, entriesState, snapshotsV2, mutationJournal);

  return { ok: true, migratedCount, snapshot };
}

