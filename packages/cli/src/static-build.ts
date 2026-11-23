/**
 * @dotmix/cli — Browserless Node Static Site Generator (`mix build --static`).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createRoot,
  createUniversalHeadCollector,
  provideContext,
  runWithHeadCollector
} from "@dotmix/runtime";
import {
  createMemoryRouter,
  expandLocalizedRoutes,
  RouteDepthContext,
  RouteMatchesContext,
  RouterContext,
  RouterProvider,
  type ExpandedRouteLocaleMeta,
  type RouteObject,
  type Router
} from "@dotmix/router";
import type { MixConfig } from "./config.js";
import { build as runBuild, type BuildResult } from "./build.js";
import { normalizeBasePath } from "./production-shell.js";
import { detectMountContainerId } from "./prerender.js";
import { compileSsrWorkspace } from "./static-ssr-loader.js";
import { assembleStaticHtmlPage, loadBaseIndexHtml } from "./static-html.js";
import type { SitemapEntry } from "./seo-files.js";
import {
  collectStaticRoutePaths,
  extractShellMetadata,
  resolveIslandModuleAttributes,
  resolveOutHtmlPath,
  writeSeoAndCspArtifacts
} from "./static-build-helpers.js";

export interface StaticRouteReport {
  readonly route: string;
  readonly file: string;
  readonly mode: "zero-js" | "islands" | "hydrate";
  readonly jsBytes: number;
  readonly noindex: boolean;
}

export interface StaticBuildResult {
  readonly buildResult: BuildResult;
  readonly routes: readonly StaticRouteReport[];
  readonly sitemapPath: string | undefined;
  readonly robotsPath: string | undefined;
  readonly cspManifestPath: string | undefined;
  readonly headersPath: string | undefined;
}

interface SsrRenderable {
  (props?: Record<string, unknown>, ctx?: Record<string, unknown>): unknown;
  renderToString?: (props?: Record<string, unknown>, ctx?: Record<string, unknown>) => string;
  __mixModuleKey?: string;
  __mixHydrationMeta?: { isInteractive: boolean; islandSpecifiers: readonly string[] };
}

function renderMatchedRouterTree(
  router: Router,
  ssrMetaByKey: ReadonlyMap<string, SsrRenderable>
): { bodyHtml: string; matchedModuleKeys: string[]; suppressedSpecifiers: Array<readonly [string, string]> } {
  const matched = router.currentRoute().matched;
  const matchedModuleKeys: string[] = [];
  const suppressedSpecifiers: Array<readonly [string, string]> = [];
  const ssrRenderCtx: Record<string, unknown> = { __suppressedSpecifiers: suppressedSpecifiers };

  const renderAtDepth = (depth: number): string => {
    const m = matched[depth];
    if (!m) return "";
    const comp = (m.route.element ?? m.route.Component ?? m.route.component ?? m.component) as
      | SsrRenderable
      | undefined;
    if (!comp) return renderAtDepth(depth + 1);
    if (comp.__mixModuleKey) matchedModuleKeys.push(comp.__mixModuleKey);
    else {
      for (const [k, fn] of ssrMetaByKey.entries()) {
        if (fn === comp) matchedModuleKeys.push(k);
      }
    }

    provideContext(RouteDepthContext, depth + 1);
    const props: Record<string, unknown> = {
      route: router.currentRoute(),
      params: m.params,
      ...(depth + 1 < matched.length
        ? {
            slots: { default: () => renderAtDepth(depth + 1) },
            children: () => renderAtDepth(depth + 1)
          }
        : {})
    };
    if (typeof comp.renderToString === "function") {
      return comp.renderToString(props, ssrRenderCtx);
    }
    if (typeof comp === "function") {
      const res = comp(props, ssrRenderCtx);
      return typeof res === "string" ? res : "";
    }
    return "";
  };

  let bodyHtml = "";
  createRoot((dispose) => {
    try {
      RouterProvider({ router, children: "" });
      provideContext(RouterContext, router);
      provideContext(RouteMatchesContext, () => matched);
      bodyHtml = renderAtDepth(0);
    } finally {
      dispose();
    }
  }, null);

  return { bodyHtml, matchedModuleKeys, suppressedSpecifiers };
}

function resolveIslandSpecToModuleKey(ownerKey: string, spec: string): string {
  let normalized = spec;
  for (const ext of [".tix", ".mix", ".ts"]) {
    if (normalized.endsWith(ext)) {
      normalized = `${normalized.slice(0, -ext.length)}.js`;
      break;
    }
  }
  return spec.startsWith("./") || spec.startsWith("../")
    ? path.posix.normalize(path.posix.join(path.posix.dirname(ownerKey), normalized))
    : normalized;
}

export async function runStaticSiteBuild(options: {
  readonly inDir: string;
  readonly outDir: string;
  readonly clean: boolean;
  readonly sourcemap: boolean;
  readonly analyze: boolean;
  readonly mode: string;
  readonly base: string | undefined;
  readonly config: MixConfig;
  readonly filterRoutes: readonly string[];
}): Promise<StaticBuildResult> {
  const inDir = path.resolve(options.inDir);
  const outDir = path.resolve(options.outDir);
  const projectDir = path.dirname(inDir);
  const basePath = normalizeBasePath(options.base);
  const mountId = detectMountContainerId(projectDir);
  const sourceIndexHtml = loadBaseIndexHtml(projectDir);

  const buildResult = runBuild({
    inDir,
    outDir,
    target: "client",
    clean: options.clean,
    sourcemap: options.sourcemap,
    analyze: options.analyze,
    mode: options.mode,
    base: options.base
  });

  const shellMeta = extractShellMetadata(outDir, basePath);
  const ssrWorkspace = compileSsrWorkspace(inDir, outDir, options.mode);
  const chunkSizes = new Map<string, number>();
  for (const c of buildResult.bundleReport.chunks) {
    chunkSizes.set(`${c.name}.js`, c.sizeBytes);
  }

  const routeReports: StaticRouteReport[] = [];
  const emittedHtmlFiles: Array<{ route: string; file: string; html: string }> = [];
  const sitemapEntries: SitemapEntry[] = [];
  const buildTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  try {
    const ssrModulesByKey = new Map<string, SsrRenderable>();
    for (const key of ssrWorkspace.moduleKeys) {
      if (key === "main.js" || key === "routes.js") continue;
      const disk = path.join(ssrWorkspace.tmpDir, ...key.split("/"));
      const imported = (await import(pathToFileURL(disk).href)) as {
        default?: SsrRenderable;
        renderToString?: SsrRenderable;
      };
      const fn = imported.renderToString ?? imported.default;
      if (typeof fn === "function") ssrModulesByKey.set(key, fn);
    }

    let rawRoutes: RouteObject[] = [];
    const routesJsPath = path.join(ssrWorkspace.tmpDir, "routes.js");
    if (fs.existsSync(routesJsPath)) {
      const routesMod = (await import(pathToFileURL(routesJsPath).href)) as {
        routes?: RouteObject[];
        default?: RouteObject[];
      };
      rawRoutes = routesMod.routes ?? routesMod.default ?? [];
    } else {
      const appMod = ssrModulesByKey.get("App.js");
      if (appMod) rawRoutes = [{ path: "/", component: appMod }];
    }

    const expandedRoutes = options.config.i18n
      ? expandLocalizedRoutes(rawRoutes, options.config.i18n)
      : rawRoutes;

    const { staticPaths, has404Route } = collectStaticRoutePaths(expandedRoutes);
    const pathsToRender = options.filterRoutes.length > 0 ? [...options.filterRoutes] : [...staticPaths];
    if (has404Route && !pathsToRender.includes("/404")) {
      pathsToRender.push("/404");
    }

    const collectTransitiveDeps = (startKey: string, out: Set<string>): void => {
      if (out.has(startKey)) return;
      out.add(startKey);
      for (const dep of ssrWorkspace.staticImportGraph.get(startKey) ?? []) {
        collectTransitiveDeps(dep, out);
      }
    };

    for (const routePath of pathsToRender) {
      const router = createMemoryRouter({
        routes: expandedRoutes,
        initialPath: routePath,
        i18n: options.config.i18n,
        siteUrl: options.config.site?.url
      });
      const headCollector = createUniversalHeadCollector();
      const matched = router.currentRoute().matched;
      const isNoindex = routePath === "/404" || matched.some((m) => m.route.meta?.noindex === true);

      const renderedTree = runWithHeadCollector(headCollector, () =>
        renderMatchedRouterTree(router, ssrModulesByKey)
      );
      let bodyHtml = renderedTree.bodyHtml;
      const matchedModuleKeys = renderedTree.matchedModuleKeys;
      if (isNoindex) {
        headCollector.addKeyedMeta({ name: "robots", content: "noindex" }, "name:robots");
      }

      const islandAssetKeys = new Set<string>();
      const ownerKey = matchedModuleKeys[matchedModuleKeys.length - 1];
      bodyHtml = resolveIslandModuleAttributes(
        bodyHtml,
        ownerKey,
        shellMeta.importMapEntries,
        basePath,
        islandAssetKeys
      );

      const suppressedModuleKeys = new Set<string>();
      for (const [supOwner, supSpec] of renderedTree.suppressedSpecifiers) {
        const effOwner = supOwner || ownerKey || "";
        suppressedModuleKeys.add(resolveIslandSpecToModuleKey(effOwner, supSpec));
      }

      let nonIslandInteractive = false;
      const visited = new Set<string>();
      const checkNonIsland = (key: string): void => {
        if (visited.has(key)) return;
        visited.add(key);
        if (islandAssetKeys.has(key) || suppressedModuleKeys.has(key)) {
          return;
        }
        const modFn = ssrModulesByKey.get(key);
        if (modFn?.__mixHydrationMeta?.isInteractive) {
          nonIslandInteractive = true;
          return;
        }
        const ownIslandKeys = new Set(
          (modFn?.__mixHydrationMeta?.islandSpecifiers ?? []).map((s) => resolveIslandSpecToModuleKey(key, s))
        );
        for (const dep of ssrWorkspace.staticImportGraph.get(key) ?? []) {
          if (!ownIslandKeys.has(dep) && !islandAssetKeys.has(dep) && !suppressedModuleKeys.has(dep)) {
            checkNonIsland(dep);
          }
        }
      };
      for (const mk of matchedModuleKeys) checkNonIsland(mk);

      let pageMode: "zero-js" | "islands" | "hydrate" = "zero-js";
      let pageImportMap: Record<string, string> = {};
      let jsBytes = 0;

      if (nonIslandInteractive) {
        pageMode = "hydrate";
        pageImportMap = shellMeta.importMapEntries;
        for (const size of chunkSizes.values()) jsBytes += size;
      } else if (islandAssetKeys.size > 0) {
        pageMode = "islands";
        const islandDeps = new Set<string>();
        for (const ik of islandAssetKeys) collectTransitiveDeps(ik, islandDeps);
        for (const [spec, url] of Object.entries(shellMeta.importMapEntries)) {
          if (spec === "@dotmix/runtime" || spec.startsWith("@dotmix/runtime/")) {
            pageImportMap[spec] = url;
          }
        }
        for (const dk of islandDeps) {
          const unhashed = `${basePath}assets/${dk}`;
          if (shellMeta.importMapEntries[unhashed]) {
            pageImportMap[unhashed] = shellMeta.importMapEntries[unhashed]!;
          }
          jsBytes += chunkSizes.get(dk) ?? 0;
        }
      }

      const fullHtml = assembleStaticHtmlPage({
        sourceIndexHtml,
        mountId,
        bodyHtml,
        headCollector,
        basePath,
        stylesheetFile: shellMeta.stylesheetFile,
        mode: pageMode,
        importMapEntries: pageImportMap,
        modulePreloadUrls: pageMode === "hydrate" ? shellMeta.modulePreloadUrls : [],
        entryModuleUrl: pageMode === "hydrate" ? shellMeta.entryModuleUrl : undefined
      });

      const outHtmlPath = resolveOutHtmlPath(outDir, routePath);
      fs.mkdirSync(path.dirname(outHtmlPath), { recursive: true });
      fs.writeFileSync(outHtmlPath, fullHtml, "utf-8");
      const relFile = path.relative(outDir, outHtmlPath).split(path.sep).join("/");

      routeReports.push({ route: routePath, file: relFile, mode: pageMode, jsBytes, noindex: isNoindex });
      emittedHtmlFiles.push({ route: routePath, file: relFile, html: fullHtml });

      if (!isNoindex && options.config.site?.url) {
        const cleanOrigin = options.config.site.url.replace(/\/+$/, "");
        const locMeta = router.currentRoute().meta.__i18n as ExpandedRouteLocaleMeta | undefined;
        const alternates = locMeta && options.config.i18n
          ? [
              ...locMeta.locales.map((l) => {
                const p =
                  l !== options.config.i18n!.defaultLocale || options.config.i18n!.prefixDefault
                    ? locMeta.basePath === "/" ? `/${l}/` : `/${l}${locMeta.basePath}`
                    : locMeta.basePath;
                return { hreflang: options.config.i18n!.hreflang?.[l] ?? l, href: `${cleanOrigin}${p}` };
              }),
              {
                hreflang: "x-default",
                href: `${cleanOrigin}${
                  options.config.i18n.prefixDefault
                    ? locMeta.basePath === "/"
                      ? `/${options.config.i18n.defaultLocale}/`
                      : `/${options.config.i18n.defaultLocale}${locMeta.basePath}`
                    : locMeta.basePath
                }`
              }
            ]
          : undefined;
        const normalizedRouteLoc =
          locMeta && routePath !== "/" && locMeta.basePath === "/" && !routePath.endsWith("/")
            ? `${routePath}/`
            : routePath;
        sitemapEntries.push({
          loc: `${cleanOrigin}${normalizedRouteLoc}`,
          lastmod: buildTimestamp,
          ...(alternates ? { alternates } : {})
        });
      }
    }
  } finally {
    ssrWorkspace.cleanup();
  }

  const artifacts = writeSeoAndCspArtifacts({
    projectDir,
    outDir,
    basePath,
    config: options.config,
    sitemapEntries,
    emittedHtmlFiles
  });

  return {
    buildResult,
    routes: routeReports,
    sitemapPath: artifacts.sitemapPath,
    robotsPath: artifacts.robotsPath,
    cspManifestPath: artifacts.cspManifestPath,
    headersPath: artifacts.headersPath
  };
}
