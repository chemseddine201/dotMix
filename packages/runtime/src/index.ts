/**
 * @mix/runtime — Platform-neutral reactive core, scheduler, cancellation, and DOM reconciliation.
 */

// --- 1. Lifecycle and State Types (D-102) ---

export type OwnerState = "ACTIVE" | "DISPOSED";
export type ComputationState = "CLEAN" | "CHECK" | "DIRTY" | "RUNNING" | "DISPOSED";

export class ReactiveCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReactiveCycleError";
  }
}

export class MixSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MixSecurityError";
  }
}

export interface SchedulerOptions {
  maxEffectIterations?: number;
}

export const defaultSchedulerOptions: Required<SchedulerOptions> = {
  maxEffectIterations: 1000 // Configurable iteration ceiling (D-101)
};

// --- 2. Global Reactive Engine Context ---

let activeOwner: Owner | null = null;
let activeComputation: ComputationNode | null = null;
const pendingQueue: ComputationNode[] = [];
let isFlushing = false;
let batchDepth = 0;
let globalGenerationCounter = 0;

export class Owner {
  state: OwnerState = "ACTIVE";
  readonly cleanups: Array<() => void> = [];
  readonly children: Owner[] = [];
  readonly computations: ComputationNode[] = [];
  readonly tokens: CancellationToken[] = [];
  readonly parent: Owner | null;
  readonly isDetached: boolean;

  constructor(parent: Owner | null = activeOwner, isDetached = false) {
    this.parent = parent;
    this.isDetached = isDetached;
    if (parent && parent.state === "ACTIVE" && !isDetached) {
      parent.children.push(this);
    }
  }

  dispose(): void {
    if (this.state === "DISPOSED") return;
    this.state = "DISPOSED";

    // 1. Cancel all active cancellation tokens (D-104)
    for (const token of this.tokens) {
      token.cancel();
    }
    this.tokens.length = 0;

    // 2. Run all cleanups
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch (err) {
        console.error("Error in onCleanup:", err);
      }
    }
    this.cleanups.length = 0;

    // 3. Dispose all descendant computations (D-102)
    for (const comp of this.computations) {
      comp.dispose();
    }
    this.computations.length = 0;

    // 4. Dispose all child owners
    for (const child of this.children) {
      child.dispose();
    }
    this.children.length = 0;
  }
}

export interface ComputationNode {
  state: ComputationState;
  pendingRerun: boolean; // Decoupled from state (D-101)
  runCount: number;
  run(): void;
  dispose(): void;
}

// --- 3. Reactive Primitives: Signals, Memos, Effects ---

export interface Signal<T> {
  (): T;
  set(nextValue: T | ((prev: T) => T)): T;
}

export function signal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const observers = new Set<ComputationNode>();

  const read = function (): T {
    if (activeComputation && activeComputation.state !== "DISPOSED") {
      observers.add(activeComputation);
    }
    return value;
  };

  read.set = function (nextValue: T | ((prev: T) => T)): T {
    const resolvedValue =
      typeof nextValue === "function" ? (nextValue as (prev: T) => T)(value) : nextValue;

    if (!Object.is(value, resolvedValue)) {
      value = resolvedValue;

      // Notify observers (D-101, Pull-Push model)
      for (const observer of Array.from(observers)) {
        if (observer.state === "DISPOSED") {
          observers.delete(observer);
          continue;
        }

        if (observer instanceof ComputedNode) {
          // Push notification marks memo dirty without eager queueing
          observer.markDirty();
        } else if (observer.state === "RUNNING") {
          // Non-nested: Coalesce duplicate rerun requests (D-101)
          observer.pendingRerun = true;
        } else {
          observer.state = "DIRTY";
          scheduleComputation(observer);
        }
      }
    }
    return value;
  };

  return read as Signal<T>;
}

export interface Computed<T> {
  (): T;
}

export class ComputedNode<T> implements ComputationNode {
  state: ComputationState = "DIRTY";
  pendingRerun = false;
  runCount = 0;
  private value!: T;
  private readonly fn: () => T;
  readonly observers = new Set<ComputationNode>();
  private readonly owner: Owner;

