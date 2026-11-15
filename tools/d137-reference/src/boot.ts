/**
 * D137-v33-reference: Boot Recovery, Snapshot Verification & N-1 Fallback (S59, S91)
 */

import { toIncarnationId, toOperationKey } from "./canonicalization.js";
import { validateEpochMembershipCertificate } from "./certificates.js";
import { D137Engine } from "./engine.js";
import { recomputeStableFrontier, updateRollingStreamDigest } from "./frontiers.js";
import { applyOperationToState, type InTransactionContext } from "./operations.js";
import { computeCanonicalSnapshotDigest } from "./snapshots.js";
import type { StoreBackend } from "./backend/types.js";
import type {
  MutationJournalRecord,
  OperationDigestRecord,
  SnapshotRecord,
  SyncOutboxRecord,
} from "./types.js";

export interface BootRecoveryResult {
  ok: boolean;
  engine?: D137Engine;
  acceptedSnapSeq?: number;
  fallbackUsed?: boolean;
  code?: string;
  detail?: string;
}

export async function recoverFromStoreOnBoot(
  backend: StoreBackend,
  collectionId: string,
  replicaId?: string,
  options?: { authorPrivateKeyHex?: string }
): Promise<BootRecoveryResult> {
  if (!backend.isOpen()) {
    await backend.open();
  }

  // 1. Load all snapshots from store
  const snapshots = await backend.runTransaction(
    ["snapshots"],
    "readonly",
    async (tx) => tx.getAll<SnapshotRecord>("snapshots")
  );

  const matchingSnaps = snapshots
    .filter((s) => s.collectionId === collectionId)
    .sort((a, b) => b.snapshotSeq - a.snapshotSeq);

  if (matchingSnaps.length === 0) {
    throw new Error(
      `CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED: No snapshots found for collection ${collectionId}`
    );
  }

  const snapN = matchingSnaps[0]!;
  const snapNMinus1 = matchingSnaps.length > 1 ? matchingSnaps[1] : undefined;

  let acceptedSnap: SnapshotRecord | undefined;
  let fallbackUsed = false;

  // 2. Verify Snapshot N (digest + coordinator certificate)
  const snapNDigest = computeCanonicalSnapshotDigest(snapN);
  const snapNDigestValid = snapNDigest === snapN.snapshotDigest;
  const certNResult = await validateEpochMembershipCertificate(
    snapN.epochCertificate,
    collectionId,
    snapN.snapshotSeq === 0 ? snapN : undefined
  );

  if (snapNDigestValid && certNResult.ok) {
    acceptedSnap = snapN;
  } else {
    // 3. Fallback to Snapshot N-1 (S59, S91)
    if (snapNMinus1) {
      const snapNMinus1Digest = computeCanonicalSnapshotDigest(snapNMinus1);
      const snapNMinus1DigestValid = snapNMinus1Digest === snapNMinus1.snapshotDigest;
      const certNMinus1Result = await validateEpochMembershipCertificate(
        snapNMinus1.epochCertificate,
        collectionId,
        snapNMinus1.snapshotSeq === 0 ? snapNMinus1 : undefined
      );

      if (snapNMinus1DigestValid && certNMinus1Result.ok) {
        acceptedSnap = snapNMinus1;
        fallbackUsed = true;
      }
    }
  }

  // 4. If neither snapshot is valid, fail closed with CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED
  if (!acceptedSnap) {
    throw new Error(
      "CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED: Both latest snapshot N and N-1 failed verification"
    );
  }

  // 5. Load mutation journal from store
  const journalRecords = await backend.runTransaction(
    ["mutation_journal"],
    "readonly",
    async (tx) => tx.getAll<MutationJournalRecord>("mutation_journal")
  );

  const matchingJournal = journalRecords.filter((j) => j.collectionId === collectionId);

  // S59: If fallback to N-1 was used, check if journal was truncated past N-1
  if (fallbackUsed) {
    for (const [streamKey, incSeq] of Object.entries(acceptedSnap.frontiers.snapshotIncludedFrontier)) {
      const streamOps = matchingJournal
        .filter((j) => `${j.epochNumber}:${j.replicaId}` === streamKey)
        .sort((a, b) => a.sequence - b.sequence);

      if (streamOps.length > 0 && streamOps[0]!.sequence > incSeq + 1) {
        throw new Error(
          `CORRUPT_LOCAL_STORE_RECOVERY_REQUIRED: Truncated journal gap on fallback from seq ${incSeq} to ${streamOps[0]!.sequence}`
        );
      }
    }
  }

  // 6. Reconstruct engine from accepted snapshot
  const targetReplicaId = replicaId ?? acceptedSnap.members[0] ?? "A";
  const binding = acceptedSnap.epochCertificate.memberBindings[targetReplicaId];
  const authorKeyId = binding?.authorKeyId ?? "key-default";

  const engine = new D137Engine(
    collectionId,
    targetReplicaId,
    acceptedSnap.epochNumber,
    acceptedSnap.epochCertificate,
    authorKeyId,
    options?.authorPrivateKeyHex
  );

  engine.snapshotsV2.clear();
  engine.snapshotsV2.set(acceptedSnap.snapshotSeq, acceptedSnap);
  if (!fallbackUsed && snapNMinus1) {
    engine.snapshotsV2.set(snapNMinus1.snapshotSeq, snapNMinus1);
  }

  engine.meta.activeSnapshotSeq = acceptedSnap.snapshotSeq;
  engine.meta.epochNumber = acceptedSnap.epochNumber;
  engine.meta.epochCertificateId = acceptedSnap.epochCertificateId;
  engine.meta.frontiers = JSON.parse(JSON.stringify(acceptedSnap.frontiers));
  engine.meta.rollingStreamDigestAnchors = { ...(acceptedSnap.rollingStreamDigestAnchors ?? {}) };
  engine.meta.activeEpochEquivocations = { ...acceptedSnap.activeEpochEquivocations };
  engine.meta.historicalEquivocationAudit = [...acceptedSnap.historicalEquivocationAudit];

  engine.entriesState.clear();
  for (const e of acceptedSnap.entries) {
    engine.entriesState.set(toIncarnationId(e.targetBirthDot), JSON.parse(JSON.stringify(e)));
  }

  // 7. Load other persisted state (outbox, operation digests, replica_meta)
  const [outboxRecords, digestRecords, persistedMeta] = await backend.runTransaction(
    ["sync_outbox", "operation_digests", "replica_meta"],
    "readonly",
    async (tx) => {
      const o = await tx.getAll<SyncOutboxRecord>("sync_outbox");
      const d = await tx.getAll<OperationDigestRecord>("operation_digests");
      const m = await tx.get<any>("replica_meta", collectionId);
      return [o, d, m];
    }
  );

  if (persistedMeta) {
    if (persistedMeta.authorKeyId) {
      engine.meta.authorKeyId = persistedMeta.authorKeyId;
    }
    if (persistedMeta.nextLocalSequence > engine.meta.nextLocalSequence) {
      engine.meta.nextLocalSequence = persistedMeta.nextLocalSequence;
    }
    if (persistedMeta.localLamport > engine.meta.localLamport) {
      engine.meta.localLamport = persistedMeta.localLamport;
    }
  }

  for (const o of outboxRecords.filter((rec) => rec.collectionId === collectionId)) {
    engine.syncOutbox.set(toOperationKey(o.collectionId, o.operation.opDot), o);
  }
  for (const d of digestRecords.filter((rec) => rec.collectionId === collectionId)) {
    engine.operationDigests.set(d.opKey, d);
  }

  // 8. Replay journal ops whose sequence exceeds snapshot included frontier
  const replayCtx: InTransactionContext = {
    meta: engine.meta,
    entriesState: engine.entriesState,
    mutationJournal: engine.mutationJournal,
    operationDigests: engine.operationDigests,
    syncOutbox: engine.syncOutbox,
    inboundGapBuffer: engine.inboundGapBuffer,
    inboundDependencyBuffer: engine.inboundDependencyBuffer,
    quarantineJournal: engine.quarantineJournal,
  };

  const sortedOps = matchingJournal.sort((a, b) => {
    if (a.operation.stamp.lamport !== b.operation.stamp.lamport) {
      return a.operation.stamp.lamport - b.operation.stamp.lamport;
    }
    return a.sequence - b.sequence;
  });

  for (const jRec of sortedOps) {
    engine.mutationJournal.set(jRec.opKey, jRec);

    if (jRec.epochNumber < acceptedSnap.epochNumber) {
      continue;
    }

    const streamKey = `${jRec.epochNumber}:${jRec.replicaId}`;
    const incSeq = acceptedSnap.frontiers.snapshotIncludedFrontier[streamKey] ?? 0;

    if (jRec.sequence > incSeq) {
      applyOperationToState(replayCtx, jRec.operation, false);
      const curDur = engine.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
      if (jRec.sequence > curDur) {
        engine.meta.frontiers.localDurableFrontier[streamKey] = jRec.sequence;
        engine.meta.frontiers.knownProducedFrontier[streamKey] = jRec.sequence;
        updateRollingStreamDigest(engine.meta, streamKey, jRec.sequence, jRec.operation.payloadDigest);
      }
      if (jRec.operation.stamp.lamport >= engine.meta.localLamport) {
        engine.meta.localLamport = jRec.operation.stamp.lamport + 1;
      }
    }
  }

  const localStreamKey = `${engine.meta.epochNumber}:${engine.meta.replicaId}`;
  const localDurable = engine.meta.frontiers.localDurableFrontier[localStreamKey] ?? 0;
  if (localDurable >= engine.meta.nextLocalSequence) {
    engine.meta.nextLocalSequence = localDurable + 1;
  }

  recomputeStableFrontier(engine.meta);

  return {
    ok: true,
    engine,
    acceptedSnapSeq: acceptedSnap.snapshotSeq,
    fallbackUsed,
  };
}

