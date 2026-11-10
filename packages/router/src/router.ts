/**
 * @mix/router — Production Router Implementation (React Router v6/v7 Parity)
 */

import {
  createSignal,
  createEffect,
  createRoot,
  createCancellationSource,
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
  NavigationGuard,
  RouterHistory,
  NavigationState,
  SubmitOptions,
} from "./types.js";
import { createMemoryHistory, createBrowserHistory, createHashHistory } from "./history.js";
import { parseLocation } from "./location.js";
import { checkLocationPermissions, resolveRouteLazy } from "./guards.js";

export * from "./location.js";
export * from "./guards.js";
export * from "./hooks.js";

export function createRouter(options: RouterOptions): Router {
  const history: RouterHistory =
    options.history ??
    (typeof window !== "undefined" ? createBrowserHistory() : createMemoryHistory(options.initialPath ?? "/"));

  const routes = options.routes || [];
  let isInternalNav = false;
  let currentAbility = options.ability;
  const abilitySignal = createSignal<unknown>(options.ability);

  let initialLoc = parseLocation(history.location || options.initialPath || "/", routes);
  // Enforce route permissions synchronously during router initialization before mounting or running loaders
  for (let hop = 0; hop < 10; hop++) {
    const permCheck = checkLocationPermissions(initialLoc, currentAbility);
    if (permCheck.allowed) {
      break;
    }
    const redirectTarget = permCheck.redirectTo ?? "/";
    isInternalNav = true;
    try {
      history.replace(redirectTarget);
    } finally {
      isInternalNav = false;
    }
    initialLoc = parseLocation(redirectTarget, routes);
  }

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
  let disposeAbilitySubscription: (() => void) | null = null;

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
    const permCheck = checkLocationPermissions(targetLoc, currentAbility);
    if (!permCheck.allowed) {
      navigation.set({ state: "idle" });
      activeSource = null;
      if (permCheck.redirectTo) {
        return navigateTo(permCheck.redirectTo, true, false);
      }
      if (fromHistory) {
        isInternalNav = true;
        try {
          history.replace(fromLoc.fullPath);
        } finally {
          isInternalNav = false;
        }
      }
      return false;
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

  // Reactively re-evaluate permissions when abilitySignal or currentRoute changes
  createRoot((dispose) => {
    disposeAbilitySubscription = dispose;
    createEffect(() => {
      const ab = abilitySignal();
      const loc = currentRoute();
      const permCheck = checkLocationPermissions(loc, ab);
      if (!permCheck.allowed) {
        void navigateTo(permCheck.redirectTo ?? "/", true, false);
      }
    });
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
      abilitySignal.set(() => ability);
    },
    destroy(): void {
      if (activeSource) {
        activeSource.cancel("MIX_ROUTER_DESTROYED");
        activeSource = null;
      }
      if (disposeAbilitySubscription) {
        disposeAbilitySubscription();
        disposeAbilitySubscription = null;
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
