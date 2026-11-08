/**
 * @mix/runtime/security — Sanitizer boundary, WeakSet registry, WHATWG srcset parser,
 * safe URL validator, and dynamic CSS escape/property validator (D-107, D-108, D-109 / HAA-03).
 */

import { MixError, DiagnosticCodes } from "../errors.js";

// ============================================================================
// 1. Trusted HTML Boundary & SanitizerProvider (D-109 / HAA-03, R-HTML-01..06)
// ============================================================================

export interface SanitizerContext {
  element?: string;
  attribute?: string;
}

export interface SanitizerProvider {
  sanitizeHtml(raw: string, context?: SanitizerContext): string;
}

export interface TrustedHtmlValue {
  readonly __mixTrustedHtml: true;
  readonly html: string;
  readonly nativeTrusted?: unknown;
  toString(): string;
}

interface TrustedTypesPolicy {
  createHTML(input: string): unknown;
}

interface TrustedTypesFactory {
  createPolicy(
    name: string,
    rules: { createHTML: (input: string) => string }
  ): TrustedTypesPolicy;
}

let activeSanitizerProvider: SanitizerProvider | null = null;
let cachedTrustedTypesPolicy: TrustedTypesPolicy | null = null;
const trustedHtmlRegistry = new WeakSet<object>();

const FORBIDDEN_HTML_CONTEXT_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "style",
  "svg",
  "math",
  "template",
  "textarea",
  "title"
]);

export function setSanitizerProvider(provider: SanitizerProvider | null): void {
  if (provider !== null && (typeof provider !== "object" || typeof provider.sanitizeHtml !== "function")) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML,
      "Invalid SanitizerProvider: expected an object implementing sanitizeHtml(raw, context)."
    );
  }
  activeSanitizerProvider = provider;
}

export function getSanitizerProvider(): SanitizerProvider | null {
  return activeSanitizerProvider;
}

function getOrCreateTrustedTypesPolicy(): TrustedTypesPolicy | null {
  if (cachedTrustedTypesPolicy !== null) {
    return cachedTrustedTypesPolicy;
  }
  const tt = (globalThis as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
  if (tt && typeof tt.createPolicy === "function") {
    try {
      cachedTrustedTypesPolicy = tt.createPolicy("mix-html#trusted", {
        createHTML: (s: string): string => s
      });
      return cachedTrustedTypesPolicy;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Creates an authentic TrustedHtmlValue using the root application SanitizerProvider.
 * Caller-supplied sanitizer callbacks are strictly prohibited (D-109 / HAA-03).
 */
export function createTrustedHtml(
  dirtyHtml: string,
  context?: SanitizerContext,
  ...extraArgs: unknown[]
): TrustedHtmlValue {
  if (typeof (context as unknown) === "function" || typeof extraArgs[0] === "function") {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML,
      "Caller-supplied sanitizer callbacks are forbidden (D-109 / HAA-03). Configure root SanitizerProvider via setSanitizerProvider()."
    );
  }
  if (typeof dirtyHtml !== "string") {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML,
      "createTrustedHtml requires a string input."
    );
  }
  if (!activeSanitizerProvider) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML,
      "Refusing to create TrustedHTML without an active application SanitizerProvider."
    );
  }
  const sanitized = activeSanitizerProvider.sanitizeHtml(dirtyHtml, context);
  if (typeof sanitized !== "string") {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML,
      "SanitizerProvider.sanitizeHtml() must return a sanitized string."
    );
  }

  const policy = getOrCreateTrustedTypesPolicy();
  const nativeTrusted = policy ? policy.createHTML(sanitized) : undefined;

  const wrapper: TrustedHtmlValue = Object.freeze({
    __mixTrustedHtml: true as const,
    html: sanitized,
    nativeTrusted,
    toString(): string {
      return sanitized;
    }
  });
  trustedHtmlRegistry.add(wrapper);
  return wrapper;
}

