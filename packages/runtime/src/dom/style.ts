// packages/runtime/src/dom/style.ts — FROZEN per MIX_SPEC_v3.2.2 §6.3
import { MixError } from "../core/errors.js";
import { isAllowedStyleProperty, isAllowedStyleValue } from "../security/style.js";

/**
 * R-CSS-01: In browser, style properties MUST be set individually via el.style.setProperty(name, value).
 * Assembling cssText or writing the style attribute as a raw string is strictly forbidden.
 */
export function setSafeStyleProperty(
  el: { style: { setProperty: (name: string, value: string) => void; removeProperty?: (name: string) => void } },
  name: string,
  value: string
): void {
  // 1. Validate property name (R-CSS-02)
  if (!isAllowedStyleProperty(name)) {
    throw new MixError(
      "MIX_SEC_INVALID_STYLE_PROPERTY",
      `Invalid or unsafe CSS property name: "${name}"`
    );
  }

  // 2. Validate property value (R-CSS-03, R-CSS-04)
  if (!isAllowedStyleValue(value)) {
    throw new MixError(
      "MIX_SEC_INSECURE_DYNAMIC_STYLE",
      `Insecure dynamic style value detected for property "${name}": "${value}"`
    );
  }

  // 3. Set property individually
  el.style.setProperty(name, value);
}

/**
 * Applies a dictionary of dynamic styles to an element safely.
 */
export function applyDynamicStyles(
  el: { style: { setProperty: (name: string, value: string) => void } },
  styles: Record<string, string>
): void {
  for (const [prop, val] of Object.entries(styles)) {
    if (val !== undefined && val !== null) {
      setSafeStyleProperty(el, prop, String(val));
    }
  }
}
