/**
 * @mix/runtime/core/cancellation — Pure ECMAScript CancellationToken and CancellationSource (D-104).
 */

import {
  OwnerState,
  type CancellationSource,
  type CancellationToken,
  type Owner
} from "./types.js";
import { coreState } from "./state.js";

export function createCancellationSource(
  parentOwner: Owner | null = coreState.currentOwner,
  generation?: number
): CancellationSource {
  let cancelled = false;
  let cancelReason: unknown = undefined;
  const gen = generation ?? ++coreState.globalGenerationCounter;
  const listeners = new Set<(reason: unknown) => void>();

  const token: CancellationToken = {
    get isCancelled(): boolean {
      return cancelled;
    },
    get aborted(): boolean {
      return cancelled;
    },
    get reason(): unknown {
      return cancelReason;
    },
    get generation(): number {
      return gen;
    },
    onCancelled(callback: (reason: unknown) => void): () => void {
      if (typeof callback !== "function") {
        return () => {};
      }
      if (cancelled) {
        // R-CX-04: Invoke synchronously if already cancelled
        try {
          callback(cancelReason);
        } catch (err) {
          if (coreState.uncaughtErrorHandler) {
            coreState.uncaughtErrorHandler(err);
          } else {
            throw err;
          }
        }
        return () => {};
      }
      listeners.add(callback);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(callback);
      };
    },
    throwIfAborted(): void {
      if (cancelled) {
        throw cancelReason;
      }
    }
  };

  let unbindParent: (() => void) | null = null;

  function cancel(reason: unknown = "MIX_RT_CANCELLED"): void {
    // R-CX-03: Idempotent cancellation
    if (cancelled) return;
    cancelled = true;
    cancelReason = reason;
    if (unbindParent) {
      unbindParent();
      unbindParent = null;
    }
    const snapshot = [...listeners];
    listeners.clear();
    const listenerErrors: unknown[] = [];
    for (const listener of snapshot) {
      try {
        listener(cancelReason);
      } catch (err) {
        listenerErrors.push(err);
      }
    }
    // R-CX-06: Deliver listener errors after all listeners finish
    for (const err of listenerErrors) {
      if (coreState.uncaughtErrorHandler) {
        coreState.uncaughtErrorHandler(err);
      } else {
        throw err;
      }
    }
  }

  if (parentOwner && parentOwner.ownerState === OwnerState.ACTIVE) {
    unbindParent = parentOwner.token.onCancelled(reason => {
      cancel(reason);
    });
  } else if (parentOwner && parentOwner.ownerState === OwnerState.DISPOSED) {
    cancel(parentOwner.token.reason ?? "MIX_RT_DISPOSED");
  }

  return { token, cancel };
}

export function createCancellationToken(
  parentOwner: Owner | null = coreState.currentOwner
): CancellationToken {
  return createCancellationSource(parentOwner).token;
}
