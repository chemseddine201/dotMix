/**
 * packages/runtime/src/security/style.ts
 *
 * Mix v3.2.2 Dynamic CSS Style Validation & Tokenizer Subsystem (§6.3).
 * Implements strict identifier grammar (R-CSS-02), fast-path evaluation (R-CSS-04),
 * and full tokenization via @csstools/css-tokenizer (R-CSS-03).
 */

import { tokenize, TokenType } from "@csstools/css-tokenizer";

/**
 * Decodes CSS escape sequences (both hex code points and escaped characters).
 */
export function decodeCssEscapes(value: string): string {
  if (typeof value !== "string") return "";
  return value.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|([^\r\n\f0-9a-fA-F]))/g, (_, hex, char) => {
    if (hex !== undefined) {
      const codePoint = parseInt(hex, 16);
      if (codePoint === 0 || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
        return "\uFFFD";
      }
      return String.fromCodePoint(codePoint);
    }
    return char ?? "";
  });
}

/**
 * Validates dynamic CSS property names against the strict identifier grammar (R-CSS-02).
 * Converts camelCase to kebab-case, then asserts ^--[A-Za-z0-9_-]+$ or ^-?[a-z][a-z0-9-]*$.
 */
export function isAllowedStyleProperty(name: string): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;

  // Convert camelCase to kebab-case
  const kebab = trimmed.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

  // Custom properties: ^--[A-Za-z0-9_-]+$
  if (/^--[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return true;
  }

  // Standard properties: ^-?[a-z][a-z0-9-]*$
  return /^-?[a-z][a-z0-9-]*$/.test(kebab);
}

/**
 * Validates dynamic CSS property values (R-CSS-03, R-CSS-04).
 * Fast-path: values without ( ; { } " ' \ or /* are accepted without tokenization.
 * In-depth: tokenized using @csstools/css-tokenizer to block delimiter injection,
 * url(), image-set(), expression(), and @import.
 */
export function isAllowedStyleValue(value: string): boolean {
  if (typeof value !== "string") return false;

  // R-CSS-04 Fast Path:
  // If the value contains none of ( ; { } " ' \ nor /*, it is safe immediately.
  if (!/[();{}"'\\]|\/\*/.test(value)) {
    return true;
  }

  // Decode escape sequences to check for escaped delimiter injection
  const decoded = decodeCssEscapes(value);

  // Check for literal or decoded braces
  if (/[{}]/.test(decoded)) {
    return false;
  }

  // Check for literal or decoded semicolons
  if (/;/.test(decoded)) {
    return false;
  }

  // Check for legacy script execution or binding injection
  if (/expression\s*\(/i.test(decoded) || /-moz-binding\s*:/i.test(decoded)) {
    return false;
  }

  // Tokenize using @csstools/css-tokenizer (R-CSS-03)
  let tokens: ReturnType<typeof tokenize>;
  try {
    tokens = tokenize({ css: value });
  } catch {
    return false;
  }

  for (const token of tokens) {
    const type = token[0];

    // Delimiter / injection tokens
    if (type === TokenType.Semicolon || type === TokenType.OpenCurly || type === TokenType.CloseCurly) {
      return false;
    }

    // At-rule keywords (@import, etc.)
    if (type === TokenType.AtKeyword) {
      return false;
    }

    // Malformed tokens
    if (type === TokenType.BadString || type === TokenType.BadURL) {
      return false;
    }

    // url(...) token — Dynamic style maps block url() (AGENTS.md Part V)
    if (type === TokenType.URL) {
      return false;
    }

    // Function tokens
    if (type === TokenType.Function) {
      const fnName = String(token[1]).replace(/\($/, "").toLowerCase().trim();
      if (
        fnName === "url" ||
        fnName === "image-set" ||
        fnName === "expression" ||
        fnName === "-moz-binding"
      ) {
        return false;
      }
    }
  }

  return true;
}
