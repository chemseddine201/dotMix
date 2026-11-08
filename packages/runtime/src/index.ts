/**
 * @mix/runtime — Platform-neutral reactive core & direct DOM adapter for Phase 1.
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

export class Owner {
  state: OwnerState = "ACTIVE";
  readonly cleanups: Array<() => void> = [];
  readonly children: Owner[] = [];
  readonly computations: ComputationNode[] = [];
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

    // 1. Run all cleanups
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch (err) {
        console.error("Error in onCleanup:", err);
      }
    }
    this.cleanups.length = 0;

    // 2. Dispose all descendant computations (D-102)
    for (const comp of this.computations) {
      comp.dispose();
    }
    this.computations.length = 0;

    // 3. Dispose all child owners
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

// --- 3. Reactive Primitives ---

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

      // Notify observers (D-101)
      for (const observer of Array.from(observers)) {
        if (observer.state === "DISPOSED") {
          observers.delete(observer);
          continue;
        }

        if (observer.state === "RUNNING") {
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

function scheduleComputation(comp: ComputationNode): void {
  if (comp.state === "DISPOSED") return;
  if (!pendingQueue.includes(comp)) {
    pendingQueue.push(comp);
  }
  flushQueue();
}

export function flushQueue(): void {
  if (isFlushing) return;
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
    // Reset run counts after cycle flush
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

// --- 5. Direct DOM Adapter ---

export function createElement(tagName: string): HTMLElement {
  return document.createElement(tagName);
}

export function createTextNode(text: string): Text {
  return document.createTextNode(text);
}

export function setTextContent(node: Node, text: string): void {
  node.textContent = text;
}
