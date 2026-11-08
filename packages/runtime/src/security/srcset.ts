/**
 * packages/runtime/src/security/srcset.ts
 *
 * Mix v3.2.2 WHATWG Conforming srcset Parsing & Validation (§6.2).
 * Implements HTML Standard §4.8.4.3.7 "parse a srcset attribute" with strict total rejection (R-SRCSET-02).
 */

import { isAllowedUrl } from "./url.js";

export interface SrcsetCandidate {
  readonly url: string;
  readonly width?: number | undefined;
  readonly density?: number | undefined;
}

function isAsciiWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/**
 * Standard WHATWG HTML §4.8.4.3.7 conforming srcset attribute parser.
 * Handles commas in query parameters and data URIs, parses width and density descriptors,
 * and recovers gracefully from malformed candidates.
 */
export function parseSrcset(input: string): SrcsetCandidate[] {
  if (typeof input !== "string") return [];
  const length = input.length;
  let position = 0;
  const candidates: SrcsetCandidate[] = [];

  while (position < length) {
    // 1. Skip leading ASCII whitespace and commas
    while (position < length && (isAsciiWhitespace(input[position]!) || input[position] === ",")) {
      position++;
    }
    if (position >= length) break;

    // 2. Collect candidate URL substring
    let url = "";
    if (input.slice(position, position + 5).toLowerCase() === "data:") {
      const dataStart = position;
      position += 5;
      while (position < length) {
        if (input[position] === ",") {
          const nextPos = position + 1;
          if (nextPos >= length || isAsciiWhitespace(input[nextPos]!)) {
            break;
          }
        } else if (isAsciiWhitespace(input[position]!)) {
          const rest = input.slice(position).trimStart();
          if (/^(?:[1-9]\d*w|\d+(?:\.\d+)?x)(?:\s*,|\s*$)/i.test(rest) || rest.startsWith(",")) {
            break;
          }
        }
        position++;
      }
      url = input.slice(dataStart, position).trim();
    } else {
      const urlStart = position;
      while (position < length && !isAsciiWhitespace(input[position]!)) {
        if (input[position] === ",") {
          const next = position + 1;
          if (next >= length || isAsciiWhitespace(input[next]!)) {
            position++; // consume comma
            url = input.slice(urlStart, position - 1);
            if (url.length > 0) {
              candidates.push({ url, density: 1 });
            }
            url = "";
            break;
          }
        }
        position++;
      }
      if (url.length === 0 && position > urlStart) {
        url = input.slice(urlStart, position);
        if (url.endsWith(",")) {
          url = url.slice(0, -1);
          if (url.length > 0) {
            candidates.push({ url, density: 1 });
          }
          continue;
        }
      }
    }

    if (url.length === 0) continue;

    // 3. Collect descriptors
    const descriptors: string[] = [];
    while (position < length) {
      while (position < length && isAsciiWhitespace(input[position]!)) {
        position++;
      }
      if (position >= length) break;
      if (input[position] === ",") {
        position++;
        break;
      }

      let descriptor = "";
      let inParens = false;
      while (position < length) {
        const c = input[position]!;
        if (inParens) {
          if (c === ")") inParens = false;
          descriptor += c;
          position++;
        } else {
          if (isAsciiWhitespace(c)) {
            position++;
            break;
          }
          if (c === ",") {
            // Do not consume the comma here; next iteration will see it
            break;
          }
          if (c === "(") inParens = true;
          descriptor += c;
          position++;
        }
      }

      if (descriptor.length > 0) {
        descriptors.push(descriptor);
      }
    }

    // 4. Validate and parse descriptors
    let width: number | undefined;
    let density: number | undefined;
    let valid = true;

    for (const desc of descriptors) {
      if (/^[1-9]\d*w$/i.test(desc)) {
        if (width !== undefined || density !== undefined) {
          valid = false;
          break;
        }
        width = parseInt(desc.slice(0, -1), 10);
      } else if (/^\d+(?:\.\d+)?x$/i.test(desc)) {
        if (width !== undefined || density !== undefined) {
          valid = false;
          break;
        }
        density = parseFloat(desc.slice(0, -1));
        if (Number.isNaN(density) || density <= 0) {
          valid = false;
          break;
        }
      } else {
        // Unknown or malformed descriptor
        valid = false;
        break;
      }
    }

    if (valid) {
      if (width === undefined && density === undefined) {
        density = 1;
      }
      candidates.push({
        url,
        ...(width !== undefined ? { width } : {}),
        ...(density !== undefined ? { density } : {})
      });
    }
  }

  return candidates;
}

/**
 * Validates a srcset attribute value (R-SRCSET-02).
 * If any candidate URL fails isAllowedUrl(url, "media"), the ENTIRE attribute is rejected.
 * Partial filtering is strictly forbidden.
 */
export function validateSrcset(input: string): boolean {
  if (typeof input !== "string") return false;
  const trimmed = input.trim();
  if (trimmed.length === 0) return true;

  const candidates = parseSrcset(trimmed);
  if (candidates.length === 0) return false;

  for (const candidate of candidates) {
    if (!isAllowedUrl(candidate.url, "media")) {
      return false; // R-SRCSET-02: Total rejection of attribute
    }
  }

  return true;
}

/**
 * Serializes srcset candidates back to standard string format.
 */
export function serializeSrcset(candidates: readonly SrcsetCandidate[]): string {
  return candidates
    .map((c) => {
      let desc = "";
      if (c.width !== undefined) desc = ` ${c.width}w`;
      else if (c.density !== undefined && c.density !== 1) desc = ` ${c.density}x`;
      return `${c.url}${desc}`;
    })
    .join(", ");
}

