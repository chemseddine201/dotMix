/**
 * packages/runtime/src/core/reactivity.ts
 *
 * Mix v3.2.2 Reference-Conforming Push-Pull Reactive Scheduler.
 * Implements exact state transitions: CLEAN(0), CHECK(1), DIRTY(2), RUNNING(3), DISPOSED(4).
 * Pure ECMAScript implementation with zero Web / Node API dependencies (AGENTS.md Part I).
 */

import { MixError } from "./errors.js";
import { activeConfig } from "./config.js";
import { OwnerState, type Equals, type Owner } from "../types.js";
import {
  getCurrentOwner,
  setCurrentOwner,
  disposeOwner,
  resetOwnerCleanups,
  routeError,
  isComputing,
  setComputing,
  onCleanup
} from "./owner.js";

// --- 1. Computation and Lifecycle States (FROZEN §2.1) ---

export const ComputationState = {
  CLEAN: 0,
  CHECK: 1,
  DIRTY: 2,
  RUNNING: 3,
  DISPOSED: 4
} as const;
export type ComputationState = (typeof ComputationState)[keyof typeof ComputationState];

export { OwnerState };

// --- 2. Reactive Node Interfaces ---

export interface SourceNode {
  observers: Set<ObserverNode>;
}

export interface SignalNode<T = unknown> extends SourceNode {
  readonly kind: "Signal";
  value: T;
  equals: Equals<T>;
  (): T;
  (next: T | ((prev: T) => T)): T;
  set(next: T | ((prev: T) => T)): void;
}

export interface ComputedNode<T = any> extends SourceNode {
  readonly kind: "Computed";
  fn: (prev: any) => any;
  equals: Equals<T>;
  value: T | undefined;
  hasError: boolean;
  error: unknown;
  state: ComputationState;
  sources: SourceNode[];
  nextSources: SourceNode[] | null;
  nextSet: Set<SourceNode> | null;
  runs: number;
  owner: Owner | null;
  (): T;
}

export interface EffectNode extends Owner {
  readonly kind: "Effect";
  fn: () => void;
  state: ComputationState;
  sources: SourceNode[];
  nextSources: SourceNode[] | null;
  nextSet: Set<SourceNode> | null;
  runsInFlush: number;
  runs: number;
  disposed: boolean;
  dispose(): void;
  (): void;

  parent: Owner | null;
  children: Set<Owner> | null;
  context: Map<symbol, unknown> | null;
  scopeCleanups: (() => void)[] | null;
  errorHandlers: ((err: unknown) => boolean)[] | null;
  ownerState: OwnerState;
}

export type ObserverNode = ComputedNode | EffectNode;

// --- 3. Reactive Scheduler Global State ---

let currentObserver: ObserverNode | null = null;
let computedDepth = 0;
let batchDepth = 0;
let isFlushing = false;
const queue: EffectNode[] = [];
const flushErrors: unknown[] = [];

export function getFlushErrors(): readonly unknown[] {
  return flushErrors;
}

export function clearFlushErrors(): void {
  flushErrors.length = 0;
}

// --- 4. Signal Factory ---

export function signal<T>(value: T, equals: Equals<T> = Object.is): SignalNode<T> {
  const node = function (nextVal?: T | ((prev: T) => T)): T {
    if (arguments.length === 0) {
      return read(node);
    }
    const resolved = typeof nextVal === "function"
      ? (nextVal as (prev: T) => T)(node.value)
      : (nextVal as T);
    write(node, resolved);
    return resolved;
  } as SignalNode<T>;

  Object.defineProperty(node, "kind", { value: "Signal", writable: false });
  node.value = value;
  node.equals = equals;
  node.observers = new Set<ObserverNode>();
  node.set = (nextVal: T | ((prev: T) => T)) => {
    const resolved = typeof nextVal === "function"
      ? (nextVal as (prev: T) => T)(node.value)
      : nextVal;
    write(node, resolved);
  };

  return node;
}

// --- 5. Computed Factory ---

export function computed<T>(fn: (prev: T | undefined) => T, equals: Equals<T> = Object.is): ComputedNode<T> {
  const owner = getCurrentOwner();

  const node = function (): T {
    return read(node);
  } as ComputedNode<T>;

  Object.defineProperty(node, "kind", { value: "Computed", writable: false });
  node.fn = fn;
  node.equals = equals;
  node.value = undefined;
  node.hasError = false;
  node.error = undefined;
  node.state = ComputationState.DIRTY;
  node.sources = [];
  node.nextSources = null;
  node.nextSet = null;
  node.observers = new Set<ObserverNode>();
  node.runs = 0;
  node.owner = owner;

  // R-OW-07: Computed auto-disposes and disconnects from sources on owner disposal
  if (owner) {
    onCleanup(() => {
      disposeNode(node);
    });
  }

  return node;
}

