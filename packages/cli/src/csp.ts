/**
 * @dotmix/cli — SHA-256 CSP hash collector (`dist/mix-csp.json`) and Cloudflare Pages `_headers` writer.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CspConfig } from "./config-schema.js";

export interface CspRouteRecord {
  readonly route: string;
  readonly file: string;
  readonly scriptHashes: readonly string[];
  readonly styleHashes: readonly string[];
  readonly policy: string;
}

export interface MixCspManifest {
  readonly version: "1.0";
  readonly algorithm: "sha256";
  readonly globalScriptHashes: readonly string[];
  readonly globalStyleHashes: readonly string[];
  readonly globalPolicy: string;
  readonly routes: Readonly<Record<string, CspRouteRecord>>;
}

export function computeCspSha256Hash(content: string): string {
  const digest = crypto.createHash("sha256").update(content, "utf-8").digest("base64");
  return `'sha256-${digest}'`;
}

function readAttrValue(openTag: string, attrName: string): string | null {
  const lower = openTag.toLowerCase();
  const target = `${attrName.toLowerCase()}=`;
  let idx = 0;
  while (idx < lower.length) {
    const found = lower.indexOf(target, idx);
    if (found === -1) return null;
    const prevCh = found > 0 ? lower[found - 1]! : " ";
    if (prevCh !== " " && prevCh !== "\t" && prevCh !== "\n" && prevCh !== "\r") {
      idx = found + target.length;
      continue;
    }
    const afterEq = found + target.length;
    const quote = openTag[afterEq];
    if (quote === '"' || quote === "'") {
      const endQuote = openTag.indexOf(quote, afterEq + 1);
      if (endQuote !== -1) return openTag.slice(afterEq + 1, endQuote);
    }
    let end = afterEq;
    while (end < openTag.length && !/[\s>]/.test(openTag[end]!)) end++;
    return openTag.slice(afterEq, end);
  }
  return null;
}

function hasAttrName(openTag: string, attrName: string): boolean {
  const lower = openTag.toLowerCase();
  const target = attrName.toLowerCase();
  let idx = 0;
  while (idx < lower.length) {
    const found = lower.indexOf(target, idx);
    if (found === -1) return false;
    const prev = found > 0 ? lower[found - 1]! : " ";
    const next = lower[found + target.length] ?? " ";
    if ((prev === " " || prev === "\t" || prev === "\n" || prev === "\r") &&
        (next === "=" || next === " " || next === "\t" || next === ">" || next === "/")) {
      return true;
    }
    idx = found + target.length;
  }
  return false;
}

export function extractInlineCspHashes(html: string): {
  readonly scriptHashes: readonly string[];
  readonly styleHashes: readonly string[];
} {
  const scriptHashes: string[] = [];
  const styleHashes: string[] = [];
  const lower = html.toLowerCase();

  let cursor = 0;
  while (cursor < html.length) {
    const scriptStart = lower.indexOf("<script", cursor);
    const styleStart = lower.indexOf("<style", cursor);
    let nextTagStart = -1;
    let kind: "script" | "style" | null = null;

    if (scriptStart !== -1 && (styleStart === -1 || scriptStart < styleStart)) {
      nextTagStart = scriptStart;
      kind = "script";
    } else if (styleStart !== -1) {
      nextTagStart = styleStart;
      kind = "style";
    }

    if (nextTagStart === -1 || !kind) break;

    const afterName = nextTagStart + (kind === "script" ? 7 : 6);
    const nextChar = html[afterName];
    if (nextChar !== ">" && nextChar !== " " && nextChar !== "\t" && nextChar !== "\n" && nextChar !== "\r") {
      cursor = afterName;
      continue;
    }

    const openEnd = html.indexOf(">", afterName);
    if (openEnd === -1) break;
    const openTag = html.slice(nextTagStart, openEnd + 1);
    const closeTag = kind === "script" ? "</script>" : "</style>";
    const closeIdx = lower.indexOf(closeTag, openEnd + 1);
    if (closeIdx === -1) break;

    const inner = html.slice(openEnd + 1, closeIdx);
    cursor = closeIdx + closeTag.length;

    if (kind === "script") {
      if (hasAttrName(openTag, "src")) continue;
      const scriptType = (readAttrValue(openTag, "type") ?? "").trim().toLowerCase();
      // JSON-LD and JSON state blocks are inert data, not executable scripts under CSP.
      if (scriptType === "application/ld+json" || scriptType === "application/json") {
        continue;
      }
      if (inner.length > 0) {
        const hash = computeCspSha256Hash(inner);
        if (!scriptHashes.includes(hash)) scriptHashes.push(hash);
      }
    } else if (inner.length > 0) {
      const hash = computeCspSha256Hash(inner);
      if (!styleHashes.includes(hash)) styleHashes.push(hash);
    }
  }

  return { scriptHashes, styleHashes };
}

export function buildCspPolicyString(
  scriptHashes: readonly string[],
  styleHashes: readonly string[],
  config?: CspConfig
): string {
  const scriptTokens = ["'self'", ...scriptHashes, ...(config?.scriptSrc ?? [])];
  const styleTokens = ["'self'", ...styleHashes, ...(config?.styleSrc ?? [])];
  const imgTokens = config?.imgSrc ?? ["'self'", "data:"];
  const fontTokens = config?.fontSrc ?? ["'self'"];
  const connectTokens = config?.connectSrc ?? ["'self'"];
  const frameAncestors = config?.frameAncestors ?? ["'none'"];

  return [
    "default-src 'self'",
    `script-src ${scriptTokens.join(" ")}`,
    `style-src ${styleTokens.join(" ")}`,
    `img-src ${imgTokens.join(" ")}`,
    `font-src ${fontTokens.join(" ")}`,
    `connect-src ${connectTokens.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors.join(" ")}`
  ].join("; ");
}

export function writeCloudflareHeadersFile(
  outDir: string,
  manifest: MixCspManifest,
  config?: CspConfig
): string {
  const includeSecurityHeaders = config?.securityHeaders !== false;
  const lines: string[] = [
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/vendor/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/*"
  ];

  if (includeSecurityHeaders) {
    lines.push(
      "  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: strict-origin-when-cross-origin",
      "  Permissions-Policy: camera=(), microphone=(), geolocation=()"
    );
  }
  lines.push(`  Content-Security-Policy: ${manifest.globalPolicy}`);
  lines.push("");

  const headersPath = path.join(outDir, "_headers");
  fs.writeFileSync(headersPath, lines.join("\n"), "utf-8");
  return headersPath;
}

