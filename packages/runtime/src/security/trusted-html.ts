/**
 * @mix/runtime/security/trusted-html — Trusted HTML Boundary & SanitizerProvider
 * (D-109 / HAA-03, R-HTML-01..06).
 */

import { MixError, DiagnosticCodes } from "../errors.js";

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

export type TrustedHtml = TrustedHtmlValue;

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
  if (
    provider !== null &&
    (typeof provider !== "object" || typeof provider.sanitizeHtml !== "function")
  ) {
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
  if (
    typeof (context as unknown) === "function" ||
    typeof extraArgs[0] === "function"
  ) {
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

export const setTrustedInnerHtml = setTrustedHtml;