// --- 6. Effect Factory ---

export function createEffect(fn: () => void): EffectNode {
  // R-OW-08: Creating an effect inside computed is strictly forbidden
  if (isComputing()) {
    throw new MixError("MIX_RT_OWNER_IN_COMPUTED", "Creating an effect inside a computed expression is strictly forbidden.");
  }

  const owner = getCurrentOwner();
  // R-OW-06: Emit warning in __DEV__ if called without owner
  if (!owner) {
    activeConfig.onWarning({
      code: "MIX_RT_NO_OWNER",
      message: "createEffect called without an active owner scope."
    });
  }

  const node = function (): void {
    if (node.disposed || node.ownerState === OwnerState.DISPOSED) return;
    runEffect(node);
  } as EffectNode;

  Object.defineProperty(node, "kind", { value: "Effect", writable: false });
  node.fn = fn;
  node.state = ComputationState.DIRTY;
  node.sources = [];
  node.nextSources = null;
  node.nextSet = null;
  node.runsInFlush = 0;
  node.runs = 0;
  node.disposed = false;
  node.dispose = () => disposeOwner(node);

  // Owner tree linkages
  node.parent = owner;
  node.children = null;
  node.context = null;
  node.scopeCleanups = null;
  node.errorHandlers = null;
  node.ownerState = OwnerState.ACTIVE;

  if (owner) {
    if (!owner.children) {
      owner.children = new Set<Owner>();
    }
    owner.children.add(node);
  }

  queue.push(node);

  // Auto-schedule flush if outside batch and not flushing (R-RX-11)
  if (batchDepth === 0 && !isFlushing) {
    activeConfig.scheduler(flushSync);
  }

  return node;
}

// --- 7. Dependency Tracking ---

function track(obs: ObserverNode, src: SourceNode): void {
  if (!obs.nextSet || !obs.nextSources) return;
  if (obs.nextSet.has(src)) return;

  obs.nextSet.add(src);
  obs.nextSources.push(src);
  src.observers.add(obs); // Subscribe immediately on first read (R-RX-05)
}

function beginTracking(node: ObserverNode): void {
  node.nextSources = [];
  node.nextSet = new Set<SourceNode>();
}

function endTracking(node: ObserverNode): void {
  if (!node.nextSet || !node.nextSources) return;

  // Unsubscribe dropped dependencies (I-3)
  for (const s of node.sources) {
    if (!node.nextSet.has(s)) {
      s.observers.delete(node);
    }
  }

  node.sources = node.nextSources;
  node.nextSources = null;
  node.nextSet = null;
}

// --- 8. Core Reactive Primitives: read, write, untrack ---

export function read<T>(node: SignalNode<T> | ComputedNode<T>): T {
  if (node.kind === "Computed" && node.state === ComputationState.RUNNING) {
    throw new MixError("MIX_RT_CYCLE", "Cycle detected during reactive computation read.");
  }

  if (currentObserver) {
    track(currentObserver, node);
  }

  if (node.kind === "Computed") {
    updateIfNecessary(node);
    if (node.hasError) {
      throw node.error;
    }
  }

  return node.value as T;
}

export function untrack<T>(fn: () => T): T {
  const prev = currentObserver;
  currentObserver = null;
  try {
    return fn();
  } finally {
    currentObserver = prev;
  }
}

export function write<T>(sig: SignalNode<T>, v: T): void {
  if (computedDepth > 0) {
    throw new MixError("MIX_RT_WRITE_IN_COMPUTED", "Mutating a signal inside a computed expression is strictly forbidden.");
  }

  if (sig.equals !== false && sig.equals(sig.value, v)) {
    return;
  }

  sig.value = v;

  // Push Phase: notify observers (R-RX-03)
  for (const o of [...sig.observers]) {
    mark(o, ComputationState.DIRTY);
  }

  if (batchDepth === 0 && !isFlushing) {
    activeConfig.scheduler(flushSync);
  }
}

// --- 9. Push Phase: mark ---

function mark(node: ObserverNode, next: ComputationState): void {
  const s = node.state;
  if (s === ComputationState.RUNNING) {
    node.state = next; // Will be re-queued by its own finally block (R-RX-04)
    return;
  }

  if (s >= next) return;

  node.state = next;

  if (node.kind === "Effect") {
    if (s === ComputationState.CLEAN) {
      queue.push(node);
    }
  } else {
    for (const o of [...node.observers]) {
      mark(o, ComputationState.CHECK);
    }
  }
}

