/**
 * @dotmix/cli — Helper functions for static site build (shell parsing, route collection, island rewriting, SEO/CSP output).
 */

import fs from "node:fs";
import path from "node:path";
import type { RouteObject } from "@dotmix/router";
import type { MixConfig } from "./config.js";
import { generateRobotsTxt, generateSitemapXml, type SitemapEntry } from "./seo-files.js";
import {
  buildCspPolicyString,
  extractInlineCspHashes,
  writeCloudflareHeadersFile,
  type CspRouteRecord,
  type MixCspManifest
} from "./csp.js";

export interface ShellMetadata {
  readonly stylesheetFile: string | undefined;
  readonly importMapEntries: Record<string, string>;
  readonly modulePreloadUrls: string[];
  readonly entryModuleUrl: string | undefined;
}

export function extractShellMetadata(distDir: string, basePath: string): ShellMetadata {
  const indexPath = path.join(distDir, "index.html");
  const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf-8") : "";
  let importMapEntries: Record<string, string> = {};
  const mapOpen = '<script type="importmap">';
  const mapStart = html.indexOf(mapOpen);
  if (mapStart !== -1) {
    const mapEnd = html.indexOf("</script>", mapStart);
    if (mapEnd !== -1) {
      const parsed = JSON.parse(html.slice(mapStart + mapOpen.length, mapEnd)) as {
        imports?: Record<string, string>;
      };
      importMapEntries = parsed.imports ?? {};
    }
  }

  let stylesheetFile: string | undefined;
  const cssMarker = 'rel="stylesheet" href="';
  const cssIdx = html.indexOf(cssMarker);
  if (cssIdx !== -1) {
    const hrefStart = cssIdx + cssMarker.length;
    const hrefEnd = html.indexOf('"', hrefStart);
    if (hrefEnd !== -1) {
      const fullHref = html.slice(hrefStart, hrefEnd);
      stylesheetFile = fullHref.startsWith(basePath) ? fullHref.slice(basePath.length) : fullHref;
    }
  }

  const modulePreloadUrls: string[] = [];
  let cursor = 0;
  const preloadToken = 'rel="modulepreload" href="';
  while (cursor < html.length) {
    const idx = html.indexOf(preloadToken, cursor);
    if (idx === -1) break;
    const start = idx + preloadToken.length;
    const end = html.indexOf('"', start);
    if (end === -1) break;
    modulePreloadUrls.push(html.slice(start, end));
    cursor = end + 1;
  }

  let entryModuleUrl: string | undefined;
  const entryToken = '<script type="module" src="';
  const entryIdx = html.indexOf(entryToken);
  if (entryIdx !== -1) {
    const start = entryIdx + entryToken.length;
    const end = html.indexOf('"', start);
    if (end !== -1) entryModuleUrl = html.slice(start, end);
  }

  return { stylesheetFile, importMapEntries, modulePreloadUrls, entryModuleUrl };
}

function joinUrlPath(prefix: string, seg: string): string {
  if (!seg) return prefix || "/";
  if (seg.startsWith("/")) return seg;
  const cleanPrefix = prefix === "/" ? "" : prefix.replace(/\/+$/, "");
  return `${cleanPrefix}/${seg}`;
}

export function collectStaticRoutePaths(
  routes: readonly RouteObject[],
  prefix: string = ""
): { staticPaths: string[]; has404Route: boolean } {
  const staticPaths: string[] = [];
  const seen = new Set<string>();
  let has404Route = false;

  const walk = (list: readonly RouteObject[], currentPrefix: string): void => {
    for (const r of list) {
      const raw = r.path ?? "";
      if (raw === "*" || raw.includes("*")) {
        has404Route = true;
        continue;
      }
      if (raw.includes(":")) continue;

      const full = r.index ? (currentPrefix || "/") : joinUrlPath(currentPrefix, raw);
      if (full === "/404") {
        has404Route = true;
        continue;
      }
      if (r.children && r.children.length > 0) {
        walk(r.children, full);
      } else {
        const normalized = full === "" ? "/" : full;
        if (!seen.has(normalized)) {
          seen.add(normalized);
          staticPaths.push(normalized);
        }
      }
    }
  };

  walk(routes, prefix);
  return { staticPaths, has404Route };
}

export function resolveOutHtmlPath(outDir: string, routePath: string): string {
  if (routePath === "/404") return path.join(outDir, "404.html");
  const trimmed = routePath.replace(/^\/+|\/+$/g, "");
  return trimmed.length === 0
    ? path.join(outDir, "index.html")
    : path.join(outDir, ...trimmed.split("/"), "index.html");
}

