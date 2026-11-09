/**
 * @mix/runtime/dom/lifecycle — Built-in DOM visual and lifecycle primitives:
 * - Teleport (createPortal): surgical portal mounting into any target element or selector
 * - KeepAlive (createKeepAlive): LRU offscreen component caching with live signal preservation
 * - Transition (createTransition): enter/leave CSS lifecycle classes and delayed unmounting
 *
 * Implements Phase Gate 19 / Decision D-122.
 */

import {
  createRoot,
  createEffect,
  getCurrentOwner,
  onCleanup,
  type Owner
} from "../core/index.js";
import { removeNode, normalizeToNodeArray } from "./index.js";

// ============================================================================
// 1. Teleport / createPortal
// ============================================================================

export interface TeleportProps {
  to: string | Element;
  disabled?: boolean | (() => boolean) | undefined;
  children?: Node | readonly Node[] | (() => unknown) | unknown;
}

/**
 * Surgically mounts children into a target DOM container (e.g. document.body)
 * while preserving parent Owner hierarchy, context inheritance, and scoped styles.
 */
export function Teleport(props: TeleportProps, parent?: Node | null, anchor?: Node | null): Node | readonly Node[] {
  const marker = document.createComment("mix:teleport");
  const parentOwner = getCurrentOwner();

  if (parent) {
    parent.insertBefore(marker, anchor ?? null);
  }

  let childNodes: Node[] = [];
  let rootDisposer: (() => void) | null = null;

  createRoot((dispose) => {
    rootDisposer = dispose;
    const raw = typeof props.children === "function" ? (props.children as () => unknown)() : props.children;
    childNodes = normalizeToNodeArray(raw as Node | readonly Node[] | null | undefined);
  }, parentOwner);

  function resolveTarget(): Element | null {
    if (typeof props.to === "string") {
      if (typeof document !== "undefined") {
        return document.querySelector(props.to);
      }
      return null;
    }
    return props.to;
  }

  function isDisabled(): boolean {
    if (typeof props.disabled === "function") {
      return Boolean(props.disabled());
    }
    return Boolean(props.disabled);
  }

  let isFirstRun = true;

  createEffect(() => {
    const disabled = isDisabled();
    const target = resolveTarget();

    if (isFirstRun) {
      isFirstRun = false;
      if (!disabled && target) {
        for (const node of childNodes) {
          target.appendChild(node);
        }
      }
      return;
    }

    if (disabled || !target) {
      const p = marker.parentNode;
      if (p) {
        for (const node of childNodes) {
          p.insertBefore(node, marker);
        }
      }
    } else {
      for (const node of childNodes) {
        target.appendChild(node);
      }
    }
  });

  if (parentOwner) {
    onCleanup(() => {
      for (const node of childNodes) {
        removeNode(node);
      }
      if (rootDisposer) {
        rootDisposer();
        rootDisposer = null;
      }
    });
  }

  const initiallyDisabled = isDisabled();
  const initialTarget = resolveTarget();
  if (initiallyDisabled || !initialTarget) {
    return [...childNodes, marker];
  }

  return marker;
}

export function createPortal(
  children: Node | readonly Node[] | (() => unknown) | unknown,
  container: string | Element,
  options?: { disabled?: boolean | (() => boolean) }
): Node | readonly Node[] {
  return Teleport({
    to: container,
    disabled: options?.disabled,
    children
  });
}

// ============================================================================
// 2. KeepAlive / createKeepAlive
// ============================================================================

export interface KeepAliveProps {
  activeKey: string | (() => string);
  max?: number | undefined;
  render: (key: string) => Node | readonly Node[] | unknown;
}

interface KeepAliveCacheEntry {
  key: string;
  nodes: Node[];
  dispose: () => void;
  owner: Owner | null;
  lastAccessed: number;
}

/**
 * Caches rendered DOM nodes and their live reactive Owner inside an offscreen
 * DocumentFragment keyed by activeKey with LRU eviction when cache exceeds max.
 */
