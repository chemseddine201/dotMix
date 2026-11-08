/**
 * packages/runtime/src/platform/abort.ts
 *
 * Mix v3.2.2 Platform Adapter for AbortSignal / AbortController (§3).
 * Interoperates with web, node, and worker environments using platform standard AbortSignal.
 */

import type { CancellationToken } from "../core/cancellation.js";
import { createCancellationTokenSource } from "../core/cancellation.js";

const tokenToSignalMap = new WeakMap<CancellationToken, AbortSignal>();
const signalToTokenMap = new WeakMap<AbortSignal, CancellationToken>();

/**
 * Converts a pure Mix CancellationToken into a platform AbortSignal.
 * Cached per token via WeakMap. If token is already aborted, returns an aborted signal.
 */
export function toAbortSignal(token: CancellationToken): AbortSignal {
  const cached = tokenToSignalMap.get(token);
  if (cached) return cached;

  if (token.aborted) {
    const signal = typeof AbortSignal.abort === "function"
      ? AbortSignal.abort(token.reason)
      : (() => {
          const c = new AbortController();
          c.abort(token.reason);
          return c.signal;
        })();
    tokenToSignalMap.set(token, signal);
    signalToTokenMap.set(signal, token);
    return signal;
  }

  const controller = new AbortController();
  const signal = controller.signal;
  tokenToSignalMap.set(token, signal);
  signalToTokenMap.set(signal, token);

  token.subscribe((reason) => {
    controller.abort(reason);
  });

  return signal;
}

/**
 * Converts a platform AbortSignal into a pure Mix CancellationToken.
 * Cached per signal via WeakMap. If signal is already aborted, returns an aborted token.
 */
export function fromAbortSignal(signal: AbortSignal): CancellationToken {
  const cached = signalToTokenMap.get(signal);
  if (cached) return cached;

  if (signal.aborted) {
    const source = createCancellationTokenSource();
    source.abort(signal.reason);
    signalToTokenMap.set(signal, source.token);
    tokenToSignalMap.set(source.token, signal);
    return source.token;
  }

  const source = createCancellationTokenSource();
  signalToTokenMap.set(signal, source.token);
  tokenToSignalMap.set(source.token, signal);

  signal.addEventListener(
    "abort",
    () => {
      source.abort(signal.reason);
    },
    { once: true }
  );

  return source.token;
}