export function resolveIslandModuleAttributes(
  html: string,
  ownerModuleKey: string | undefined,
  importMapEntries: Readonly<Record<string, string>>,
  basePath: string,
  usedIslandAssetKeys: Set<string>
): string {
  const tagPrefix = "<mix-island";
  let out = "";
  let pos = 0;

  while (pos < html.length) {
    const tagStart = html.indexOf(tagPrefix, pos);
    if (tagStart === -1) {
      out += html.slice(pos);
      break;
    }
    const nextCh = html[tagStart + tagPrefix.length];
    if (nextCh !== " " && nextCh !== "\t" && nextCh !== ">" && nextCh !== "\n") {
      out += html.slice(pos, tagStart + tagPrefix.length);
      pos = tagStart + tagPrefix.length;
      continue;
    }
    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) {
      out += html.slice(pos);
      break;
    }

    out += html.slice(pos, tagStart);
    let openTag = html.slice(tagStart, tagEnd + 1);
    pos = tagEnd + 1;

    let effectiveOwner = ownerModuleKey;
    const ownerToken = ' data-island-owner="';
    const ownerIdx = openTag.indexOf(ownerToken);
    if (ownerIdx !== -1) {
      const ownerValStart = ownerIdx + ownerToken.length;
      const ownerValEnd = openTag.indexOf('"', ownerValStart);
      if (ownerValEnd !== -1) {
        const parsedOwner = openTag.slice(ownerValStart, ownerValEnd);
        if (parsedOwner.length > 0) effectiveOwner = parsedOwner;
        openTag = openTag.slice(0, ownerIdx) + openTag.slice(ownerValEnd + 1);
      }
    }

    const specToken = 'data-island-specifier="';
    const specIdx = openTag.indexOf(specToken);
    if (specIdx !== -1) {
      const specValStart = specIdx + specToken.length;
      const specValEnd = openTag.indexOf('"', specValStart);
      if (specValEnd !== -1) {
        const specifier = openTag.slice(specValStart, specValEnd);
        let resolvedModuleKey = specifier;
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          const baseDir = effectiveOwner ? path.posix.dirname(effectiveOwner) : ".";
          let joined = path.posix.normalize(path.posix.join(baseDir, specifier));
          for (const ext of [".tix", ".mix", ".ts"]) {
            if (joined.endsWith(ext)) {
              joined = `${joined.slice(0, -ext.length)}.js`;
              break;
            }
          }
          resolvedModuleKey = joined;
        }
        const unhashedUrl = `${basePath}assets/${resolvedModuleKey}`;
        const hashedUrl = importMapEntries[unhashedUrl] ?? unhashedUrl;
        usedIslandAssetKeys.add(resolvedModuleKey);
        openTag =
          openTag.slice(0, specIdx) +
          `data-island-module="${hashedUrl}"` +
          openTag.slice(specValEnd + 1);
      }
    }

    out += openTag;
  }

  return out;
}

export function writeSeoAndCspArtifacts(options: {
  readonly projectDir: string;
  readonly outDir: string;
  readonly basePath: string;
  readonly config: MixConfig;
  readonly sitemapEntries: readonly SitemapEntry[];
  readonly emittedHtmlFiles: readonly { readonly route: string; readonly file: string; readonly html: string }[];
}): {
  readonly sitemapPath: string | undefined;
  readonly robotsPath: string | undefined;
  readonly cspManifestPath: string | undefined;
  readonly headersPath: string | undefined;
} {
  let sitemapPath: string | undefined;
  let robotsPath: string | undefined;
  if (options.config.site?.url) {
    const sitemapOpt = options.config.seo?.sitemap;
    if (sitemapOpt !== false && (typeof sitemapOpt !== "object" || sitemapOpt.enabled !== false)) {
      sitemapPath = path.join(options.outDir, "sitemap.xml");
      fs.writeFileSync(sitemapPath, generateSitemapXml(options.sitemapEntries), "utf-8");
    }
    const robotsOpt = options.config.seo?.robots;
    const candidateRobots = path.join(options.outDir, "robots.txt");
    if (
      robotsOpt !== false &&
      (typeof robotsOpt !== "object" || robotsOpt.enabled !== false) &&
      !fs.existsSync(path.join(options.projectDir, "public", "robots.txt"))
    ) {
      robotsPath = candidateRobots;
      fs.writeFileSync(
        robotsPath,
        generateRobotsTxt(
          options.config.site.url,
          options.basePath,
          typeof robotsOpt === "object" ? robotsOpt : undefined
        ),
        "utf-8"
      );
    }
  }

  let cspManifestPath: string | undefined;
  let headersPath: string | undefined;
  if (options.config.csp?.enabled !== false) {
    const globalScripts = new Set<string>();
    const globalStyles = new Set<string>();
    const routeCspMap: Record<string, CspRouteRecord> = {};

    for (const item of options.emittedHtmlFiles) {
      const { scriptHashes, styleHashes } = extractInlineCspHashes(item.html);
      for (const h of scriptHashes) globalScripts.add(h);
      for (const h of styleHashes) globalStyles.add(h);
      routeCspMap[item.route] = {
        route: item.route,
        file: item.file,
        scriptHashes,
        styleHashes,
        policy: buildCspPolicyString(scriptHashes, styleHashes, options.config.csp)
      };
    }

    const globalScriptHashes = [...globalScripts];
    const globalStyleHashes = [...globalStyles];
    const manifest: MixCspManifest = {
      version: "1.0",
      algorithm: "sha256",
      globalScriptHashes,
      globalStyleHashes,
      globalPolicy: buildCspPolicyString(globalScriptHashes, globalStyleHashes, options.config.csp),
      routes: routeCspMap
    };

    cspManifestPath = path.join(options.outDir, "mix-csp.json");
    fs.writeFileSync(cspManifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    if (options.config.csp?.target === "cloudflare-pages") {
      headersPath = writeCloudflareHeadersFile(options.outDir, manifest, options.config.csp);
    }
  }

  return { sitemapPath, robotsPath, cspManifestPath, headersPath };
}

