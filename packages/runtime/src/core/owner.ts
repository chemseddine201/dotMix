/**
 * @mix/runtime/core/owner — Ownership hierarchy, disposal (D-102), and detached roots (D-103).
 */

import {
  OwnerState,
  ComputationState,
  type EffectNode,
  type Owner
} from "./types.js";
import { coreState, unlinkComputation } from "./state.js";
import { createCancellationSource } from "./cancellation.js";

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

  // 1. Recursively dispose child owners
  for (const child of [...owner.children]) {
    disposeOwner(child);
  }
  owner.children.clear();

  // 2. Dispose and unlink all owned computations (D-102)
  for (const comp of [...owner.computations]) {
    comp.state = ComputationState.DISPOSED;
    if (comp.kind === "Effect") {
      comp.pendingRerun = false;
      comp.pendingState = ComputationState.CLEAN;
      if (comp.effectCleanup) {
        try {
          comp.effectCleanup();
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
      } finally {
        eff.effectCleanup = null;
      }
    }
    unlinkComputation(eff);
  }

  // 4. Cancel owner's cancellation token with reason MIX_RT_DISPOSED (R-CX-08)
  owner.cancellationSource.cancel("MIX_RT_DISPOSED");

  // 5. Run registered cleanups in reverse registration order
  const cleanups = owner.cleanups.splice(0, owner.cleanups.length);
  for (let i = cleanups.length - 1; i >= 0; i--) {
    cleanups[i]!();
  }
  owner.contexts.clear();
}

/**
 * D-103: Creates a root ownership scope with an explicit `dispose` callback.
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
