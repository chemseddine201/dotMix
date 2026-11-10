/**
 * @mix/runtime/dom/keep-alive — LRU offscreen component caching with live signal preservation
 * (KeepAlive / createKeepAlive, Phase 19 / D-122).
 */

import {
  createRoot,
  createEffect,
  getCurrentOwner,
  onCleanup,
  setOwnerSuspended,
  untrack,
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
  startMarker: Comment;
  endMarker: Comment;
  offscreen: DocumentFragment | null;
  nodes: Node[];
  dispose: () => void;
  owner: Owner | null;
  lastAccessed: number;
}

function parkEntryOffscreen(entry: KeepAliveCacheEntry): void {
  if (!entry.offscreen) return;
  if (
    entry.startMarker.parentNode &&
    entry.startMarker.parentNode === entry.endMarker.parentNode
  ) {
    let curr: Node | null = entry.startMarker;
    while (curr !== null) {
      const next: Node | null =
        curr === entry.endMarker ? null : curr.nextSibling;
      entry.offscreen.appendChild(curr);
      curr = next;
    }
  } else {
    for (const node of entry.nodes) {
      entry.offscreen.appendChild(node);
    }
  }
  entry.nodes = [...entry.offscreen.childNodes];
}

function mountEntryBeforeMarker(
  entry: KeepAliveCacheEntry,
  marker: Comment
): void {
  const p = marker.parentNode;
  if (!p) return;
  if (entry.offscreen && entry.offscreen.childNodes.length > 0) {
    entry.nodes = [...entry.offscreen.childNodes];
    p.insertBefore(entry.offscreen, marker);
  } else {
    for (const node of entry.nodes) {
      p.insertBefore(node, marker);
    }
  }
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

  if (parent) {
    parent.insertBefore(marker, anchor ?? null);
  }

  const cache = new Map<string, KeepAliveCacheEntry>();
  let accessCounter = 0;
  let currentKey = "";
  let initialEntry = null as KeepAliveCacheEntry | null;

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
    const startMarker = document.createComment(`mix:ka-start:${key}`);
    const endMarker = document.createComment(`mix:ka-end:${key}`);
    const offscreen =
      typeof document !== "undefined" ? document.createDocumentFragment() : null;

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

    const initialNodes = [startMarker, ...renderedNodes, endMarker];
    if (offscreen) {
      for (const node of initialNodes) {
        offscreen.appendChild(node);
      }
    }

    return {
      key,
      startMarker,
      endMarker,
      offscreen,
      nodes: initialNodes,
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

  let isFirstRun = true;

  // Register KeepAlive's key-observer effect FIRST so it always executes before
  // any conditional/child effects created inside createEntry(key) when activeKey changes.
  createEffect(() => {
    const nextKey = getKey();
    if (isFirstRun) {
      isFirstRun = false;
      currentKey = nextKey;
      initialEntry = untrack(() => createEntry(nextKey));
      cache.set(nextKey, initialEntry);
      if (marker.parentNode) {
        mountEntryBeforeMarker(initialEntry, marker);
      }
      return;
    }
    if (nextKey === currentKey) return;

    // Suspend previous entry's Owner and park its live DOM range into its offscreen fragment
    if (currentKey && cache.has(currentKey)) {
      const prevEntry = cache.get(currentKey)!;
      setOwnerSuspended(prevEntry.owner, true);
      parkEntryOffscreen(prevEntry);
    }

    currentKey = nextKey;

    // Restore cached entry or create new entry for nextKey
    let entry = cache.get(nextKey);
    if (entry) {
      entry.lastAccessed = ++accessCounter;
      mountEntryBeforeMarker(entry, marker);
      setOwnerSuspended(entry.owner, false);
    } else {
      entry = untrack(() => createEntry(nextKey));
      cache.set(nextKey, entry);
      mountEntryBeforeMarker(entry, marker);
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

  if (parent && initialEntry) {
    return marker;
  }
  if (initialEntry) {
    if (initialEntry.offscreen && initialEntry.offscreen.childNodes.length > 0) {
      initialEntry.nodes = [...initialEntry.offscreen.childNodes];
    }
    return [...initialEntry.nodes, marker];
  }
  return [marker];
}

export const createKeepAlive = KeepAlive;
