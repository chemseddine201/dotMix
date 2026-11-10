/**
 * @mix/runtime/core/scheduler — Push-Pull reactive scheduler, batching, and cycle detection (D-101, D-102).
 */

import {
  OwnerState,
  ComputationState,
  ReactiveCycleError,
  type ComputationNode,
  type ComputationStateValue,
  type ComputedNode,
  type EffectNode,
  type Owner,
  type OwnerStateValue,
  type SchedulerOptions,
  type SourceNode
} from "./types.js";
import {
  coreState,
  findErrorHandler,
  isOwnerSuspended,
  unlinkComputation
} from "./state.js";
import { disposeOwner } from "./owner.js";

export function configureScheduler(options: SchedulerOptions): void {
  if (options.maxEffectIterations !== undefined) {
    coreState.maxEffectIterations = Math.max(1, options.maxEffectIterations);
  }
  if (options.onUncaughtError !== undefined) {
    coreState.uncaughtErrorHandler = options.onUncaughtError;
  }
}

export function enqueueEffect(effect: EffectNode): void {
  if (
    effect.ownerState === OwnerState.DISPOSED ||
    effect.state === ComputationState.DISPOSED
  ) {
    return;
  }
  if (isOwnerSuspended(effect)) {
    coreState.suspendedEffects.add(effect);
    return;
  }
  if (!effect.queued) {
    effect.queued = true;
    coreState.effectQueue.push(effect);
  }
}

export function setOwnerSuspended(owner: Owner | null, suspended: boolean): void {
  if (!owner || owner.ownerState === OwnerState.DISPOSED) {
    return;
  }
  owner.suspended = suspended;
  if (!suspended && coreState.suspendedEffects.size > 0) {
    for (const eff of [...coreState.suspendedEffects]) {
      if (
        eff.ownerState === OwnerState.DISPOSED ||
        eff.state === ComputationState.DISPOSED
      ) {
        coreState.suspendedEffects.delete(eff);
        continue;
      }
      if (!isOwnerSuspended(eff)) {
        coreState.suspendedEffects.delete(eff);
        if (
          eff.state === ComputationState.DIRTY ||
          eff.state === ComputationState.CHECK
        ) {
          enqueueEffect(eff);
        }
      }
    }
    if (coreState.batchDepth === 0 && !coreState.isFlushing && coreState.effectQueue.length > 0) {
      flushSync();
    }
  }
}

/**
 * Push phase: marks dependents as `CHECK` or `DIRTY` while respecting `RUNNING` state
 * and independent `pendingRerun` (D-101, R-RX-04).
 */
export function mark(
  node: ComputationNode,
  nextState: typeof ComputationState.CHECK | typeof ComputationState.DIRTY
): void {
  if (node.state === ComputationState.DISPOSED) {
    return;
  }
  if (node.kind === "Effect") {
    if (node.ownerState === OwnerState.DISPOSED) {
      return;
    }
    if (node.state === ComputationState.RUNNING) {
      // D-101 / R-RX-04: Never execute re-entrantly; record independent pendingRerun
      node.pendingRerun = true;
      if (nextState > node.pendingState) {
        node.pendingState = nextState;
      }
      return;
    }
    if (node.state >= nextState) {
      return;
    }
    const prevState = node.state;
    node.state = nextState;
    if (prevState === ComputationState.CLEAN) {
      enqueueEffect(node);
    }
  } else {
    if (node.state === ComputationState.RUNNING) {
      return;
    }
    if (node.state >= nextState) {
      return;
    }
    node.state = nextState;
    for (const obs of [...node.observers]) {
      mark(obs, ComputationState.CHECK);
    }
  }
}

/**
 * Pull phase: validates sources in read order with mandatory lazy `break` on `DIRTY` (R-RX-01).
 */
export function validateSources(node: ComputationNode): void {
  for (const src of [...node.sources]) {
    if (src.kind === "Computed") {
      updateComputedIfNecessary(src as ComputedNode<unknown>);
    }
    if (node.state === ComputationState.DIRTY) {
      break; // R-RX-01
    }
  }
}

export function endSourceTracking(
  node: ComputationNode,
  prevSources: SourceNode[]
): void {
  for (const oldSrc of prevSources) {
    if (!node.readSet.has(oldSrc)) {
      oldSrc.observers.delete(node);
    }
  }
}

