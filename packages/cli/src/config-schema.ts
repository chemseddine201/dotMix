/**
 * @dotmix/cli — Configuration schema and validator for site, i18n, seo, and csp sections.
 */

import { DiagnosticCodes, MixDiagnosticError } from "@dotmix/diagnostics";
import type { I18nConfig } from "@dotmix/router";

export interface SiteConfig {
  readonly url: string;
  readonly trailingSlash?: "never" | "always" | "preserve" | undefined;
}

export interface SitemapConfig {
  readonly enabled?: boolean | undefined;
  readonly lastmod?: string | "build-time" | undefined;
  readonly exclude?: readonly string[] | undefined;
}

export interface RobotsConfig {
  readonly enabled?: boolean | undefined;
  readonly allow?: readonly string[] | undefined;
  readonly disallow?: readonly string[] | undefined;
  readonly extraLines?: readonly string[] | undefined;
}

export interface SeoConfig {
  readonly sitemap?: boolean | SitemapConfig | undefined;
  readonly robots?: boolean | RobotsConfig | undefined;
  readonly notFound?: boolean | string | undefined;
}

export interface CspConfig {
  readonly enabled?: boolean | undefined;
  readonly target?: "cloudflare-pages" | "manifest-only" | undefined;
  readonly scriptSrc?: readonly string[] | undefined;
  readonly styleSrc?: readonly string[] | undefined;
  readonly imgSrc?: readonly string[] | undefined;
  readonly fontSrc?: readonly string[] | undefined;
  readonly connectSrc?: readonly string[] | undefined;
  readonly frameAncestors?: readonly string[] | undefined;
  readonly securityHeaders?: boolean | undefined;
}

export interface StaticBuildConfig {
  readonly routes?: readonly string[] | "auto" | undefined;
  readonly trailingSlash?: "never" | "always" | "preserve" | undefined;
  readonly islandMode?: "auto" | "explicit" | undefined;
}

export interface ErrorsConfig {
  readonly fallback?: string | undefined;
  readonly report?: string | undefined;
}

export function configError(configPath: string, messageText: string): MixDiagnosticError {
  return new MixDiagnosticError({
    code: DiagnosticCodes.MIX_ERR_CONFIG_INVALID,
    severity: "error",
    message: `${configPath}: ${messageText}`,
    span: {
      file: configPath,
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 }
    }
  });
}

function assertObject(val: unknown, configPath: string, field: string): Record<string, unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    throw configError(configPath, `${field}: expected an object`);
  }
  return val as Record<string, unknown>;
}

function assertStringArray(val: unknown, configPath: string, field: string): void {
  if (!Array.isArray(val)) {
    throw configError(configPath, `${field}: expected an array of strings`);
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== "string") {
      throw configError(configPath, `${field}[${i}]: expected a string`);
    }
  }
}

export function validateSiteConfig(raw: unknown, configPath: string): SiteConfig {
  const rec = assertObject(raw, configPath, "site");
  const allowed = new Set(["url", "trailingSlash"]);
  for (const k of Object.keys(rec)) {
    if (!allowed.has(k)) throw configError(configPath, `site.${k}: unknown configuration property`);
  }
  if (typeof rec.url !== "string" || rec.url.trim().length === 0) {
    throw configError(configPath, "site.url: expected a non-empty URL string");
  }
  if (
    rec.trailingSlash !== undefined &&
    rec.trailingSlash !== "never" &&
    rec.trailingSlash !== "always" &&
    rec.trailingSlash !== "preserve"
  ) {
    throw configError(configPath, "site.trailingSlash: expected 'never' | 'always' | 'preserve'");
  }
  return rec as unknown as SiteConfig;
}

export function validateI18nConfig(raw: unknown, configPath: string): I18nConfig {
  const rec = assertObject(raw, configPath, "i18n");
  const allowed = new Set(["locales", "defaultLocale", "prefixDefault", "dir", "hreflang"]);
  for (const k of Object.keys(rec)) {
    if (!allowed.has(k)) throw configError(configPath, `i18n.${k}: unknown configuration property`);
  }
  assertStringArray(rec.locales, configPath, "i18n.locales");
  if ((rec.locales as string[]).length === 0) {
    throw configError(configPath, "i18n.locales: expected at least one locale");
  }
  if (typeof rec.defaultLocale !== "string" || !(rec.locales as string[]).includes(rec.defaultLocale)) {
    throw configError(configPath, "i18n.defaultLocale: must be one of i18n.locales");
  }
  if (rec.prefixDefault !== undefined && typeof rec.prefixDefault !== "boolean") {
    throw configError(configPath, "i18n.prefixDefault: expected a boolean");
  }
  if (rec.dir !== undefined) {
    const dirObj = assertObject(rec.dir, configPath, "i18n.dir");
    for (const [k, v] of Object.entries(dirObj)) {
      if (v !== "ltr" && v !== "rtl" && v !== "auto") {
        throw configError(configPath, `i18n.dir.${k}: expected 'ltr' | 'rtl' | 'auto'`);
      }
    }
  }
  if (rec.hreflang !== undefined) {
    const hrefObj = assertObject(rec.hreflang, configPath, "i18n.hreflang");
    for (const [k, v] of Object.entries(hrefObj)) {
      if (typeof v !== "string") {
        throw configError(configPath, `i18n.hreflang.${k}: expected a string`);
      }
    }
  }
  return rec as unknown as I18nConfig;
}

export function validateSeoConfig(raw: unknown, configPath: string): SeoConfig {
  const rec = assertObject(raw, configPath, "seo");
  const allowed = new Set(["sitemap", "robots", "notFound"]);
  for (const k of Object.keys(rec)) {
    if (!allowed.has(k)) throw configError(configPath, `seo.${k}: unknown configuration property`);
  }
  return rec as unknown as SeoConfig;
}

export function validateCspConfig(raw: unknown, configPath: string): CspConfig {
  const rec = assertObject(raw, configPath, "csp");
  const allowed = new Set([
    "enabled",
    "target",
    "scriptSrc",
    "styleSrc",
    "imgSrc",
    "fontSrc",
    "connectSrc",
    "frameAncestors",
    "securityHeaders"
  ]);
  for (const k of Object.keys(rec)) {
    if (!allowed.has(k)) throw configError(configPath, `csp.${k}: unknown configuration property`);
  }
  if (
    rec.target !== undefined &&
    rec.target !== "cloudflare-pages" &&
    rec.target !== "manifest-only"
  ) {
    throw configError(configPath, "csp.target: expected 'cloudflare-pages' | 'manifest-only'");
  }
  return rec as unknown as CspConfig;
}

export function validateErrorsConfig(raw: unknown, configPath: string): ErrorsConfig {
  const rec = assertObject(raw, configPath, "errors");
  const allowed = new Set(["fallback", "report"]);
  for (const k of Object.keys(rec)) {
    if (!allowed.has(k)) throw configError(configPath, `errors.${k}: unknown configuration property`);
  }
  if (rec.fallback !== undefined && typeof rec.fallback !== "string") {
    throw configError(configPath, "errors.fallback: expected a file path string");
  }
  if (rec.report !== undefined && typeof rec.report !== "string") {
    throw configError(configPath, "errors.report: expected a file path string");
  }
  return rec as unknown as ErrorsConfig;
}

