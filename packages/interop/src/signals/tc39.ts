/**
 * @mix/interop — ECMAScript TC39 Signals Standard Interoperability Bridge
 */

import { signal, createEffect, onCleanup, type Signal } from "@mix/runtime";
import type { TC39Signal, SignalRef } from "../types.js";

/**
 * Checks if a value is any flavor of reactive signal (Mix, TC39, Preact, Vue, Angular, Solid).
 */
export function isSignal(val: unknown): boolean {
  if (typeof val === "function") {
    return "set" in val || Boolean((val as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]?.includes("Signal"));
  }
  if (val && typeof val === "object") {
    return "get" in val || "value" in val || "subscribe" in val;
  }
  return false;
}

/**
 * Adapts a Mix Signal to conform to the TC39 Signals Proposal interface (`Signal.State`).
 */
export function toTc39Signal<T>(mixSig: Signal<T>): TC39Signal<T> {
  return {
    get() {
      return mixSig();
    },
    set(nextVal: T) {
      mixSig.set(nextVal);
    },
    subscribe(callback: () => void) {
      let isFirst = true;
      let active = true;
      createEffect(() => {
        mixSig();
        if (!active) return;
        if (isFirst) {
          isFirst = false;
          return;
        }
        callback();
      });
      return () => {
        active = false;
      };
    },
    [Symbol.toStringTag]: "Signal.State"
  };
}

/**
 * Adapts any foreign reactive signal (TC39, Angular 18+, Preact, Vue Ref) into a native Mix Signal.
 */
export function fromTc39Signal<T>(foreign: unknown, defaultValue?: T): Signal<T> {
  const read = (): T => {
    if (typeof foreign === "function") {
      return (foreign as () => T)();
    }
    if (foreign && typeof foreign === "object") {
      if ("get" in foreign && typeof (foreign as { get: () => T }).get === "function") {
        return (foreign as { get: () => T }).get();
      }
      if ("value" in foreign) {
        return (foreign as { value: T }).value;
      }
    }
    return defaultValue as T;
  };

  const initial = read();
  const internalSig = signal<T>(initial);

  // If foreign object has a subscribe method (TC39 proposal, Preact, NanoStores, Svelte store)
  if (foreign && typeof foreign === "object" && "subscribe" in foreign) {
    const sub = (foreign as { subscribe: (fn: (v: T) => void) => (() => void) | { unsubscribe: () => void } }).subscribe(
      (val: T) => {
        internalSig.set(val !== undefined ? val : read());
      }
    );
    if (typeof sub === "function") {
      onCleanup(() => sub());
    } else if (sub && typeof sub.unsubscribe === "function") {
      onCleanup(() => sub.unsubscribe());
    }
  }

  // Create bi-directional setter
  const bridgedSig = function () {
    return internalSig();
  } as Signal<T>;

  bridgedSig.set = (nextVal: T | ((prev: T) => T)) => {
    const computedNext = typeof nextVal === "function" ? (nextVal as (prev: T) => T)(internalSig()) : nextVal;
    internalSig.set(computedNext);

    if (typeof foreign === "function" && "set" in foreign && typeof (foreign as { set: (v: T) => void }).set === "function") {
      (foreign as { set: (v: T) => void }).set(computedNext);
    } else if (foreign && typeof foreign === "object") {
      if ("set" in foreign && typeof (foreign as { set: (v: T) => void }).set === "function") {
        (foreign as { set: (v: T) => void }).set(computedNext);
      } else if ("value" in foreign) {
        (foreign as { value: T }).value = computedNext;
      }
    }
    return computedNext;
  };

  return bridgedSig;
}

/**
 * Creates a SignalRef object compatible with Vue 3.5 / Svelte / Preact signal conventions.
 */
export function toSignalRef<T>(sig: Signal<T>): SignalRef<T> {
  return {
    get value() {
      return sig();
    },
    set value(next: T) {
      sig.set(next);
    },
    peek() {
      return sig();
    },
    subscribe(fn: (v: T) => void) {
      let isFirst = true;
      let active = true;
      createEffect(() => {
        const val = sig();
        if (!active) return;
        if (isFirst) {
          isFirst = false;
          fn(val);
          return;
        }
        fn(val);
      });
      return () => {
        active = false;
      };
    }
  };
}
