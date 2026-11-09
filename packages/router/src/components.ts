/**
 * @mix/router — Router Components (React Router v6/v7 Parity & Mix Native)
 */

import {
  createEffect,
  createRoot,
  createMemo,
  provideContext,
  useContext,
  validateSafeUrl,
} from "@mix/runtime";
import type {
  Router,
  RouteObject,
  RouteRecord,
  To,
  BrowserRouterOptions,
  HashRouterOptions,
  MemoryRouterOptions,
} from "./types.js";
import {
  RouterContext,
  RouteDepthContext,
  RouteMatchesContext,
  OutletContextData,
  useRouter,
  useNavigate,
  createBrowserRouter,
  createHashRouter,
  createMemoryRouter,
} from "./router.js";
import { matchRoutes, createRoutesFromElements, resolvePath } from "./match.js";

export function isDomNode(val: unknown): val is Node {
  return typeof (val as { nodeType?: unknown })?.nodeType === "number";
}

export function renderRouteContent(
  compOrElem: unknown,
  props: { route?: unknown; params?: Record<string, string> }
): Node | null {
  if (compOrElem === null || compOrElem === undefined) {
    return null;
  }
  let rendered: unknown = compOrElem;
  if (typeof compOrElem === "function") {
    try {
      rendered = (compOrElem as (props: unknown) => unknown)(props);
    } catch {
      rendered = compOrElem;
    }
  }

  if (isDomNode(rendered)) {
    return rendered;
  }
  if (typeof rendered === "string" || typeof rendered === "number") {
    return document.createTextNode(String(rendered));
  }
  return null;
}

export interface RouterProviderProps {
  router: Router;
  children?: unknown;
  fallbackElement?: unknown;
}

export function RouterProvider(props: RouterProviderProps): unknown {
  provideContext(RouterContext, props.router);
  provideContext(RouteDepthContext, 0);

  if (typeof props.children === "function") {
    return (props.children as () => unknown)();
  }
  return props.children;
}

export interface BrowserRouterProps extends BrowserRouterOptions {
  children?: unknown;
}

export function BrowserRouter(props: BrowserRouterProps): unknown {
  const router = createBrowserRouter(props.routes || [], props);
  return RouterProvider({
    router,
    children: props.children,
  });
}

export interface HashRouterProps extends HashRouterOptions {
  children?: unknown;
}

export function HashRouter(props: HashRouterProps): unknown {
  const router = createHashRouter(props.routes || [], props);
  return RouterProvider({
    router,
    children: props.children,
  });
}

export interface MemoryRouterProps extends MemoryRouterOptions {
  children?: unknown;
}

