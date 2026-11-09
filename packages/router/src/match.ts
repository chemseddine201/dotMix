/**
 * @mix/router — React Router Route Matching and Scoring Engine
 *
 * Implements React Router v6/v7 route ranking, segment scoring,
 * dynamic parameter extraction (:id), splat capturing (*),
 * and route element tree generation.
 */

import type { RouteObject, RouteMatch, Location, To, NavigationGuard, PathPattern, PathMatch } from "./types.js";
import { normalizePath, joinPaths } from "./trie.js";

interface RouteBranch {
  routesMeta: RouteMeta[];
  score: number;
}

interface RouteMeta {
  relativePath: string;
  caseSensitive?: boolean | undefined;
  childrenIndex: number;
  route: RouteObject;
}

function computeSegmentScore(segment: string, isIndex?: boolean): number {
  if (segment === "") {
    return isIndex ? 2 : 1;
  }
  if (segment === "*" || segment.startsWith("*")) {
    return -2;
  }
  if (segment.startsWith(":")) {
    return 3;
  }
  return 10;
}

function computeScore(path: string, isIndex?: boolean): number {
  const segments = path.split("/").filter(Boolean);
  let initialScore = segments.length;
  if (isIndex) {
    initialScore += 2;
  }
  return segments.reduce((score, segment) => score + computeSegmentScore(segment), initialScore);
}

function flattenRoutes(
  routes: RouteObject[],
  branches: RouteBranch[] = [],
  parentsMeta: RouteMeta[] = [],
  parentPath = ""
): RouteBranch[] {
  routes.forEach((route, index) => {
    const meta: RouteMeta = {
      relativePath: route.path || "",
      caseSensitive: route.caseSensitive,
      childrenIndex: index,
      route,
    };

    const combinedPath = joinPaths(parentPath, meta.relativePath);
    const routesMeta = parentsMeta.concat(meta);

    if (route.children && route.children.length > 0) {
      flattenRoutes(route.children, branches, routesMeta, combinedPath);
    }

    if (route.path !== undefined || route.index) {
      branches.push({
        routesMeta,
        score: computeScore(combinedPath, route.index),
      });
    }
  });

  return branches;
}

function rankRouteBranches(branches: RouteBranch[]): void {
  branches.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    for (let i = 0; i < a.routesMeta.length; i++) {
      const aIndex = a.routesMeta[i]?.childrenIndex ?? 0;
      const bIndex = b.routesMeta[i]?.childrenIndex ?? 0;
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }
    }
    return 0;
  });
}

function matchRouteBranch(
  branch: RouteBranch,
  pathname: string
): RouteMatch[] | null {
  const { routesMeta } = branch;
  const matchedParams: Record<string, string> = {};
  let matchedPathname = "/";
  const matches: RouteMatch[] = [];

  for (let i = 0; i < routesMeta.length; i++) {
    const meta = routesMeta[i]!;
    const end = i === routesMeta.length - 1;
    const remainingPathname =
      matchedPathname === "/"
        ? pathname
        : pathname.slice(matchedPathname.length) || "/";

    const match = matchPath(
      {
        path: meta.relativePath,
        caseSensitive: meta.caseSensitive,
        end,
      },
      remainingPathname
    );

    if (!match) {
      return null;
    }

    Object.assign(matchedParams, match.params);
    matches.push({
      params: matchedParams,
      pathname: joinPaths(matchedPathname, match.pathname),
      pathnameBase: normalizePath(
        joinPaths(matchedPathname, match.pathnameBase)
      ),
      route: meta.route,
    });

    if (match.pathnameBase !== "/") {
      matchedPathname = joinPaths(matchedPathname, match.pathnameBase);
    }
  }

  return matches;
}

export function matchPath(pattern: PathPattern | string, pathname: string): PathMatch | null {
  const pathObj: PathPattern = typeof pattern === "string" ? { path: pattern } : pattern;
  const { path: rawPath = "/", caseSensitive = false, end = true } = pathObj;

  const cleanPath = normalizePath(rawPath);
  const cleanPathname = normalizePath(pathname);

  const patternSegments = cleanPath.split("/").filter(Boolean);
  const pathnameSegments = cleanPathname.split("/").filter(Boolean);

  const isSplat = patternSegments.length > 0 && patternSegments[patternSegments.length - 1]!.startsWith("*");
  if (!isSplat && end && patternSegments.length !== pathnameSegments.length) {
    return null;
  }
  if (!isSplat && !end && pathnameSegments.length < patternSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};
  const matchedSegments: string[] = [];

  for (let i = 0; i < patternSegments.length; i++) {
    const pSeg = patternSegments[i]!;
    if (pSeg === "*" || pSeg.startsWith("*")) {
      const remaining = pathnameSegments.slice(i).join("/");
      params["*"] = remaining;
      const splatName = pSeg.slice(1);
      if (splatName && splatName !== "*") {
        params[splatName] = remaining;
      }
      matchedSegments.push(...pathnameSegments.slice(i));
      break;
    }

    const pathSeg = pathnameSegments[i];
    if (pathSeg === undefined) {
      return null;
    }

    if (pSeg.startsWith(":")) {
      const paramName = pSeg.slice(1);
      params[paramName] = pathSeg;
      matchedSegments.push(pathSeg);
    } else {
      const match = caseSensitive
        ? pSeg === pathSeg
        : pSeg.toLowerCase() === pathSeg.toLowerCase();
      if (!match) {
        return null;
      }
      matchedSegments.push(pathSeg);
    }
  }

  const matchedStr = "/" + matchedSegments.join("/");
  return {
    params,
    pathname: matchedStr,
    pathnameBase: isSplat ? "/" + patternSegments.slice(0, -1).join("/") : matchedStr,
    pattern: pathObj,
  };
}

