/**
 * @mix/runtime/security/url-policy — Safe URL protocol validation (R-URL-01)
 * and normative WHATWG `srcset` parser (D-107, HTML Standard §4.8.4.3.7).
 */

import { MixError, DiagnosticCodes } from "../errors.js";

export type UrlContext = "attribute" | "srcset" | "css" | (string & {});

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

export function isAsciiWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

export function isSafeUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string") {
    return false;
  }
  const normalized = stripControlAndSpace(rawUrl);
  if (normalized.length === 0) {
    return true;
  }

  // Relative URLs starting with /, ./, ../, ?, # are safe
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

export interface SrcsetCandidate {
  readonly url: string;
  readonly descriptor?: string;
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

export function formatSrcsetCandidates(
  candidates: readonly SrcsetCandidate[]
): string {
  return candidates
    .map((c) => (c.descriptor ? `${c.url} ${c.descriptor}` : c.url))
    .join(", ");
}

export function setSafeSrcset(el: Element, rawSrcset: string): void {
  const candidates = parseSrcsetCandidates(rawSrcset);
  el.setAttribute("srcset", formatSrcsetCandidates(candidates));
}

export const validateAndCommitSrcset = setSafeSrcset;
