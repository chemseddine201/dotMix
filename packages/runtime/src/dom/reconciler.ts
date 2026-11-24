/**
 * @dotmix/runtime/dom/reconciler — Keyed List Reconciliation & O(N log N) LIS
 * with Atomic Duplicate-Update Rejection.
 */

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
import { getHydrationContext, runWithHydrationSubtree } from "./hydration.js";
import {
  normalizeSameValueZeroKey,
  resolveImplicitKey,
  resolveIncomingKeys,
  type DuplicateKeyTracker,
  type KeyMode,
  type KeyedEachLocation,
  type KeyedEachOptions
} from "./reconciler-keys.js";

export {
  normalizeSameValueZeroKey,
  resolveImplicitKey,
  resolveIncomingKeys,
  type DuplicateKeyTracker,
  type KeyMode,
  type KeyedEachLocation,
  type KeyedEachOptions
};

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
  readonly key: unknown;
  readonly owner: Owner;
  readonly dispose: () => void;
  readonly itemSignal: Signal<T>;
  readonly indexSignal: Signal<number>;
  readonly nodes: Node[];
}

export type KeyedItemRecord<T> = KeyedRowEntry<T>;

interface KeyedListState<T> extends DuplicateKeyTracker {
  readonly endAnchor: Comment;
  entries: Map<unknown, KeyedRowEntry<T>>;
  order: KeyedRowEntry<T>[];
}

const containerListStateMap = new WeakMap<Node, KeyedListState<unknown>>();

function reconcileKeyedListInternal<T>(
  parent: Node,
  state: KeyedListState<T>,
  items: readonly T[],
  keyFn: ((item: T, index: number) => unknown) | null | undefined,
  createRowNodes: (
    item: T,
    indexSignal: Signal<number>,
    itemSignal: Signal<T>
  ) => Node | readonly Node[],
  parentOwner: Owner | null,
  options?: KeyedEachOptions
): void {
  const mode: KeyMode = options?.mode ?? "explicit";
  // Step 1: Pre-reconciliation Key Validation (atomic in explicit mode, safe in implicit mode)
  const { seenKeys, incomingKeys } = resolveIncomingKeys(
    items,
    keyFn,
    mode,
    state,
    options?.loc
  );

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
  const survivingIndexMap = new Map<unknown, number>();
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
 * Direct imperative keyed list reconciler for `parent` container.
 * Maintains reconciliation state per container across consecutive calls.
 */
export function renderKeyedList<T>(
  parent: HTMLElement,
  items: readonly T[],
  keyFn: ((item: T, index: number) => unknown) | null | undefined,
  renderFn: (
    item: T,
    indexGetter: () => number,
    itemGetter: () => T
  ) => Node | readonly Node[],
  options?: KeyedEachOptions
): void {
  let state = containerListStateMap.get(parent) as KeyedListState<T> | undefined;
  if (!state) {
    const endAnchor = document.createComment("mix:each");
    parent.appendChild(endAnchor);
    state = {
      endAnchor,
      entries: new Map(),
      order: [],
      duplicateTokens: new Map(),
      warnedDuplicate: false
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
    getCurrentOwner(),
    options
  );
}

/**
 * Reactive keyed `{each}` block primitive used by compiled Mix/Tix templates.
 */
export function createKeyedEach<T>(
  parent: Node,
  itemsFn: () => readonly T[],
  keyFn: ((item: T, index: number) => unknown) | null | undefined,
  renderRowFn: (
    itemGetter: () => T,
    indexGetter: () => number
  ) => Node | readonly Node[],
  anchor?: Node | null,
  options?: KeyedEachOptions
): Comment {
  const initialWalker = getHydrationContext();
  const openMarker = initialWalker ? initialWalker.claimComment("mix:each:") : null;
  const closeMarker =
    initialWalker && openMarker ? initialWalker.findClosingComment(openMarker, "mix:each:") : null;
  const endAnchor = closeMarker ?? document.createComment("mix:each");
  if (!closeMarker) {
    parent.insertBefore(endAnchor, anchor ?? null);
  } else if (parent.nodeType === 11 && initialWalker) {
    initialWalker.recordScopeNode(endAnchor);
  }

  const state: KeyedListState<T> = {
    endAnchor,
    entries: new Map(),
    order: [],
    duplicateTokens: new Map(),
    warnedDuplicate: false
  };
  const parentOwner = getCurrentOwner();
  let isFirstHydrateRun = Boolean(initialWalker && openMarker && closeMarker);
  const mode: KeyMode = options?.mode ?? "explicit";

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
      state.duplicateTokens.clear();
      state.order = [];
      removeNode(endAnchor);
    });
  }

  createEffect(() => {
    const items = itemsFn() ?? [];
    const targetParent = endAnchor.parentNode ?? parent;

    if (isFirstHydrateRun && initialWalker && openMarker && closeMarker) {
      isFirstHydrateRun = false;
      runWithHydrationSubtree(
        initialWalker,
        openMarker,
        closeMarker,
        () => {
          const { incomingKeys } = resolveIncomingKeys(items, keyFn, mode, state, options?.loc);
          const hydratedOrder: KeyedRowEntry<T>[] = [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i]!;
            const key = incomingKeys[i]!;

            const itemOpen = initialWalker.claimComment("mix:item:");
            const itemClose = itemOpen ? initialWalker.findClosingComment(itemOpen, "mix:item:") : null;
            let rowOwner!: Owner;
            let rowDispose!: () => void;
            const itemSig: Signal<T> = signal<T>(item);
            const indexSig: Signal<number> = signal<number>(i);
            let rowNodes: Node[] = [];

            untrack(() => {
              createRoot((dispose) => {
                rowDispose = dispose;
                rowOwner = getCurrentOwner()!;
                rowNodes = runWithHydrationSubtree(
                  initialWalker,
                  itemOpen,
                  itemClose,
                  () => {
                    initialWalker.pushScope();
                    const res = normalizeToNodeArray(
                      renderRowFn(
                        () => itemSig(),
                        () => indexSig()
                      )
                    );
                    const scoped = initialWalker.popScope();
                    return res.length > 0 ? res : scoped;
                  },
                  () => {
                    const res = normalizeToNodeArray(
                      renderRowFn(
                        () => itemSig(),
                        () => indexSig()
                      )
                    );
                    if (itemClose && itemClose.parentNode) {
                      for (const n of res) itemClose.parentNode.insertBefore(n, itemClose);
                    }
                    return res;
                  }
                );
              }, parentOwner);
            });

            const entry: KeyedRowEntry<T> = {
              key,
              owner: rowOwner,
              dispose: rowDispose,
              itemSignal: itemSig,
              indexSignal: indexSig,
              nodes: rowNodes
            };
            state.entries.set(key, entry);
            hydratedOrder.push(entry);
          }
          state.order = hydratedOrder;
        },
        () => {
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
            parentOwner,
            options
          );
        }
      );
      return;
    }

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
      parentOwner,
      options
    );
  });

  return endAnchor;
}
