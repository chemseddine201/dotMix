/**
 * @mix/runtime/dom/reconciler — Keyed List Reconciliation & O(N log N) LIS
 * with Atomic Duplicate-Update Rejection (D-110 / HAA-02 Option A).
 */

import { MixError, DiagnosticCodes } from "../errors.js";
import {
  signal,
  createEffect,
  createRoot,
  getCurrentOwner,
  runWithOwner,
  disposeOwner,
  onCleanup,
  untrack,
  type Signal,
  type Owner
} from "../core/index.js";
import { removeNode, normalizeToNodeArray } from "./nodes.js";

/**
 * Computes the Longest Increasing Subsequence of non-negative values in `seq`
 * in O(N log N) time, returning the strictly increasing indices in `seq`.
 * Entries with `seq[i] < 0` (newly created rows) are ignored.
 * `seq[i] === 0` is handled accurately as a valid non-negative index.
 */
export function longestIncreasingSubsequence(seq: readonly number[]): number[] {
  const len = seq.length;
  if (len === 0) return [];

  const tails: number[] = []; // indices into `seq`
  const prev = new Int32Array(len).fill(-1);

  for (let i = 0; i < len; i++) {
    const val = seq[i]!;
    if (val < 0) {
      continue;
    }

    if (tails.length === 0 || seq[tails[tails.length - 1]!]! < val) {
      if (tails.length > 0) {
        prev[i] = tails[tails.length - 1]!;
      }
      tails.push(i);
      continue;
    }

    // Binary search for the smallest tail >= val
    let lo = 0;
    let hi = tails.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < val) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    if (val < seq[tails[lo]!]!) {
      if (lo > 0) {
        prev[i] = tails[lo - 1]!;
      }
      tails[lo] = i;
    }
  }

  const result = new Array<number>(tails.length);
  let k = tails.length;
  let curr = k > 0 ? tails[k - 1]! : -1;
  while (k > 0 && curr !== -1) {
    k--;
    result[k] = curr;
    curr = prev[curr]!;
  }
  return result;
}

export const computeLisIndices = longestIncreasingSubsequence;

export interface KeyedRowEntry<T> {
  readonly key: string | number | symbol;
  readonly owner: Owner;
  readonly dispose: () => void;
  readonly itemSignal: Signal<T>;
  readonly indexSignal: Signal<number>;
  readonly nodes: Node[];
}

export type KeyedItemRecord<T> = KeyedRowEntry<T>;

interface KeyedListState<T> {
  readonly endAnchor: Comment;
  entries: Map<string | number | symbol, KeyedRowEntry<T>>;
  order: KeyedRowEntry<T>[];
}

const containerListStateMap = new WeakMap<Node, KeyedListState<unknown>>();

function normalizeSameValueZeroKey(
  rawKey: unknown,
  index: number
): string | number | symbol {
  if (
    rawKey === null ||
    rawKey === undefined ||
    (typeof rawKey !== "string" &&
      typeof rawKey !== "number" &&
      typeof rawKey !== "symbol") ||
    (typeof rawKey === "number" && Number.isNaN(rawKey))
  ) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_DUPLICATE_KEY,
      `Invalid key "${String(rawKey)}" at index ${index}: keys must be non-null strings, finite numbers, or symbols (D-110).`
    );
  }
  if (typeof rawKey === "number" && Object.is(rawKey, -0)) {
    return 0;
  }
  return rawKey;
}

