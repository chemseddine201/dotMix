/**
 * @mix/runtime/core — Pure platform-neutral Push-Pull reactive kernel, Owner lifecycle,
 * context inheritance, and generation-checked cancellation tokens.
 *
 * Implements Phase Gate 4 canonical contracts:
 * - D-101: Independent `pendingRerun` flag, non-nested deferred reruns, coalesced notifications,
 *          configurable `maxEffectIterations` ceiling (`ReactiveCycleError`), queue preservation on error.
 * - D-102: Orthogonal `OwnerState` (`ACTIVE | DISPOSED`) and `ComputationState` (`CLEAN | CHECK | DIRTY | RUNNING | DISPOSED`),
 *          immediate source/observer unlinking on disposal.
 * - D-103: `createRoot(fn, detachedParent?)` inheriting context without automatic child disposal linkage.
 * - D-104: Pure ECMAScript `CancellationToken`, `createCancellationSource`, and generation-checked `createResource`.
 * - Architecture Invariant: Zero browser DOM types (`window`, `document`, `Node`, `HTMLElement`, `AbortSignal`).
 */

import { MixError, DiagnosticCodes } from "../errors.js";

export const OwnerState = {
  ACTIVE: 0,
  DISPOSED: 1
} as const;

export type OwnerStateValue = (typeof OwnerState)[keyof typeof OwnerState];

export const ComputationState = {
  CLEAN: 0,
  CHECK: 1,
  DIRTY: 2,
  RUNNING: 3,
  DISPOSED: 4
} as const;

export type ComputationStateValue = (typeof ComputationState)[keyof typeof ComputationState];

export type Equals<T> = ((a: T, b: T) => boolean) | false;

export interface SignalOptions<T> {
  equals?: Equals<T>;
}

export interface Signal<T> {
  (): T;
  set(nextValue: T | ((prev: T) => T)): T;
  peek(): T;
}

export interface Computed<T> {
  (): T;
  peek(): T;
}

export interface CancellationToken {
  readonly isCancelled: boolean;
  readonly aborted: boolean;
  readonly reason: unknown;
  readonly generation: number;
  onCancelled(callback: (reason: unknown) => void): () => void;
  throwIfAborted(): void;
}

export interface CancellationSource {
  readonly token: CancellationToken;
  cancel(reason?: unknown): void;
}

export interface Owner {
  ownerState: OwnerStateValue;
  readonly parent: Owner | null;
  readonly contextParent: Owner | null;
  readonly children: Set<Owner>;
  readonly cleanups: Array<() => void>;
  readonly computations: Set<ComputationNode>;
  readonly contexts: Map<symbol, unknown>;
  readonly cancellationSource: CancellationSource;
  readonly token: CancellationToken;
  errorHandler?: (err: unknown) => void;
  dispose(): void;
}

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
}

export interface SchedulerOptions {
  maxEffectIterations?: number;
  onUncaughtError?: ((error: unknown) => void) | null;
}

export class ReactiveCycleError extends MixError {
  constructor(message: string) {
    super(DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE, message);
    this.name = "ReactiveCycleError";
  }
}

interface SourceNode {
  readonly kind: "Signal" | "Computed";
  readonly observers: Set<ComputationNode>;
}

interface SignalNode<T = unknown> extends SourceNode {
  readonly kind: "Signal";
  value: T;
  readonly equals: Equals<T>;
}

interface ComputedNode<T = unknown> extends SourceNode {
  readonly kind: "Computed";
  state: ComputationStateValue;
  readonly fn: (prev: T | undefined) => T;
  value: T | undefined;
  hasValue: boolean;
  readonly equals: Equals<T>;
  error: { readonly value: unknown } | null;
  readonly owner: Owner | null;
  sources: SourceNode[];
  readonly readSet: Set<SourceNode>;
}

interface EffectNode extends Owner {
  readonly kind: "Effect";
  state: ComputationStateValue;
  /** D-101: Tracked independently from `state` */
  pendingRerun: boolean;
  pendingState: ComputationStateValue;
  queued: boolean;
  runsInFlush: number;
  readonly fn: () => void | (() => void);
  effectCleanup: (() => void) | null;
  sources: SourceNode[];
  readonly readSet: Set<SourceNode>;
}

