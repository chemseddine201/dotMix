/**
 * @dotmix/sync — Production v1 -> v2 Migration Typed Definitions
 *
 * Defines contracts for legacy v1 snapshot extraction, pending mutation replay plans,
 * legacy archiving, and multi-stage idempotent migration state machines.
 * Zero external dependencies.
 */

import type { MigrationStatus } from "../adapter/contract.js";

export interface LegacyV1EntryPayload {
  readonly id: string;
  readonly fields?: Record<string, unknown> | undefined;
  readonly deleted?: boolean | undefined;
  readonly indexKey?: string | undefined;
  readonly [additionalProperty: string]: unknown;
}

export interface LegacyV1MutationRecord {
  readonly idStr: string;
  readonly storeKey: string;
  readonly state: "pending" | "committed" | "failed" | string;
  readonly op: "insert" | "update" | "delete" | "move" | "set" | string;
  readonly targetId?: string | undefined;
  /** The legacy engine stores a MutationId object here; flat records use the item id. */
  readonly id?: unknown;
  /** The legacy engine's CollectionMutationPayload: { id, value | partial | targetIndex, indexKey }. */
  readonly payload?: unknown;
  readonly fields?: Record<string, unknown> | undefined;
  readonly partial?: Record<string, unknown> | undefined;
  readonly value?: unknown;
  readonly indexKey?: string | undefined;
  readonly newIndexKey?: string | undefined;
  readonly targetIndex?: number | undefined;
  readonly timestamp?: number | undefined;
}

export interface LegacyArchiveRecord {
  readonly collectionId: string;
  readonly stage: "archive_written" | "entries_migrated" | "checkpoint_committed" | "finalized";
  readonly archivedAt: number;
  readonly finalizedAt?: number | undefined;
  readonly rawEntriesCount: number;
  readonly rawPendingMutationsCount: number;
  readonly replayPlan: readonly LegacyV1MutationRecord[];
  readonly rawSnapshotData?: unknown;
}

export interface V1MigrationPlan {
  readonly collectionId: string;
  readonly activeEntries: readonly LegacyV1EntryPayload[];
  readonly deletedEntries: readonly LegacyV1EntryPayload[];
  readonly pendingMutations: readonly LegacyV1MutationRecord[];
}

export interface V1MigrationExecutionResult {
  readonly ok: boolean;
  readonly status: MigrationStatus;
  readonly migratedCount: number;
  readonly pendingReplayedCount: number;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
}
