/**
 * @mix/runtime/security/css-policy — Runtime Dynamic CSS Property & Escape Validation
 * (D-108, R-CSS-01..05).
 */

import { MixError, DiagnosticCodes } from "../errors.js";
import { isAsciiWhitespace, isSafeUrl } from "./url-policy.js";

const CUSTOM_PROP_RE = /^--[A-Za-z0-9_-]+$/;
const STANDARD_PROP_RE = /^-?[a-z][a-z0-9-]*$/;
const FORBIDDEN_STYLE_PROPS = new Set(["behavior", "-moz-binding"]);

/**
 * Decodes CSS escape sequences per CSS Syntax Module Level 3 §4.3.7.
 * E.g. `\3b ` -> `;`, `\7d` -> `}`, `\00003b` -> `;`.
 */
export function decodeCssEscapes(cssValue: string): string {
  let out = "";
  let i = 0;
  const len = cssValue.length;

  while (i < len) {
    const ch = cssValue[i]!;
    if (ch !== "\\") {
      out += ch;
      i++;
      continue;
    }

    i++; // consume '\'
    if (i >= len) {
      // Trailing backslash in CSS value
      out += "\uFFFD";
      break;
    }

    const next = cssValue[i]!;
    // Hex escape: 1 to 6 hex digits
    if (/[0-9a-fA-F]/.test(next)) {
      let hex = "";
      let count = 0;
      while (i < len && count < 6 && /[0-9a-fA-F]/.test(cssValue[i]!)) {
        hex += cssValue[i]!;
        i++;
        count++;
      }
      // Optional single whitespace following hex escape is consumed
      if (i < len) {
        if (cssValue[i] === "\r" && cssValue[i + 1] === "\n") {
          i += 2;
        } else if (isAsciiWhitespace(cssValue[i]!)) {
          i++;
        }
      }
      const codePoint = Number.parseInt(hex, 16);
      if (
        codePoint === 0 ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        codePoint > 0x10ffff
      ) {
        out += "\uFFFD";
      } else {
        out += String.fromCodePoint(codePoint);
      }
    } else if (next === "\n" || next === "\r" || next === "\f") {
      // Backslash followed by newline is not a valid escape
      out += "\\" + next;
      i++;
    } else {
      out += next;
      i++;
    }
  }

  return out;
}

export function normalizeStylePropertyName(prop: string): string {
  if (typeof prop !== "string" || prop.length === 0) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
      "CSS property name must be a non-empty string."
    );
  }
  if (prop.startsWith("--")) {
    if (!CUSTOM_PROP_RE.test(prop)) {
      throw new MixError(
        DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
        `Invalid CSS custom property name "${prop}".`
      );
    }
    return prop;
  }

  // Convert camelCase to kebab-case if needed (only ASCII letters allowed)
  let kebab = "";
  for (let i = 0; i < prop.length; i++) {
    const ch = prop[i]!;
    if (ch >= "A" && ch <= "Z") {
      kebab += "-" + ch.toLowerCase();
    } else {
      kebab += ch;
    }
  }

  if (!STANDARD_PROP_RE.test(kebab) || FORBIDDEN_STYLE_PROPS.has(kebab)) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
      `Forbidden or malformed CSS property name "${prop}".`
    );
  }
  return kebab;
}

export function validateStylePropertyValue(prop: string, rawValue: string): string {
  if (typeof rawValue !== "string") {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
      `CSS property value for "${prop}" must be a string.`
    );
  }

  // Reject trailing unescaped backslash that could escape delimiter
  if (rawValue.endsWith("\\")) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
      `CSS property "${prop}" contains an illegal trailing backslash escape.`
    );
  }

  const decoded = decodeCssEscapes(rawValue);

  // Check both raw and escape-decoded strings for statement-breaking or injection tokens
  for (const candidate of [rawValue, decoded]) {
    if (
      candidate.includes(";") ||
      candidate.includes("{") ||
      candidate.includes("}") ||
      candidate.includes("/*") ||
      candidate.includes("*/")
    ) {
      throw new MixError(
        DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
        `CSS value injection detected in "${prop}": property delimiters (;, {, }, /*) are forbidden.`
      );
    }

    if (
      /expression\s*\(/i.test(candidate) ||
      /-moz-binding/i.test(candidate) ||
      /behavior\s*:/i.test(candidate) ||
      /@import/i.test(candidate)
    ) {
      throw new MixError(
        DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
        `Dangerous CSS construct rejected in "${prop}".`
      );
    }

    // Inspect any url(...) occurrences in the decoded CSS value
    const urlRegex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(candidate)) !== null) {
      const innerUrl = match[2] ?? "";
      if (!isSafeUrl(innerUrl)) {
        throw new MixError(
          DiagnosticCodes.MIX_SEC_UNSAFE_URL,
          `Unsafe URL "${innerUrl}" inside dynamic CSS property "${prop}".`
        );
      }
    }
  }

  return decoded;
}

export const validateDynamicCssValue = validateStylePropertyValue;

export function setSafeStyleProperty(
  el: HTMLElement,
  prop: string,
  val: string | number | null | undefined
): void {
  const normalizedProp = normalizeStylePropertyName(prop);
  if (val === null || val === undefined || val === "") {
    el.style.removeProperty(normalizedProp);
    return;
  }
  const strVal = typeof val === "number" ? String(val) : val;
  const validated = validateStylePropertyValue(normalizedProp, strVal);
  el.style.setProperty(normalizedProp, validated);
}

export const setDynamicStyleProperty = setSafeStyleProperty;

export function setSafeStyleObject(
  el: HTMLElement,
  styles: Record<string, string | number | null | undefined>
): void {
  for (const [prop, val] of Object.entries(styles)) {
    setSafeStyleProperty(el, prop, val);
  }
}
