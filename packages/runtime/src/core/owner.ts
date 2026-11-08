/**
 * packages/runtime/src/core/owner.ts
 *
 * Mix v3.2.2 Owner, Lifecycle, and Context Subsystem (§2.5).
 * Pure ECMAScript with zero Web / Node API dependencies (AGENTS.md Part I).
 */

import { MixError } from "./errors.js";
import { activeConfig } from "./config.js";
import { OwnerState, type Owner, type CreateRoot } from "../types.js";

// --- 1. Global Owner & Computation Execution State ---

let currentOwner: Owner | null = null;
let computing = false;

export function getCurrentOwner(): Owner | null {
  return currentOwner;
}

export function setCurrentOwner(owner: Owner | null): void {
  currentOwner = owner;
}

export function getOwner(): Owner | null {
  return currentOwner;
}

export function isComputing(): boolean {
  return computing;
}

export function setComputing(val: boolean): void {
  computing = val;
}

// --- 2. Owner Tree Node Implementation ---

export class OwnerNode implements Owner {
  readonly kind: "Root" | "Component" | "Effect";
  parent: Owner | null;
  children: Set<Owner> | null = null;
  context: Map<symbol, unknown> | null = null;
  scopeCleanups: (() => void)[] | null = null;
  errorHandlers: ((err: unknown) => boolean)[] | null = null;
  ownerState: OwnerState = OwnerState.ACTIVE;

  constructor(kind: "Root" | "Component" | "Effect", parent: Owner | null = null) {
    this.kind = kind;
    this.parent = parent;
  }

  dispose(): void {
    disposeOwner(this);
  }
}

// --- 3. createRoot (FROZEN signature §2.5) ---

export const createRoot: CreateRoot = <T>(
  fn: (dispose: () => void) => T,
  detachedParent?: Owner | null
): T => {
  // R-OW-02:
  // undefined -> currentOwner
  // null -> completely isolated root (parent = null)
  // Owner -> explicit detachedParent
  const parent = detachedParent === undefined ? currentOwner : detachedParent;

  const root = new OwnerNode("Root", parent);
  // R-OW-01: Root is NOT added to parent.children and not disposed by any ancestor!

  const prevOwner = currentOwner;
  currentOwner = root;
  try {
    return fn(() => {
      disposeOwner(root);
    });
  } finally {
    currentOwner = prevOwner;
  }
};

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
  }
}

// --- 4. Cleanup & Error Handler Registration ---

export function onCleanup(fn: () => void): void {
  // R-OW-08: onCleanup inside computed is strictly forbidden
  if (computing) {
    throw new MixError("MIX_RT_OWNER_IN_COMPUTED", "Calling onCleanup inside a computed expression is strictly forbidden.");
  }

  // R-OW-06: onCleanup outside an owner emits warning in __DEV__
  if (!currentOwner) {
    activeConfig.onWarning({
      code: "MIX_RT_NO_OWNER",
      message: "onCleanup called outside of an active owner scope."
    });
    return;
  }

  if (!currentOwner.scopeCleanups) {
    currentOwner.scopeCleanups = [];
  }
  currentOwner.scopeCleanups.push(fn);
}

export function onError(handler: (err: unknown) => boolean): void {
  if (computing) {
    throw new MixError("MIX_RT_OWNER_IN_COMPUTED", "Calling onError inside a computed expression is strictly forbidden.");
  }

  if (!currentOwner) {
    activeConfig.onWarning({
      code: "MIX_RT_NO_OWNER",
      message: "onError called outside of an active owner scope."
    });
    return;
  }

  if (!currentOwner.errorHandlers) {
    currentOwner.errorHandlers = [];
  }
  currentOwner.errorHandlers.push(handler);
}

// --- 5. Error Routing Algorithm (R-OW-05) ---

export function routeError(owner: Owner | null, error: unknown): void {
  let curr = owner;
  let currentErr = error;

  while (curr) {
    if (curr.errorHandlers && curr.errorHandlers.length > 0) {
      for (const handler of curr.errorHandlers) {
        try {
          const handled = handler(currentErr);
          if (handled === true) {
            return; // Handled! Stop propagation.
          }
        } catch (handlerErr) {
          // If handler itself throws, propagation continues upward with MIX_RT_ERROR_HANDLER_FAILED
          // carrying original error in cause
          currentErr = new MixError(
            "MIX_RT_ERROR_HANDLER_FAILED",
            "An error occurred within an onError handler during error routing.",
            { handlerError: String(handlerErr) },
            { cause: currentErr }
          );
          break; // Move to next parent with new error
        }
      }
    }
    curr = curr.parent;
  }

  // Unhandled error reached the root
  activeConfig.onUncaughtError(currentErr);
}

