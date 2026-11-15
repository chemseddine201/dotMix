/**
 * @dotmix/runtime/dom/directives/control-flow — F1 & F2 conditional and switch helpers.
 */

import { createEffect } from "../../core/index.js";
import type { SwitchCase } from "./contract-types.js";
import { createAnchorRegion } from "./shared.js";

export function __mixIsSet<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

export function __mixIsEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.length === 0;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size === 0;
  }
  if (typeof value === "object") {
    const tag = Object.prototype.toString.call(value);
    if (tag === "[object Map]" || tag === "[object Set]") {
      const sized = value as { readonly size?: unknown };
      if (typeof sized.size === "number") {
        return sized.size === 0;
      }
    }
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto === null || proto === Object.prototype) {
      return Object.keys(value).length === 0;
    }
  }
  return false;
}

export function __mixShow(
  target: HTMLElement,
  when: () => unknown,
  display?: string
): void {
  const initialInline = target.style.display;
  const visibleDisplay =
    display !== undefined ? display : initialInline === "none" ? "" : initialInline;

  createEffect(() => {
    const show = Boolean(when());
    const nextDisplay = show ? visibleDisplay : "none";
    if (target.style.display !== nextDisplay) {
      target.style.display = nextDisplay;
    }
  });
}

export const bindShow = __mixShow;

export function __mixSwitch(
  parent: Node,
  subject: (() => unknown) | null,
  cases: readonly SwitchCase[],
  defaultRender?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const region = createAnchorRegion(parent, "mix:switch", anchor);
  let activeCaseIndex = -2;

  createEffect(() => {
    const hasSubject = subject !== null;
    const subjVal = hasSubject ? subject() : undefined;
    let matchedIndex = -1;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]!;
      if (c.kind === "values") {
        if (!hasSubject) {
          continue;
        }
        const candidates = c.values();
        let matched = false;
        for (let j = 0; j < candidates.length; j++) {
          if (Object.is(subjVal, candidates[j])) {
            matched = true;
            break;
          }
        }
        if (matched) {
          matchedIndex = i;
          break;
        }
      } else if (c.condition()) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === activeCaseIndex) {
      return;
    }

    activeCaseIndex = matchedIndex;
    const renderFn =
      matchedIndex >= 0 ? cases[matchedIndex]!.render : (defaultRender ?? null);
    region.mount(renderFn);
  });

  return region.marker;
}

export const renderSwitch = __mixSwitch;