// --- 10. Pull Phase: validateSources, updateIfNecessary, runComputed ---

function validateSources(node: ObserverNode): void {
  for (const src of node.sources) {
    if ("kind" in src && src.kind === "Computed") {
      updateIfNecessary(src as ComputedNode);
    }
    if (node.state === ComputationState.DIRTY) {
      break; // Lazy validation optimization with break (R-RX-01)
    }
  }
}

function updateIfNecessary(node: ComputedNode): void {
  if (node.state === ComputationState.RUNNING) {
    throw new MixError("MIX_RT_CYCLE", "Cycle detected in reactive dependency graph.");
  }

  if (node.state === ComputationState.CHECK) {
    validateSources(node);
  }

  if (node.state === ComputationState.DIRTY) {
    runComputed(node);
  } else if (node.state === ComputationState.CHECK) {
    node.state = ComputationState.CLEAN;
  }
}

function runComputed(c: ComputedNode): void {
  const prev = currentObserver;
  c.state = ComputationState.RUNNING;
  beginTracking(c);
  currentObserver = c;
  computedDepth++;
  setComputing(true);
  c.runs++;

  let next: unknown;
  let threw = false;
  let err: unknown;

  try {
    next = c.fn(c.value);
  } catch (e) {
    threw = true;
    err = e;
  } finally {
    computedDepth--;
    if (computedDepth === 0) {
      setComputing(false);
    }
    currentObserver = prev;
    endTracking(c);
  }

  const changed =
    threw ||
    c.hasError ||
    c.equals === false ||
    (c.equals ? !c.equals(c.value, next) : !Object.is(c.value, next));

  if (threw) {
    c.hasError = true;
    c.error = err;
  } else {
    c.hasError = false;
    c.error = undefined;
    c.value = next;
  }

  c.state = ComputationState.CLEAN;

  // Confirm only CHECK observers to DIRTY (R-RX-03)
  if (changed) {
    for (const o of c.observers) {
      if (o.state === ComputationState.CHECK) {
        o.state = ComputationState.DIRTY;
      }
    }
  }
}

// --- 11. Effect Execution: runEffect ---

function runEffect(e: EffectNode): void {
  if (e.disposed || e.ownerState === OwnerState.DISPOSED) return;

  if (e.state === ComputationState.CHECK) {
    validateSources(e);
  }

  if (e.state !== ComputationState.DIRTY) {
    e.state = ComputationState.CLEAN;
    return;
  }

  if (++e.runsInFlush > activeConfig.maxEffectRunsPerFlush) {
    e.state = ComputationState.CLEAN;
    const loopErr = new MixError("MIX_RT_EFFECT_LOOP", `Exceeded maximum effect iterations per flush (${activeConfig.maxEffectRunsPerFlush}).`);
    flushErrors.push(loopErr);
    routeError(e, loopErr);
    return;
  }

  // R-RX-14: Clean up nested children and cleanups before re-running
  if (e.runs > 0) {
    resetOwnerCleanups(e);
  }

  const prevObserver = currentObserver;
  const prevOwner = getCurrentOwner();

  e.state = ComputationState.RUNNING;
  beginTracking(e);
  currentObserver = e;
  setCurrentOwner(e);
  e.runs++;

  try {
    e.fn();
  } catch (err) {
    flushErrors.push(err);
    routeError(e, err);
  } finally {
    setCurrentOwner(prevOwner);
    currentObserver = prevObserver;
    endTracking(e);

    if (e.state === ComputationState.RUNNING) {
      e.state = ComputationState.CLEAN;
    } else {
      // Marked CHECK/DIRTY while running -> re-enqueue in the same flush (R-RX-04)
      queue.push(e);
    }
  }
}

// --- 12. Flush and Batching (R-RX-11, R-RX-12) ---

export function flushSync(): void {
  if (isFlushing) return;
  isFlushing = true;
  const ran = new Set<EffectNode>();

  try {
    for (let i = 0; i < queue.length; i++) {
      const e = queue[i]!;
      ran.add(e);
      runEffect(e);
    }
  } finally {
    queue.length = 0;
    isFlushing = false;
    for (const e of ran) {
      e.runsInFlush = 0;
    }
  }
}

export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && !isFlushing) {
      flushSync();
    }
  }
}

// --- 13. Node Disposal (R-RX-13) ---

export function disposeNode(node: ObserverNode): void {
  if (node.kind === "Effect") {
    disposeOwner(node as unknown as Owner);
    return;
  }

  if ("disposed" in node) {
    (node as any).disposed = true;
  }
  node.state = ComputationState.DISPOSED;

  for (const s of node.sources) {
    s.observers.delete(node);
  }
  node.sources.length = 0;
}
