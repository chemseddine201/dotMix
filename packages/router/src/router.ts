/**
 * @mix/router — Production Router Implementation (React Router v6/v7 Parity)
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
  CancellationToken,
} from "@mix/runtime";
import type {
  Router,
  RouterOptions,
  BrowserRouterOptions,
  HashRouterOptions,
  MemoryRouterOptions,
  RouteRecord,
  RouteObject,
  RouteLocation,
  Location,
  NavigationGuard,
  MatchedRoute,
  RouteMatch,
  RouterHistory,
  NavigateFunction,
  NavigateOptions,
  To,
  PathPattern,
  PathMatch,
  NavigationState,
  SubmitOptions,
} from "./types.js";
import { RouteTrie, normalizePath } from "./trie.js";
import { createMemoryHistory, createBrowserHistory, createHashHistory } from "./history.js";
import { matchRoutes, matchPath, resolvePath } from "./match.js";

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

export function createRouter(options: RouterOptions): Router {
  const history: RouterHistory =
    options.history ??
    (typeof window !== "undefined" ? createBrowserHistory() : createMemoryHistory(options.initialPath ?? "/"));

  const routes = options.routes || [];
  const initialLoc = parseLocation(history.location || options.initialPath || "/", routes);

  const currentRoute = createSignal<RouteLocation>(initialLoc);
  const navigation = createSignal<NavigationState>({ state: "idle" });
  const loaderData = createSignal<Record<string, unknown>>({});
  const actionData = createSignal<unknown>(undefined);
  const revalidationKey = createSignal<number>(0);

  const beforeEachGuards: NavigationGuard[] = [];
  if (options.beforeEach) {
    beforeEachGuards.push(options.beforeEach);
  }

  let navGeneration = 0;
  let activeSource: CancellationSource | null = null;
  let unlistenHistory: (() => void) | null = null;
  let isInternalNav = false;
  let currentAbility = options.ability;

  async function resolveRouteLazy(route: RouteObject): Promise<void> {
    if (route.lazy && typeof route.lazy === "function") {
      const res = await route.lazy();
      if (res.default) route.component = res.default;
      if (res.Component) route.Component = res.Component;
      if (res.loader) route.loader = res.loader;
      if (res.action) route.action = res.action;
      route.lazy = undefined;
    }
  }

  async function runLoaders(targetLoc: RouteLocation, token: CancellationToken): Promise<Record<string, unknown> | null> {
    const results: Record<string, unknown> = {};
    for (const m of targetLoc.matched) {
      const r = m.route;
      if (r.lazy) {
        await resolveRouteLazy(r);
        if (token.isCancelled) return null;
      }
      if (r.loader && typeof r.loader === "function") {
        const key = r.id ?? r.path ?? targetLoc.pathname;
        const res = await r.loader({
          params: targetLoc.params,
          request: { url: targetLoc.fullPath, method: "GET" },
          cancellationToken: token,
        });
        if (token.isCancelled) return null;
        results[key] = res;
      }
    }
    return results;
  }

  async function navigateTo(to: string, isReplace: boolean, fromHistory = false): Promise<boolean> {
    if (activeSource) {
      activeSource.cancel("MIX_ROUTER_CANCELLED");
      activeSource = null;
    }

    const gen = ++navGeneration;
    const source = createCancellationSource(null);
    activeSource = source;
    const token = source.token;

    const targetLoc = parseLocation(to, routes);
    const fromLoc = currentRoute();
    navigation.set({ state: "loading", location: targetLoc });

    // Check route permissions before any guards or loaders run
    for (const m of targetLoc.matched) {
      const perm = m.route.permissions;
      if (perm) {
        let ab: unknown = currentAbility;
        if (typeof ab === "function") {
          ab = (ab as () => unknown)();
        }
        if (ab && typeof (ab as { can?: unknown }).can === "function") {
          const allowed = (ab as { can: (a: string, s: string, f?: string) => boolean }).can(
            perm.action,
            perm.subject,
            perm.field
          );
          if (!allowed) {
            navigation.set({ state: "idle" });
            activeSource = null;
            if (perm.redirectTo) {
              return navigateTo(perm.redirectTo, true, false);
            }
            return false;
          }
        }
      }
    }

    const allGuards: NavigationGuard[] = [...beforeEachGuards];
    for (const m of targetLoc.matched) {
      if (m.record?.beforeEnter) {
        allGuards.push(m.record.beforeEnter);
      }
    }

    const hasLoadersOrLazy = targetLoc.matched.some(
      (m) => Boolean(m.route.lazy || m.route.loader)
    );

    if (allGuards.length === 0 && !hasLoadersOrLazy) {
      if (!fromHistory) {
        isInternalNav = true;
        try {
          if (isReplace) {
            history.replace(targetLoc.fullPath);
          } else {
            history.push(targetLoc.fullPath);
          }
        } finally {
          isInternalNav = false;
        }
      }

      currentRoute.set(targetLoc);
      navigation.set({ state: "idle" });
      activeSource = null;
      return true;
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
          navigation.set({ state: "idle" });
          return false;
        }
        if (typeof res === "string") {
          return navigateTo(res, true, false);
        }
      } catch (err) {
        console.error("Navigation guard error:", err);
        navigation.set({ state: "idle" });
        return false;
      }
    }

    if (token.isCancelled || navGeneration !== gen) {
      return false;
    }

    const loaded = await runLoaders(targetLoc, token);
    if (token.isCancelled || navGeneration !== gen) {
      return false;
    }

    if (loaded) {
      loaderData.set((prev) => ({ ...prev, ...loaded }));
    }

    if (!fromHistory) {
      isInternalNav = true;
      try {
        if (isReplace) {
          history.replace(targetLoc.fullPath);
        } else {
          history.push(targetLoc.fullPath);
        }
      } finally {
        isInternalNav = false;
      }
    }

    currentRoute.set(targetLoc);
    navigation.set({ state: "idle" });
    activeSource = null;
    return true;
  }

  unlistenHistory = history.listen((loc) => {
    if (!isInternalNav && loc !== currentRoute().fullPath) {
      void navigateTo(loc, false, true);
    }
  });

  const router: Router = {
    get routes(): (RouteRecord | RouteObject)[] {
      return routes;
    },
    get history(): RouterHistory {
      return history;
    },
    get currentRoute(): () => RouteLocation {
      return currentRoute;
    },
    get navigation(): () => NavigationState {
      return navigation;
    },
    get loaderData(): () => Record<string, unknown> {
      return loaderData;
    },
    get actionData(): () => unknown {
      return actionData;
    },
    get revalidationKey(): () => number {
      return revalidationKey;
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
      return parseLocation(to, routes);
    },
    async submit(target: unknown, opts?: SubmitOptions): Promise<unknown> {
      const gen = ++navGeneration;
      const source = createCancellationSource(null);
      activeSource = source;
      const token = source.token;

      const loc = currentRoute();
      navigation.set({ state: "submitting", location: loc });

      let actionRoute: RouteObject | null = null;
      for (let i = loc.matched.length - 1; i >= 0; i--) {
        const r = loc.matched[i]!.route;
        if (r.lazy) {
          await resolveRouteLazy(r);
        }
        if (r.action) {
          actionRoute = r;
          break;
        }
      }

      if (!actionRoute || !actionRoute.action) {
        navigation.set({ state: "idle" });
        return undefined;
      }

      try {
        const res = await actionRoute.action({
          params: loc.params,
          request: { url: loc.fullPath, method: opts?.method ?? "POST", body: target },
          cancellationToken: token,
        });
        if (token.isCancelled || navGeneration !== gen) {
          return undefined;
        }
        actionData.set(res);

        // Revalidate loaders on submission
        const reloaded = await runLoaders(loc, token);
        if (reloaded && !token.isCancelled && navGeneration === gen) {
          loaderData.set((prev) => ({ ...prev, ...reloaded }));
          revalidationKey.set((k) => k + 1);
          currentRoute.set({ ...loc });
        }

        navigation.set({ state: "idle" });
        return res;
      } catch (err) {
        navigation.set({ state: "idle" });
        throw err;
      }
    },
    async prefetchRoute(to: string): Promise<void> {
      const source = createCancellationSource(null);
      const targetLoc = parseLocation(to, routes);
      await runLoaders(targetLoc, source.token);
    },
    get ability() {
      return currentAbility;
    },
    setAbility(ability: unknown): void {
      currentAbility = ability;
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

export function createBrowserRouter(
  routesOrOptions: (RouteRecord | RouteObject)[] | BrowserRouterOptions,
  options: BrowserRouterOptions = {}
): Router {
  let routes: (RouteRecord | RouteObject)[] = [];
  let opts: BrowserRouterOptions = options;
  if (Array.isArray(routesOrOptions)) {
    routes = routesOrOptions;
  } else if (routesOrOptions && typeof routesOrOptions === "object") {
    routes = routesOrOptions.routes ?? [];
    opts = { ...routesOrOptions, ...options };
  }
  const history = createBrowserHistory();
  return createRouter({
    ...opts,
    routes,
    history,
  });
}

export function createHashRouter(
  routesOrOptions: (RouteRecord | RouteObject)[] | HashRouterOptions,
  options: HashRouterOptions = {}
): Router {
  let routes: (RouteRecord | RouteObject)[] = [];
  let opts: HashRouterOptions = options;
  if (Array.isArray(routesOrOptions)) {
    routes = routesOrOptions;
  } else if (routesOrOptions && typeof routesOrOptions === "object") {
    routes = routesOrOptions.routes ?? [];
    opts = { ...routesOrOptions, ...options };
  }
  const history = createHashHistory();
  return createRouter({
    ...opts,
    routes,
    history,
  });
}

export function createMemoryRouter(
  routesOrOptions: (RouteRecord | RouteObject)[] | MemoryRouterOptions,
  options: MemoryRouterOptions = {}
): Router {
  let routes: (RouteRecord | RouteObject)[] = [];
  let opts: MemoryRouterOptions = options;
  if (Array.isArray(routesOrOptions)) {
    routes = routesOrOptions;
  } else if (routesOrOptions && typeof routesOrOptions === "object") {
    routes = routesOrOptions.routes ?? [];
    opts = { ...routesOrOptions, ...options };
  }
  const initialPath =
    opts.initialEntries && opts.initialEntries.length > 0
      ? opts.initialEntries[opts.initialIndex ?? 0]!
      : opts.initialPath ?? "/";
  const history = createMemoryHistory(initialPath);
  return createRouter({
    ...opts,
    routes,
    history,
  });
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

export function useLocation(): (() => Location) & Location {
  const route = useRoute();
  const fn = (() => route()) as unknown as (() => Location) & Location;
  Object.defineProperties(fn, {
    pathname: { get: () => route().pathname, enumerable: true },
    search: { get: () => route().search, enumerable: true },
    hash: { get: () => route().hash, enumerable: true },
    state: { get: () => route().state, enumerable: true },
    key: { get: () => route().key, enumerable: true },
  });
  return fn;
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): (() => T) & T {
  const route = useRoute();
  const memo = createMemo(() => route().params as T);
  const fn = (() => memo()) as (() => T) & T;
  const proxy = new Proxy(fn, {
    apply(_target, _thisArg, _argList) {
      return memo();
    },
    get(_target, prop, receiver) {
      if (prop === "then" || typeof prop === "symbol") {
        return Reflect.get(fn, prop, receiver);
      }
      const params = memo();
      if (prop in params) {
        return params[prop as string];
      }
      return Reflect.get(fn, prop, receiver);
    },
  });
  return proxy as unknown as (() => T) & T;
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

export function useSearchParams(): [
  (() => MixSearchParams & Record<string, string>) & MixSearchParams,
  (params: Record<string, string>, options?: NavigateOptions) => void
] {
  const router = useRouter();
  const route = router.currentRoute;
  const memo = createMemo(() => new MixSearchParams(route().query) as MixSearchParams & Record<string, string>);

  const fn = (() => memo()) as (() => MixSearchParams & Record<string, string>) & MixSearchParams;
  const proxy = new Proxy(fn, {
    apply(_target, _thisArg, _argList) {
      return memo();
    },
    get(_target, prop, receiver) {
      if (prop === "then" || typeof prop === "symbol") {
        return Reflect.get(fn, prop, receiver);
      }
      const instance = memo();
      if (prop in instance) {
        return Reflect.get(instance, prop);
      }
      return Reflect.get(fn, prop, receiver);
    },
  });

  const setSearchParams = (
    newParams: Record<string, string>,
    options?: NavigateOptions
  ) => {
    const cur = route();
    const queryStr = stringifyQuery(newParams);
    const target = `${cur.pathname}${queryStr}${cur.hash}`;
    if (options?.replace) {
      void router.replace(target);
    } else {
      void router.push(target);
    }
  };

  return [proxy as unknown as (() => MixSearchParams & Record<string, string>) & MixSearchParams, setSearchParams];
}

export function useNavigate(): NavigateFunction {
  const router = useRouter();
  const navFn = (to: To | number, options?: NavigateOptions) => {
    if (typeof to === "number") {
      router.go(to);
      return;
    }
    const resolved = resolvePath(to, router.currentRoute().pathname);
    const pathStr = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    if (options?.replace) {
      return router.replace(pathStr);
    }
    return router.push(pathStr);
  };
  return navFn as NavigateFunction;
}

export function useMatch(pattern: string | PathPattern): (() => PathMatch | null) & { readonly match: PathMatch | null } {
  const route = useRoute();
  const memo = createMemo(() => matchPath(pattern, route().pathname));
  const fn = (() => memo()) as (() => PathMatch | null) & { readonly match: PathMatch | null };
  Object.defineProperty(fn, "match", {
    get: () => memo(),
    enumerable: true,
  });
  return fn;
}

export function useOutletContext<T = unknown>(): T {
  return useContext(OutletContextData) as T;
}

export function useOutlet(): unknown {
  const router = useRouter();
  const depth = useContext(RouteDepthContext);
  const matchesFn = useContext(RouteMatchesContext);
  const matches = matchesFn ? matchesFn() : router.currentRoute().matched;
  const childMatch = matches[depth + 1];
  if (!childMatch) return null;
  return (
    childMatch.route.element ??
    childMatch.route.Component ??
    childMatch.route.component ??
    (childMatch as { component?: unknown }).component
  );
}

// ============================================================================
// Phase 20 Data Router Hooks (D-123)
// ============================================================================

export function useLoaderData<T = unknown>(routeId?: string): T | undefined {
  const router = useRouter();
  const allData = router.loaderData();
  if (routeId) {
    return allData[routeId] as T | undefined;
  }
  const current = router.currentRoute();
  const leaf = current.matched[current.matched.length - 1];
  const key = leaf?.route?.id ?? leaf?.record?.id ?? leaf?.path ?? current.pathname;
  return allData[key] as T | undefined;
}

export function useActionData<T = unknown>(): T | undefined {
  const router = useRouter();
  return router.actionData() as T | undefined;
}

export function useNavigation(): NavigationState {
  const router = useRouter();
  return router.navigation();
}

export function useSubmit(): (target: unknown, options?: SubmitOptions) => Promise<unknown> {
  const router = useRouter();
  return (target, options) => router.submit(target, options);
}

export function useHead(meta: { title?: string | undefined; meta?: Array<Record<string, string>> | undefined }): void {
  if (typeof document === "undefined") return;
  if (meta.title !== undefined) {
    document.title = meta.title;
  }
  if (meta.meta) {
    for (const item of meta.meta) {
      if (item.name) {
        let el = document.querySelector(`meta[name="${item.name}"]`) as HTMLMetaElement | null;
        if (!el) {
          el = document.createElement("meta");
          el.name = item.name;
          document.head.appendChild(el);
        }
        if (item.content !== undefined) {
          el.content = item.content;
        }
      }
    }
  }
}