export function MemoryRouter(props: MemoryRouterProps): unknown {
  const router = createMemoryRouter(props.routes || [], props);
  return RouterProvider({
    router,
    children: props.children,
  });
}

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
  let currentRenderedNode: Node | null = null;

  createEffect(() => {
    const matches = matchesMemo();
    const topMatch = matches[0];
    const nextRecord = topMatch ? topMatch.route : null;

    if (nextRecord === currentRecord && currentRenderedNode !== null) {
      return;
    }
    currentRecord = nextRecord;

    if (currentDisposer) {
      currentDisposer();
      currentDisposer = null;
    }
    if (currentRenderedNode && currentRenderedNode.parentNode) {
      currentRenderedNode.parentNode.removeChild(currentRenderedNode);
      currentRenderedNode = null;
    }

    if (topMatch) {
      createRoot((dispose) => {
        currentDisposer = dispose;
        provideContext(RouteMatchesContext, matchesMemo);
        provideContext(RouteDepthContext, 1);

        const comp =
          topMatch.route.element ??
          topMatch.route.Component ??
          topMatch.route.component;
        const rendered = renderRouteContent(comp, {
          route: locMemo(),
          params: topMatch.params,
        });

        if (rendered && isDomNode(rendered)) {
          currentRenderedNode = rendered;
          if (anchor.parentNode) {
            anchor.parentNode.insertBefore(currentRenderedNode, anchor);
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
  let currentRenderedNode: Node | null = null;

  createEffect(() => {
    const matches = matchesContext
      ? matchesContext()
      : router.currentRoute().matched;
    const matched = matches[depth];
    const nextRecord = matched
      ? ((matched as { record?: RouteRecord }).record ?? matched.route)
      : null;

    if (nextRecord === currentRecord && currentRenderedNode !== null) {
      return;
    }
    currentRecord = nextRecord;

    if (currentDisposer) {
      currentDisposer();
      currentDisposer = null;
    }
    if (currentRenderedNode && currentRenderedNode.parentNode) {
      currentRenderedNode.parentNode.removeChild(currentRenderedNode);
      currentRenderedNode = null;
    }

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

        const rendered = renderRouteContent(comp, {
          route: router.currentRoute(),
          params: matched.params,
        });

        if (rendered && isDomNode(rendered)) {
          currentRenderedNode = rendered;
          if (anchor.parentNode) {
            anchor.parentNode.insertBefore(currentRenderedNode, anchor);
          }
        }
      });
    } else if (props.fallback) {
      const fb = renderRouteContent(props.fallback, {
        route: router.currentRoute(),
        params: {},
      });
      if (fb && isDomNode(fb)) {
        currentRenderedNode = fb;
        if (anchor.parentNode) {
          anchor.parentNode.insertBefore(currentRenderedNode, anchor);
        }
      }
    }
  });

  return fragment;
}

export const RouterView = Outlet;

export interface LinkProps {
  to?: To | undefined;
  href?: string | undefined;
  replace?: boolean | undefined;
  state?: unknown | undefined;
  class?: string | undefined;
  className?: string | undefined;
  activeClass?: string | undefined;
  exact?: boolean | undefined;
  children?: unknown | undefined;
  [key: string]: unknown;
}

export function Link(props: LinkProps): HTMLAnchorElement {
  if (typeof document === "undefined") {
    throw new Error("[@mix/router] Link requires a DOM environment");
  }

  const rawTarget = props.to !== undefined ? props.to : props.href || "/";
  const targetStr =
    typeof rawTarget === "string"
      ? rawTarget
      : `${rawTarget.pathname || "/"}${rawTarget.search || ""}${rawTarget.hash || ""}`;

  validateSafeUrl(targetStr);

  const router = useRouter();
  const el = document.createElement("a");
  el.setAttribute("href", targetStr);

  const baseClass = props.className || props.class || "";
  const activeClass = props.activeClass || "active";
  const exact = props.exact ?? false;

  const isActive = createMemo(() => {
    const curPath = router.currentRoute().pathname;
    const targetPath = resolvePath(rawTarget).pathname;
    if (exact) {
      return curPath === targetPath;
    }
    if (targetPath === "/") {
      return curPath === "/";
    }
    return curPath === targetPath || curPath.startsWith(targetPath + "/");
  });

  createEffect(() => {
    const active = isActive();
    if (active) {
      el.setAttribute("aria-current", "page");
      el.className = baseClass ? `${baseClass} ${activeClass}` : activeClass;
    } else {
      el.removeAttribute("aria-current");
      el.className = baseClass;
    }
  });

  el.addEventListener("click", (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) {
      return;
    }
    e.preventDefault();
    if (props.replace) {
      void router.replace(targetStr);
    } else {
      void router.push(targetStr);
    }
  });

  if (props.children) {
    if (typeof props.children === "function") {
      const child = (props.children as () => unknown)();
      if (isDomNode(child)) {
        el.appendChild(child);
      } else if (typeof child === "string" || typeof child === "number") {
        el.textContent = String(child);
      }
    } else if (isDomNode(props.children)) {
      el.appendChild(props.children);
    } else if (typeof props.children === "string" || typeof props.children === "number") {
      el.textContent = String(props.children);
    }
  }

  return el;
}

export interface NavLinkProps {
  to: To;
  replace?: boolean | undefined;
  state?: unknown | undefined;
  end?: boolean | undefined;
  caseSensitive?: boolean | undefined;
  class?: string | undefined;
  className?: string | ((props: { isActive: boolean; isPending: boolean }) => string) | undefined;
  style?: string | Record<string, string> | ((props: { isActive: boolean; isPending: boolean }) => string | Record<string, string>) | undefined;
  activeClassName?: string | undefined;
  children?: unknown | ((props: { isActive: boolean; isPending: boolean }) => unknown) | undefined;
  [key: string]: unknown;
}

export function NavLink(props: NavLinkProps): HTMLAnchorElement {
  if (typeof document === "undefined") {
    throw new Error("[@mix/router] NavLink requires a DOM environment");
  }

  const router = useRouter();
  const targetStr =
    typeof props.to === "string"
      ? props.to
      : `${props.to.pathname || "/"}${props.to.search || ""}${props.to.hash || ""}`;

  validateSafeUrl(targetStr);

  const el = document.createElement("a");
  el.setAttribute("href", targetStr);

  const targetPath = resolvePath(props.to).pathname;
  const end = props.end ?? false;
  const caseSensitive = props.caseSensitive ?? false;

  const isActiveMemo = createMemo(() => {
    const curPath = router.currentRoute().pathname;
    const cur = caseSensitive ? curPath : curPath.toLowerCase();
    const tgt = caseSensitive ? targetPath : targetPath.toLowerCase();

    if (end) {
      return cur === tgt;
    }
    if (tgt === "/") {
      return cur === "/";
    }
    return cur === tgt || cur.startsWith(tgt + "/");
  });

  createEffect(() => {
    const active = isActiveMemo();
    if (active) {
      el.setAttribute("aria-current", "page");
    } else {
      el.removeAttribute("aria-current");
    }

    if (typeof props.className === "function") {
      el.className = props.className({ isActive: active, isPending: false });
    } else if (typeof props.className === "string" || typeof props.class === "string") {
      const baseClass = props.className || props.class || "";
      const activeClass = props.activeClassName || "active";
      el.className = active ? (baseClass ? `${baseClass} ${activeClass}` : activeClass) : baseClass;
    } else if (active) {
      el.className = props.activeClassName || "active";
    } else {
      el.className = "";
    }
  });

  el.addEventListener("click", (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) {
      return;
    }
    e.preventDefault();
    if (props.replace) {
      void router.replace(targetStr);
    } else {
      void router.push(targetStr);
    }
  });

  if (props.children) {
    if (typeof props.children === "function") {
      createEffect(() => {
        const active = isActiveMemo();
        const child = (props.children as (arg: { isActive: boolean; isPending: boolean }) => unknown)({
          isActive: active,
          isPending: false,
        });
        el.textContent = "";
        if (isDomNode(child)) {
          el.appendChild(child);
        } else if (typeof child === "string" || typeof child === "number") {
          el.textContent = String(child);
        }
      });
    } else if (isDomNode(props.children)) {
      el.appendChild(props.children);
    } else if (typeof props.children === "string" || typeof props.children === "number") {
      el.textContent = String(props.children);
    }
  }

  return el;
}

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
