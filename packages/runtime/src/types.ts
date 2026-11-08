/**
 * packages/runtime/src/types.ts — FROZEN Types & Locked Contracts
 * Defines the core types for the Push-Pull Reactive Scheduler,
 * Owner tree, and RendererAdapter (AGENTS.md Part III & MIX_SPEC_v3.2.2 §2.1).
 */

// --- 1. Computation and Owner Lifecycle States ---

export const ComputationState = {
  CLEAN: 0,
  CHECK: 1,
  DIRTY: 2,
  RUNNING: 3,
  DISPOSED: 4
} as const;
export type ComputationState = (typeof ComputationState)[keyof typeof ComputationState];

export const OwnerState = {
  ACTIVE: 0,
  DISPOSED: 1
} as const;
export type OwnerState = (typeof OwnerState)[keyof typeof OwnerState];

// --- 2. Equality Contract ---

export type Equals<T> = false | ((a: T, b: T) => boolean);

// --- 3. Reactive Graph Nodes ---

export interface SourceNode {
  observers: Set<ObserverNode> | null;
}

export interface Computation {
  state: ComputationState;
  sources: SourceNode[]; // Ordered by first read in last run, deduplicated (I-2)
}

export interface SignalNode<T = unknown> extends SourceNode {
  readonly kind: "Signal";
  value: T;
  equals: Equals<T>;
}

export interface ComputedNode<T = unknown> extends SourceNode, Computation {
  readonly kind: "Computed";
  fn: (prev: T | undefined) => T;
  value: T | undefined;
  equals: Equals<T>;
  error: { readonly value: unknown } | null;
  owner: Owner | null; // For context lookup & error routing; Computed is NOT an Owner
  runs: number;
}

export interface EffectNode extends Owner, Computation {
  readonly kind: "Effect";
  fn: () => void;
  runsInFlush: number;
  runs: number;
  disposed: boolean;
}

export type ObserverNode = ComputedNode | EffectNode;

// --- 4. Ownership & Lifecycle Tree ---

export interface Owner {
  readonly kind: "Root" | "Component" | "Effect";
  parent: Owner | null;
  children: Set<Owner> | null;
  context: Map<symbol, unknown> | null; // Symbol keys only (R-OW-09)
  scopeCleanups: (() => void)[] | null;
  errorHandlers: ((err: unknown) => boolean)[] | null;
  ownerState: OwnerState;
}

export type CreateRoot = <T>(
  fn: (dispose: () => void) => T,
  detachedParent?: Owner | null
) => T;

// --- 5. Component & Reference Target Contracts ---

export type RefCallback<T> = (element: T) => void;
export type RefObject<T> = { current: T | null };
export type RefTarget<T> = RefCallback<T> | RefObject<T> | SignalNode<T>;

export interface ComponentInstance<Props = Record<string, unknown>> {
  readonly props: Props;
  readonly scope: Record<string, unknown>;
  readonly rootNode: unknown;
  dispose(): void;
}

export type ComponentFactory<Props = Record<string, unknown>, Return = unknown, Context = unknown> = (
  props: Props,
  context?: Context
) => Return;

// --- 6. Abstract Renderer Adapter ---
// @mix/runtime/reactivity and @mix/runtime/core must have zero references to browser DOM types.
// All rendering operations must pass through RendererAdapter (AGENTS.md Part I).

export interface RendererAdapter<TNode = unknown, TElement = TNode> {
  createElement(tag: string): TElement;
  createTextNode(text: string): TNode;
  setTextContent(node: TNode, text: string): void;
  setAttribute(element: TElement, name: string, value: string): void;
  removeAttribute(element: TElement, name: string): void;
  setStyleProperty(element: TElement, name: string, value: string): void;
  appendChild(parent: TElement, child: TNode): void;
  insertBefore(parent: TElement, child: TNode, before: TNode | null): void;
  removeChild(parent: TElement, child: TNode): void;
  addEventListener(element: TElement, event: string, handler: (e: unknown) => void): () => void;
}

