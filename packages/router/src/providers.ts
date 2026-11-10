/**
 * @mix/router — Router Provider & History-Bound Router Components
 */

import { provideContext } from "@mix/runtime";
import type {
  Router,
  BrowserRouterOptions,
  HashRouterOptions,
  MemoryRouterOptions,
} from "./types.js";
import {
  RouterContext,
  RouteDepthContext,
  createBrowserRouter,
  createHashRouter,
  createMemoryRouter,
} from "./router.js";
import { Outlet } from "./outlet.js";

export function isDomNode(val: unknown): val is Node {
  return typeof (val as { nodeType?: unknown })?.nodeType === "number";
}

export function renderRouteContent(
  compOrElem: unknown,
  props: { route?: unknown; params?: Record<string, string> }
): Node[] {
  if (compOrElem === null || compOrElem === undefined) {
    return [];
  }
  let rendered: unknown = compOrElem;
  if (typeof compOrElem === "function") {
    try {
      rendered = (compOrElem as (props: unknown) => unknown)(props);
    } catch {
      rendered = compOrElem;
    }
  }

  if (Array.isArray(rendered)) {
    const list: Node[] = [];
    for (const item of rendered) {
      if (isDomNode(item)) {
        if (item.nodeType === 11 /* DocumentFragment */) {
          list.push(...Array.from(item.childNodes));
        } else {
          list.push(item);
        }
      } else if (typeof item === "string" || typeof item === "number") {
        list.push(document.createTextNode(String(item)));
      }
    }
    return list;
  }

  if (isDomNode(rendered)) {
    if (rendered.nodeType === 11 /* DocumentFragment */) {
      return Array.from(rendered.childNodes);
    }
    return [rendered];
  }

  if (typeof rendered === "string" || typeof rendered === "number") {
    return [document.createTextNode(String(rendered))];
  }

  return [];
}

export interface RouterProviderProps {
  router: Router;
  children?: unknown;
  fallbackElement?: unknown;
}

export function RouterProvider(props: RouterProviderProps): unknown {
  provideContext(RouterContext, props.router);
  provideContext(RouteDepthContext, 0);

  if (props.children !== undefined) {
    if (typeof props.children === "function") {
      return (props.children as () => unknown)();
    }
    return props.children;
  }
  return Outlet({ fallback: props.fallbackElement });
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
