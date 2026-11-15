/**
 * @dotmix/runtime/dom/directives/attrs-styles — F12 class, style, dynamic/boolean/conditional/match attributes & spread.
 */

import {
  createEffect,
  getCurrentOwner,
  onCleanup
} from "../../core/index.js";
import { setSafeStyleProperty } from "../../security/index.js";
import {
  addEventListener as attachDomEventListener,
  setAttribute,
  toggleClass
} from "../attributes.js";
import type { AttrMatchCase } from "./contract-types.js";

function splitClassTokens(raw: string, out: Set<string>): void {
  let tokenStart = -1;
  for (let i = 0; i <= raw.length; i++) {
    const code = i < raw.length ? raw.charCodeAt(i) : 32;
    const isSpace =
      code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
    if (isSpace) {
      if (tokenStart !== -1) {
        out.add(raw.slice(tokenStart, i));
        tokenStart = -1;
      }
    } else if (tokenStart === -1) {
      tokenStart = i;
    }
  }
}

export function __mixBindClassMap(
  el: Element,
  getter: () => Readonly<Record<string, unknown>> | readonly unknown[]
): void {
  let prevTokens = new Set<string>();

  createEffect(() => {
    const raw = getter();
    const nextTokens = new Set<string>();

    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (typeof item === "string" && item.length > 0) {
          splitClassTokens(item, nextTokens);
        } else if (item !== null && item !== undefined && item !== false && typeof item !== "boolean") {
          splitClassTokens(String(item), nextTokens);
        }
      }
    } else if (raw && typeof raw === "object") {
      for (const [key, active] of Object.entries(raw)) {
        if (active) {
          splitClassTokens(key, nextTokens);
        }
      }
    }

    for (const oldToken of prevTokens) {
      if (!nextTokens.has(oldToken)) {
        el.classList.remove(oldToken);
      }
    }
    for (const nextToken of nextTokens) {
      if (!prevTokens.has(nextToken)) {
        el.classList.add(nextToken);
      }
    }
    prevTokens = nextTokens;
  });
}

export function __mixToggleClass(
  el: Element,
  className: string,
  getter: () => unknown
): void {
  createEffect(() => {
    toggleClass(el, className, getter());
  });
}

export function __mixBindStyleMap(
  el: HTMLElement,
  getter: () => Readonly<Record<string, string | number | null | undefined>>
): void {
  let prevKeys = new Set<string>();

  createEffect(() => {
    const map = getter();
    const nextKeys = new Set<string>();

    if (map && typeof map === "object") {
      for (const [prop, styleValue] of Object.entries(map)) {
        nextKeys.add(prop);
        setSafeStyleProperty(
          el,
          prop,
          styleValue === null || styleValue === undefined ? null : String(styleValue)
        );
      }
    }

    for (const oldProp of prevKeys) {
      if (!nextKeys.has(oldProp)) {
        setSafeStyleProperty(el, oldProp, null);
      }
    }
    prevKeys = nextKeys;
  });
}

export function __mixSetStyleProp(
  el: HTMLElement,
  prop: string,
  getter: () => string | number | null | undefined,
  unit?: string
): void {
  createEffect(() => {
    const raw = getter();
    if (raw === null || raw === undefined) {
      setSafeStyleProperty(el, prop, null);
      return;
    }
    const formatted =
      typeof raw === "number" && unit !== undefined ? `${raw}${unit}` : String(raw);
    setSafeStyleProperty(el, prop, formatted);
  });
}

export function __mixBindDynamicAttr(
  el: Element,
  nameExpr: string | (() => string),
  valExpr: () => unknown
): void {
  if (typeof nameExpr === "string") {
    createEffect(() => {
      setAttribute(el, nameExpr, valExpr());
    });
    return;
  }

  let prevName: string | null = null;
  createEffect(() => {
    const nextName = nameExpr();
    if (prevName !== null && prevName !== nextName) {
      el.removeAttribute(prevName);
    }
    prevName = nextName;
    setAttribute(el, nextName, valExpr());
  });
}

export function __mixBindBooleanAttr(
  el: Element,
  name: string,
  getter: () => unknown
): void {
  createEffect(() => {
    setAttribute(el, name, Boolean(getter()));
  });
}

export function __mixBindConditionalAttr(
  el: Element,
  name: string,
  condition: () => unknown,
  value: () => unknown,
  elseValue?: (() => unknown) | null,
  invert?: boolean
): void {
  createEffect(() => {
    const raw = Boolean(condition());
    const active = invert ? !raw : raw;
    if (active) {
      setAttribute(el, name, value());
    } else if (elseValue) {
      setAttribute(el, name, elseValue());
    } else {
      setAttribute(el, name, null);
    }
  });
}

function matchesAttrToken(subject: unknown, token: string): boolean {
  if (typeof subject === "string") {
    return subject === token;
  }
  if (typeof subject === "number" || typeof subject === "boolean") {
    return String(subject) === token;
  }
  return false;
}

export function __mixBindMatchAttr(
  el: Element,
  name: string,
  subject: () => unknown,
  cases: readonly AttrMatchCase[],
  elseValue?: (() => unknown) | null
): void {
  createEffect(() => {
    const subjVal = subject();
    let matched: AttrMatchCase | null = null;
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]!;
      if (matchesAttrToken(subjVal, c.token)) {
        matched = c;
        break;
      }
    }

    if (matched) {
      setAttribute(el, name, matched.value());
    } else if (elseValue) {
      setAttribute(el, name, elseValue());
    } else {
      setAttribute(el, name, null);
    }
  });
}

export function __mixSpreadAttrs(
  el: Element,
  getter: () => Readonly<Record<string, unknown>>,
  condition?: (() => unknown) | null
): void {
  let prevAttrKeys = new Set<string>();
  const activeListeners = new Map<string, () => void>();

  const clearListeners = (): void => {
    for (const dispose of activeListeners.values()) {
      dispose();
    }
    activeListeners.clear();
  };

  if (getCurrentOwner()) {
    onCleanup(clearListeners);
  }

  createEffect(() => {
    clearListeners();

    if (condition && !condition()) {
      for (const oldKey of prevAttrKeys) {
        setAttribute(el, oldKey, null);
      }
      prevAttrKeys.clear();
      return;
    }

    const attrs = getter();
    const nextAttrKeys = new Set<string>();

    if (attrs && typeof attrs === "object") {
      for (const [key, propValue] of Object.entries(attrs)) {
        if (key === "children" || key === "key" || key === "ref") {
          continue;
        }
        if (key.startsWith("on") && key.length > 2 && typeof propValue === "function") {
          const eventName = key.slice(2).toLowerCase();
          const dispose = attachDomEventListener(el, eventName, propValue as EventListener);
          activeListeners.set(key, dispose);
          continue;
        }
        nextAttrKeys.add(key);
        setAttribute(el, key, propValue);
      }
    }

    for (const oldKey of prevAttrKeys) {
      if (!nextAttrKeys.has(oldKey)) {
        setAttribute(el, oldKey, null);
      }
    }
    prevAttrKeys = nextAttrKeys;
  });
}
