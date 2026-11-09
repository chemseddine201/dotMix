/**
 * @mix/router — Production Router Implementation
 */

import {
  createSignal,
  createMemo,
  createContext,
  useContext,
  createCancellationSource,
  validateSafeUrl,
} from "@mix/runtime";
import type {
  CancellationSource,
} from "@mix/runtime";
import type {
  Router,
  RouterOptions,
  RouteRecord,
  RouteLocation,
  NavigationGuard,
  MatchedRoute,
  RouterHistory,
} from "./types.js";
import { RouteTrie, normalizePath } from "./trie.js";
import { createMemoryHistory, createBrowserHistory } from "./history.js";

export const RouterContext = createContext<Router | null>(null);
export const RouteDepthContext = createContext<number>(0);

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

export function parseLocation(to: string, trie: RouteTrie): RouteLocation {
  // Validate URL protocol safety (R-URL-01)
  validateSafeUrl(to);

  const hashIdx = to.indexOf("#");
  const withoutHash = hashIdx === -1 ? to : to.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : to.slice(hashIdx);

  const queryIdx = withoutHash.indexOf("?");
  const pathname = normalizePath(queryIdx === -1 ? withoutHash : withoutHash.slice(0, queryIdx));
  const search = queryIdx === -1 ? "" : withoutHash.slice(queryIdx);

  const query = parseQuery(search);
  const matchResult = trie.match(pathname);

  const params: Record<string, string> = matchResult ? matchResult.params : {};
  const matched: MatchedRoute[] = matchResult ? matchResult.matched : [];

  const meta: Record<string, unknown> = {};
  for (const m of matched) {
    if (m.record.meta) {
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

export function createRouter(options: RouterOptions): Router {
  const history: RouterHistory =
    options.history ??
    (typeof window !== "undefined" ? createBrowserHistory() : createMemoryHistory(options.initialPath ?? "/"));

  const trie = new RouteTrie(options.routes);
  const initialLoc = parseLocation(history.location || options.initialPath || "/", trie);

  const currentRoute = createSignal<RouteLocation>(initialLoc);
  const beforeEachGuards: NavigationGuard[] = [];
  if (options.beforeEach) {
    beforeEachGuards.push(options.beforeEach);
  }

  let navGeneration = 0;
  let activeSource: CancellationSource | null = null;
  let unlistenHistory: (() => void) | null = null;

  async function navigateTo(to: string, isReplace: boolean, fromHistory = false): Promise<boolean> {
    // Increment generation and cancel previous in-flight navigation (D-104)
    if (activeSource) {
      activeSource.cancel("MIX_ROUTER_CANCELLED");
      activeSource = null;
    }

    const gen = ++navGeneration;
    const source = createCancellationSource(null);
    activeSource = source;
    const token = source.token;

    const targetLoc = parseLocation(to, trie);
    const fromLoc = currentRoute();

    // Collect all guards: global beforeEach + route-level beforeEnter
    const allGuards: NavigationGuard[] = [...beforeEachGuards];
    for (const m of targetLoc.matched) {
      if (m.record.beforeEnter) {
        allGuards.push(m.record.beforeEnter);
      }
    }

    for (const guard of allGuards) {
      if (token.isCancelled || navGeneration !== gen) {
        return false;
      }
      try {
        const res = await guard(targetLoc, fromLoc, token);
        if (token.isCancelled || navGeneration !== gen) {
          return false;
        }
        if (res === false) {
          return false;
        }
        if (typeof res === "string") {
          return navigateTo(res, true, false);
        }
      } catch (err) {
        console.error("Navigation guard error:", err);
        return false;
      }
    }

    if (token.isCancelled || navGeneration !== gen) {
      return false;
    }

    // Guards passed! Commit navigation
    if (!fromHistory) {
      if (isReplace) {
        history.replace(targetLoc.fullPath);
      } else {
        history.push(targetLoc.fullPath);
      }
    }

    currentRoute.set(targetLoc);
    activeSource = null;
    return true;
  }

  // Synchronize history popstate/hashchange events
  unlistenHistory = history.listen((loc) => {
    void navigateTo(loc, false, true);
  });

  const router: Router = {
    get routes(): RouteRecord[] {
      return options.routes;
    },
    get history(): RouterHistory {
      return history;
    },
    get currentRoute(): () => RouteLocation {
      return currentRoute;
    },
    push(to: string): Promise<boolean> {
      return navigateTo(to, false, false);
    },
    replace(to: string): Promise<boolean> {
      return navigateTo(to, true, false);
    },
    back(): void {
      history.back();
    },
    forward(): void {
      history.forward();
    },
    go(delta: number): void {
      history.go(delta);
    },
    beforeEach(guard: NavigationGuard): () => void {
      beforeEachGuards.push(guard);
      return () => {
        const idx = beforeEachGuards.indexOf(guard);
        if (idx !== -1) beforeEachGuards.splice(idx, 1);
      };
    },
    resolve(to: string): RouteLocation {
      return parseLocation(to, trie);
    },
    destroy(): void {
      if (activeSource) {
        activeSource.cancel("MIX_ROUTER_DESTROYED");
        activeSource = null;
      }
      if (unlistenHistory) {
        unlistenHistory();
        unlistenHistory = null;
      }
      history.destroy();
    },
  };

  return router;
}

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (!router) {
    throw new Error("[@mix/router] useRouter() called outside of a RouterProvider/RouterContext");
  }
  return router;
}

export function useRoute(): () => RouteLocation {
  const router = useRouter();
  return router.currentRoute;
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): () => T {
  const route = useRoute();
  return createMemo(() => route().params as T);
}

export function useSearchParams(): [() => Record<string, string>, (params: Record<string, string>) => void] {
  const router = useRouter();
  const route = router.currentRoute;
  const searchParams = createMemo(() => route().query);

  const setSearchParams = (newParams: Record<string, string>) => {
    const cur = route();
    const queryStr = stringifyQuery(newParams);
    const target = `${cur.pathname}${queryStr}${cur.hash}`;
    void router.push(target);
  };

  return [searchParams, setSearchParams];
}

export function useNavigate(): (to: string, options?: { replace?: boolean }) => Promise<boolean> {
  const router = useRouter();
  return (to: string, options?: { replace?: boolean }) => {
    if (options?.replace) {
      return router.replace(to);
    }
    return router.push(to);
  };
}
