/**
 * @mix/runtime/dom/keep-alive — LRU offscreen component caching with live signal preservation
 * (KeepAlive / createKeepAlive, Phase 19 / D-122).
 */

import {
  createRoot,
  createEffect,
  getCurrentOwner,
  onCleanup,
  type Owner
} from "../core/index.js";
import { removeNode, normalizeToNodeArray } from "./nodes.js";

export interface KeepAliveProps {
  activeKey: string | (() => string);
  max?: number | undefined;
  render?: ((key: string) => Node | readonly Node[] | unknown) | undefined;
  children?: ((key?: string) => unknown) | Node | readonly Node[] | unknown;
}

export type KeepAliveHandle = Node | readonly Node[];

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
export function KeepAlive(
  props: KeepAliveProps,
  parent?: Node | null,
  anchor?: Node | null
): KeepAliveHandle {
  const marker = document.createComment("mix:keep-alive");
  const parentOwner = getCurrentOwner();
  const offscreen =
    typeof document !== "undefined" ? document.createDocumentFragment() : null;

  if (parent) {
    parent.insertBefore(marker, anchor ?? null);
  }

  const cache = new Map<string, KeepAliveCacheEntry>();
  let accessCounter = 0;

  function getKey(): string {
    return typeof props.activeKey === "function"
      ? props.activeKey()
      : props.activeKey;
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
      const res = props.render
        ? props.render(key)
        : typeof props.children === "function"
        ? (props.children as (k?: string) => unknown)(key)
        : props.children;
      renderedNodes = normalizeToNodeArray(
        res as Node | readonly Node[] | null | undefined
      );
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
