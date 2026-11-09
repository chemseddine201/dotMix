/**
 * @mix/router — Router Components (<RouterView />, <Link />, <RouterProvider />)
 */

import {
  createEffect,
  createRoot,
  createMemo,
  provideContext,
  useContext,
  validateSafeUrl,
} from "@mix/runtime";
import type { Router } from "./types.js";
import { RouterContext, RouteDepthContext, useRouter } from "./router.js";

function isDomNode(val: unknown): val is Node {
  return typeof (val as { nodeType?: unknown })?.nodeType === "number";
}

export interface RouterProviderProps {
  router: Router;
  children?: unknown;
}

export function RouterProvider(props: RouterProviderProps): unknown {
  provideContext(RouterContext, props.router);
  provideContext(RouteDepthContext, 0);

  if (typeof props.children === "function") {
    return (props.children as () => unknown)();
  }
  return props.children;
}

export interface RouterViewProps {
  fallback?: unknown;
}

export function RouterView(props: RouterViewProps = {}): Node {
  const router = useRouter();
  const depth = useContext(RouteDepthContext);

  if (typeof document === "undefined") {
    throw new Error("[@mix/router] RouterView requires a DOM environment");
  }

  const fragment = document.createDocumentFragment();
  const anchor = document.createComment(`router-view-depth-${depth}`);
  fragment.appendChild(anchor);
  let currentRecord: unknown = null;
  let currentDisposer: (() => void) | null = null;
  let currentRenderedNode: Node | null = null;

  createEffect(() => {
    const route = router.currentRoute();
    const matched = route.matched[depth];
    const nextRecord = matched ? matched.record : null;

    if (nextRecord === currentRecord && currentRenderedNode !== null) {
      return;
    }
    currentRecord = nextRecord;

    // Cleanup previous route view
    if (currentDisposer) {
      currentDisposer();
      currentDisposer = null;
    }
    if (currentRenderedNode && currentRenderedNode.parentNode) {
      currentRenderedNode.parentNode.removeChild(currentRenderedNode);
      currentRenderedNode = null;
    }

    if (matched && matched.component) {
      createRoot((dispose) => {
        currentDisposer = dispose;
        provideContext(RouteDepthContext, depth + 1);

        const comp = matched.component;
        let rendered: unknown;
        if (typeof comp === "function") {
          rendered = (comp as (args: { route: unknown; params: Record<string, string> }) => unknown)({
            route,
            params: matched.params,
          });
        } else {
          rendered = comp;
        }

        if (isDomNode(rendered)) {
          currentRenderedNode = rendered;
          if (anchor.parentNode) {
            anchor.parentNode.insertBefore(currentRenderedNode, anchor);
          }
        }
      });
    } else if (props.fallback) {
      let fb: unknown;
      if (typeof props.fallback === "function") {
        fb = (props.fallback as () => unknown)();
      } else {
        fb = props.fallback;
      }
      if (isDomNode(fb)) {
        currentRenderedNode = fb;
        if (anchor.parentNode) {
          anchor.parentNode.insertBefore(currentRenderedNode, anchor);
        }
      }
    }
  });

  return fragment;
}

export interface LinkProps {
  href: string;
  replace?: boolean;
  class?: string;
  activeClass?: string;
  exact?: boolean;
  children?: unknown;
  [key: string]: unknown;
}

export function Link(props: LinkProps): HTMLAnchorElement {
  if (typeof document === "undefined") {
    throw new Error("[@mix/router] Link requires a DOM environment");
  }

  // Validate URL protocol safety immediately per R-URL-01
  validateSafeUrl(props.href);

  const router = useRouter();
  const el = document.createElement("a");
  el.setAttribute("href", props.href);

  const baseClass = props.class || "";
  const activeClass = props.activeClass || "active";
  const exact = props.exact ?? false;

  const isActive = createMemo(() => {
    const curPath = router.currentRoute().pathname;
    if (exact) {
      return curPath === props.href;
    }
    if (props.href === "/") {
      return curPath === "/";
    }
    return curPath === props.href || curPath.startsWith(props.href + "/");
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
      void router.replace(props.href);
    } else {
      void router.push(props.href);
    }
  });

  if (props.children) {
    if (typeof props.children === "function") {
      const child = (props.children as () => unknown)();
      if (isDomNode(child)) {
        el.appendChild(child);
      } else if (typeof child === "string") {
        el.textContent = child;
      }
    } else if (isDomNode(props.children)) {
      el.appendChild(props.children);
    } else if (typeof props.children === "string") {
      el.textContent = props.children;
    }
  }

  return el;
}
