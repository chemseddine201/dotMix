/**
 * @mix/router — Reactive Router & Data Router Hooks
 */

import { createMemo, useContext } from "@mix/runtime";
import type {
  Router,
  RouteLocation,
  Location,
  NavigateFunction,
  NavigateOptions,
  To,
  PathPattern,
  PathMatch,
  NavigationState,
  SubmitOptions,
} from "./types.js";
import { matchPath, resolvePath } from "./match.js";
import {
  RouterContext,
  RouteDepthContext,
  RouteMatchesContext,
  OutletContextData,
  MixSearchParams,
  stringifyQuery,
} from "./location.js";

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