export function KeepAlive(props: KeepAliveProps, parent?: Node | null, anchor?: Node | null): Node | readonly Node[] {
  const marker = document.createComment("mix:keep-alive");
  const parentOwner = getCurrentOwner();
  const offscreen = typeof document !== "undefined" ? document.createDocumentFragment() : null;

  if (parent) {
    parent.insertBefore(marker, anchor ?? null);
  }

  const cache = new Map<string, KeepAliveCacheEntry>();
  let accessCounter = 0;

  function getKey(): string {
    return typeof props.activeKey === "function" ? props.activeKey() : props.activeKey;
  }

  function evictLruIfNeeded(): void {
    if (!props.max || cache.size <= props.max) return;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of cache.entries()) {
      if (key !== currentKey && entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey && cache.has(oldestKey)) {
      const entry = cache.get(oldestKey)!;
      for (const node of entry.nodes) {
        removeNode(node);
      }
      entry.dispose();
      cache.delete(oldestKey);
    }
  }

  function createEntry(key: string): KeepAliveCacheEntry {
    let entryDisposer: (() => void) | null = null;
    let renderedNodes: Node[] = [];
    let entryOwner: Owner | null = null;

    createRoot((dispose) => {
      entryDisposer = dispose;
      entryOwner = getCurrentOwner();
      const res = props.render(key);
      renderedNodes = normalizeToNodeArray(res as Node | readonly Node[] | null | undefined);
    }, parentOwner);

    return {
      key,
      nodes: renderedNodes,
      dispose: () => {
        if (entryDisposer) {
          entryDisposer();
          entryDisposer = null;
        }
      },
      owner: entryOwner,
      lastAccessed: ++accessCounter
    };
  }

  // 1. Synchronously prepare initial entry
  const initialKey = getKey();
  let currentKey = initialKey;
  const initialEntry = createEntry(initialKey);
  cache.set(initialKey, initialEntry);

  let isFirstRun = true;

  createEffect(() => {
    const nextKey = getKey();
    if (isFirstRun) {
      isFirstRun = false;
      return;
    }
    if (nextKey === currentKey) return;

    // Move previous nodes to offscreen fragment without disposing Owner
    if (currentKey && cache.has(currentKey)) {
      const prevEntry = cache.get(currentKey)!;
      if (offscreen) {
        for (const node of prevEntry.nodes) {
          offscreen.appendChild(node);
        }
      }
    }

    currentKey = nextKey;

    // Check if nextKey is in cache
    let entry = cache.get(nextKey);
    if (entry) {
      entry.lastAccessed = ++accessCounter;
      const p = marker.parentNode;
      if (p) {
        for (const node of entry.nodes) {
          p.insertBefore(node, marker);
        }
      }
    } else {
      entry = createEntry(nextKey);
      cache.set(nextKey, entry);

      const p = marker.parentNode;
      if (p) {
        for (const node of entry.nodes) {
          p.insertBefore(node, marker);
        }
      }

      evictLruIfNeeded();
    }
  });

  if (parentOwner) {
    onCleanup(() => {
      for (const entry of cache.values()) {
        for (const node of entry.nodes) {
          removeNode(node);
        }
        entry.dispose();
      }
      cache.clear();
    });
  }

  return [...initialEntry.nodes, marker];
}

export const createKeepAlive = KeepAlive;

// ============================================================================
// 3. Transition / createTransition
// ============================================================================

export interface TransitionProps {
  name?: string | undefined;
  show?: boolean | (() => boolean) | undefined;
  durationMs?: number | undefined;
  onBeforeEnter?: ((el: HTMLElement) => void) | undefined;
  onAfterEnter?: ((el: HTMLElement) => void) | undefined;
  onBeforeLeave?: ((el: HTMLElement) => void) | undefined;
  onAfterLeave?: ((el: HTMLElement) => void) | undefined;
  children?: Node | (() => unknown) | unknown;
}

/**
 * Applies enter/leave CSS lifecycle classes and delays physical DOM unmounting
 * until leave transitions complete.
 */
