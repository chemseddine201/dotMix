/**
 * @mix/runtime/core/state — Shared active tracking state and graph unlinking helpers.
 */

import type { ComputationNode, EffectNode, Owner } from "./types.js";

export interface CoreKernelState {
  currentOwner: Owner | null;
  currentObserver: ComputationNode | null;
  inComputedDepth: number;
  batchDepth: number;
  isFlushing: boolean;
  readonly effectQueue: EffectNode[];
  queueIndex: number;
  readonly touchedEffectsInFlush: Set<EffectNode>;
  maxEffectIterations: number;
  uncaughtErrorHandler: ((error: unknown) => void) | null;
  globalGenerationCounter: number;
}

export const coreState: CoreKernelState = {
  currentOwner: null,
  currentObserver: null,
  inComputedDepth: 0,
  batchDepth: 0,
  isFlushing: false,
  effectQueue: [],
  queueIndex: 0,
  touchedEffectsInFlush: new Set<EffectNode>(),
  maxEffectIterations: 1000,
  uncaughtErrorHandler: null,
  globalGenerationCounter: 0
};

export function getCurrentOwner(): Owner | null {
  return coreState.currentOwner;
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = coreState.currentOwner;
  coreState.currentOwner = owner;
  try {
    return fn();
  } finally {
    coreState.currentOwner = prev;
  }
}

export function untrack<T>(fn: () => T): T {
  const prev = coreState.currentObserver;
  coreState.currentObserver = null;
  try {
    return fn();
  } finally {
    coreState.currentObserver = prev;
  }
}

export function unlinkComputation(node: ComputationNode): void {
  for (const src of node.sources) {
    src.observers.delete(node);
  }
  node.sources.length = 0;
  node.readSet.clear();
  if (node.kind === "Computed") {
    for (const obs of [...node.observers]) {
      const idx = obs.sources.indexOf(node);
      if (idx !== -1) {
        obs.sources.splice(idx, 1);
      }
      obs.readSet.delete(node);
    }
    node.observers.clear();
  }
}

export function findErrorHandler(owner: Owner | null): ((err: unknown) => void) | null {
  let cursor: Owner | null = owner;
  while (cursor !== null) {
    if (cursor.errorHandler) {
      return cursor.errorHandler;
    }
    cursor = cursor.parent ?? cursor.contextParent;
  }
  return coreState.uncaughtErrorHandler;
}
