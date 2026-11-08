// packages/runtime/src/hmr/index.ts — FROZEN per MIX_SPEC_v3.2.2 §8
import { MixError } from "../core/errors.js";
import type { HmrComponentRecord } from "./types.js";

export * from "./types.js";

export interface HmrInstance {
  readonly record: HmrComponentRecord;
  readonly scope: Record<string, unknown>;
  readonly trampolines: Map<string, (...args: unknown[]) => unknown>;
  trampoline(name: string): (...args: unknown[]) => unknown;
  remount(nextRecord: HmrComponentRecord): void;
  dispose(): void;
}

const componentRegistry = new Map<string, HmrComponentRecord>();
const activeInstances = new Map<string, Set<HmrInstance>>();

/**
 * Creates a stable trampoline function for a method on the component scope (R-HMR-02).
 * The returned function reference identity never changes across HMR updates.
 */
export function createTrampoline(
  scope: Record<string, unknown>,
  name: string
): (...args: unknown[]) => unknown {
  return function (...args: unknown[]) {
    const fn = scope[name];
    if (typeof fn === "function") {
      return (fn as (...a: unknown[]) => unknown).apply(scope, args);
    }
    return undefined;
  };
}

/**
 * Registers an active component instance for HMR tracking (R-HMR-01, R-HMR-04).
 */
export function registerHmrInstance(
  record: HmrComponentRecord,
  scope: Record<string, unknown>,
  remountFn: (nextRecord: HmrComponentRecord) => void,
  disposeFn: () => void
): HmrInstance {
  componentRegistry.set(record.id, record);

  let instances = activeInstances.get(record.id);
  if (!instances) {
    instances = new Set();
    activeInstances.set(record.id, instances);
  }

  const trampolines = new Map<string, (...args: unknown[]) => unknown>();

  const instance: HmrInstance = {
    record,
    scope,
    trampolines,
    trampoline(name: string) {
      let t = trampolines.get(name);
      if (!t) {
        t = createTrampoline(scope, name);
        trampolines.set(name, t);
      }
      return t;
    },
    remount(next) {
      remountFn(next);
    },
    dispose() {
      disposeFn();
      const currentSet = activeInstances.get(record.id);
      if (currentSet) {
        currentSet.delete(instance);
        if (currentSet.size === 0) {
          activeInstances.delete(record.id);
        }
      }
    }
  };

  // Populate initial trampolines for methods
  const methods = record.methods(scope);
  for (const [mName, mFn] of Object.entries(methods)) {
    scope[mName] = mFn;
    instance.trampoline(mName);
  }

  instances.add(instance);
  return instance;
}

/**
 * Applies an HMR update to active components (R-HMR-04).
 * If signature matches: updates methods and re-runs template on live scope, preserving signal state.
 * If signature changed: triggers a full remount.
 */
export function applyHmrUpdate(next: HmrComponentRecord): void {
  const currentRecord = componentRegistry.get(next.id);
  componentRegistry.set(next.id, next);

  const instances = activeInstances.get(next.id);
  if (!instances || instances.size === 0) {
    return;
  }

  const signatureMatches = currentRecord ? currentRecord.signature === next.signature : false;

  for (const instance of [...instances]) {
    if (signatureMatches) {
      // Signature matches: Live state preservation (R-HMR-04)
      const newMethods = next.methods(instance.scope);
      for (const [name, fn] of Object.entries(newMethods)) {
        instance.scope[name] = fn;
      }
      // Re-run render with the live scope
      next.render(instance.scope);
    } else {
      // Signature changed: Full remount (R-HMR-04)
      instance.remount(next);
    }
  }
}

/**
 * Resets the HMR registry (used in test tear-down).
 */
export function resetHmrRegistry(): void {
  componentRegistry.clear();
  activeInstances.clear();
}