export function updateComputedIfNecessary<T>(c: ComputedNode<T>): void {
  if (c.state === ComputationState.DISPOSED) {
    return;
  }
  if (c.state === ComputationState.RUNNING) {
    throw new ReactiveCycleError("Circular dependency detected while evaluating computed node.");
  }
  if (c.state === ComputationState.CHECK) {
    validateSources(c as ComputationNode);
    if ((c.state as ComputationStateValue) === ComputationState.CHECK) {
      c.state = ComputationState.CLEAN;
      return;
    }
  }
  if (c.state !== ComputationState.DIRTY) {
    return;
  }

  const prevObserver = coreState.currentObserver;
  const prevSources = c.sources;
  c.sources = [];
  c.readSet.clear();
  c.state = ComputationState.RUNNING;
  coreState.currentObserver = c as ComputationNode;
  coreState.inComputedDepth++;

  let changed = false;
  try {
    const nextVal = c.fn(c.value);
    if (c.error !== null) {
      changed = true;
      c.error = null;
      c.value = nextVal;
      c.hasValue = true;
    } else if (!c.hasValue) {
      changed = true;
      c.hasValue = true;
      c.value = nextVal;
    } else if (c.equals === false || !c.equals(c.value as T, nextVal)) {
      changed = true;
      c.value = nextVal;
    }
  } catch (err) {
    // R-RX-02: Both entering an error state and changing error value count as a change
    changed = c.error === null || !Object.is(c.error.value, err);
    c.error = { value: err };
  } finally {
    coreState.inComputedDepth--;
    coreState.currentObserver = prevObserver;
    endSourceTracking(c as ComputationNode, prevSources);
    if ((c.state as ComputationStateValue) === ComputationState.RUNNING) {
      c.state = ComputationState.CLEAN;
    }
  }

  if (changed) {
    // R-RX-03: Confirmation upgrades CHECK -> DIRTY only; RUNNING observers are not touched
    // unless they already flagged pendingRerun = CHECK during their current run
    for (const obs of [...c.observers]) {
      if (obs.state === ComputationState.CHECK) {
        obs.state = ComputationState.DIRTY;
      } else if (
        obs.kind === "Effect" &&
        obs.state === ComputationState.RUNNING &&
        obs.pendingRerun &&
        obs.pendingState === ComputationState.CHECK
      ) {
        obs.pendingState = ComputationState.DIRTY;
      }
    }
  }
}

export function runEffect(effect: EffectNode, deferredErrors: unknown[]): void {
  if (
    effect.ownerState === OwnerState.DISPOSED ||
    effect.state === ComputationState.DISPOSED
  ) {
    return;
  }

  // Dispose child owners created during previous effect execution
  for (const child of [...effect.children]) {
    disposeOwner(child);
  }
  effect.children.clear();

  for (const comp of [...effect.computations]) {
    comp.state = ComputationState.DISPOSED;
    unlinkComputation(comp);
  }
  effect.computations.clear();

  // Execute previous effect cleanup
  if (effect.effectCleanup) {
    const cleanup = effect.effectCleanup;
    effect.effectCleanup = null;
    cleanup();
  }
  const cleanups = effect.cleanups.splice(0, effect.cleanups.length);
  for (let i = cleanups.length - 1; i >= 0; i--) {
    cleanups[i]!();
  }

  const prevOwner = coreState.currentOwner;
  const prevObserver = coreState.currentObserver;
  const prevSources = effect.sources;

  effect.sources = [];
  effect.readSet.clear();
  effect.state = ComputationState.RUNNING;
  effect.pendingRerun = false;
  effect.pendingState = ComputationState.CLEAN;

  coreState.currentOwner = effect;
  coreState.currentObserver = effect;

  let thrownError: { value: unknown } | null = null;
  try {
    const ret = effect.fn();
    if (typeof ret === "function") {
      effect.effectCleanup = ret;
    }
  } catch (err) {
    thrownError = { value: err };
  } finally {
    coreState.currentOwner = prevOwner;
    coreState.currentObserver = prevObserver;
    endSourceTracking(effect, prevSources);

    if (thrownError !== null) {
      // D-101: Reset state to CLEAN, run any newly registered cleanups, and preserve scheduler queue
      if ((effect.ownerState as OwnerStateValue) !== OwnerState.DISPOSED) {
        effect.state = ComputationState.CLEAN;
      }
      effect.pendingRerun = false;
      effect.pendingState = ComputationState.CLEAN;
      const errCleanups = effect.cleanups.splice(0, effect.cleanups.length);
      for (let i = errCleanups.length - 1; i >= 0; i--) {
        try {
          errCleanups[i]!();
        } catch {
          // ignore secondary cleanup error
        }
      }
      const handler = findErrorHandler(effect);
      if (handler) {
        handler(thrownError.value);
      } else {
        deferredErrors.push(thrownError.value);
      }
    } else if (
      (effect.ownerState as OwnerStateValue) !== OwnerState.DISPOSED &&
      (effect.state as ComputationStateValue) !== ComputationState.DISPOSED
    ) {
      if (effect.pendingRerun) {
        // D-101 / R-RX-04: Transition to pendingState (CHECK or DIRTY) and re-enqueue for deferred rerun
        effect.state =
          effect.pendingState >= ComputationState.CHECK
            ? effect.pendingState
            : ComputationState.DIRTY;
        effect.pendingRerun = false;
        effect.pendingState = ComputationState.CLEAN;
        enqueueEffect(effect);
      } else {
        effect.state = ComputationState.CLEAN;
      }
    }
  }
}