export function Transition(props: TransitionProps, parent?: Node | null, anchor?: Node | null): Node | readonly Node[] {
  const marker = document.createComment("mix:transition");
  const parentOwner = getCurrentOwner();
  const name = props.name ?? "v";
  const duration = props.durationMs ?? 300;

  if (parent) {
    parent.insertBefore(marker, anchor ?? null);
  }

  let childNodes: Node[] = [];
  let rootDisposer: (() => void) | null = null;
  let isMounted = false;

  createRoot((dispose) => {
    rootDisposer = dispose;
    const raw = typeof props.children === "function" ? (props.children as () => unknown)() : props.children;
    childNodes = normalizeToNodeArray(raw as Node | readonly Node[] | null | undefined);
  }, parentOwner);

  function isShowing(): boolean {
    if (typeof props.show === "function") {
      return Boolean(props.show());
    }
    return props.show !== undefined ? Boolean(props.show) : true;
  }

  function getFirstElement(): HTMLElement | null {
    for (const node of childNodes) {
      if (node.nodeType === 1) {
        return node as HTMLElement;
      }
    }
    return null;
  }

  const initialShow = isShowing();
  isMounted = initialShow;
  const initialEl = getFirstElement();
  if (initialShow && initialEl) {
    props.onBeforeEnter?.(initialEl);
    initialEl.classList.add(`${name}-enter-from`, `${name}-enter-active`);

    const enterFrame = () => {
      initialEl.classList.remove(`${name}-enter-from`);
      initialEl.classList.add(`${name}-enter-to`);

      const cleanupEnter = () => {
        initialEl.classList.remove(`${name}-enter-active`, `${name}-enter-to`);
        props.onAfterEnter?.(initialEl);
      };

      if (typeof globalThis.setTimeout === "function") {
        globalThis.setTimeout(cleanupEnter, duration);
      }
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(enterFrame);
    } else {
      enterFrame();
    }
  }

  let isFirstRun = true;

  createEffect(() => {
    const show = isShowing();
    if (isFirstRun) {
      isFirstRun = false;
      return;
    }
    const el = getFirstElement();

    if (show) {
      if (!isMounted) {
        isMounted = true;
        const p = marker.parentNode;
        if (p) {
          for (const node of childNodes) {
            p.insertBefore(node, marker);
          }
        }

        if (el) {
          props.onBeforeEnter?.(el);
          el.classList.add(`${name}-enter-from`, `${name}-enter-active`);

          const enterFrame = () => {
            el.classList.remove(`${name}-enter-from`);
            el.classList.add(`${name}-enter-to`);

            const cleanupEnter = () => {
              el.classList.remove(`${name}-enter-active`, `${name}-enter-to`);
              props.onAfterEnter?.(el);
            };

            if (typeof globalThis.setTimeout === "function") {
              globalThis.setTimeout(cleanupEnter, duration);
            }
          };

          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(enterFrame);
          } else {
            enterFrame();
          }
        }
      }
    } else {
      if (isMounted) {
        if (el) {
          props.onBeforeLeave?.(el);
          el.classList.add(`${name}-leave-from`, `${name}-leave-active`);

          const leaveFrame = () => {
            el.classList.remove(`${name}-leave-from`);
            el.classList.add(`${name}-leave-to`);

            const cleanupLeave = () => {
              el.classList.remove(`${name}-leave-active`, `${name}-leave-to`);
              for (const node of childNodes) {
                removeNode(node);
              }
              isMounted = false;
              props.onAfterLeave?.(el);
            };

            if (typeof globalThis.setTimeout === "function") {
              globalThis.setTimeout(cleanupLeave, duration);
            } else {
              cleanupLeave();
            }
          };

          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(leaveFrame);
          } else {
            leaveFrame();
          }
        } else {
          for (const node of childNodes) {
            removeNode(node);
          }
          isMounted = false;
        }
      }
    }
  });

  if (parentOwner) {
    onCleanup(() => {
      for (const node of childNodes) {
        removeNode(node);
      }
      if (rootDisposer) {
        rootDisposer();
        rootDisposer = null;
      }
    });
  }

  if (initialShow) {
    return [...childNodes, marker];
  }
  return marker;
}

export const createTransition = Transition;
