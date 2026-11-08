// packages/runtime/src/dom/reconcile.ts — FROZEN per MIX_SPEC_v3.2.2 §7 & AGENTS.md Part III #3
import { MixError } from "../core/errors.js";
import { activeConfig } from "../core/config.js";
import {
  signal,
  type SignalNode
} from "../core/reactivity.js";
import {
  OwnerNode,
  disposeOwner,
  runWithOwner
} from "../core/owner.js";
import type { Owner } from "../types.js";

declare const __DEV__: boolean;

export interface KeyedEntry<T> {
  key: unknown;
  owner: Owner;
  node: any;
  itemSignal: SignalNode<T>;
  indexSignal: SignalNode<number>;
}

export type KeySelector<T> = (item: T, index: number) => unknown;
export type ItemRenderer<T> = (
  itemSignal: SignalNode<T>,
  indexSignal: SignalNode<number>,
  owner: Owner
) => any;

/**
 * R-KEY-01: Key comparison via SameValueZero (Map semantics).
 * NaN matches NaN, and +0 matches -0.
 */
export function isSameKey(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  return Object.is(a, b);
}

/**
 * Longest Increasing Subsequence (LIS) in O(N log N) using binary search.
 * Returns the array of indices of the longest strictly increasing subsequence.
 */
export function getSequence(arr: number[]): number[] {
  const p = arr.slice();
  const result: number[] = [0];
  let i: number, j: number, u: number, v: number, c: number;
  const len = arr.length;

  for (i = 0; i < len; i++) {
    const arrI = arr[i]!;
    if (arrI !== 0) {
      j = result[result.length - 1]!;
      if (arr[j]! < arrI) {
        p[i] = j;
        result.push(i);
        continue;
      }
      u = 0;
      v = result.length - 1;
      while (u < v) {
        c = (u + v) >> 1;
        if (arr[result[c]!]! < arrI) {
          u = c + 1;
        } else {
          v = c;
        }
      }
      if (arrI < arr[result[u]!]!) {
        if (u > 0) {
          p[i] = result[u - 1]!;
        }
        result[u] = i;
      }
    }
  }

  u = result.length;
  v = result[u - 1]!;
  while (u-- > 0) {
    result[u] = v;
    v = p[v]!;
  }
  return result;
}

/**
 * Reconciles dynamic list items using 6-step deterministic LIS algorithm (AGENTS.md Part III #3)
 * and strict duplicate key policy (MIX_SPEC_v3.2.2 §7).
 */
