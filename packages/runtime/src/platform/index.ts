/**
 * @mix/runtime/platform — Platform cancellation bridges (`toAbortSignal` and `fromAbortSignal`).
 *
 * Implements D-104 and MIX_SPEC_v3.2.2.md §3.
 */

import { createCancellationSource } from "../core/index.js";
import type { CancellationToken } from "../core/index.js";

const abortSignalCache = new WeakMap<CancellationToken, AbortSignal>();

/**
 * Bridges a platform-neutral `CancellationToken` to a browser/winterTC `AbortSignal`.
 * Cached per token via `WeakMap` (`MIX_SPEC_v3.2.2.md` §3).
 */
export function toAbortSignal(token: CancellationToken): AbortSignal {
  const existing = abortSignalCache.get(token);
  if (existing) {
    return existing;
  }

  const controller = new AbortController();
  if (token.isCancelled) {
    controller.abort(token.reason);
  } else {
    token.onCancelled(reason => {
      controller.abort(reason);
    });
  }

  abortSignalCache.set(token, controller.signal);
  return controller.signal;
}

/**
 * Bridges a platform `AbortSignal` into a platform-neutral `CancellationToken`.
 */
export function fromAbortSignal(signal: AbortSignal): CancellationToken {
  const source = createCancellationSource(null);
  if (signal.aborted) {
    source.cancel(signal.reason ?? "MIX_RT_ABORTED");
  } else {
    signal.addEventListener(
      "abort",
      () => {
        source.cancel(signal.reason ?? "MIX_RT_ABORTED");
      },
      { once: true }
    );
  }
  return source.token;
}
