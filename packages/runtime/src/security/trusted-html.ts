/**
 * packages/runtime/src/security/trusted-html.ts
 *
 * Mix v3.2.2 Trusted HTML Boundary & WeakSet Registry (§6.4).
 * Enforces explicit sanitization (R-HTML-01..03) and detects foreign forged objects (R-HTML-06).
 */

import { MixError } from "../core/errors.js";
import { activeConfig } from "../core/config.js";

// --- 1. Frozen Contracts (§6.4) ---

export type HtmlSanitizerFn = (dirtyHtml: string) => string;

export interface TrustedHtmlValue {
  readonly html: string;
}

// Private module-scoped registry (R-HTML-01)
const trustedHtmlRegistry = new WeakSet<object>();

function getIsDev(): boolean {
  return typeof (globalThis as unknown as { __DEV__?: boolean }).__DEV__ !== "undefined"
    ? Boolean((globalThis as unknown as { __DEV__?: boolean }).__DEV__)
    : true;
}

/**
 * Creates a validated TrustedHtmlValue by running dirtyHtml through sanitizer (R-HTML-01).
 * In DEV mode: verifies sanitizer against canary payload (R-HTML-03).
 */
export function createTrustedHtml(dirtyHtml: string, sanitizer: HtmlSanitizerFn): TrustedHtmlValue {
  // R-HTML-02: Sanitizer must be a function
  if (typeof sanitizer !== "function") {
    throw new MixError(
      "MIX_SEC_MISSING_SANITIZER",
      "createTrustedHtml requires an active, callable sanitizer function."
    );
  }

  // R-HTML-03: In __DEV__, check sanitizer with canary payload
  if (getIsDev()) {
    const canaryPayload = '<img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:alert(1)">';
    try {
      const canaryResult = sanitizer(canaryPayload);
      if (typeof canaryResult === "string" && /onerror|<script|javascript:/i.test(canaryResult)) {
        activeConfig.onWarning({
          code: "MIX_SEC_SANITIZER_SUSPICIOUS",
          message: "Sanitizer produced suspicious output in canary verification test."
        });
      }
    } catch {
      // If canary throws, sanitizer may reject unsafe patterns, which is safe
    }
  }

  const clean = sanitizer(dirtyHtml);
  const record: TrustedHtmlValue = Object.freeze({ html: clean });
  trustedHtmlRegistry.add(record);

  return record;
}

/**
 * Checks whether a given value is a registered TrustedHtmlValue (R-HTML-01).
 * In __DEV__: if value is a frozen object with string html but outside registry,
 * throws MIX_SEC_FOREIGN_TRUSTED_HTML (R-HTML-06).
 */
export function isTrustedHtml(value: unknown): value is TrustedHtmlValue {
  if (value !== null && typeof value === "object") {
    if (trustedHtmlRegistry.has(value)) {
      return true;
    }

    // R-HTML-06: Detect forged frozen objects in __DEV__
    if (getIsDev() && Object.isFrozen(value) && typeof (value as { html?: unknown }).html === "string") {
      throw new MixError(
        "MIX_SEC_FOREIGN_TRUSTED_HTML",
        "Foreign or forged TrustedHtml object detected outside the trusted registry."
      );
    }
  }

  return false;
}
