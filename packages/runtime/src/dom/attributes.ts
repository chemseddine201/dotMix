/**
 * @dotmix/runtime/dom/attributes — Attribute, class, style, two-way binding, event, and ref helpers.
 */

import { MixError, DiagnosticCodes } from "../errors.js";
import { createEffect, findErrorHandler, getCurrentOwner, onCleanup, reportError } from "../core/index.js";
import {
  setSafeSrcset,
  setSafeUrlAttribute,
  setSafeStyleProperty,
  setSafeStyleObject,
  setTrustedHtml
} from "../security/index.js";

export const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "poster"
]);

export const BOOLEAN_ATTRIBUTES = new Set([
  "disabled",
  "readonly",
  "required",
  "checked",
  "selected",
  "hidden",
  "multiple",
  "autofocus",
  "autoplay",
  "controls",
  "loop",
  "muted",
  "novalidate",
  "open",
  "reversed"
]);

export function bindValue(
  el: HTMLElement,
  getter: () => unknown,
  setter: (val: unknown) => void
): void {
  const isInput = el.tagName === "INPUT";
  const inputType = isInput ? (el as HTMLInputElement).type : "";
  const isNumeric = inputType === "number" || inputType === "range";

  createEffect(() => {
    const val = getter();
    const str = val === null || val === undefined ? "" : String(val);
    if ((el as HTMLInputElement).value !== str) {
      (el as HTMLInputElement).value = str;
    }
  });

  const onInput = () => {
    const raw = (el as HTMLInputElement).value;
    if (isNumeric) {
      const num = raw === "" ? 0 : Number(raw);
      setter(Number.isNaN(num) ? raw : num);
    } else {
      setter(raw);
    }
  };

  el.addEventListener("input", onInput);
  el.addEventListener("change", onInput);
}

export function bindChecked(
  el: HTMLElement,
  getter: () => boolean,
  setter: (val: boolean) => void
): void {
  createEffect(() => {
    const checked = Boolean(getter());
    if ((el as HTMLInputElement).checked !== checked) {
      (el as HTMLInputElement).checked = checked;
    }
  });

  const onChange = () => {
    setter((el as HTMLInputElement).checked);
  };

  el.addEventListener("change", onChange);
}

export function setClassName(el: Element, value: unknown): void {
  if (value === null || value === undefined || value === false || value === "") {
    el.removeAttribute("class");
  } else {
    const str = String(value);
    if (el.getAttribute("class") !== str) {
      el.setAttribute("class", str);
    }
  }
}

export function toggleClass(el: Element, className: string, active: unknown): void {
  if (active) {
    el.classList.add(className);
  } else {
    el.classList.remove(className);
  }
}

export function setAttribute(el: Element, name: string, value: unknown): void {
  if (name === "mix-html") {
    setTrustedHtml(el, value);
    return;
  }
  if (name === "class" || name === "className") {
    setClassName(el, value);
    return;
  }
  if (name === "srcset") {
    if (value === null || value === undefined || value === false) {
      el.removeAttribute("srcset");
    } else {
      setSafeSrcset(el, String(value));
    }
    return;
  }
  if (URL_ATTRIBUTES.has(name.toLowerCase())) {
    if (value === null || value === undefined || value === false) {
      el.removeAttribute(name);
    } else {
      setSafeUrlAttribute(el, name, String(value));
    }
    return;
  }
  if (name === "style") {
    const htmlEl = el as HTMLElement;
    if (value === null || value === undefined || value === false || value === "") {
      htmlEl.removeAttribute("style");
      return;
    }
    if (typeof value === "object") {
      setSafeStyleObject(
        htmlEl,
        value as Record<string, string | number | null | undefined>
      );
      return;
    }
    if (typeof value === "string") {
      // Parse declarations and validate each property/value pair via security boundary
      const parts = value.split(";");
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) {
          throw new MixError(
            DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
            `Malformed style declaration "${trimmed}".`
          );
        }
        const prop = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        setSafeStyleProperty(htmlEl, prop, val);
      }
      return;
    }
  }
  if (name.startsWith("style:")) {
    const prop = name.slice("style:".length);
    setSafeStyleProperty(
      el as HTMLElement,
      prop,
      value === null || value === undefined || value === false ? null : String(value)
    );
    return;
  }
  if (name.startsWith("class:")) {
    const cls = name.slice("class:".length);
    toggleClass(el, cls, value);
    return;
  }
  if (name === "value" && "value" in el) {
    const nextVal = value === null || value === undefined ? "" : String(value);
    if ((el as HTMLInputElement).value !== nextVal) {
      (el as HTMLInputElement).value = nextVal;
    }
    if (value === null || value === undefined) {
      el.removeAttribute("value");
    } else {
      el.setAttribute("value", nextVal);
    }
    return;
  }
  const normalizedBoolName = name.toLowerCase();
  if (BOOLEAN_ATTRIBUTES.has(normalizedBoolName)) {
    // HTML boolean attributes: presence means true, so a valueless attribute (compiled to "") is enabled.
    const isEnabled = value === "" || Boolean(value);
    const propName =
      normalizedBoolName === "readonly"
        ? "readOnly"
        : normalizedBoolName === "novalidate"
          ? "noValidate"
          : name;
    if (propName in el) {
      try {
        (el as unknown as Record<string, unknown>)[propName] = isEnabled;
      } catch {
        // Ignore read-only DOM properties
      }
    }
    if (isEnabled) {
      el.setAttribute(name, "");
    } else {
      el.removeAttribute(name);
    }
    return;
  }
  if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
  } else if (value === true) {
    el.setAttribute(name, "");
  } else {
    const str = String(value);
    if (el.getAttribute(name) !== str) {
      el.setAttribute(name, str);
    }
  }
}

export function addEventListener(
  el: EventTarget,
  eventName: string,
  handler: EventListener
): () => void {
  const owner = getCurrentOwner();
  const wrapped: EventListener = function (this: unknown, ev: Event) {
    try {
      const res = (handler as (this: unknown, e: Event) => unknown).call(this, ev);
      if (res && typeof (res as Promise<unknown>).catch === "function") {
        (res as Promise<unknown>).catch((err: unknown) => {
          const eh = findErrorHandler(owner);
          if (eh) {
            eh(err);
            return;
          }
          reportError(err, { source: "event" }, owner);
        });
      }
    } catch (err) {
      const eh = findErrorHandler(owner);
      if (eh) {
        eh(err);
        return;
      }
      reportError(err, { source: "event" }, owner);
      throw err;
    }
  };
  el.addEventListener(eventName, wrapped);
  const cleanup = (): void => {
    el.removeEventListener(eventName, wrapped);
  };
  if (owner) {
    onCleanup(cleanup);
  }
  return cleanup;
}

export function bindRef<T extends Element>(
  el: T,
  target: ((node: T | null) => void) | { current: T | null } | null | undefined
): void {
  if (!target) return;
  if (typeof target === "function") {
    target(el);
    if (getCurrentOwner()) {
      onCleanup(() => target(null));
    }
  } else if (typeof target === "object" && "current" in target) {
    target.current = el;
    if (getCurrentOwner()) {
      onCleanup(() => {
        if (target.current === el) {
          target.current = null;
        }
      });
    }
  }
}
