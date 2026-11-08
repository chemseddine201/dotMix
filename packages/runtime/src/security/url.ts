/**
 * packages/runtime/src/security/url.ts
 *
 * Mix v3.2.2 WHATWG-Compliant URL Allowlist & Validation (§6.1).
 * Strictly validates schemes and prevents protocol smuggling (javascript:, vbscript:, data:image/svg+xml).
 */

import { MixError } from "../core/errors.js";
import { activeConfig } from "../core/config.js";

// --- 1. Frozen Type Contract (§6.1) ---

export type UrlContext = "navigation" | "media" | "resource";

const SAFE_NAVIGATION_SCHEMES = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
  "sms:"
]);

const SAFE_MEDIA_SCHEMES = new Set([
  "http:",
  "https:",
  "blob:",
  "data:"
]);

const SAFE_RESOURCE_SCHEMES = new Set([
  "http:",
  "https:",
  "blob:"
]);

const SAFE_DATA_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/x-icon"
];

// Helper to determine if running in DEV mode
function getIsDev(): boolean {
  return typeof (globalThis as unknown as { __DEV__?: boolean }).__DEV__ !== "undefined"
    ? Boolean((globalThis as unknown as { __DEV__?: boolean }).__DEV__)
    : true;
}

/**
 * Validates a candidate URL string against the locked context allowlist (R-URL-01).
 * Complies strictly with WHATWG URL parsing semantics.
 */
export function isAllowedUrl(raw: string, context: UrlContext): boolean {
  if (typeof raw !== "string") {
    return false;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return true; // Valid relative empty reference
  }

  // Parse with WHATWG URL parser using dummy base
  let parsed: URL;
  try {
    parsed = new URL(trimmed, "https://mix-base.invalid");
  } catch {
    return false;
  }

  const protocol = parsed.protocol.toLowerCase();

  // 1. Strictly blocked schemes in all contexts
  if (protocol === "javascript:" || protocol === "vbscript:" || protocol === "file:") {
    return false;
  }

  // 2. data: URL validation
  if (protocol === "data:") {
    // data:image/svg+xml is strictly forbidden across all contexts (AGENTS.md Part V)
    const lowerRaw = trimmed.toLowerCase();
    if (lowerRaw.includes("image/svg+xml") || lowerRaw.includes("text/html") || lowerRaw.includes("javascript")) {
      return false;
    }

    // data: is only permitted in media context, and only for safe raster/vector image mimes
    if (context !== "media") {
      return false;
    }

    const hasSafeMime = SAFE_DATA_IMAGE_MIMES.some((mime) => lowerRaw.startsWith(`data:${mime}`));
    return hasSafeMime;
  }

  // 3. Absolute URL with explicit scheme (origin is not the dummy base)
  if (parsed.origin !== "https://mix-base.invalid") {
    if (context === "navigation") {
      return SAFE_NAVIGATION_SCHEMES.has(protocol);
    }
    if (context === "media") {
      return SAFE_MEDIA_SCHEMES.has(protocol);
    }
    if (context === "resource") {
      return SAFE_RESOURCE_SCHEMES.has(protocol);
    }
    return false;
  }

  // 4. Protocol-relative URL (e.g. "//cdn.example.com/img.png")
  if (trimmed.startsWith("//")) {
    try {
      const resolved = new URL("https:" + trimmed);
      return resolved.protocol === "https:" || resolved.protocol === "http:";
    } catch {
      return false;
    }
  }

  // 5. Safe relative path without scheme (/path, ./rel, ../up, ?query, #hash, name)
  return true;
}

/**
 * Asserts that a URL is allowed in the given context (R-URL-01).
 * In DEV mode: throws MixError("MIX_SEC_UNSAFE_URL").
 * In Production: returns false and triggers activeConfig.onSecurityViolation.
 */
export function assertAllowedUrl(raw: string, context: UrlContext, attribute?: string): boolean {
  if (isAllowedUrl(raw, context)) {
    return true;
  }

  if (getIsDev()) {
    throw new MixError(
      "MIX_SEC_UNSAFE_URL",
      `Unsafe URL scheme detected in ${context} context: "${raw}"`,
      { url: raw, context, attribute }
    );
  }

  activeConfig.onSecurityViolation({
    code: "MIX_SEC_UNSAFE_URL",
    attribute,
    value: raw
  });

  return false;
}

