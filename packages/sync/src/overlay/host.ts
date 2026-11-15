/**
 * @dotmix/sync — Optimistic Overlay Host & Microtask Batcher (Gate 34 / T-34.2)
 *
 * Coordinates immediate synchronous visible state updates followed by asynchronous
 * signing, batching commits per microtask tick, and handling rollbacks on failure.
 * Zero external dependencies.
 */

import { signal } from "@dotmix/runtime";
import type { OverlayHost, OverlayReconciler, PendingIntent } from "../adapter/contract.js";
import { DefaultOverlayReconciler } from "./reconciler.js";

export type OverlayChangeNotifier<T> = (effectiveItems: readonly T[]) => void;
export type OverlayErrorNotifier = (intentIdentifier: string, failureReason: Error) => void;

export interface OverlayHostOptions<T> {
  readonly reconciler?: OverlayReconciler<T> | undefined;
  readonly onChange?: OverlayChangeNotifier<T> | undefined;
  readonly onError?: OverlayErrorNotifier | undefined;
}

export class DefaultOverlayHost<T> implements OverlayHost<T> {
  private intentsSignal = signal<readonly PendingIntent<T>[]>([]);
  private readonly reconciler: OverlayReconciler<T>;
  private readonly changeListener?: OverlayChangeNotifier<T> | undefined;
  private readonly errorListener?: OverlayErrorNotifier | undefined;

  // Microtask batching queue for asynchronous commits
  private scheduledBatchQueue: Array<() => Promise<void>> = [];
  private batchScheduled = false;

  constructor(options?: OverlayHostOptions<T>) {
    this.reconciler = options?.reconciler ?? new DefaultOverlayReconciler<T>();
    this.changeListener = options?.onChange;
    this.errorListener = options?.onError;
  }

  readonly pendingIntents = (): readonly PendingIntent<T>[] => {
    return this.intentsSignal();
  };

  readonly pendingCount = (): number => {
    return this.intentsSignal().length;
  };

  addIntent(intent: PendingIntent<T>): void {
    const currentIntents = this.intentsSignal();
    this.intentsSignal.set([...currentIntents, intent]);
  }

  removeIntent(intentIdentifier: string): void {
    const remainingIntents = this.intentsSignal().filter(
      (candidateIntent) => candidateIntent.intentId !== intentIdentifier
    );
    this.intentsSignal.set(remainingIntents);
  }

  rollbackIntent(intentIdentifier?: string, failureReason?: Error): void {
    if (intentIdentifier !== undefined) {
      this.removeIntent(intentIdentifier);
      if (this.errorListener && failureReason) {
        this.errorListener(intentIdentifier, failureReason);
      }
    } else {
      this.clearIntents();
    }
  }

  clearIntents(): void {
    this.intentsSignal.set([]);
  }

  getEffectiveItems(committedItems: readonly T[]): T[] {
    return this.reconciler.reconcile(committedItems, this.intentsSignal());
  }

  /**
   * Enqueues an asynchronous commit action to be batched into the next microtask tick.
   * Ensures exactly one transaction execution per microtask batch.
   */
  scheduleMicrotaskCommit(commitAction: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolvePromise, rejectPromise) => {
      this.scheduledBatchQueue.push(async () => {
        try {
          await commitAction();
          resolvePromise();
        } catch (commitExecutionError) {
          rejectPromise(commitExecutionError);
        }
      });

      if (!this.batchScheduled) {
        this.batchScheduled = true;
        queueMicrotask(async () => {
          this.batchScheduled = false;
          const currentBatchOperations = [...this.scheduledBatchQueue];
          this.scheduledBatchQueue = [];

          for (const batchedOperation of currentBatchOperations) {
            await batchedOperation();
          }
        });
      }
    });
  }

  /**
   * Applies an optimistic mutation immediately, notifies visible listeners,
   * schedules asynchronous commit, and reconciles or rolls back upon completion.
   */
  async applyOptimisticAction(
    intent: PendingIntent<T>,
    committedItems: readonly T[],
    executeCommitOperation: () => Promise<void>
  ): Promise<void> {
    // 1. Immediate synchronous visible update
    this.addIntent(intent);
    if (this.changeListener) {
      const immediateEffectiveItems = this.getEffectiveItems(committedItems);
      this.changeListener(immediateEffectiveItems);
    }

    // 2. Asynchronous sign + commit scheduled via microtask batching
    try {
      await this.scheduleMicrotaskCommit(executeCommitOperation);
      // 3. On successful commit: reconcile intent
      this.removeIntent(intent.intentId);
      if (this.changeListener) {
        this.changeListener(this.getEffectiveItems(committedItems));
      }
    } catch (operationFailure) {
      // 4. On failure: remove overlay intent and raise error signal
      const errorObject =
        operationFailure instanceof Error
          ? operationFailure
          : new Error(String(operationFailure));
      this.rollbackIntent(intent.intentId, errorObject);
      if (this.changeListener) {
        this.changeListener(this.getEffectiveItems(committedItems));
      }
      throw errorObject;
    }
  }
}
