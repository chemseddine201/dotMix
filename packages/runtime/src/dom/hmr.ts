/**
 * @mix/runtime/dom/hmr — HMR Stable Scope & Trampoline Dispatch Contract (D-111).
 */

import { MixError, DiagnosticCodes } from "../errors.js";
import { getCurrentOwner, onCleanup } from "../core/index.js";

export type HmrMethod = (scope: Record<string, unknown>, ...args: unknown[]) => unknown;

export interface HmrScopeHandle<T extends Record<string, unknown>> {
  readonly scope: T;
  trampoline<Args extends unknown[], R>(methodName: string): (...args: Args) => R;
  dispose(): void;
}

interface HmrComponentRecord {
  signature: string;
  methods: Record<string, HmrMethod>;
  instances: Set<{
    scope: Record<string, unknown>;
    remount?: (() => void) | undefined;
  }>;
}

const hmrComponentRegistry = new Map<string, HmrComponentRecord>();

/**
 * D-111: Creates a stable per-instance `scope` object and returns a `trampoline`
 * dispatcher so event handlers and methods can be hot-swapped in place without
 * rebinding lexical closures or unmounting DOM state.
 */
export function createHmrScope<T extends Record<string, unknown>>(
  componentId: string,
  initialScope: T,
  methods: Record<string, HmrMethod> = {},
  signature: string = "v1",
  remount?: () => void
): HmrScopeHandle<T> {
  let record = hmrComponentRegistry.get(componentId);
  if (!record) {
    record = {
      signature,
      methods: { ...methods },
      instances: new Set()
    };
    hmrComponentRegistry.set(componentId, record);
  } else {
    record.methods = { ...record.methods, ...methods };
  }

  const instanceEntry = {
    scope: initialScope as Record<string, unknown>,
    remount
  };
  record.instances.add(instanceEntry);

  const cleanup = (): void => {
    record?.instances.delete(instanceEntry);
  };
  if (getCurrentOwner()) {
    onCleanup(cleanup);
  }

  return {
    scope: initialScope,
    trampoline<Args extends unknown[], R>(methodName: string): (...args: Args) => R {
      return (...args: Args): R => {
        const activeRecord = hmrComponentRegistry.get(componentId);
        const fn = activeRecord?.methods[methodName];
        if (typeof fn !== "function") {
          throw new MixError(
            DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER,
            `HMR trampoline method "${methodName}" not found on component "${componentId}".`
          );
        }
        return fn.call(initialScope, initialScope, ...args) as R;
      };
    },
    dispose: cleanup
  };
}

/**
 * Applies an HMR update for `componentId`.
 * Returns `true` if hot-swapped in place (signature matched), or `false` if a
 * structural signature change triggered instance remounts.
 */
export function applyHmrUpdate(
  componentId: string,
  update: {
    methods: Record<string, HmrMethod>;
    signature?: string;
  }
): boolean {
  const record = hmrComponentRegistry.get(componentId);
  if (!record) {
    hmrComponentRegistry.set(componentId, {
      signature: update.signature ?? "v1",
      methods: { ...update.methods },
      instances: new Set()
    });
    return true;
  }

  const nextSignature = update.signature ?? record.signature;
  record.methods = { ...record.methods, ...update.methods };

  if (nextSignature !== record.signature) {
    record.signature = nextSignature;
    for (const inst of [...record.instances]) {
      inst.remount?.();
    }
    return false;
  }

  return true;
}