/**
 * Persists complete engine state into a StoreBackend within atomic transactions.
 */
export async function persistEngineToStore(
  backend: StoreBackend,
  engine: D137Engine
): Promise<void> {
  if (!backend.isOpen()) {
    await backend.open();
  }

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
    async (tx) => {
      // 1. Snapshots
      for (const [seq, snap] of engine.snapshotsV2.entries()) {
        await tx.put("snapshots", seq, snap);
      }
      // 2. Journal
      await tx.clear("mutation_journal");
      for (const [key, jRec] of engine.mutationJournal.entries()) {
        await tx.put("mutation_journal", key, jRec);
      }
      // 3. Outbox
      await tx.clear("sync_outbox");
      for (const [key, outRec] of engine.syncOutbox.entries()) {
        await tx.put("sync_outbox", key, outRec);
      }
      // 4. Operation Digests
      await tx.clear("operation_digests");
      for (const [key, dRec] of engine.operationDigests.entries()) {
        await tx.put("operation_digests", key, dRec);
      }
      // 5. Entries State
      await tx.clear("entries_state");
      for (const [key, entry] of engine.entriesState.entries()) {
        await tx.put("entries_state", key, entry);
      }
      // 6. Replica Meta
      await tx.put("replica_meta", engine.meta.collectionId, engine.meta);
    }
  );
}