  constructor(fn: () => T, owner: Owner) {
    this.fn = fn;
    this.owner = owner;
    owner.computations.push(this);
  }

  markDirty(): void {
    if (this.state === "DIRTY" || this.state === "DISPOSED") return;
    this.state = "DIRTY";
    for (const obs of Array.from(this.observers)) {
      if (obs instanceof ComputedNode) {
        obs.markDirty();
      } else {
        obs.state = "DIRTY";
        scheduleComputation(obs);
      }
    }
  }

  read(): T {
    if (this.state === "DISPOSED") {
      return this.value;
    }

    if (activeComputation && activeComputation.state !== "DISPOSED") {
      this.observers.add(activeComputation);
    }

    if (this.state === "DIRTY") {
      this.run();
    }

    return this.value;
  }

  run(): void {
    if (this.state === "DISPOSED") return;

    const prevComputation = activeComputation;
    const prevOwner = activeOwner;
    activeComputation = this;
    activeOwner = this.owner;
    this.state = "RUNNING";

    try {
      this.value = this.fn();
    } finally {
      this.state = "CLEAN";
      activeComputation = prevComputation;
      activeOwner = prevOwner;
    }
  }

  dispose(): void {
    if (this.state === "DISPOSED") return;
    this.state = "DISPOSED";
    this.observers.clear();
  }
}

export function computed<T>(fn: () => T): Computed<T> {
  const currentOwner = activeOwner ?? new Owner(null);
  const memo = new ComputedNode(fn, currentOwner);
  return () => memo.read();
}

export class EffectComputation implements ComputationNode {
  state: ComputationState = "CLEAN";
  pendingRerun = false; // Separate from state (D-101)
  runCount = 0;
  private readonly fn: () => void | (() => void);
  private cleanup: (() => void) | void = undefined;
  private readonly owner: Owner;

  constructor(fn: () => void | (() => void), owner: Owner) {
    this.fn = fn;
    this.owner = owner;
    owner.computations.push(this);
  }

  run(): void {
    if (this.state === "DISPOSED") return;

    // Cycle detection check (D-101)
    this.runCount++;
    if (this.runCount > defaultSchedulerOptions.maxEffectIterations) {
      this.state = "CLEAN";
      this.pendingRerun = false;
      throw new ReactiveCycleError(
        `Exceeded maximum effect iterations (${defaultSchedulerOptions.maxEffectIterations}). Infinite reactive loop detected.`
      );
    }

    if (typeof this.cleanup === "function") {
      try {
        this.cleanup();
      } catch (err) {
        console.error("Error in effect cleanup:", err);
      }
      this.cleanup = undefined;
    }

    const prevComputation = activeComputation;
    const prevOwner = activeOwner;
    activeComputation = this;
    activeOwner = this.owner;
    this.state = "RUNNING";

    try {
      this.cleanup = this.fn();
    } finally {
      this.state = "CLEAN";
      activeComputation = prevComputation;
      activeOwner = prevOwner;

      // Non-nested deferred rerun (D-101): check if writes occurred during run
      if (this.pendingRerun) {
        this.pendingRerun = false;
        scheduleComputation(this);
      }
    }
  }

  dispose(): void {
    if (this.state === "DISPOSED") return;
    this.state = "DISPOSED";
    this.pendingRerun = false;

    if (typeof this.cleanup === "function") {
      try {
        this.cleanup();
      } catch (err) {
        console.error("Error in effect cleanup on dispose:", err);
      }
      this.cleanup = undefined;
    }
  }
}

export function createEffect(fn: () => void | (() => void)): void {
  const currentOwner = activeOwner ?? new Owner(null);
  const effect = new EffectComputation(fn, currentOwner);
  // Initial run
  effect.run();
}

export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flushQueue();
    }
  }
}

