/**
 * @mix/runtime/dom — Surgical DOM adapter and keyed list reconciliation.
 *
 * Scope Enclosure Notice (Gate 1): Minimal compilable skeleton only.
 * Full surgical DOM operations and LIS reconciliation are deferred to Gate 5 and Gate 7.
 */

import { MixError, DiagnosticCodes } from "../errors.js";

export function createElement(tag: string): HTMLElement {
  return document.createElement(tag);
}

export function createTextNode(text: string): Text {
  return document.createTextNode(text);
}

export function renderKeyedList<T>(
  _parent: HTMLElement,
  _items: readonly T[],
  _keyFn: (item: T) => string | number,
  _renderFn: (item: T) => HTMLElement
): void {
  throw new MixError(
    DiagnosticCodes.MIX_ERR_DUPLICATE_KEY,
    "@mix/runtime/dom renderKeyedList is not yet implemented (Gate 7 deliverable)."
  );
}
