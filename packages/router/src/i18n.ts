/**
 * @dotmix/router/i18n — Locale routing, path localization, and alternate hreflang helpers.
 */

import type { RouteObject, RouteRecord } from "./types.js";

export type TextDirection = "ltr" | "rtl" | "auto";

export interface I18nConfig {
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly prefixDefault?: boolean | undefined;
  readonly dir?: Readonly<Record<string, TextDirection>> | undefined;
  readonly hreflang?: Readonly<Record<string, string>> | undefined;
}

export interface LocaleInfo {
  readonly locale: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly dir: TextDirection;
  readonly isDefault: boolean;
  switchLocalePath(targetLocale: string): string;
}

export interface RouteI18nMeta {
  readonly i18n?: boolean | readonly string[] | undefined;
}

export interface ExpandedRouteLocaleMeta {
  readonly locale: string;
  readonly defaultLocale: string;
  readonly basePath: string;
  readonly locales: readonly string[];
  readonly dir: TextDirection;
}

function normalizePathname(rawPath: string): string {
  if (!rawPath || rawPath === "/") return "/";
  const withSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

function joinLocalePrefix(locale: string, basePath: string): string {
  const norm = normalizePathname(basePath);
  if (norm === "/") {
    return `/${locale}/`;
  }
  return `/${locale}${norm}`;
}

export function getDirectionForLocale(locale: string, config?: I18nConfig): TextDirection {
  const explicit = config?.dir?.[locale];
  if (explicit) return explicit;
  const lower = locale.toLowerCase().split("-")[0] ?? locale.toLowerCase();
  if (lower === "ar" || lower === "he" || lower === "fa" || lower === "ur") {
    return "rtl";
  }
  return "ltr";
}

export function resolveLocaleFromPath(
  pathname: string,
  config: I18nConfig
): { readonly locale: string; readonly unprefixedPath: string } {
  const clean = pathname.split(/[?#]/)[0] || "/";
  const segments = clean.split("/").filter((s) => s.length > 0);
  const first = segments[0];
  if (first && config.locales.includes(first)) {
    const rest = "/" + segments.slice(1).join("/");
    return {
      locale: first,
      unprefixedPath: rest === "/" ? "/" : normalizePathname(rest)
    };
  }
  return {
    locale: config.defaultLocale,
    unprefixedPath: normalizePathname(clean)
  };
}

export function formatLocalePath(
  targetPath: string,
  locale?: string,
  config?: I18nConfig
): string {
  const raw = targetPath || "/";
  const qIdx = raw.search(/[?#]/);
  const pathPart = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const suffix = qIdx === -1 ? "" : raw.slice(qIdx);

  if (!config) {
    const norm = pathPart === "/" ? "/" : normalizePathname(pathPart);
    if (!locale) return `${norm}${suffix}`;
    return norm === "/" ? `/${locale}/${suffix}` : `/${locale}${norm}${suffix}`;
  }

  const targetLocale = locale ?? config.defaultLocale;
  const { unprefixedPath } = resolveLocaleFromPath(pathPart, config);
  const shouldPrefix =
    targetLocale !== config.defaultLocale || Boolean(config.prefixDefault);

  if (!shouldPrefix) {
    return `${unprefixedPath}${suffix}`;
  }
  return `${joinLocalePrefix(targetLocale, unprefixedPath)}${suffix}`;
}

function resolveAllowedLocales(
  route: RouteObject | RouteRecord,
  config: I18nConfig
): readonly string[] | null {
  const metaI18n = route.meta?.i18n as boolean | readonly string[] | undefined;
  if (metaI18n === false) return null;
  if (Array.isArray(metaI18n)) {
    return metaI18n.filter((loc) => config.locales.includes(loc));
  }
  return config.locales;
}

function expandChildRoutes(
  children: readonly (RouteRecord | RouteObject)[],
  locale: string,
  config: I18nConfig,
  parentFullBase: string
): RouteObject[] {
  return children.map((child) => {
    const rawChildPath = child.path ?? "";
    const childFullBase = child.index
      ? parentFullBase
      : rawChildPath.startsWith("/")
        ? normalizePathname(rawChildPath)
        : normalizePathname(
            parentFullBase === "/" ? `/${rawChildPath}` : `${parentFullBase}/${rawChildPath}`
          );
    const expandedChildren = child.children
      ? expandChildRoutes(child.children, locale, config, childFullBase)
      : undefined;
    return {
      ...child,
      meta: {
        ...(child.meta ?? {}),
        __i18n: {
          locale,
          defaultLocale: config.defaultLocale,
          basePath: childFullBase,
          locales: config.locales,
          dir: getDirectionForLocale(locale, config)
        } satisfies ExpandedRouteLocaleMeta
      },
      ...(expandedChildren ? { children: expandedChildren } : {})
    };
  });
}

export function expandLocalizedRoutes(
  routes: readonly (RouteRecord | RouteObject)[],
  config: I18nConfig
): RouteObject[] {
  const expanded: RouteObject[] = [];

  for (const route of routes) {
    const rawPath = route.path ?? "/";
    if (rawPath === "*" || rawPath.includes("*")) {
      expanded.push({ ...route });
      continue;
    }

    const allowedLocales = resolveAllowedLocales(route, config);
    if (!allowedLocales || allowedLocales.length === 0) {
      expanded.push({ ...route });
      continue;
    }

    const basePath = normalizePathname(rawPath);
    for (const loc of allowedLocales) {
      const shouldPrefix = loc !== config.defaultLocale || Boolean(config.prefixDefault);
      const localizedPath = shouldPrefix
        ? basePath === "/"
          ? `/${loc}`
          : `/${loc}${basePath}`
        : basePath;
      const dir = getDirectionForLocale(loc, config);
      const clonedChildren = route.children
        ? expandChildRoutes(route.children, loc, config, basePath)
        : undefined;

      expanded.push({
        ...route,
        ...(route.id ? { id: `${route.id}:${loc}` } : {}),
        path: localizedPath,
        meta: {
          ...(route.meta ?? {}),
          __i18n: {
            locale: loc,
            defaultLocale: config.defaultLocale,
            basePath,
            locales: allowedLocales,
            dir
          } satisfies ExpandedRouteLocaleMeta
        },
        ...(clonedChildren ? { children: clonedChildren } : {})
      });
    }
  }

  return expanded;
}