/**
 * Verifies whether `val` is an authentic TrustedHtmlValue registered in the
 * module-private WeakSet. Never inspects constructor.name or prototype chains.
 */
export function isTrustedHtml(val: unknown): val is TrustedHtmlValue {
  return typeof val === "object" && val !== null && trustedHtmlRegistry.has(val);
}

/**
 * Safely applies a verified TrustedHtmlValue to a DOM element (R-HTML-01..06).
 */
export function setTrustedHtml(el: Element, val: unknown): void {
  const tagName = el.tagName.toLowerCase();
  if (FORBIDDEN_HTML_CONTEXT_TAGS.has(tagName)) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_HTML_CONTEXT,
      `Trusted HTML injection into <${tagName}> is unconditionally forbidden (D-109 / R-HTML-04).`
    );
  }
  if (!isTrustedHtml(val)) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML,
      "mix-html sink rejected unverified or forged HTML value. Values must be created via createTrustedHtml()."
    );
  }
  el.innerHTML = val.html;
}

// ============================================================================
// 2. Safe URL Protocol Validation (R-URL-01)
// ============================================================================

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "blob:"]);
const SAFE_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp|x-icon)(?:;[a-zA-Z0-9=._+-]+)*,/i;

function stripControlAndSpace(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 0x20 && code !== 0x7f) {
      out += str[i]!;
    }
  }
  return out;
}

export function isSafeUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string") {
    return false;
  }
  const normalized = stripControlAndSpace(rawUrl);
  if (normalized.length === 0) {
    return true;
  }

  // Relative URLs starting with /, ./, ../, ?, # are safe (except protocol-relative // with javascript? // is network-path reference)
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("?") ||
    normalized.startsWith("#")
  ) {
    return true;
  }

  // Check if there is a scheme before the first '/', '?', '#'
  const colonIdx = normalized.indexOf(":");
  if (colonIdx === -1) {
    return true;
  }
  const slashIdx = normalized.indexOf("/");
  const queryIdx = normalized.indexOf("?");
  const hashIdx = normalized.indexOf("#");
  if (
    (slashIdx !== -1 && slashIdx < colonIdx) ||
    (queryIdx !== -1 && queryIdx < colonIdx) ||
    (hashIdx !== -1 && hashIdx < colonIdx)
  ) {
    return true;
  }

  const scheme = normalized.slice(0, colonIdx + 1).toLowerCase();
  if (SAFE_SCHEMES.has(scheme)) {
    return true;
  }
  if (scheme === "data:") {
    return SAFE_DATA_IMAGE_RE.test(normalized);
  }
  return false;
}

export function validateSafeUrl(rawUrl: string): string {
  if (!isSafeUrl(rawUrl)) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_UNSAFE_URL,
      `Unsafe URL rejected by security policy: "${rawUrl}"`
    );
  }
  return rawUrl;
}

export function setSafeUrlAttribute(el: Element, attr: string, rawUrl: string): void {
  validateSafeUrl(rawUrl);
  el.setAttribute(attr, rawUrl);
}

// ============================================================================
// 3. Normative WHATWG `srcset` Parser (D-107, HTML Standard §4.8.4.3.7)
// ============================================================================

export interface SrcsetCandidate {
  readonly url: string;
  readonly descriptor?: string;
}

function isAsciiWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

const WIDTH_DESCRIPTOR_RE = /^[1-9][0-9]*w$/;
const DENSITY_DESCRIPTOR_RE = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?x$/;

function isValidSrcsetDescriptor(desc: string): boolean {
  if (desc.length === 0) return true;
  if (WIDTH_DESCRIPTOR_RE.test(desc)) {
    return Number.parseInt(desc.slice(0, -1), 10) > 0;
  }
  if (DENSITY_DESCRIPTOR_RE.test(desc)) {
    const val = Number.parseFloat(desc.slice(0, -1));
    return Number.isFinite(val) && val > 0;
  }
  return false;
}

