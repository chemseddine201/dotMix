/**
 * @mix/runtime/core/types — Platform-neutral reactive kernel types, state enums,
 * ownership contracts, and internal dependency graph structures.
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
export type EqualityFn<T> = Equals<T>;

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

export interface RefObject<T> {
  current: T | null;
}

export class ReactiveCycleError extends MixError {
  constructor(message: string) {
    super(DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE, message);
    this.name = "ReactiveCycleError";
  }
}

export interface SourceNode {
  readonly kind: "Signal" | "Computed";
  readonly observers: Set<ComputationNode>;
}

export interface SignalNode<T = unknown> extends SourceNode {
  readonly kind: "Signal";
  value: T;
  readonly equals: Equals<T>;
}

export interface ComputedNode<T = unknown> extends SourceNode {
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

export interface EffectNode extends Owner {
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

export type ComputationNode = ComputedNode<unknown> | EffectNode;