function scheduleComputation(comp: ComputationNode): void {
  if (comp.state === "DISPOSED") return;
  if (!pendingQueue.includes(comp)) {
    pendingQueue.push(comp);
  }
  if (batchDepth === 0) {
    flushQueue();
  }
}

export function flushQueue(): void {
  if (isFlushing || batchDepth > 0) return;
  isFlushing = true;

  try {
    while (pendingQueue.length > 0) {
      const comp = pendingQueue.shift();
      if (comp && comp.state !== "DISPOSED") {
        comp.run();
      }
    }
  } finally {
    isFlushing = false;
    for (const comp of pendingQueue) {
      comp.runCount = 0;
    }
  }
}

// --- 4. Root Creation & Lifecycle (D-103) ---

export function createRoot<T>(
  fn: (dispose: () => void) => T,
  detachedParent?: Owner | null
): T {
  // Preserves detachedParent per D-103: detached from parent's automatic child disposal
  const rootOwner = new Owner(detachedParent ?? null, true);
  const prevOwner = activeOwner;
  activeOwner = rootOwner;

  const dispose = () => {
    rootOwner.dispose();
  };

  try {
    return fn(dispose);
  } finally {
    activeOwner = prevOwner;
  }
}

export function onCleanup(fn: () => void): void {
  if (activeOwner && activeOwner.state === "ACTIVE") {
    activeOwner.cleanups.push(fn);
  }
}

// --- 5. Platform-Neutral Resource Cancellation & Generation Tokens (D-104) ---

export class CancellationToken {
  private _isCancelled = false;
  readonly generation: number;
  private readonly callbacks: Array<() => void> = [];

  constructor(generation: number) {
    this.generation = generation;
  }

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  cancel(): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    for (const cb of this.callbacks) {
      try {
        cb();
      } catch (err) {
        console.error("Error in cancellation callback:", err);
      }
    }
    this.callbacks.length = 0;
  }

  onCancelled(cb: () => void): void {
    if (this._isCancelled) {
      cb();
    } else {
      this.callbacks.push(cb);
    }
  }
}

export function createCancellationToken(): CancellationToken {
  const token = new CancellationToken(++globalGenerationCounter);
  if (activeOwner && activeOwner.state === "ACTIVE") {
    activeOwner.tokens.push(token);
  }
  return token;
}

export interface Resource<T> {
  data: Signal<T | undefined>;
  loading: Signal<boolean>;
  error: Signal<unknown>;
  refetch: () => void;
}

export function createResource<T>(fetcher: (token: CancellationToken) => Promise<T>): Resource<T> {
  const data = signal<T | undefined>(undefined);
  const loading = signal<boolean>(true);
  const error = signal<unknown>(undefined);

  let currentToken: CancellationToken | null = null;

  function load() {
    if (currentToken) {
      currentToken.cancel();
    }
    const token = createCancellationToken();
    currentToken = token;

    loading.set(true);
    error.set(undefined);

    fetcher(token)
      .then((res) => {
        // Reject stale generations (D-104)
        if (!token.isCancelled) {
          data.set(() => res);
          loading.set(false);
        }
      })
      .catch((err) => {
        if (!token.isCancelled) {
          error.set(() => err);
          loading.set(false);
        }
      });
  }

  load();

  return {
    data,
    loading,
    error,
    refetch: load
  };
}

// --- 6. Trusted HTML Sanitizer Contract (D-109) ---

export interface SanitizerContext {
  element?: string;
  attribute?: string;
}

export interface SanitizerProvider {
  sanitizeHtml(raw: string, context?: SanitizerContext): string;
}

let activeSanitizerProvider: SanitizerProvider | null = null;

export function setSanitizerProvider(provider: SanitizerProvider): void {
  activeSanitizerProvider = provider;
}

export function getSanitizerProvider(): SanitizerProvider | null {
  return activeSanitizerProvider;
}

export function renderTrustedHtml(rawHtml: string, context?: SanitizerContext): string {
  if (!activeSanitizerProvider) {
    throw new MixSecurityError("Refusing to evaluate raw HTML without a registered SanitizerProvider.");
  }
  return activeSanitizerProvider.sanitizeHtml(rawHtml, context);
}