/**
 * Conforming WHATWG HTML Standard §4.8.4.3.7 `srcset` parser and URL validator.
 * Handles `data:` URLs with commas, query strings with commas, irregular whitespace,
 * and discards candidates with malformed descriptors while recovering for subsequent candidates.
 */
export function parseSrcsetCandidates(input: string): SrcsetCandidate[] {
  if (typeof input !== "string") {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_UNSAFE_URL,
      "srcset attribute value must be a string."
    );
  }

  const candidates: SrcsetCandidate[] = [];
  const len = input.length;
  let pos = 0;

  while (pos < len) {
    // 1. Skip leading ASCII whitespace and comma separators
    while (pos < len && (isAsciiWhitespace(input[pos]!) || input[pos] === ",")) {
      pos++;
    }
    if (pos >= len) break;

    // 2. Collect URL (non-whitespace sequence)
    const urlStart = pos;
    while (pos < len && !isAsciiWhitespace(input[pos]!)) {
      pos++;
    }
    let url = input.slice(urlStart, pos);

    // Per WHATWG §4.8.4.3.7: if URL ends with one or more commas, strip trailing commas;
    // the candidate has no descriptors and terminates immediately.
    let terminatedByTrailingComma = false;
    while (url.endsWith(",")) {
      url = url.slice(0, -1);
      terminatedByTrailingComma = true;
    }

    let descriptorStr = "";
    let descriptorValid = true;

    if (!terminatedByTrailingComma) {
      // 3. Collect descriptor tokens until unparenthesized comma or EOF
      while (pos < len && isAsciiWhitespace(input[pos]!)) {
        pos++;
      }

      const descriptors: string[] = [];
      let currentDesc = "";
      let inParens = false;

      while (pos < len) {
        const ch = input[pos]!;
        if (inParens) {
          currentDesc += ch;
          if (ch === ")") {
            inParens = false;
          }
          pos++;
        } else if (ch === "(") {
          currentDesc += ch;
          inParens = true;
          pos++;
        } else if (ch === ",") {
          pos++; // consume candidate-terminating comma
          break;
        } else if (isAsciiWhitespace(ch)) {
          if (currentDesc.length > 0) {
            descriptors.push(currentDesc);
            currentDesc = "";
          }
          while (pos < len && isAsciiWhitespace(input[pos]!)) {
            pos++;
          }
        } else {
          currentDesc += ch;
          pos++;
        }
      }
      if (currentDesc.length > 0) {
        descriptors.push(currentDesc);
      }

      // Per WHATWG §4.8.4.3.7: at most one valid width or density descriptor is allowed
      if (descriptors.length > 1) {
        descriptorValid = false;
      } else if (descriptors.length === 1) {
        const single = descriptors[0]!;
        if (!isValidSrcsetDescriptor(single)) {
          descriptorValid = false;
        } else {
          descriptorStr = single;
        }
      }
    }

    if (url.length === 0) {
      continue;
    }

    // Validate URL security protocol even before emitting candidate
    validateSafeUrl(url);

    // If descriptor was malformed, discard this candidate and recover for remaining candidates
    if (!descriptorValid) {
      continue;
    }

    candidates.push(descriptorStr ? { url, descriptor: descriptorStr } : { url });
  }

  return candidates;
}

export function formatSrcsetCandidates(candidates: readonly SrcsetCandidate[]): string {
  return candidates
    .map((c) => (c.descriptor ? `${c.url} ${c.descriptor}` : c.url))
    .join(", ");
}

export function setSafeSrcset(el: Element, rawSrcset: string): void {
  const candidates = parseSrcsetCandidates(rawSrcset);
  el.setAttribute("srcset", formatSrcsetCandidates(candidates));
}

// ============================================================================
// 4. Runtime Dynamic CSS Property & Escape Validation (D-108, R-CSS-01..05)
// ============================================================================

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

export function setSafeStyleObject(
  el: HTMLElement,
  styles: Record<string, string | number | null | undefined>
): void {
  for (const [prop, val] of Object.entries(styles)) {
    setSafeStyleProperty(el, prop, val);
  }
}