export function flushSync(): void {
  if (coreState.isFlushing) {
    return;
  }
  coreState.isFlushing = true;
  const deferredErrors: unknown[] = [];

  try {
    while (coreState.queueIndex < coreState.effectQueue.length) {
      const effect = coreState.effectQueue[coreState.queueIndex++]!;
      effect.queued = false;

      if (
        effect.ownerState === OwnerState.DISPOSED ||
        effect.state === ComputationState.DISPOSED ||
        effect.state === ComputationState.CLEAN
      ) {
        continue;
      }

      if (isOwnerSuspended(effect)) {
        coreState.suspendedEffects.add(effect);
        continue;
      }

      if (effect.state === ComputationState.CHECK) {
        validateSources(effect);
        if ((effect.state as ComputationStateValue) === ComputationState.CHECK) {
          effect.state = ComputationState.CLEAN;
          continue;
        }
      }

      if ((effect.state as ComputationStateValue) === ComputationState.DIRTY) {
        coreState.touchedEffectsInFlush.add(effect);
        effect.runsInFlush++;
        if (effect.runsInFlush > coreState.maxEffectIterations) {
          // D-101 / R-RX-06: Abort runaway loop, reset effect to CLEAN, and continue flushing remaining queue
          effect.state = ComputationState.CLEAN;
          effect.pendingRerun = false;
          effect.pendingState = ComputationState.CLEAN;
          const cycleErr = new ReactiveCycleError(
            `Reactive cycle detected: effect exceeded maximum iteration ceiling (${coreState.maxEffectIterations}).`
          );
          const handler = findErrorHandler(effect);
          if (handler) {
            handler(cycleErr);
          } else {
            deferredErrors.push(cycleErr);
          }
          continue;
        }
        runEffect(effect, deferredErrors);
      }
    }
  } finally {
    coreState.effectQueue.length = 0;
    coreState.queueIndex = 0;
    for (const eff of coreState.touchedEffectsInFlush) {
      eff.runsInFlush = 0;
    }
    coreState.touchedEffectsInFlush.clear();
    coreState.isFlushing = false;
  }

  if (deferredErrors.length > 0) {
    throw deferredErrors[0]!;
  }
}

export function batch<T>(fn: () => T): T {
  coreState.batchDepth++;
  try {
    return fn();
  } finally {
    coreState.batchDepth--;
    if (
      coreState.batchDepth === 0 &&
      !coreState.isFlushing &&
      coreState.effectQueue.length > 0
    ) {
      flushSync();
    }
  }
}

export function trackSourceRead(sourceNode: SourceNode): void {
  if (
    coreState.currentObserver !== null &&
    coreState.currentObserver.state !== ComputationState.DISPOSED
  ) {
    // R-RX-05: Subscribe immediately on first read during RUNNING
    if (!coreState.currentObserver.readSet.has(sourceNode)) {
      coreState.currentObserver.readSet.add(sourceNode);
      coreState.currentObserver.sources.push(sourceNode);
      sourceNode.observers.add(coreState.currentObserver);
    }
  }
}