export function renderKeyedList<T>(
  parentElement: any,
  anchorNode: any,
  items: readonly T[],
  keySelector: KeySelector<T>,
  renderItem: ItemRenderer<T>,
  parentOwner?: Owner | null
): KeyedEntry<T>[] {
  const globalDev = (globalThis as unknown as { __DEV__?: boolean }).__DEV__;
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
  const isDev = typeof globalDev !== "undefined"
    ? Boolean(globalDev)
    : (proc ? proc.env?.NODE_ENV !== "production" : true);

  // 1. Compute keys and validate duplicate key policy (R-KEY-01, R-KEY-02, R-KEY-03)
  const newKeys: unknown[] = new Array(items.length);
  const seenKeys = new Map<unknown, number>();
  const keyOccurrences = new Map<unknown, number>();

  for (let idx = 0; idx < items.length; idx++) {
    const rawKey = keySelector(items[idx]!, idx);

    if (seenKeys.has(rawKey)) {
      const firstIndex = seenKeys.get(rawKey)!;
      if (isDev) {
        // R-KEY-02: __DEV__ throws MIX_RT_DUPLICATE_KEY with details
        throw new MixError(
          "MIX_RT_DUPLICATE_KEY",
          `Duplicate key "${String(rawKey)}" at index ${idx} (first seen at index ${firstIndex})`,
          { key: rawKey, firstIndex, duplicateIndex: idx }
        );
      } else {
        // R-KEY-03: Production keeps all items, assigns internal identity (k, n), emits warning
        const count = (keyOccurrences.get(rawKey) ?? 1) + 1;
        keyOccurrences.set(rawKey, count);
        newKeys[idx] = Object.freeze({ __mix_dup_key: rawKey, __mix_dup_occ: count });
        const warnErr = new MixError(
          "MIX_RT_DUPLICATE_KEY",
          `Duplicate key "${String(rawKey)}" at index ${idx}`,
          { key: rawKey, firstIndex, duplicateIndex: idx }
        );
        activeConfig.onWarning({
          code: warnErr.code,
          message: warnErr.message,
          details: warnErr.details
        });
      }
    } else {
      seenKeys.set(rawKey, idx);
      newKeys[idx] = rawKey;
    }
  }

  // Retrieve current entries from DOM container
  const oldEntries: KeyedEntry<T>[] = parentElement.__mix_keyed_entries ?? [];
  const newEntries: KeyedEntry<T>[] = new Array(items.length);

  function createEntry(item: T, key: unknown, index: number): KeyedEntry<T> {
    const itemSignal = signal(item);
    const indexSignal = signal(index);
    const owner = new OwnerNode("Component", parentOwner ?? null);

    const node = runWithOwner(owner, () => {
      return renderItem(itemSignal, indexSignal, owner);
    });

    return {
      key,
      owner,
      node,
      itemSignal,
      indexSignal
    };
  }

  function updateEntry(entry: KeyedEntry<T>, item: T, index: number): void {
    if (entry.itemSignal.value !== item) {
      entry.itemSignal.value = item;
    }
    if (entry.indexSignal.value !== index) {
      entry.indexSignal.value = index;
    }
  }

  function disposeEntry(entry: KeyedEntry<T>): void {
    disposeOwner(entry.owner);
    if (entry.node && parentElement.contains && parentElement.contains(entry.node)) {
      parentElement.removeChild(entry.node);
    } else if (entry.node && entry.node.parentNode === parentElement) {
      parentElement.removeChild(entry.node);
    }
  }

  function insertEntry(entry: KeyedEntry<T>, nextNode: any): void {
    if (entry.node) {
      parentElement.insertBefore(entry.node, nextNode);
    }
  }

  let i = 0;
  let e1 = oldEntries.length - 1;
  let e2 = items.length - 1;

  // Step 1: Sync from start (prefix match)
  while (i <= e1 && i <= e2 && isSameKey(oldEntries[i]!.key, newKeys[i])) {
    const entry = oldEntries[i]!;
    updateEntry(entry, items[i]!, i);
    newEntries[i] = entry;
    i++;
  }

  // Step 2: Sync from end (suffix match)
  while (i <= e1 && i <= e2 && isSameKey(oldEntries[e1]!.key, newKeys[e2])) {
    const entry = oldEntries[e1]!;
    updateEntry(entry, items[e2]!, e2);
    newEntries[e2] = entry;
    e1--;
    e2--;
  }

  // Step 3: Common sequence + mount (old items exhausted)
  if (i > e1) {
    if (i <= e2) {
      const nextPos = e2 + 1;
      const anchor = nextPos < items.length ? newEntries[nextPos]!.node : anchorNode;
      while (i <= e2) {
        const entry = createEntry(items[i]!, newKeys[i], i);
        newEntries[i] = entry;
        insertEntry(entry, anchor);
        i++;
      }
    }
  }
  // Step 4: Common sequence + unmount (new items exhausted)
  else if (i > e2) {
    while (i <= e1) {
      disposeEntry(oldEntries[i]!);
      i++;
    }
  }
  // Step 5: Unknown sequence (LIS diff)
  else {
    const s1 = i;
    const s2 = i;

    // 5.1 Build keyToNewIndexMap
    const keyToNewIndexMap = new Map<unknown, number>();
    for (i = s2; i <= e2; i++) {
      keyToNewIndexMap.set(newKeys[i], i);
    }

    // 5.2 Traverse old items to patch or remove
    const toBePatched = e2 - s2 + 1;
    let patched = 0;
    let maxNewIndexSoFar = 0;
    let moved = false;
    const newIndexToOldIndexMap = new Array<number>(toBePatched).fill(0);

    for (i = s1; i <= e1; i++) {
      const prevEntry = oldEntries[i]!;
      if (patched >= toBePatched) {
        disposeEntry(prevEntry);
        continue;
      }

      const newIndex = keyToNewIndexMap.get(prevEntry.key);
      if (newIndex === undefined) {
        disposeEntry(prevEntry);
      } else {
        newIndexToOldIndexMap[newIndex - s2] = i + 1;
        if (newIndex >= maxNewIndexSoFar) {
          maxNewIndexSoFar = newIndex;
        } else {
          moved = true;
        }
        updateEntry(prevEntry, items[newIndex]!, newIndex);
        newEntries[newIndex] = prevEntry;
        patched++;
      }
    }

    // Step 6: Move and mount with LIS
    const increasingNewIndexSequence = moved ? getSequence(newIndexToOldIndexMap) : [];
    let j = increasingNewIndexSequence.length - 1;

    for (i = toBePatched - 1; i >= 0; i--) {
      const nextIndex = s2 + i;
      const anchor = nextIndex + 1 < items.length ? newEntries[nextIndex + 1]!.node : anchorNode;

      if (newIndexToOldIndexMap[i] === 0) {
        // Mount brand new entry
        const entry = createEntry(items[nextIndex]!, newKeys[nextIndex], nextIndex);
        newEntries[nextIndex] = entry;
        insertEntry(entry, anchor);
      } else if (moved) {
        if (j < 0 || i !== increasingNewIndexSequence[j]) {
          // Perform minimal surgical DOM move
          insertEntry(newEntries[nextIndex]!, anchor);
        } else {
          j--;
        }
      }
    }
  }

  parentElement.__mix_keyed_entries = newEntries;
  return newEntries;
}