type ComputationNode = ComputedNode<unknown> | EffectNode;

let currentOwner: Owner | null = null;
let currentObserver: ComputationNode | null = null;
let inComputedDepth = 0;
let batchDepth = 0;
let isFlushing = false;

const effectQueue: EffectNode[] = [];
let queueIndex = 0;
const touchedEffectsInFlush = new Set<EffectNode>();

let maxEffectIterations = 1000;
let uncaughtErrorHandler: ((error: unknown) => void) | null = null;

export function configureScheduler(options: SchedulerOptions): void {
  if (options.maxEffectIterations !== undefined) {
    maxEffectIterations = Math.max(1, options.maxEffectIterations);
  }
  if (options.onUncaughtError !== undefined) {
    uncaughtErrorHandler = options.onUncaughtError;
  }
}

export function getCurrentOwner(): Owner | null {
  return currentOwner;
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
  }
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

let globalGenerationCounter = 0;

export function createCancellationSource(
  parentOwner: Owner | null = currentOwner,
  generation?: number
): CancellationSource {
  let cancelled = false;
  let cancelReason: unknown = undefined;
  const gen = generation ?? ++globalGenerationCounter;
  const listeners = new Set<(reason: unknown) => void>();

  const token: CancellationToken = {
    get isCancelled(): boolean {
      return cancelled;
    },
    get aborted(): boolean {
      return cancelled;
    },
    get reason(): unknown {
      return cancelReason;
    },
    get generation(): number {
      return gen;
    },
    onCancelled(callback: (reason: unknown) => void): () => void {
      if (typeof callback !== "function") {
        return () => {};
      }
      if (cancelled) {
        // R-CX-04: Invoke synchronously if already cancelled
        try {
          callback(cancelReason);
        } catch (err) {
          if (uncaughtErrorHandler) {
            uncaughtErrorHandler(err);
          } else {
            throw err;
          }
        }
        return () => {};
      }
      listeners.add(callback);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(callback);
      };
    },
    throwIfAborted(): void {
      if (cancelled) {
        throw cancelReason;
      }
    }
  };

  let unbindParent: (() => void) | null = null;

  function cancel(reason: unknown = "MIX_RT_CANCELLED"): void {
    // R-CX-03: Idempotent cancellation
    if (cancelled) return;
    cancelled = true;
    cancelReason = reason;
    if (unbindParent) {
      unbindParent();
      unbindParent = null;
    }
    const snapshot = [...listeners];
    listeners.clear();
    const listenerErrors: unknown[] = [];
    for (const listener of snapshot) {
      try {
        listener(cancelReason);
      } catch (err) {
        listenerErrors.push(err);
      }
    }
    // R-CX-06: Deliver listener errors after all listeners finish
    for (const err of listenerErrors) {
      if (uncaughtErrorHandler) {
        uncaughtErrorHandler(err);
      } else {
        throw err;
      }
    }
  }

  if (parentOwner && parentOwner.ownerState === OwnerState.ACTIVE) {
    unbindParent = parentOwner.token.onCancelled(reason => {
      cancel(reason);
    });
  } else if (parentOwner && parentOwner.ownerState === OwnerState.DISPOSED) {
    cancel(parentOwner.token.reason ?? "MIX_RT_DISPOSED");
  }

  return { token, cancel };
}

export function createCancellationToken(parentOwner: Owner | null = currentOwner): CancellationToken {
  return createCancellationSource(parentOwner).token;
}

