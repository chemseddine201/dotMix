/**
 * @mix/runtime/core/primitives — Signal, Computed, and Effect primitives.
 */

import { MixError, DiagnosticCodes } from "../errors.js";
import {
  OwnerState,
  ComputationState,
  type ComputationNode,
  type ComputationStateValue,
  type Computed,
  type ComputedNode,
  type EffectNode,
  type Signal,
  type SignalNode,
  type SignalOptions,
  type SourceNode
} from "./types.js";
import { coreState, untrack } from "./state.js";
import { createOwnerInstance } from "./owner.js";
import {
  enqueueEffect,
  flushSync,
  mark,
  runEffect,
  trackSourceRead,
  updateComputedIfNecessary
} from "./scheduler.js";

export const SIGNAL_BRAND = Symbol.for("@mix/signal");

export function isSignal(val: unknown): val is Signal<unknown> | Computed<unknown> {
  return (
    typeof val === "function" &&
    (val as unknown as Record<symbol, unknown>)[SIGNAL_BRAND] === true
  );
}

export function signal<T>(initialValue: T, options?: SignalOptions<T>): Signal<T> {
  const node: SignalNode<T> = {
    kind: "Signal",
    value: initialValue,
    equals: options?.equals !== undefined ? options.equals : Object.is,
    observers: new Set()
  };

  const read = (): T => {
    trackSourceRead(node);
    return node.value;
  };

  read.set = (nextValue: T | ((prev: T) => T)): T => {
    // I-5: Writing to a Signal inside a Computed evaluation is strictly forbidden
    if (coreState.inComputedDepth > 0) {
      throw new MixError(
        DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE,
        "Cannot write to a Signal inside a Computed evaluation (I-5)."
      );
    }
    const resolved =
      typeof nextValue === "function"
        ? (nextValue as (prev: T) => T)(node.value)
        : nextValue;

    if (node.equals !== false && node.equals(node.value, resolved)) {
      return node.value;
    }

    node.value = resolved;
    for (const obs of [...node.observers]) {
      mark(obs, ComputationState.DIRTY);
    }

    if (coreState.batchDepth === 0 && !coreState.isFlushing) {
      flushSync();
    }
    return node.value;
  };

  read.peek = (): T => node.value;

  Object.defineProperty(read, SIGNAL_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return read;
}

export function computed<T>(
  fn: (prev: T | undefined) => T,
  options?: SignalOptions<T>
): Computed<T> {
  const node: ComputedNode<T> = {
    kind: "Computed",
    state: ComputationState.DIRTY,
    fn,
    value: undefined,
    hasValue: false,
    equals: options?.equals !== undefined ? options.equals : Object.is,
    error: null,
    owner: coreState.currentOwner,
    sources: [],
    readSet: new Set(),
    observers: new Set()
  };

  if (coreState.currentOwner && coreState.currentOwner.ownerState === OwnerState.ACTIVE) {
    coreState.currentOwner.computations.add(node as ComputationNode);
  }

  const read = (): T => {
    if (node.state === ComputationState.DISPOSED) {
      return node.value as T;
    }
    trackSourceRead(node);
    updateComputedIfNecessary(node);
    if (node.error !== null) {
      throw node.error.value;
    }
    return node.value as T;
  };

  read.peek = (): T => {
    if (node.state !== ComputationState.DISPOSED) {
      untrack(() => updateComputedIfNecessary(node));
    }
    if (node.error !== null) {
      throw node.error.value;
    }
    return node.value as T;
  };

  Object.defineProperty(read, SIGNAL_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return read;
}

export function createEffect(fn: () => void | (() => void)): void {
  if (coreState.currentOwner && coreState.currentOwner.ownerState === OwnerState.DISPOSED) {
    return;
  }

  const baseOwner = createOwnerInstance(coreState.currentOwner, coreState.currentOwner);
  const effect: EffectNode = Object.assign(baseOwner, {
    kind: "Effect" as const,
    state: ComputationState.DIRTY as ComputationStateValue,
    pendingRerun: false,
    pendingState: ComputationState.CLEAN as ComputationStateValue,
    queued: false,
    runsInFlush: 0,
    fn,
    effectCleanup: null,
    sources: [] as SourceNode[],
    readSet: new Set<SourceNode>()
  });

  if (coreState.batchDepth > 0 || coreState.isFlushing) {
    enqueueEffect(effect);
  } else {
    // Run initial effect synchronously and flush any queued deferred reruns
    const deferredErrors: unknown[] = [];
    coreState.isFlushing = true;
    try {
      coreState.touchedEffectsInFlush.add(effect);
      effect.runsInFlush = 1;
      runEffect(effect, deferredErrors);
    } finally {
      coreState.isFlushing = false;
    }
    if (coreState.effectQueue.length > 0) {
      try {
        flushSync();
      } catch (flushErr) {
        deferredErrors.push(flushErr);
      }
    } else {
      effect.runsInFlush = 0;
      coreState.touchedEffectsInFlush.delete(effect);
    }
    if (deferredErrors.length > 0) {
      throw deferredErrors[0]!;
    }
  }
}

export const createSignal = signal;
export const createMemo = computed;