function reconcileKeyedListInternal<T>(
  parent: Node,
  state: KeyedListState<T>,
  items: readonly T[],
  keyFn: (item: T, index: number) => string | number | symbol,
  createRowNodes: (
    item: T,
    indexSignal: Signal<number>,
    itemSignal: Signal<T>
  ) => Node | readonly Node[],
  parentOwner: Owner | null
): void {
  // Step 1 (D-110 / HAA-02 Option A Strict): Pre-reconciliation Key Validation
  // Validate the ENTIRE incoming key collection upfront BEFORE any DOM/owner
  // allocation, movement, or disposal.
  const seenKeys = new Map<string | number | symbol, number>();
  const incomingKeys = new Array<string | number | symbol>(items.length);

  for (let i = 0; i < items.length; i++) {
    const rawKey = keyFn(items[i]!, i);
    const key = normalizeSameValueZeroKey(rawKey, i);
    const firstSeenIdx = seenKeys.get(key);
    if (firstSeenIdx !== undefined) {
      // Atomic rejection: zero DOM mutations, zero owner allocations/disposals
      throw new MixError(
        DiagnosticCodes.MIX_ERR_DUPLICATE_KEY,
        `Duplicate key "${String(key)}" detected at index ${i} (first seen at index ${firstSeenIdx}). Collection update atomically rejected (D-110 / HAA-02).`
      );
    }
    seenKeys.set(key, i);
    incomingKeys[i] = key;
  }

  // Step 2: Dispose and remove obsolete rows not present in `seenKeys`
  const survivingOrder: KeyedRowEntry<T>[] = [];
  for (const oldEntry of state.order) {
    if (!seenKeys.has(oldEntry.key)) {
      oldEntry.dispose();
      disposeOwner(oldEntry.owner);
      for (const node of oldEntry.nodes) {
        removeNode(node);
      }
      state.entries.delete(oldEntry.key);
    } else {
      survivingOrder.push(oldEntry);
    }
  }

  // Map surviving keys to their relative index in `survivingOrder` (0 .. survivingOrder.length - 1)
  const survivingIndexMap = new Map<string | number | symbol, number>();
  for (let i = 0; i < survivingOrder.length; i++) {
    survivingIndexMap.set(survivingOrder[i]!.key, i);
  }

  // Step 3: Build `nextOrder` and `seq` (old surviving indices or -1 for new)
  const nextOrder = new Array<KeyedRowEntry<T>>(items.length);
  const seq = new Array<number>(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const key = incomingKeys[i]!;
    const existing = state.entries.get(key);

    if (existing !== undefined) {
      existing.itemSignal.set(item);
      existing.indexSignal.set(i);
      nextOrder[i] = existing;
      seq[i] = survivingIndexMap.get(key)!;
    } else {
      let rowOwner!: Owner;
      let rowDispose!: () => void;
      const itemSig: Signal<T> = signal<T>(item);
      const indexSig: Signal<number> = signal<number>(i);
      let rowNodes: Node[] = [];

      untrack(() => {
        createRoot((dispose) => {
          rowDispose = dispose;
          rowOwner = getCurrentOwner()!;
          rowNodes = normalizeToNodeArray(createRowNodes(item, indexSig, itemSig));
        }, parentOwner);
      });

      const newEntry: KeyedRowEntry<T> = {
        key,
        owner: rowOwner,
        dispose: rowDispose,
        itemSignal: itemSig,
        indexSignal: indexSig,
        nodes: rowNodes
      };
      state.entries.set(key, newEntry);
      nextOrder[i] = newEntry;
      seq[i] = -1;
    }
  }

  // Step 4: Compute O(N log N) LIS of surviving indices and apply minimal moves
  const lisIndices = longestIncreasingSubsequence(seq);
  let lisPtr = lisIndices.length - 1;
  let nextAnchor: Node | null =
    state.endAnchor.parentNode === parent ? state.endAnchor : null;

  for (let i = nextOrder.length - 1; i >= 0; i--) {
    const entry = nextOrder[i]!;
    const isNew = seq[i] === -1;
    const isInLis = !isNew && lisPtr >= 0 && lisIndices[lisPtr] === i;

    if (isInLis) {
      lisPtr--;
    } else {
      // Insert or move row nodes before `nextAnchor`
      for (const node of entry.nodes) {
        parent.insertBefore(node, nextAnchor);
      }
    }

    if (entry.nodes.length > 0) {
      nextAnchor = entry.nodes[0]!;
    }
  }

  state.order = nextOrder;
}

/**
 * Direct imperative keyed list reconciler for `parent` container (D-110 / HAA-02).
 * Maintains reconciliation state per container across consecutive calls.
 */
export function renderKeyedList<T>(
  parent: HTMLElement,
  items: readonly T[],
  keyFn: (item: T, index: number) => string | number | symbol,
  renderFn: (
    item: T,
    indexGetter: () => number,
    itemGetter: () => T
  ) => Node | readonly Node[]
): void {
  let state = containerListStateMap.get(parent) as KeyedListState<T> | undefined;
  if (!state) {
    const endAnchor = document.createComment("mix:each");
    parent.appendChild(endAnchor);
    state = {
      endAnchor,
      entries: new Map(),
      order: []
    };
    containerListStateMap.set(parent, state as KeyedListState<unknown>);
  }

  reconcileKeyedListInternal(
    parent,
    state,
    items,
    keyFn,
    (item, indexSig, itemSig) =>
      renderFn(
        item,
        () => indexSig(),
        () => itemSig()
      ),
    getCurrentOwner()
  );
}

/**
 * Reactive keyed `{#each}` block primitive used by compiled Mix/Tix templates.
 */
export function createKeyedEach<T>(
  parent: Node,
  itemsFn: () => readonly T[],
  keyFn: (item: T, index: number) => string | number | symbol,
  renderRowFn: (
    itemGetter: () => T,
    indexGetter: () => number
  ) => Node | readonly Node[],
  anchor?: Node | null
): Comment {
  const endAnchor = document.createComment("mix:each");
  parent.insertBefore(endAnchor, anchor ?? null);

  const state: KeyedListState<T> = {
    endAnchor,
    entries: new Map(),
    order: []
  };
  const parentOwner = getCurrentOwner();

  if (parentOwner) {
    onCleanup(() => {
      for (const entry of state.order) {
        entry.dispose();
        disposeOwner(entry.owner);
        for (const node of entry.nodes) {
          removeNode(node);
        }
      }
      state.entries.clear();
      state.order = [];
      removeNode(endAnchor);
    });
  }

  createEffect(() => {
    const items = itemsFn();
    const targetParent = endAnchor.parentNode ?? parent;
    reconcileKeyedListInternal(
      targetParent,
      state,
      items,
      keyFn,
      (_item, indexSig, itemSig) =>
        runWithOwner(getCurrentOwner(), () =>
          renderRowFn(
            () => itemSig(),
            () => indexSig()
          )
        ),
      parentOwner
    );
  });

  return endAnchor;
}