function createOwnerInstance(parent: Owner | null, contextParent: Owner | null): Owner {
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

function unlinkComputation(node: ComputationNode): void {
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
  const contextParent = detachedParent !== undefined ? detachedParent : currentOwner;
  const rootOwner = createOwnerInstance(null, contextParent);
  const prevOwner = currentOwner;
  const prevObserver = currentObserver;
  currentOwner = rootOwner;
  currentObserver = null;
  try {
    return fn(() => disposeOwner(rootOwner));
  } finally {
    currentOwner = prevOwner;
    currentObserver = prevObserver;
  }
}

export function onCleanup(fn: () => void): void {
  if (currentOwner && currentOwner.ownerState === OwnerState.ACTIVE) {
    currentOwner.cleanups.push(fn);
  }
}

export function createContext<T>(defaultValue: T): Context<T> {
  return Object.freeze({
    id: Symbol("mix.context"),
    defaultValue
  });
}

export function setContext<T>(context: Context<T>, value: T): T {
  if (!currentOwner || currentOwner.ownerState === OwnerState.DISPOSED) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE,
      "setContext must be called within an active Owner scope."
    );
  }
  currentOwner.contexts.set(context.id, value);
  return value;
}

export function getContext<T>(context: Context<T>): T {
  let cursor: Owner | null = currentOwner;
  while (cursor !== null) {
    if (cursor.contexts.has(context.id)) {
      return cursor.contexts.get(context.id) as T;
    }
    cursor = cursor.parent ?? cursor.contextParent;
  }
  return context.defaultValue;
}

export const useContext = getContext;
export const provideContext = setContext;

function enqueueEffect(effect: EffectNode): void {
  if (
    effect.ownerState === OwnerState.DISPOSED ||
    effect.state === ComputationState.DISPOSED
  ) {
    return;
  }
  if (!effect.queued) {
    effect.queued = true;
    effectQueue.push(effect);
  }
}

/**
 * Push phase: marks dependents as `CHECK` or `DIRTY` while respecting `RUNNING` state
 * and independent `pendingRerun` (D-101, R-RX-04).
 */