export function matchRoutes(
  routes: RouteObject[],
  location: string | Location,
  basename = ""
): RouteMatch[] | null {
  const pathname = typeof location === "string" ? location : location.pathname;
  const cleanPathname = normalizePath(
    basename && pathname.startsWith(basename)
      ? pathname.slice(basename.length) || "/"
      : pathname
  );

  const branches = flattenRoutes(routes);
  rankRouteBranches(branches);

  for (const branch of branches) {
    const matches = matchRouteBranch(branch, cleanPathname);
    if (matches) {
      return matches;
    }
  }

  return null;
}

export function resolvePath(
  to: To,
  fromPathname = "/"
): { pathname: string; search: string; hash: string } {
  const toStr =
    typeof to === "string"
      ? to
      : `${to.pathname || ""}${to.search || ""}${to.hash || ""}`;

  const hashIdx = toStr.indexOf("#");
  const withoutHash = hashIdx === -1 ? toStr : toStr.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : toStr.slice(hashIdx);

  const queryIdx = withoutHash.indexOf("?");
  const pathnamePart =
    queryIdx === -1 ? withoutHash : withoutHash.slice(0, queryIdx);
  const search = queryIdx === -1 ? "" : withoutHash.slice(queryIdx);

  let pathname = pathnamePart;
  if (!pathname.startsWith("/")) {
    const fromSegments = fromPathname.split("/").filter(Boolean);
    const toSegments = pathname.split("/").filter(Boolean);
    for (const seg of toSegments) {
      if (seg === "..") {
        fromSegments.pop();
      } else if (seg !== ".") {
        fromSegments.push(seg);
      }
    }
    pathname = "/" + fromSegments.join("/");
  }

  return {
    pathname: normalizePath(pathname),
    search,
    hash,
  };
}

export function generatePath(
  path: string,
  params: Record<string, string> = {}
): string {
  return path
    .replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
      if (!(key in params)) {
        throw new Error(`Missing parameter :${key} for path ${path}`);
      }
      return encodeURIComponent(params[key]!);
    })
    .replace(/\*([a-zA-Z0-9_]*)/g, (_, key) => {
      const splatKey = key || "*";
      if (!(splatKey in params)) {
        throw new Error(`Missing splat parameter * for path ${path}`);
      }
      return params[splatKey]!;
    });
}

export interface RouteProps {
  path?: string | undefined;
  index?: boolean | undefined;
  element?: unknown | undefined;
  Component?: unknown | undefined;
  caseSensitive?: boolean | undefined;
  children?: unknown | undefined;
  id?: string | undefined;
  [key: string]: unknown;
}

export function Route(props: RouteProps): { props: RouteProps; type: typeof Route } {
  return { props, type: Route };
}

export function createRoutesFromElements(children: unknown): RouteObject[] {
  const routes: RouteObject[] = [];
  if (!children) return routes;

  const childList = Array.isArray(children)
    ? children
    : typeof children === "object" && children !== null && "children" in children && Array.isArray((children as { children: unknown[] }).children)
    ? (children as { children: unknown[] }).children
    : [children];

  for (const child of childList) {
    if (!child) continue;

    const evaluated = typeof child === "function" ? (child as () => unknown)() : child;
    if (!evaluated) continue;

    if (Array.isArray(evaluated)) {
      routes.push(...createRoutesFromElements(evaluated));
      continue;
    }

    const obj = evaluated as {
      props?: Record<string, unknown> | undefined;
      type?: unknown;
      path?: string | undefined;
      element?: unknown | undefined;
      Component?: unknown | undefined;
      component?: unknown | undefined;
      index?: boolean | undefined;
      children?: unknown | undefined;
      caseSensitive?: boolean | undefined;
      id?: string | undefined;
      meta?: Record<string, unknown> | undefined;
      beforeEnter?: unknown | undefined;
    };

    const props = obj.props || obj;
    const route: RouteObject = {
      path: typeof props.path === "string" ? props.path : undefined,
      index: Boolean(props.index),
      element: props.element ?? props.Component ?? props.component,
      Component: props.Component ?? props.element ?? props.component,
      caseSensitive: Boolean(props.caseSensitive),
      id: typeof props.id === "string" ? props.id : undefined,
      meta: (props.meta as Record<string, unknown> | undefined) || undefined,
      beforeEnter: props.beforeEnter as NavigationGuard | undefined,
    };

    if (props.children) {
      route.children = createRoutesFromElements(props.children);
    }

    routes.push(route);
  }

  return routes;
}

export const createRoutesFromChildren = createRoutesFromElements;
