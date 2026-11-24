/**
 * @dotmix/runtime/core/owner — Ownership hierarchy, disposal, and detached roots.
 */

import {
  OwnerState,
  ComputationState,
  type EffectNode,
  type Owner
} from "./types.js";
import { coreState, findErrorHandler, runWithOwner, unlinkComputation } from "./state.js";
import { createCancellationSource } from "./cancellation.js";
import { reportError } from "./errors-reporter.js";

export function createOwnerInstance(
  parent: Owner | null,
  contextParent: Owner | null
): Owner {
  const cancellationSource = createCancellationSource(null);
  const owner: Owner = {
    ownerState: OwnerState.ACTIVE,
    parent,
    contextParent,
    children: new Set(),
    cleanups: [],
    computations: new Set(),
    contexts: new Map(),
    cancellationSource,
    token: cancellationSource.token,
    dispose() {
      disposeOwner(owner);
    }
  };
  if (parent && parent.ownerState === OwnerState.ACTIVE) {
    parent.children.add(owner);
  }
  return owner;
}

export function disposeOwner(owner: Owner): void {
  if (owner.ownerState === OwnerState.DISPOSED) {
    return;
  }
  owner.ownerState = OwnerState.DISPOSED;

  if (owner.parent) {
    owner.parent.children.delete(owner);
  }

  const errors: unknown[] = [];

  // 1. Recursively dispose child owners (guarantee all children are attempted)
  for (const child of [...owner.children]) {
    try {
      disposeOwner(child);
    } catch (err) {
      if (typeof AggregateError !== "undefined" && err instanceof AggregateError) {
        errors.push(...err.errors);
      } else {
        errors.push(err);
      }
    }
  }
  owner.children.clear();

  // 2. Dispose and unlink all owned computations
  for (const comp of [...owner.computations]) {
    comp.state = ComputationState.DISPOSED;
    if (comp.kind === "Effect") {
      coreState.suspendedEffects.delete(comp);
      comp.pendingRerun = false;
      comp.pendingState = ComputationState.CLEAN;
      if (comp.effectCleanup) {
        try {
          comp.effectCleanup();
        } catch (err) {
          errors.push(err);
        } finally {
          comp.effectCleanup = null;
        }
      }
    }
    unlinkComputation(comp);
  }
  owner.computations.clear();

  // 3. If owner itself is an EffectNode, unlink and transition its computation state
  if ("kind" in owner && (owner as EffectNode).kind === "Effect") {
    const eff = owner as EffectNode;
    eff.state = ComputationState.DISPOSED;
    eff.pendingRerun = false;
    eff.pendingState = ComputationState.CLEAN;
    if (eff.effectCleanup) {
      try {
        eff.effectCleanup();
      } catch (err) {
        errors.push(err);
      } finally {
        eff.effectCleanup = null;
      }
    }
    unlinkComputation(eff);
  }

  // 4. Cancel owner's cancellation token with reason MIX_RT_DISPOSED (R-CX-08)
  try {
    owner.cancellationSource.cancel("MIX_RT_DISPOSED");
  } catch (err) {
    errors.push(err);
  }

  // 5. Run registered cleanups in reverse registration order (guarantee all cleanups are attempted)
  const cleanups = owner.cleanups.splice(0, owner.cleanups.length);
  for (let i = cleanups.length - 1; i >= 0; i--) {
    try {
      cleanups[i]!();
    } catch (err) {
      errors.push(err);
    }
  }
  owner.contexts.clear();

  // 6. If any disposal step encountered errors, report combined aggregate
  if (errors.length > 0) {
    if (typeof AggregateError !== "undefined") {
      throw new AggregateError(
        errors,
        `[dotMix/runtime] ${errors.length} error(s) occurred during owner disposal`
      );
    }
    throw errors[0];
  }
}

/**
 *: Creates a root ownership scope with an explicit `dispose` callback.
 * When `detachedParent` is supplied, inherits context and error handling from `detachedParent`
 * without attaching to `detachedParent.children` automatic disposal.
 */
export function createRoot<T>(
  fn: (dispose: () => void) => T,
  detachedParent?: Owner | null
): T {
  const contextParent =
    detachedParent !== undefined ? detachedParent : coreState.currentOwner;
  const rootOwner = createOwnerInstance(null, contextParent);
  const prevOwner = coreState.currentOwner;
  const prevObserver = coreState.currentObserver;
  coreState.currentOwner = rootOwner;
  coreState.currentObserver = null;
  try {
    return fn(() => disposeOwner(rootOwner));
  } finally {
    coreState.currentOwner = prevOwner;
    coreState.currentObserver = prevObserver;
  }
}

export function onCleanup(fn: () => void): void {
  if (coreState.currentOwner && coreState.currentOwner.ownerState === OwnerState.ACTIVE) {
    coreState.currentOwner.cleanups.push(fn);
  }
}

/**
 * Runs `callback` once, after the current render pass has inserted this component's nodes.
 * A returned function runs when the component is disposed. Skipped if the owner is disposed first.
 * Under SSR it does nothing.
 */
export function onMount(callback: () => void | (() => void)): void {
  const owner = coreState.currentOwner;
  if (!owner || owner.ownerState !== OwnerState.ACTIVE) {
    return;
  }
  queueMicrotask(() => {
    if (owner.ownerState !== OwnerState.ACTIVE) {
      return;
    }
    let cleanup: void | (() => void);
    try {
      cleanup = runWithOwner(owner, callback);
    } catch (err) {
      const handler = findErrorHandler(owner);
      if (handler) {
        handler(err);
        return;
      }
      reportError(err, { source: "onMount" }, owner);
      throw err;
    }
    if (typeof cleanup === "function") {
      if (owner.ownerState === OwnerState.ACTIVE) {
        owner.cleanups.push(cleanup);
      } else {
        cleanup();
      }
    }
  });
}
