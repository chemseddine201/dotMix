/**
 * @dotmix/cli — Static SEO output emitters (`sitemap.xml` and `robots.txt`).
 */

import type { RobotsConfig } from "./config-schema.js";

export interface SitemapAlternate {
  readonly hreflang: string;
  readonly href: string;
}

export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod?: string | undefined;
  readonly changefreq?: string | undefined;
  readonly priority?: number | undefined;
  readonly alternates?: readonly SitemapAlternate[] | undefined;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Generates a valid Sitemap 0.9 XML document with `xmlns:xhtml` alternate links.
 */
export function generateSitemapXml(entries: readonly SitemapEntry[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
  ];

  for (const entry of entries) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) {
      lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq) {
      lines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    }
    if (entry.alternates) {
      for (const alt of entry.alternates) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}" />`
        );
      }
    }
    lines.push("  </url>");
  }

  lines.push("</urlset>");
  return lines.join("\n") + "\n";
}

/**
 * Generates `robots.txt` referencing the generated `sitemap.xml`.
 */
export function generateRobotsTxt(
  siteUrl: string,
  basePath: string = "/",
  config?: RobotsConfig
): string {
  const cleanOrigin = siteUrl.replace(/\/+$/, "");
  const cleanBase = basePath === "/" ? "/" : `/${basePath.replace(/^\/+|\/+$/g, "")}/`;
  const sitemapUrl = `${cleanOrigin}${cleanBase}sitemap.xml`;

  const lines: string[] = ["User-agent: *"];
  const allows = config?.allow ?? ["/"];
  for (const allowPath of allows) {
    lines.push(`Allow: ${allowPath}`);
  }
  if (config?.disallow) {
    for (const disallowPath of config.disallow) {
      lines.push(`Disallow: ${disallowPath}`);
    }
  }
  lines.push(`Sitemap: ${sitemapUrl}`);
  if (config?.extraLines) {
    for (const line of config.extraLines) {
      lines.push(line);
    }
  }
  return lines.join("\n") + "\n";
}

