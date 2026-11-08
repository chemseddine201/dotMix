/**
 * @mix/runtime/core — Platform-neutral reactive core, ownership, and cancellation tokens.
 *
 * Scope Enclosure Notice (Gate 1): Minimal compilable skeleton only.
 * Full reactive engine and scheduler implementation are deferred to Phase Gate 4.
 *
 * Architecture Invariant: Zero references to browser DOM types (Node, HTMLElement, AbortSignal).
 */

import { MixError, DiagnosticCodes } from "../errors.js";

export interface Signal<T> {
  (): T;
  set(nextValue: T | ((prev: T) => T)): T;
}

export interface Computed<T> {
  (): T;
}

export interface Owner {
  readonly state: number;
  dispose(): void;
}

export interface CancellationToken {
  readonly isCancelled: boolean;
  readonly generation: number;
  onCancelled(callback: () => void): void;
}

export function signal<T>(_initialValue: T): Signal<T> {
  throw new MixError(
    DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE,
    "@mix/runtime/core signal is not yet implemented (Gate 4 deliverable)."
  );
}

export function computed<T>(_fn: () => T): Computed<T> {
  throw new MixError(
    DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE,
    "@mix/runtime/core computed is not yet implemented (Gate 4 deliverable)."
  );
}

export function createEffect(_fn: () => void | (() => void)): void {
  throw new MixError(
    DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE,
    "@mix/runtime/core createEffect is not yet implemented (Gate 4 deliverable)."
  );
}

export function batch<T>(_fn: () => T): T {
  throw new MixError(
    DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE,
    "@mix/runtime/core batch is not yet implemented (Gate 4 deliverable)."
  );
}

export function createRoot<T>(
  _fn: (dispose: () => void) => T,
  _detachedParent?: Owner | null
): T {
  throw new MixError(
    DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE,
    "@mix/runtime/core createRoot is not yet implemented (Gate 4 deliverable)."
  );
}

export function onCleanup(_fn: () => void): void {
  // Gate 1 skeleton stub
}

export function createCancellationToken(): CancellationToken {
  const isCancelled = false;
  const callbacks: Array<() => void> = [];
  return {
    get isCancelled() {
      return isCancelled;
    },
    generation: 1,
    onCancelled(cb: () => void) {
      if (isCancelled) cb();
      else callbacks.push(cb);
    }
  };
}
