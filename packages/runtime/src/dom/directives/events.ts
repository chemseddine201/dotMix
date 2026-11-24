/**
 * @dotmix/runtime/dom/directives/events — F12 event modifier & conditional event helpers.
 */

import {
  createEffect,
  findErrorHandler,
  getCurrentOwner,
  onCleanup,
  reportError,
  type Owner
} from "../../core/index.js";
import type { EventModifiers } from "./contract-types.js";

function normalizeExpectedKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === "enter") return "Enter";
  if (lower === "esc" || lower === "escape") return "Escape";
  if (lower === "tab") return "Tab";
  if (lower === "space") return " ";
  return key;
}

function collectExpectedKeys(modifiers: EventModifiers): readonly string[] | null {
  const out: string[] = [];
  if (modifiers.enter) out.push("Enter");
  if (modifiers.esc) out.push("Escape");
  if (modifiers.tab) out.push("Tab");
  if (modifiers.space) out.push(" ");
  if (modifiers.keys) {
    for (let i = 0; i < modifiers.keys.length; i++) {
      out.push(normalizeExpectedKey(modifiers.keys[i]!));
    }
  }
  return out.length > 0 ? out : null;
}

function matchesExpectedKey(event: Event, expectedKeys: readonly string[]): boolean {
  const keyEvent = event as KeyboardEvent;
  const actualKey = typeof keyEvent.key === "string" ? keyEvent.key : "";
  const actualCode = typeof keyEvent.code === "string" ? keyEvent.code : "";
  for (let i = 0; i < expectedKeys.length; i++) {
    const expected = expectedKeys[i]!;
    if (actualKey === expected) {
      return true;
    }
    if (expected === " " && (actualKey === "Spacebar" || actualKey === "Space" || actualCode === "Space")) {
      return true;
    }
    if (actualKey.toLowerCase() === expected.toLowerCase()) {
      return true;
    }
  }
  return false;
}

function resolveEventTarget(el: EventTarget, modifiers?: EventModifiers): EventTarget {
  if (modifiers?.window && typeof window !== "undefined") {
    return window;
  }
  if ((modifiers?.document || modifiers?.outside) && typeof document !== "undefined") {
    return document;
  }
  return el;
}

function buildListenerOptions(
  modifiers?: EventModifiers
): AddEventListenerOptions | undefined {
  if (!modifiers) {
    return undefined;
  }
  const hasCapture = modifiers.capture !== undefined;
  const hasPassive = modifiers.passive !== undefined;
  const hasOnce = modifiers.once !== undefined;
  if (!hasCapture && !hasPassive && !hasOnce) {
    return undefined;
  }
  const opts: AddEventListenerOptions = {};
  if (hasCapture) {
    opts.capture = Boolean(modifiers.capture);
  }
  if (hasPassive) {
    opts.passive = Boolean(modifiers.passive);
  }
  if (hasOnce) {
    opts.once = Boolean(modifiers.once);
  }
  return opts;
}

interface WrappedEventListener {
  readonly listener: EventListener;
  cancelTimers(): void;
}

function wrapEventListener(
  el: EventTarget,
  handler: EventListener,
  modifiers?: EventModifiers,
  owner?: Owner | null
): WrappedEventListener {
  const expectedKeys = modifiers ? collectExpectedKeys(modifiers) : null;
  let debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let lastThrottleTime = -Infinity;

  const invokeHandler = (ev: Event): void => {
    try {
      handler(ev);
    } catch (err) {
      const eh = findErrorHandler(owner ?? null);
      if (eh) {
        eh(err);
        return;
      }
      reportError(err, { source: "event" }, owner);
      throw err;
    }
  };

  const cancelTimers = (): void => {
    if (debounceTimer !== null) {
      globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const listener: EventListener = (event: Event): void => {
    if (modifiers) {
      if (modifiers.self && event.target !== el) {
        return;
      }
      if (modifiers.outside) {
        const container = el as { contains?: (node: unknown) => boolean };
        if (typeof container.contains === "function" && container.contains(event.target)) {
          return;
        }
      }
      const modEvent = event as KeyboardEvent | MouseEvent;
      if (modifiers.ctrl && !modEvent.ctrlKey) return;
      if (modifiers.shift && !modEvent.shiftKey) return;
      if (modifiers.alt && !modEvent.altKey) return;
      if (modifiers.meta && !modEvent.metaKey) return;
      if (expectedKeys && !matchesExpectedKey(event, expectedKeys)) return;
      if (modifiers.prevent) {
        event.preventDefault();
      }
      if (modifiers.stop) {
        event.stopPropagation();
      }
      if (modifiers.debounce !== undefined && modifiers.debounce >= 0) {
        cancelTimers();
        debounceTimer = globalThis.setTimeout(() => {
          debounceTimer = null;
          invokeHandler(event);
        }, modifiers.debounce);
        return;
      }
      if (modifiers.throttle !== undefined && modifiers.throttle > 0) {
        const now = Date.now();
        if (now - lastThrottleTime < modifiers.throttle) {
          return;
        }
        lastThrottleTime = now;
      }
    }
    invokeHandler(event);
  };

  return { listener, cancelTimers };
}

export function __mixOnEvent(
  el: EventTarget,
  eventName: string,
  handler: EventListener,
  modifiers?: EventModifiers
): () => void {
  const owner = getCurrentOwner();
  const target = resolveEventTarget(el, modifiers);
  const options = buildListenerOptions(modifiers);
  const wrapped = wrapEventListener(el, handler, modifiers, owner);
  let attached = true;

  target.addEventListener(eventName, wrapped.listener, options);

  const cleanup = (): void => {
    if (!attached) {
      return;
    }
    attached = false;
    wrapped.cancelTimers();
    target.removeEventListener(eventName, wrapped.listener, options);
  };

  if (owner) {
    onCleanup(cleanup);
  }

  return cleanup;
}

export function __mixOnConditionalEvent(
  el: EventTarget,
  eventName: string,
  condition: () => unknown,
  handler: EventListener,
  elseHandler?: EventListener | null,
  modifiers?: EventModifiers,
  invert?: boolean
): () => void {
  const owner = getCurrentOwner();
  const target = resolveEventTarget(el, modifiers);
  const options = buildListenerOptions(modifiers);

  let attachedRaw: EventListener | null = null;
  let attachedWrapped: WrappedEventListener | null = null;
  let disposed = false;

  const detach = (): void => {
    if (attachedWrapped !== null) {
      attachedWrapped.cancelTimers();
      target.removeEventListener(eventName, attachedWrapped.listener, options);
      attachedWrapped = null;
      attachedRaw = null;
    }
  };

  createEffect(() => {
    if (disposed) {
      return;
    }
    const rawCond = Boolean(condition());
    const active = invert ? !rawCond : rawCond;
    const nextRaw: EventListener | null = active ? handler : (elseHandler ?? null);

    if (nextRaw === attachedRaw) {
      return;
    }

    // Atomic swap: detach old listener cleanly before attaching new listener
    detach();

    if (nextRaw !== null) {
      const nextWrapped = wrapEventListener(el, nextRaw, modifiers, owner);
      target.addEventListener(eventName, nextWrapped.listener, options);
      attachedRaw = nextRaw;
      attachedWrapped = nextWrapped;
    }
  });

  const cleanup = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    detach();
  };

  if (owner) {
    onCleanup(cleanup);
  }

  return cleanup;
}