// --- 6. Deterministic Teardown Algorithm (R-OW-03 & R-OW-04) ---

export function disposeOwner(owner: Owner): void {
  // Step 1: ownerState = DISPOSED (idempotent)
  if (owner.ownerState === OwnerState.DISPOSED) {
    return;
  }
  owner.ownerState = OwnerState.DISPOSED;

  const cleanupErrors: unknown[] = [];

  // Step 2: Children disposed in reverse order of creation
  if (owner.children && owner.children.size > 0) {
    const children = Array.from(owner.children);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]!;
      try {
        disposeOwner(child);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    owner.children.clear();
  }

  // Step 3: scopeCleanups in LIFO order
  if (owner.scopeCleanups && owner.scopeCleanups.length > 0) {
    for (let i = owner.scopeCleanups.length - 1; i >= 0; i--) {
      const cleanup = owner.scopeCleanups[i]!;
      try {
        cleanup();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    owner.scopeCleanups.length = 0;
  }

  // Step 4: Detach from parent.children (if parent is not already disposed)
  if (owner.parent && owner.parent.children) {
    owner.parent.children.delete(owner);
  }

  // Step 5: If Computation (e.g. Effect), disconnect from sources
  if ("sources" in owner && Array.isArray((owner as any).sources)) {
    const comp = owner as any;
    comp.state = 4; // ComputationState.DISPOSED
    comp.disposed = true;
    for (const s of comp.sources) {
      if (s && s.observers) {
        s.observers.delete(comp);
      }
    }
    comp.sources.length = 0;
  }

  // Route any cleanup errors upward to parent (R-OW-04)
  if (cleanupErrors.length > 0) {
    const errToRoute = cleanupErrors.length === 1
      ? cleanupErrors[0]
      : new AggregateError(cleanupErrors, "Cleanup errors");
    routeError(owner.parent, errToRoute);
  }
}

/**
 * Resets nested children and cleanups before an Effect re-runs (R-RX-14).
 * The owner itself remains ACTIVE.
 */
export function resetOwnerCleanups(owner: Owner): void {
  const cleanupErrors: unknown[] = [];

  // 1. Children disposed in reverse creation order
  if (owner.children && owner.children.size > 0) {
    const children = Array.from(owner.children);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]!;
      try {
        disposeOwner(child);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    owner.children.clear();
  }

  // 2. Cleanups in LIFO order
  if (owner.scopeCleanups && owner.scopeCleanups.length > 0) {
    for (let i = owner.scopeCleanups.length - 1; i >= 0; i--) {
      const cleanup = owner.scopeCleanups[i]!;
      try {
        cleanup();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    owner.scopeCleanups.length = 0;
  }

  if (cleanupErrors.length > 0) {
    const errToRoute = cleanupErrors.length === 1
      ? cleanupErrors[0]
      : new AggregateError(cleanupErrors, "Cleanup errors");
    routeError(owner, errToRoute);
  }
}

// --- 7. Context API (R-OW-09) ---

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
}

export function createContext<T>(defaultValue: T, name?: string): Context<T> {
  return {
    id: Symbol(name ?? "mix.context"),
    defaultValue
  };
}

export function useContext<T>(context: Context<T>): T {
  let curr = currentOwner;
  while (curr) {
    if (curr.context && curr.context.has(context.id)) {
      return curr.context.get(context.id) as T;
    }
    curr = curr.parent;
  }
  return context.defaultValue;
}

export function setContext<T>(context: Context<T>, value: T): void {
  if (!currentOwner) {
    activeConfig.onWarning({
      code: "MIX_RT_NO_OWNER",
      message: "setContext called outside of an active owner scope."
    });
    return;
  }
  if (!currentOwner.context) {
    currentOwner.context = new Map<symbol, unknown>();
  }
  currentOwner.context.set(context.id, value);
}

