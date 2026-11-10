/**
 * @mix/router — Route Outlet, Routes Tree & Declarative Navigate Components
 */

import {
  createEffect,
  createRoot,
  createMemo,
  provideContext,
  useContext,
} from "@mix/runtime";
import type {
  RouteObject,
  RouteRecord,
  To,
} from "./types.js";
import {
  RouteDepthContext,
  RouteMatchesContext,
  OutletContextData,
  useRouter,
  useNavigate,
} from "./router.js";
import { matchRoutes, createRoutesFromElements } from "./match.js";
import { renderRouteContent } from "./providers.js";

export function useRoutes(
  routes: RouteObject[],
  locationArg?: string | { pathname: string; search?: string | undefined; hash?: string | undefined }
): Node {
  const router = useRouter();
  if (typeof document === "undefined") {
    throw new Error("[@mix/router] useRoutes requires a DOM environment");
  }

  const fragment = document.createDocumentFragment();
  const anchor = document.createComment("routes-anchor");
  fragment.appendChild(anchor);

  const locMemo = createMemo(() => {
    if (locationArg) {
      return typeof locationArg === "string"
        ? { pathname: locationArg, search: "", hash: "" }
        : {
            pathname: locationArg.pathname,
            search: locationArg.search || "",
            hash: locationArg.hash || "",
          };
    }
    return router.currentRoute();
  });

  const matchesMemo = createMemo(() => {
    return matchRoutes(routes, locMemo()) || [];
  });

  provideContext(RouteMatchesContext, matchesMemo);
  provideContext(RouteDepthContext, 0);

  let currentRecord: unknown = null;
  let currentDisposer: (() => void) | null = null;
  let currentRenderedNodes: Node[] = [];

  createEffect(() => {
    const matches = matchesMemo();
    const topMatch = matches[0];
    const nextRecord = topMatch ? topMatch.route : null;

    if (nextRecord === currentRecord && currentRenderedNodes.length > 0) {
      return;
    }
    currentRecord = nextRecord;

    if (currentDisposer) {
      currentDisposer();
      currentDisposer = null;
    }
    for (const node of currentRenderedNodes) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
    currentRenderedNodes = [];

    if (topMatch) {
      createRoot((dispose) => {
        currentDisposer = dispose;
        provideContext(RouteMatchesContext, matchesMemo);
        provideContext(RouteDepthContext, 1);

        const comp =
          topMatch.route.element ??
          topMatch.route.Component ??
          topMatch.route.component;
        const nodes = renderRouteContent(comp, {
          route: locMemo(),
          params: topMatch.params,
        });

        if (nodes.length > 0) {
          currentRenderedNodes = nodes;
          const parent = anchor.parentNode ?? fragment;
          for (const node of nodes) {
            parent.insertBefore(node, anchor);
          }
        }
      });
    }
  });

  return fragment;
}

export interface RoutesProps {
  children?: unknown;
  location?: string | { pathname: string; search?: string | undefined; hash?: string | undefined };
}

export function Routes(props: RoutesProps): Node {
  const routes = createRoutesFromElements(props.children);
  return useRoutes(routes, props.location);
}

export interface OutletProps {
  context?: unknown;
  fallback?: unknown;
}

export function Outlet(props: OutletProps = {}): Node {
  const router = useRouter();
  const depth = useContext(RouteDepthContext);
  const matchesContext = useContext(RouteMatchesContext);

  if (typeof document === "undefined") {
    throw new Error("[@mix/router] Outlet requires a DOM environment");
  }

  const fragment = document.createDocumentFragment();
  const anchor = document.createComment(`outlet-depth-${depth}`);
  fragment.appendChild(anchor);

  let currentRecord: unknown = null;
  let currentDisposer: (() => void) | null = null;
  let currentRenderedNodes: Node[] = [];
  let lastReval = 0;

  createEffect(() => {
    const reval = (router.revalidationKey ? router.revalidationKey() : 0) ?? 0;
    const matches = matchesContext
      ? matchesContext()
      : router.currentRoute().matched;
    const matched = matches[depth];
    const nextRecord = matched
      ? ((matched as { record?: RouteRecord }).record ?? matched.route)
      : null;

    if (nextRecord === currentRecord && currentRenderedNodes.length > 0 && reval === lastReval) {
      return;
    }
    lastReval = reval;
    currentRecord = nextRecord;

    if (currentDisposer) {
      currentDisposer();
      currentDisposer = null;
    }
    for (const node of currentRenderedNodes) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
    currentRenderedNodes = [];

    if (matched) {
      createRoot((dispose) => {
        currentDisposer = dispose;
        if (matchesContext) {
          provideContext(RouteMatchesContext, matchesContext);
        }
        provideContext(RouteDepthContext, depth + 1);
        if (props.context !== undefined) {
          provideContext(OutletContextData, props.context);
        }

        const comp =
          matched.route?.element ??
          matched.route?.Component ??
          matched.route?.component ??
          (matched as { component?: unknown }).component ??
          (matched as { record?: { component?: unknown } }).record?.component;

        const nodes = renderRouteContent(comp, {
          route: router.currentRoute(),
          params: matched.params,
        });

        if (nodes.length > 0) {
          currentRenderedNodes = nodes;
          const parent = anchor.parentNode ?? fragment;
          for (const node of nodes) {
            parent.insertBefore(node, anchor);
          }
        }
      });
    } else if (props.fallback) {
      const fbNodes = renderRouteContent(props.fallback, {
        route: router.currentRoute(),
        params: {},
      });
      if (fbNodes.length > 0) {
        currentRenderedNodes = fbNodes;
        const parent = anchor.parentNode ?? fragment;
        for (const node of fbNodes) {
          parent.insertBefore(node, anchor);
        }
      }
    }
  });

  return fragment;
}

export const RouterView = Outlet;

export interface NavigateProps {
  to: To;
  replace?: boolean | undefined;
  state?: unknown | undefined;
}

export function Navigate(props: NavigateProps): Node {
  if (typeof document === "undefined") {
    throw new Error("[@mix/router] Navigate requires a DOM environment");
  }

  const navigate = useNavigate();
  const anchor = document.createComment("navigate-redirect");

  createEffect(() => {
    void navigate(props.to, { replace: props.replace ?? true, state: props.state });
  });

  return anchor;
}
