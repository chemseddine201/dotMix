/**
 * @dotmix/sync — Offline Outbox Replay & Lossless Local State Cluster Export (Gate 33 / D-137)
 */

import { canonicalizeValue, toIncarnationId, compareCausalDots } from "./apply.js";
import type { LocalMutationPayloadInput } from "./allocate.js";
import type {
  CausalDot,
  EntryStateRecord,
  ReplayPlanRecord,
  ReplayStep,
  SnapshotRecord,
  ReplicableOperation,
} from "./types.js";

export function planClusterExportReplay(
  localEntriesState: Map<string, EntryStateRecord>,
  remoteSnapshot: SnapshotRecord,
  collectionId: string,
  targetEpochNumber: number
): ReplayPlanRecord {
  const steps: ReplayStep[] = [];
  const incarnationMap: Record<string, string> = {};

  // Group remote snapshot entries by externalId
  const remoteByExternalId = new Map<string, EntryStateRecord[]>();
  for (const rEntry of remoteSnapshot.entries) {
    if (rEntry.externalId) {
      if (!remoteByExternalId.has(rEntry.externalId)) {
        remoteByExternalId.set(rEntry.externalId, []);
      }
      remoteByExternalId.get(rEntry.externalId)!.push(rEntry);
    }
  }

  // Group local entries by externalId
  const localByExternalId = new Map<string, EntryStateRecord[]>();
  for (const localEntry of localEntriesState.values()) {
    if (localEntry.externalId) {
      if (!localByExternalId.has(localEntry.externalId)) {
        localByExternalId.set(localEntry.externalId, []);
      }
      localByExternalId.get(localEntry.externalId)!.push(localEntry);
    }
  }

  // Sort externalIds deterministically
  const sortedExternalIds = [...localByExternalId.keys()].sort();

  for (const externalId of sortedExternalIds) {
    const localList = localByExternalId.get(externalId)!;
    // Sort local incarnations descending by dot (most recent first)
    localList.sort((a, b) => compareCausalDots(b.targetBirthDot, a.targetBirthDot));

    // Get deterministic remote winner (most recent dot)
    const remoteList = remoteByExternalId.get(externalId);
    let remoteWinner: EntryStateRecord | undefined;
    if (remoteList && remoteList.length > 0) {
      remoteList.sort((a, b) => compareCausalDots(b.targetBirthDot, a.targetBirthDot));
      remoteWinner = remoteList[0];
    }

    const anyLocalLive = localList.some((e) => !e.deleted);
    const liveLocalEntry = localList.find((e) => !e.deleted);

    if (remoteWinner) {
      const remoteIncKey = toIncarnationId(remoteWinner.targetBirthDot);
      for (const loc of localList) {
        incarnationMap[toIncarnationId(loc.targetBirthDot)] = remoteIncKey;
      }

      if (anyLocalLive && liveLocalEntry) {
        // Live local item exists: emit UPDATE targeting remote winner only if delta exists
        const partialFields: Record<string, unknown> = {};
        const removedFields: string[] = [];

        for (const [k, reg] of Object.entries(liveLocalEntry.fields)) {
          if (reg.present) {
            const rReg = remoteWinner.fields[k];
            if (!rReg || !rReg.present || canonicalizeValue(rReg.value) !== canonicalizeValue(reg.value)) {
              partialFields[k] = reg.value;
            }
          }
        }
        // Export local field removals: fields present remotely but not locally
        for (const [k, rReg] of Object.entries(remoteWinner.fields)) {
          if (rReg.present && (!liveLocalEntry.fields[k] || !liveLocalEntry.fields[k]!.present)) {
            removedFields.push(k);
          }
        }

        if (Object.keys(partialFields).length > 0 || removedFields.length > 0) {
          steps.push({
            originalOpKey: `${collectionId}:export:${toIncarnationId(liveLocalEntry.targetBirthDot)}:update`,
            kind: "update",
            payload: {
              targetIncarnation: remoteWinner.targetBirthDot,
              externalId,
              partialFields,
              removedFields,
            },
            committed: false,
          });
        }
      } else {
        // All local incarnations are deleted: emit DELETE if remote is live
        if (!remoteWinner.deleted) {
          const mostRecentDeleted = localList[0]!;
          steps.push({
            originalOpKey: `${collectionId}:export:${toIncarnationId(mostRecentDeleted.targetBirthDot)}:delete`,
            kind: "delete",
            payload: {
              targetIncarnation: remoteWinner.targetBirthDot,
              externalId,
            },
            committed: false,
          });
        }
      }
    } else {
      // Local-only item does not exist remotely
      if (anyLocalLive && liveLocalEntry) {
        const initialFields: Record<string, unknown> = {};
        for (const [k, reg] of Object.entries(liveLocalEntry.fields)) {
          if (reg.present) {
            initialFields[k] = reg.value;
          }
        }
        steps.push({
          originalOpKey: `${collectionId}:export:${toIncarnationId(liveLocalEntry.targetBirthDot)}:insert`,
          kind: "insert",
          payload: {
            externalId,
            indexKey: liveLocalEntry.pos.indexKey,
            initialFields,
          },
          committed: false,
        });
      }
    }
  }

  return {
    collectionId,
    targetEpochNumber,
    cursorIndex: 0,
    steps,
    opIdentityMap: {},
    incarnationMap,
    stampMap: {},
    unresolvedConflicts: [],
    replayCompleted: steps.length === 0,
  };
}

export async function executeReplayPlan(
  engine: {
    allocateLocalMutation(
      input: LocalMutationPayloadInput
    ): Promise<{ ok: boolean; op?: ReplicableOperation | undefined; code?: string | undefined; detail?: string | undefined }>;
  },
  replayPlan: ReplayPlanRecord
): Promise<{ ok: boolean }> {
  for (const step of replayPlan.steps) {
    if (step.committed) continue;
    if (step.kind === "delete") {
      const payload = step.payload as { targetIncarnation: CausalDot; externalId: string };
      await engine.allocateLocalMutation({
        kind: "delete",
        targetIncarnation: payload.targetIncarnation,
        externalId: payload.externalId,
      });
    } else if (step.kind === "update") {
      const payload = step.payload as {
        targetIncarnation: CausalDot;
        externalId: string;
        partialFields: Record<string, unknown>;
        removedFields?: readonly string[];
      };
      await engine.allocateLocalMutation({
        kind: "update",
        targetIncarnation: payload.targetIncarnation,
        externalId: payload.externalId,
        partialFields: payload.partialFields,
        ...(payload.removedFields !== undefined ? { removedFields: payload.removedFields } : {}),
      });
    } else if (step.kind === "insert") {
      const payload = step.payload as {
        externalId: string;
        indexKey: string;
        initialFields: Record<string, unknown>;
      };
      await engine.allocateLocalMutation({
        kind: "insert",
        externalId: payload.externalId,
        indexKey: payload.indexKey,
        initialFields: payload.initialFields,
      });
    }
    step.committed = true;
  }
  return { ok: true };
}