function mark(node: ComputationNode, nextState: typeof ComputationState.CHECK | typeof ComputationState.DIRTY): void {
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
function validateSources(node: ComputationNode): void {
  for (const src of [...node.sources]) {
    if (src.kind === "Computed") {
      updateComputedIfNecessary(src as ComputedNode<unknown>);
    }
    if (node.state === ComputationState.DIRTY) {
      break; // R-RX-01
    }
  }
}

function endSourceTracking(node: ComputationNode, prevSources: SourceNode[]): void {
  for (const oldSrc of prevSources) {
    if (!node.readSet.has(oldSrc)) {
      oldSrc.observers.delete(node);
    }
  }
}

function updateComputedIfNecessary<T>(c: ComputedNode<T>): void {
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

  const prevObserver = currentObserver;
  const prevSources = c.sources;
  c.sources = [];
  c.readSet.clear();
  c.state = ComputationState.RUNNING;
  currentObserver = c as ComputationNode;
  inComputedDepth++;

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
    inComputedDepth--;
    currentObserver = prevObserver;
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

function findErrorHandler(owner: Owner | null): ((err: unknown) => void) | null {
  let cursor: Owner | null = owner;
  while (cursor !== null) {
    if (cursor.errorHandler) {
      return cursor.errorHandler;
    }
    cursor = cursor.parent ?? cursor.contextParent;
  }
  return uncaughtErrorHandler;
}

function runEffect(effect: EffectNode, deferredErrors: unknown[]): void {
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

  const prevOwner = currentOwner;
  const prevObserver = currentObserver;
  const prevSources = effect.sources;

  effect.sources = [];
  effect.readSet.clear();
  effect.state = ComputationState.RUNNING;
  effect.pendingRerun = false;
  effect.pendingState = ComputationState.CLEAN;

  currentOwner = effect;
  currentObserver = effect;

  let thrownError: { value: unknown } | null = null;
  try {
    const ret = effect.fn();
    if (typeof ret === "function") {
      effect.effectCleanup = ret;
    }
  } catch (err) {
    thrownError = { value: err };
  } finally {
    currentOwner = prevOwner;
    currentObserver = prevObserver;
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
  if (isFlushing) {
    return;
  }
  isFlushing = true;
  const deferredErrors: unknown[] = [];

  try {
    while (queueIndex < effectQueue.length) {
      const effect = effectQueue[queueIndex++]!;
      effect.queued = false;

      if (
        effect.ownerState === OwnerState.DISPOSED ||
        effect.state === ComputationState.DISPOSED ||
        effect.state === ComputationState.CLEAN
      ) {
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
        touchedEffectsInFlush.add(effect);
        effect.runsInFlush++;
        if (effect.runsInFlush > maxEffectIterations) {
          // D-101 / R-RX-06: Abort runaway loop, reset effect to CLEAN, and continue flushing remaining queue
          effect.state = ComputationState.CLEAN;
          effect.pendingRerun = false;
          effect.pendingState = ComputationState.CLEAN;
          const cycleErr = new ReactiveCycleError(
            `Reactive cycle detected: effect exceeded maximum iteration ceiling (${maxEffectIterations}).`
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
    effectQueue.length = 0;
    queueIndex = 0;
    for (const eff of touchedEffectsInFlush) {
      eff.runsInFlush = 0;
    }
    touchedEffectsInFlush.clear();
    isFlushing = false;
  }

  if (deferredErrors.length > 0) {
    throw deferredErrors[0]!;
  }
}

export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && !isFlushing && effectQueue.length > 0) {
      flushSync();
    }
  }
}

function trackSourceRead(sourceNode: SourceNode): void {
  if (
    currentObserver !== null &&
    currentObserver.state !== ComputationState.DISPOSED
  ) {
    // R-RX-05: Subscribe immediately on first read during RUNNING
    if (!currentObserver.readSet.has(sourceNode)) {
      currentObserver.readSet.add(sourceNode);
      currentObserver.sources.push(sourceNode);
      sourceNode.observers.add(currentObserver);
    }
  }
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
    if (inComputedDepth > 0) {
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

    if (batchDepth === 0 && !isFlushing) {
      flushSync();
    }
    return node.value;
  };

  read.peek = (): T => node.value;

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
    owner: currentOwner,
    sources: [],
    readSet: new Set(),
    observers: new Set()
  };

  if (currentOwner && currentOwner.ownerState === OwnerState.ACTIVE) {
    currentOwner.computations.add(node as ComputationNode);
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

  return read;
}

export function createEffect(fn: () => void | (() => void)): void {
  if (currentOwner && currentOwner.ownerState === OwnerState.DISPOSED) {
    return;
  }

  const baseOwner = createOwnerInstance(currentOwner, currentOwner);
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

  if (batchDepth > 0 || isFlushing) {
    enqueueEffect(effect);
  } else {
    // Run initial effect synchronously and flush any queued deferred reruns
    const deferredErrors: unknown[] = [];
    isFlushing = true;
    try {
      touchedEffectsInFlush.add(effect);
      effect.runsInFlush = 1;
      runEffect(effect, deferredErrors);
    } finally {
      isFlushing = false;
    }
    if (effectQueue.length > 0) {
      try {
        flushSync();
      } catch (flushErr) {
        deferredErrors.push(flushErr);
      }
    } else {
      effect.runsInFlush = 0;
      touchedEffectsInFlush.delete(effect);
    }
    if (deferredErrors.length > 0) {
      throw deferredErrors[0]!;
    }
  }
}

export interface ResourceContext {
  readonly token: CancellationToken;
  readonly generation: number;
}

export interface Resource<T> {
  readonly data: Signal<T | undefined>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<unknown>;
  readonly generation: () => number;
  reload(): Promise<T | undefined>;
  cancel(reason?: unknown): void;
}

/**
 * D-104 / R-CX-09: Generation-checked async resource primitive.
 * Automatically supersedes prior in-flight requests (`MIX_RT_SUPERSEDED`),
 * cancels on Owner disposal (`MIX_RT_DISPOSED`), and discards stale results.
 */
export function createResource<T>(
  fetcher: (ctx: ResourceContext) => Promise<T>,
  initialValue?: T
): Resource<T> {
  const owner = currentOwner;
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
      if (myGen !== currentGen || source.token.isCancelled || (owner && owner.ownerState === OwnerState.DISPOSED)) {
        return undefined;
      }

      batch(() => {
        data.set(() => result);
        loading.set(false);
      });
      return result;
    } catch (err) {
      if (myGen !== currentGen || source.token.isCancelled || (owner && owner.ownerState === OwnerState.DISPOSED)) {
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

export interface RefObject<T> {
  current: T | null;
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
