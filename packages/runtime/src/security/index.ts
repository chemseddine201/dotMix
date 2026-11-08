/**
 * @mix/runtime/security — Sanitizer boundary, WeakSet registry, and safe attribute sinks.
 *
 * Scope Enclosure Notice (Gate 1): Minimal compilable skeleton only.
 * Full WHATWG srcset parser and CSS escape decoders are deferred to Phase Gate 6.
 */

import { MixError, DiagnosticCodes } from "../errors.js";

export interface SanitizerContext {
  element?: string;
  attribute?: string;
}

export interface SanitizerProvider {
  sanitizeHtml(raw: string, context?: SanitizerContext): string;
}

let activeSanitizerProvider: SanitizerProvider | null = null;
const trustedHtmlRegistry = new WeakSet<object>();

export function setSanitizerProvider(provider: SanitizerProvider | null): void {
  activeSanitizerProvider = provider;
}

export function getSanitizerProvider(): SanitizerProvider | null {
  return activeSanitizerProvider;
}

export function createTrustedHtml(dirtyHtml: string): object {
  if (!activeSanitizerProvider) {
    throw new MixError(
      DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML,
      "Refusing to create TrustedHTML without an active application SanitizerProvider."
    );
  }
  const sanitized = activeSanitizerProvider.sanitizeHtml(dirtyHtml);
  const wrapper = Object.freeze({ html: sanitized });
  trustedHtmlRegistry.add(wrapper);
  return wrapper;
}

export function isTrustedHtml(val: unknown): boolean {
  return typeof val === "object" && val !== null && trustedHtmlRegistry.has(val);
}

export function setSafeSrcset(_el: Element, _rawSrcset: string): void {
  // Gate 1 skeleton stub: full WHATWG parser in Gate 6
}

export function setSafeStyleProperty(_el: HTMLElement, _prop: string, _val: string): void {
  // Gate 1 skeleton stub: full escape decoder in Gate 6
}
