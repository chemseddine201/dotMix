/**
 * packages/runtime/src/core/cancellation.ts
 *
 * Mix v3.2.2 Pure Cancellation Subsystem (§3).
 * Pure ECMAScript with zero Web / Node API dependencies (AGENTS.md Part I & spec §3).
 */

import { MixError } from "./errors.js";
import { activeConfig } from "./config.js";

// --- 1. Frozen Cancellation Interfaces (§3) ---

export interface CancellationToken {
  readonly aborted: boolean;
  readonly reason: unknown;
  subscribe(listener: (reason: unknown) => void): () => void;
  throwIfAborted(): void;
}

export interface CancellationTokenSource {
  readonly token: CancellationToken;
  abort(reason?: unknown): void;
}

interface SubscriberEntry {
  fn: (reason: unknown) => void;
  active: boolean;
}

// --- 2. CancellationToken Implementation ---

class CancellationTokenImpl implements CancellationToken {
  private _aborted = false;
  private _reason: unknown = undefined;
  private _subscribers: Set<SubscriberEntry> | null = new Set<SubscriberEntry>();

  get aborted(): boolean {
    return this._aborted;
  }

  get reason(): unknown {
    return this._reason;
  }

  subscribe(listener: (reason: unknown) => void): () => void {
    // R-CX-04: subscribe after abort calls listener immediately & synchronously
    if (this._aborted) {
      try {
        listener(this._reason);
      } catch (err) {
        activeConfig.onUncaughtError(err);
      }
      return () => {};
    }

    const entry: SubscriberEntry = { fn: listener, active: true };
    if (!this._subscribers) {
      this._subscribers = new Set<SubscriberEntry>();
    }
    this._subscribers.add(entry);

    // R-CX-05: Unsubscribe function is idempotent
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      entry.active = false;
      if (this._subscribers) {
        this._subscribers.delete(entry);
      }
    };
  }

  throwIfAborted(): void {
    // R-CX-07: throwIfAborted throws reason if token is aborted
    if (this._aborted) {
      throw this._reason;
    }
  }

  _abort(reason?: unknown): void {
    // R-CX-01: abort() is idempotent. Calling it a second time does nothing, does not change reason.
    if (this._aborted) {
      return;
    }

    this._aborted = true;
    // R-CX-02: Default reason if not provided
    this._reason = reason !== undefined
      ? reason
      : new MixError("MIX_RT_ABORTED", "The operation was aborted.");

    if (!this._subscribers || this._subscribers.size === 0) {
      this._subscribers = null;
      return;
    }

    // R-CX-03: Snapshot taken at moment of abort, called synchronously, once per listener
    const snapshot = Array.from(this._subscribers);
    this._subscribers.clear();
    this._subscribers = null;

    const errors: unknown[] = [];
    for (const entry of snapshot) {
      // If unsubscribed before its turn, it must NOT be called (R-CX-03)
      if (entry.active) {
        entry.active = false;
        try {
          entry.fn(this._reason);
        } catch (err) {
          // R-CX-06: Throwing listener does not abort dispatch; remaining listeners continue
          errors.push(err);
        }
      }
    }

    // Uncaught listener errors dispatched after dispatch finishes (R-CX-06)
    if (errors.length > 0) {
      for (const err of errors) {
        activeConfig.onUncaughtError(err);
      }
    }
  }
}

// --- 3. Factory & Static Constants (§3) ---

export function createCancellationTokenSource(): CancellationTokenSource {
  const token = new CancellationTokenImpl();
  return {
    get token(): CancellationToken {
      return token;
    },
    abort(reason?: unknown): void {
      token._abort(reason);
    }
  };
}

export const neverCancelledToken: CancellationToken = Object.freeze({
  aborted: false,
  reason: undefined,
  subscribe: () => () => {},
  throwIfAborted: () => {}
});
