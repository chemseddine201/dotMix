/**
 * @dotmix/runtime/dom/directives/loops — F3 bounded range, pipeline, and empty-fallback list helpers.
 */

import { createMemo } from "../../core/index.js";
import { DiagnosticCodes, MixError } from "../../errors.js";
import { createConditional } from "../control-flow.js";
import { createKeyedEach, type KeyedEachOptions } from "../reconciler.js";
import type { EachPipelineOptions, ForRangeSpec } from "./contract-types.js";

export const MIX_FOR_MAX_RANGE = 100_000 as const;

export function __mixForRange(
  start: number,
  end: number,
  step?: number
): readonly number[] {
  const resolvedStep = step === undefined ? (start > end ? -1 : 1) : step;
  if (resolvedStep === 0) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_FOR_STEP_ZERO,
      "`for` directive step cannot be 0."
    );
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(resolvedStep)) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE,
      "`for` directive bounds and step must be finite numbers."
    );
  }
  if ((resolvedStep > 0 && start > end) || (resolvedStep < 0 && start < end)) {
    return [];
  }

  if (Number.isInteger(start) && Number.isInteger(end) && Number.isInteger(resolvedStep)) {
    const count = Math.floor((end - start) / resolvedStep) + 1;
    if (count > MIX_FOR_MAX_RANGE) {
      throw new MixError(
        DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE,
        `\`for\` directive range (${count}) exceeds maximum of ${MIX_FOR_MAX_RANGE} items.`
      );
    }
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      out[i] = start + i * resolvedStep;
    }
    return out;
  }

  const out: number[] = [];
  let idx = 0;
  while (true) {
    const currentValue = start + idx * resolvedStep;
    if (resolvedStep > 0 ? currentValue > end : currentValue < end) {
      break;
    }
    if (out.length >= MIX_FOR_MAX_RANGE) {
      throw new MixError(
        DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE,
        `\`for\` directive range exceeds maximum of ${MIX_FOR_MAX_RANGE} items.`
      );
    }
    out.push(currentValue);
    idx++;
  }
  return out;
}

export function __mixForTimes(count: number): readonly number[] {
  if (!Number.isFinite(count)) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE,
      "`for` directive times count must be a finite number."
    );
  }
  if (count <= 0) {
    return [];
  }
  const n = Math.floor(count);
  if (n > MIX_FOR_MAX_RANGE) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE,
      `\`for\` directive range (${n}) exceeds maximum of ${MIX_FOR_MAX_RANGE} items.`
    );
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = i;
  }
  return out;
}

export function __mixFor(
  parent: Node,
  spec: ForRangeSpec,
  renderRow: (indexGetter: () => number) => Node | readonly Node[],
  anchor?: Node | null
): Comment {
  const itemsFn =
    spec.kind === "range"
      ? () => __mixForRange(spec.from(), spec.to(), spec.step ? spec.step() : undefined)
      : () => __mixForTimes(spec.count());

  return createKeyedEach(
    parent,
    itemsFn,
    (value) => value,
    (valueGetter) => renderRow(valueGetter),
    anchor
  );
}

export function __mixFilterItems<T>(
  items: readonly T[],
  predicate: (item: T, index: number) => boolean
): readonly T[] {
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (predicate(item, i)) {
      out.push(item);
    }
  }
  return out;
}

export function __mixSortItems<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number
): readonly T[] {
  return [...items].sort(compare);
}

export function __mixLimitItems<T>(
  items: readonly T[],
  limit: number
): readonly T[] {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  return items.slice(0, Math.floor(limit));
}

export function __mixPaginateItems<T>(
  items: readonly T[],
  page: number,
  perPage: number
): readonly T[] {
  if (!Number.isFinite(perPage) || perPage <= 0) {
    return [];
  }
  const safePerPage = Math.floor(perPage);
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const start = (safePage - 1) * safePerPage;
  return items.slice(start, start + safePerPage);
}

export function __mixEachPipeline<T>(
  items: readonly T[],
  options: EachPipelineOptions<T>
): readonly T[] {
  let current: readonly T[] = items;

  if (options.filter) {
    current = __mixFilterItems(current, options.filter);
  }

  if (options.skip) {
    const skipFn = options.skip;
    const filtered: T[] = [];
    for (let i = 0; i < current.length; i++) {
      const item = current[i]!;
      if (!skipFn(item, i)) {
        filtered.push(item);
      }
    }
    current = filtered;
  }

  if (options.stop) {
    const stopFn = options.stop;
    const taken: T[] = [];
    for (let i = 0; i < current.length; i++) {
      const item = current[i]!;
      if (stopFn(item, i)) {
        break;
      }
      taken.push(item);
    }
    current = taken;
  }

  if (options.sort) {
    current = __mixSortItems(current, options.sort);
  }

  if (options.limit !== undefined) {
    current = __mixLimitItems(current, options.limit);
  }

  if (options.paginate !== undefined) {
    current = __mixPaginateItems(current, options.paginate.page, options.paginate.perPage);
  }

  return current;
}

export function __mixEmpty(
  parent: Node,
  isEmptyFn: () => boolean,
  renderEmpty: () => Node | readonly Node[],
  anchor?: Node | null
): Comment {
  return createConditional(
    parent,
    [{ condition: isEmptyFn, render: renderEmpty }],
    null,
    anchor
  );
}

export function __mixEachWithEmpty<T>(
  parent: Node,
  itemsFn: () => readonly T[],
  keyFn: ((item: T, index: number) => unknown) | null | undefined,
  renderRow: (itemGetter: () => T, indexGetter: () => number) => Node | readonly Node[],
  emptyRender?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null,
  options?: KeyedEachOptions
): Comment {
  if (!emptyRender) {
    return createKeyedEach(parent, itemsFn, keyFn, renderRow, anchor, options);
  }

  const itemsMemo = createMemo(() => itemsFn() ?? []);
  const eachMarker = createKeyedEach(parent, itemsMemo, keyFn, renderRow, anchor, options);
  __mixEmpty(parent, () => itemsMemo().length === 0, emptyRender, eachMarker);
  return eachMarker;
}
