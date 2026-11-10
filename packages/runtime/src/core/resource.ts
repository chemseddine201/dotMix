/**
 * @mix/runtime/core/resource — Generation-checked async resource primitive (D-104),
 * refs, and component props helpers.
 */

import {
  OwnerState,
  type CancellationSource,
  type RefObject,
  type Resource,
  type ResourceContext
} from "./types.js";
import { coreState } from "./state.js";
import { createCancellationSource } from "./cancellation.js";
import { batch } from "./scheduler.js";
import { signal } from "./primitives.js";

/**
 * D-104 / R-CX-09: Generation-checked async resource primitive.
 * Automatically supersedes prior in-flight requests (`MIX_RT_SUPERSEDED`),
 * cancels on Owner disposal (`MIX_RT_DISPOSED`), and discards stale results.
 */
export function createResource<T>(
  fetcher: (ctx: ResourceContext) => Promise<T>,
  initialValue?: T
): Resource<T> {
  const owner = coreState.currentOwner;
  const data = signal<T | undefined>(initialValue);
  const loading = signal<boolean>(false);
  const error = signal<unknown>(null);

  let currentGen = 0;
  let activeSource: CancellationSource | null = null;

  function cancelActive(reason: unknown = "MIX_RT_CANCELLED"): void {
    if (activeSource) {
      const src = activeSource;
      activeSource = null;
      src.cancel(reason);
    }
  }

  if (owner) {
    owner.cleanups.push(() => {
      currentGen++;
      cancelActive("MIX_RT_DISPOSED");
    });
  }

  async function reload(): Promise<T | undefined> {
    if (owner && owner.ownerState === OwnerState.DISPOSED) {
      return undefined;
    }
    // R-CX-09: Starting a new fetch cancels the previous in-flight fetch with MIX_RT_SUPERSEDED
    if (activeSource) {
      cancelActive("MIX_RT_SUPERSEDED");
    }

    const myGen = ++currentGen;
    const source = createCancellationSource(owner, myGen);
    activeSource = source;

    loading.set(true);
    error.set(null);

    try {
      const result = await fetcher({
        token: source.token,
        generation: myGen
      });

      // D-104 / R-CX-09: Only apply result if generation matches currentGen and token is not cancelled
      if (
        myGen !== currentGen ||
        source.token.isCancelled ||
        (owner && owner.ownerState === OwnerState.DISPOSED)
      ) {
        return undefined;
      }

      batch(() => {
        data.set(() => result);
        loading.set(false);
      });
      return result;
    } catch (err) {
      if (
        myGen !== currentGen ||
        source.token.isCancelled ||
        (owner && owner.ownerState === OwnerState.DISPOSED)
      ) {
        return undefined;
      }
      batch(() => {
        error.set(err);
        loading.set(false);
      });
      return undefined;
    } finally {
      if (activeSource === source) {
        activeSource = null;
      }
    }
  }

  return {
    data,
    loading,
    error,
    generation: () => currentGen,
    reload,
    cancel: cancelActive
  };
}

export function createRef<T = unknown>(initialValue: T | null = null): RefObject<T> {
  return { current: initialValue };
}

let activeComponentProps: Record<string, unknown> | null = null;

export function withComponentProps<T>(
  props: Record<string, unknown> | null | undefined,
  fn: () => T
): T {
  const prev = activeComponentProps;
  activeComponentProps = props ?? {};
  try {
    return fn();
  } finally {
    activeComponentProps = prev;
  }
}

export function defineProps<P = Record<string, unknown>>(defaults?: Partial<P>): P {
  const target: Record<string, unknown> = { ...(defaults ?? {}) };
  if (activeComponentProps) {
    Object.defineProperties(
      target,
      Object.getOwnPropertyDescriptors(activeComponentProps)
    );
  }
  return target as P;
}

export function getActiveComponentProps(): Record<string, unknown> | null {
  return activeComponentProps;
}
