/**
 * @mix/router — Location Parsing, Query String Helpers & Contexts
 */

import { createContext, validateSafeUrl } from "@mix/runtime";
import type {
  Router,
  RouteRecord,
  RouteObject,
  RouteLocation,
  MatchedRoute,
  RouteMatch,
} from "./types.js";
import { RouteTrie, normalizePath } from "./trie.js";
import { matchRoutes } from "./match.js";

export const RouterContext = createContext<Router | null>(null);
export const RouteDepthContext = createContext<number>(0);
export const RouteMatchesContext = createContext<(() => RouteMatch[]) | null>(null);
export const OutletContextData = createContext<unknown>(undefined);

export function parseQuery(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (!search) return query;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return query;

  const parts = raw.split("&");
  for (const part of parts) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      query[decodeURIComponent(part)] = "";
    } else {
      const key = decodeURIComponent(part.slice(0, eq));
      const val = decodeURIComponent(part.slice(eq + 1));
      query[key] = val;
    }
  }
  return query;
}

export function stringifyQuery(query: Record<string, string>): string {
  const keys = Object.keys(query);
  if (keys.length === 0) return "";
  const pairs = keys.map(
    (k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k] ?? "")}`
  );
  return `?${pairs.join("&")}`;
}

export function parseLocation(
  to: string,
  routesOrTrie: RouteTrie | (RouteRecord | RouteObject)[]
): RouteLocation {
  validateSafeUrl(to);

  const hashIdx = to.indexOf("#");
  const withoutHash = hashIdx === -1 ? to : to.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : to.slice(hashIdx);

  const queryIdx = withoutHash.indexOf("?");
  const pathname = normalizePath(queryIdx === -1 ? withoutHash : withoutHash.slice(0, queryIdx));
  const search = queryIdx === -1 ? "" : withoutHash.slice(queryIdx);

  const query = parseQuery(search);

  let params: Record<string, string> = {};
  const matched: MatchedRoute[] = [];

  if (Array.isArray(routesOrTrie)) {
    const matches = matchRoutes(routesOrTrie as RouteObject[], pathname);
    if (matches) {
      for (const m of matches) {
        Object.assign(params, m.params);
        matched.push({
          record: m.route as RouteRecord,
          route: m.route,
          path: m.pathname,
          pathname: m.pathname,
          pathnameBase: m.pathnameBase,
          params: m.params,
          component: m.route.element ?? m.route.Component ?? m.route.component,
        });
      }
    }
  } else if (routesOrTrie && typeof (routesOrTrie as RouteTrie).match === "function") {
    const matchResult = routesOrTrie.match(pathname);
    if (matchResult) {
      params = matchResult.params;
      matched.push(...matchResult.matched);
    }
  }

  const meta: Record<string, unknown> = {};
  for (const m of matched) {
    if (m.record?.meta) {
      Object.assign(meta, m.record.meta);
    }
  }

  return {
    fullPath: `${pathname}${search}${hash}`,
    pathname,
    search,
    hash,
    params,
    query,
    matched,
    meta,
  };
}

export class MixSearchParams {
  private _query: Record<string, string>;

  constructor(query: Record<string, string>) {
    this._query = query;
    Object.assign(this, query);
  }

  get(name: string): string | null {
    return this._query[name] ?? null;
  }

  has(name: string): boolean {
    return name in this._query;
  }

  getAll(name: string): string[] {
    return name in this._query ? [this._query[name]!] : [];
  }

  entries(): [string, string][] {
    return Object.entries(this._query);
  }

  toString(): string {
    return stringifyQuery(this._query);
  }
}
