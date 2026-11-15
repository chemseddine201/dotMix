/**
 * @dotmix/sync — Optimistic Overlay Reconciler (Gate 34 / T-34.2)
 *
 * Implements deterministic reconciliation between authoritative committed items
 * and in-flight pending optimistic intents (insert, update, delete, move).
 * Zero external dependencies.
 */

import type { OverlayReconciler, PendingIntent } from "../adapter/contract.js";

function extractItemIdentifier<T>(item: T): string | undefined {
  if (typeof item === "object" && item !== null) {
    if ("id" in item && typeof (item as { id: unknown }).id === "string") {
      return (item as { id: string }).id;
    }
    if ("externalId" in item && typeof (item as { externalId: unknown }).externalId === "string") {
      return (item as { externalId: string }).externalId;
    }
  }
  return undefined;
}

export class DefaultOverlayReconciler<T> implements OverlayReconciler<T> {
  applyIntent(committedItems: readonly T[], intent: PendingIntent<T>): T[] {
    const workingItems = [...committedItems];
    const targetIdentifier = intent.externalId;

    switch (intent.kind) {
      case "insert": {
        const itemPayload = (intent.fullFields ??
          (intent.partialFields as unknown as T) ??
          ({ id: targetIdentifier } as unknown as T)) as T;

        const existingIndex = workingItems.findIndex(
          (candidateItem) => extractItemIdentifier(candidateItem) === targetIdentifier
        );

        if (existingIndex >= 0) {
          workingItems[existingIndex] = itemPayload;
        } else if (
          intent.targetIndex !== undefined &&
          intent.targetIndex >= 0 &&
          intent.targetIndex <= workingItems.length
        ) {
          workingItems.splice(intent.targetIndex, 0, itemPayload);
        } else {
          workingItems.push(itemPayload);
        }
        return workingItems;
      }

      case "update": {
        const targetIndex = workingItems.findIndex(
          (candidateItem) => extractItemIdentifier(candidateItem) === targetIdentifier
        );
        if (targetIndex >= 0) {
          const currentItem = workingItems[targetIndex]!;
          const updatedItem =
            typeof currentItem === "object" && currentItem !== null
              ? ({ ...currentItem, ...(intent.partialFields ?? {}) } as T)
              : ((intent.partialFields as unknown as T) ?? currentItem);
          workingItems[targetIndex] = updatedItem;
        }
        return workingItems;
      }

      case "delete": {
        return workingItems.filter(
          (candidateItem) => extractItemIdentifier(candidateItem) !== targetIdentifier
        );
      }

      case "clear": {
        return [];
      }

      case "move": {
        const sourceIndex = workingItems.findIndex(
          (candidateItem) => extractItemIdentifier(candidateItem) === targetIdentifier
        );
        if (sourceIndex >= 0 && intent.targetIndex !== undefined && intent.targetIndex >= 0) {
          const [movedItem] = workingItems.splice(sourceIndex, 1);
          if (movedItem !== undefined) {
            const clampedIndex = Math.min(intent.targetIndex, workingItems.length);
            workingItems.splice(clampedIndex, 0, movedItem);
          }
        }
        return workingItems;
      }

      default:
        return workingItems;
    }
  }

  rollbackIntent(stagedItems: readonly T[], _intentIdentifier: string): T[] {
    // Rollback is achieved by filtering or restoring through full reconcile pass
    return [...stagedItems];
  }

  /**
   * Same result as applying applyIntent() once per intent, in order, but with one working
   * array and an identifier -> position index. The index is rebuilt only after an operation
   * that shifts positions (splice, filter), so an append-only burst stays linear.
   */
  reconcile(committedItems: readonly T[], pendingIntents: readonly PendingIntent<T>[]): T[] {
    const workingItems = [...committedItems];
    if (pendingIntents.length === 0) return workingItems;

    const positionByIdentifier = new Map<string, number>();
    let positionsStale = true;
    const findPosition = (targetIdentifier: string): number => {
      if (positionsStale) {
        positionByIdentifier.clear();
        for (let itemPosition = 0; itemPosition < workingItems.length; itemPosition++) {
          const itemIdentifier = extractItemIdentifier(workingItems[itemPosition]);
          // findIndex semantics: the first occurrence wins.
          if (itemIdentifier !== undefined && !positionByIdentifier.has(itemIdentifier)) {
            positionByIdentifier.set(itemIdentifier, itemPosition);
          }
        }
        positionsStale = false;
      }
      return positionByIdentifier.get(targetIdentifier) ?? -1;
    };

    for (const pendingIntent of pendingIntents) {
      const targetIdentifier = pendingIntent.externalId;
      switch (pendingIntent.kind) {
        case "insert": {
          const itemPayload = (pendingIntent.fullFields ??
            (pendingIntent.partialFields as unknown as T) ??
            ({ id: targetIdentifier } as unknown as T)) as T;
          const existingPosition = findPosition(targetIdentifier);
          const requestedIndex = pendingIntent.targetIndex;
          if (existingPosition >= 0) {
            workingItems[existingPosition] = itemPayload;
            if (extractItemIdentifier(itemPayload) !== targetIdentifier) positionsStale = true;
          } else if (
            requestedIndex !== undefined &&
            requestedIndex >= 0 &&
            requestedIndex < workingItems.length
          ) {
            workingItems.splice(requestedIndex, 0, itemPayload);
            positionsStale = true;
          } else {
            workingItems.push(itemPayload);
            const appendedIdentifier = extractItemIdentifier(itemPayload);
            if (!positionsStale && appendedIdentifier !== undefined && !positionByIdentifier.has(appendedIdentifier)) {
              positionByIdentifier.set(appendedIdentifier, workingItems.length - 1);
            }
          }
          break;
        }
        case "update": {
          const targetPosition = findPosition(targetIdentifier);
          if (targetPosition >= 0) {
            const currentItem = workingItems[targetPosition]!;
            const updatedItem =
              typeof currentItem === "object" && currentItem !== null
                ? ({ ...currentItem, ...(pendingIntent.partialFields ?? {}) } as T)
                : ((pendingIntent.partialFields as unknown as T) ?? currentItem);
            workingItems[targetPosition] = updatedItem;
            if (extractItemIdentifier(updatedItem) !== targetIdentifier) positionsStale = true;
          }
          break;
        }
        default: {
          // delete, clear and move reshape the list; reuse the reference implementation.
          const reshapedItems = this.applyIntent(workingItems, pendingIntent);
          workingItems.length = 0;
          for (const reshapedItem of reshapedItems) workingItems.push(reshapedItem);
          positionsStale = true;
        }
      }
    }
    return workingItems;
  }
}