// --- 7. Keyed List Reconciliation Algorithm (D-110) ---

export interface KeyedEntry<T> {
  key: unknown;
  owner: Owner;
  element: Node;
  itemSignal: Signal<T>;
  indexSignal: Signal<number>;
}

/**
 * Reconciles dynamic list items with deterministic duplicate-key handling (D-110):
 * - First key wins; duplicates emit warning and are cleanly disposed.
 * - Atomic batching: DOM commits happen together without partial reactive leaks.
 */
export function reconcileKeyed<T>(
  parentElement: Element,
  anchor: Node,
  items: T[],
  keyFn: (item: T, index: number) => unknown,
  renderFn: (itemSignal: Signal<T>, indexSignal: Signal<number>, owner: Owner) => Node
): void {
  batch(() => {
    const oldEntries: Map<unknown, KeyedEntry<T>> =
      (parentElement as unknown as { __mix_keyed_map?: Map<unknown, KeyedEntry<T>> }).__mix_keyed_map ?? new Map();
    const newEntries = new Map<unknown, KeyedEntry<T>>();
    const seenKeys = new Set<unknown>();

    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      const key = keyFn(item, index);

      // Duplicate-key detection (D-110)
      if (seenKeys.has(key)) {
        console.warn(`[MIX_ERR_DUPLICATE_KEY] Duplicate key encountered during reconciliation: "${String(key)}"`);
        continue; // First occurrence wins; duplicate is omitted and not rendered
      }
      seenKeys.add(key);

      const existing = oldEntries.get(key);
      if (existing) {
        // Reuse existing entry
        existing.itemSignal.set(() => item);
        existing.indexSignal.set(index);
        newEntries.set(key, existing);
        oldEntries.delete(key);
      } else {
        // Create new child owner and entry
        const itemSignal: Signal<T> = signal<T>(item);
        const indexSignal = signal(index);
        let domNode!: Node;

        const entryOwner = new Owner(activeOwner);
        const prevOwner = activeOwner;
        activeOwner = entryOwner;

        try {
          domNode = renderFn(itemSignal, indexSignal, entryOwner);
        } finally {
          activeOwner = prevOwner;
        }

        newEntries.set(key, {
          key,
          owner: entryOwner,
          element: domNode,
          itemSignal,
          indexSignal
        });
      }
    }

    // Clean up removed items (D-110: recursive owner disposal)
    for (const [_, removed] of oldEntries) {
      removed.owner.dispose();
      if (removed.element.parentNode === parentElement) {
        parentElement.removeChild(removed.element);
      }
    }

    // Position new entries in order
    for (const [_, entry] of newEntries) {
      parentElement.insertBefore(entry.element, anchor);
    }

    (parentElement as unknown as { __mix_keyed_map: Map<unknown, KeyedEntry<T>> }).__mix_keyed_map = newEntries;
  });
}

// --- 8. Direct DOM Adapter ---

export function createElement(tagName: string): HTMLElement {
  return document.createElement(tagName);
}

export function createTextNode(text: string): Text {
  return document.createTextNode(text);
}

export function setTextContent(node: Node, text: string): void {
  node.textContent = text;
}

export function setAttribute(el: Element, name: string, value: string): void {
  el.setAttribute(name, value);
}

export function removeAttribute(el: Element, name: string): void {
  el.removeAttribute(name);
}

export function setStyleProperty(el: HTMLElement, name: string, value: string): void {
  el.style.setProperty(name, value);
}

export function appendChild(parent: Element, child: Node): void {
  parent.appendChild(child);
}

export function insertBefore(parent: Element, child: Node, before: Node | null): void {
  parent.insertBefore(child, before);
}

export function removeChild(parent: Element, child: Node): void {
  parent.removeChild(child);
}

export function addEventListener(
  el: Element,
  event: string,
  handler: (e: Event) => void
): () => void {
  el.addEventListener(event, handler);
  return () => el.removeEventListener(event, handler);
}
