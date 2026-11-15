/**
 * @dotmix/sync — D-137 Adapter Typed Contracts (Gate 34 / Phase 1)
 *
 * Defines the architectural boundaries between public reactive primitives
 * (syncCollection / syncSignal), optimistic overlay reconciliation,
 * v1 migration runners, multi-tab leasing, and the D-137 protocol engine.
 * Zero external dependencies.
 */

import type {
  Mutation,
  SyncCollection,
  SyncCollectionOptions,
  SyncSignal,
  SyncSignalOptions,
} from "../types.js";
import type {
  CausalDot,
  TabLeaseRecord,
  TransportChannelPrincipal,
} from "../protocol/types.js";
import type { D137Engine } from "../protocol/engine.js";

/**
 * Engine selection switch for sync primitives.
 */
export type SyncEngineSelection = "d137" | "legacy";

// ============================================================================
// 1. OVERLAY CONTRACT (Optimistic UI Intent Application & Rollback)
// ============================================================================

export type PendingIntentKind = "insert" | "update" | "delete" | "move" | "clear";

export interface PendingIntent<T = unknown> {
  readonly intentId: string;
  readonly collectionId: string;
  readonly kind: PendingIntentKind;
  readonly externalId: string;
  readonly createdAt: number;
  readonly indexKey?: string | undefined;
  readonly targetIndex?: number | undefined;
  readonly targetBirthDot?: CausalDot | undefined;
  readonly partialFields?: Partial<T> | undefined;
  readonly fullFields?: T | undefined;
  readonly associatedMutation: Mutation<unknown>;
}

export interface OverlayReconciler<T> {
  applyIntent(committedItems: readonly T[], intent: PendingIntent<T>): T[];
  rollbackIntent(stagedItems: readonly T[], intentId: string): T[];
  reconcile(committedItems: readonly T[], pendingIntents: readonly PendingIntent<T>[]): T[];
}

export interface OverlayHost<T> {
  readonly pendingIntents: () => readonly PendingIntent<T>[];
  readonly pendingCount: () => number;
  addIntent(intent: PendingIntent<T>): void;
  removeIntent(intentId: string): void;
  rollbackIntent(intentId?: string): void;
  clearIntents(): void;
  getEffectiveItems(committedItems: readonly T[]): T[];
}

// ============================================================================
// 2. MIGRATION CONTRACT (v1 Data Migration Hook)
// ============================================================================

export type MigrationStatus =
  | "uninitialized"
  | "pending"
  | "migrating"
  | "completed"
  | "skipped"
  | "failed";

export interface MigrationResult {
  readonly ok: boolean;
  readonly status: MigrationStatus;
  readonly migratedCount?: number | undefined;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
}

export interface MigrationRunner {
  status(): MigrationStatus;
  isMigrationRequired(collectionId: string): Promise<boolean>;
  runV1Migration(collectionId: string, legacyDriver?: unknown): Promise<MigrationResult>;
}

export class DefaultMigrationRunner implements MigrationRunner {
  private currentStatus: MigrationStatus = "uninitialized";

  public status(): MigrationStatus {
    return this.currentStatus;
  }

  public async isMigrationRequired(_collectionIdentifier: string): Promise<boolean> {
    return false;
  }

  public async runV1Migration(
    _collectionIdentifier: string,
    _legacyDriver?: unknown
  ): Promise<MigrationResult> {
    this.currentStatus = "completed";
    return {
      ok: true,
      status: "completed",
      migratedCount: 0,
    };
  }
}

// ============================================================================
// 3. TRANSPORT CONTRACT (Wire Envelopes, Multi-Tab Leasing, Channels)
// ============================================================================

export type WireEnvelopeKind =
  | "operation"
  | "ack"
  | "certificate"
  | "range_request"
  | "range_response";

export interface WireEnvelope {
  readonly protocolVersion: string;
  readonly collectionId: string;
  readonly senderReplicaId: string;
  readonly kind: WireEnvelopeKind;
  readonly timestamp: number;
  readonly payload: unknown;
  readonly signature?: string | undefined;
}

export interface TransportHost {
  sendEnvelope(envelope: WireEnvelope, destinationReplicaId?: string): Promise<void>;
  onReceiveEnvelope(
    listener: (envelope: WireEnvelope, channelPrincipal: TransportChannelPrincipal) => Promise<void> | void
  ): () => void;
  acquireTabLease(tabIdentifier: string, fencingTerm: number): Promise<boolean>;
  renewTabLease(tabIdentifier: string, fencingTerm: number): Promise<boolean>;
  releaseTabLease(tabIdentifier: string): Promise<void>;
  getCurrentLease(): TabLeaseRecord | undefined;
  isPrimaryTab(): boolean;
}

// ============================================================================
// 4. PUBLIC ADAPTER INTERFACES
// ============================================================================

export interface D137CollectionAdapter<T> extends SyncCollection<T> {
  readonly engineInstance: D137Engine;
  readonly overlayHost: OverlayHost<T>;
  readonly migrationRunner: MigrationRunner;
  readonly transportHost?: TransportHost | undefined;
  readonly options: SyncCollectionOptions<T>;
  conflictedIds(): string[];
  /** The D137_* code behind an "error" status (for example D137_STORAGE_QUOTA_EXCEEDED). */
  errorCode(): string | undefined;
}

export interface D137SignalAdapter<T> extends SyncSignal<T> {
  readonly engineInstance: D137Engine;
  readonly storeKey: string;
  readonly options: SyncSignalOptions<T>;
  readonly transportHost?: TransportHost | undefined;
}
