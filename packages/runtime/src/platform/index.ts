/**
 * @mix/runtime/platform — Platform cancellation bridges and adapters.
 */

import type { CancellationToken } from "../core/index.js";

export function toAbortSignal(token: CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancelled) {
    controller.abort();
  } else {
    token.onCancelled(() => controller.abort());
  }
  return controller.signal;
}
