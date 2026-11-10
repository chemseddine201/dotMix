/**
 * @mix/router — Link & NavLink Navigation Anchor Components
 */

import {
  createEffect,
  createMemo,
  validateSafeUrl,
} from "@mix/runtime";
import type { Router, To } from "./types.js";
import { useRouter } from "./router.js";
import { resolvePath } from "./match.js";
import { isDomNode } from "./providers.js";

function formatAndValidateTargetUrl(rawTarget: To): string {
  const targetStr =
    typeof rawTarget === "string"
      ? rawTarget
      : `${rawTarget.pathname || "/"}${rawTarget.search || ""}${rawTarget.hash || ""}`;
  validateSafeUrl(targetStr);
  return targetStr;
}

function setupAnchorNavigation(
  el: HTMLAnchorElement,
  router: Router,
  targetStr: string,
  replace?: boolean,
  prefetch?: unknown
): void {
  el.setAttribute("href", targetStr);

  el.addEventListener("click", (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) {
      return;
    }
    e.preventDefault();
    if (replace) {
      void router.replace(targetStr);
    } else {
      void router.push(targetStr);
    }
  });

  if (prefetch === "render") {
    void router.prefetchRoute(targetStr);
  } else if (prefetch === "intent") {
    const onIntent = () => {
      void router.prefetchRoute(targetStr);
    };
    el.addEventListener("mouseenter", onIntent, { once: true });
    el.addEventListener("focus", onIntent, { once: true });
  }
}

function appendLinkChildValue(el: HTMLAnchorElement, child: unknown): void {
  if (Array.isArray(child)) {
    for (const c of child) {
      if (isDomNode(c)) {
        el.appendChild(c);
      } else if (typeof c === "string" || typeof c === "number") {
        el.appendChild(document.createTextNode(String(c)));
      }
    }
  } else if (isDomNode(child)) {
    el.appendChild(child);
  } else if (typeof child === "string" || typeof child === "number") {
    el.textContent = String(child);
  }
}

export interface LinkProps {
  to?: To | undefined;
  href?: string | undefined;
  replace?: boolean | undefined;
  state?: unknown | undefined;
  class?: string | undefined;
  className?: string | undefined;
  activeClass?: string | undefined;
  exact?: boolean | undefined;
  prefetch?: "intent" | "render" | "none" | undefined;
  children?: unknown | undefined;
  [key: string]: unknown;
}

export function Link(props: LinkProps): HTMLAnchorElement {
  if (typeof document === "undefined") {
    throw new Error("[@mix/router] Link requires a DOM environment");
  }

  const rawTarget = props.to !== undefined ? props.to : props.href || "/";
  const targetStr = formatAndValidateTargetUrl(rawTarget);
  const router = useRouter();
  const el = document.createElement("a");

  setupAnchorNavigation(el, router, targetStr, props.replace, props.prefetch);

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

  if (props.children) {
    const child =
      typeof props.children === "function"
        ? (props.children as () => unknown)()
        : props.children;
    appendLinkChildValue(el, child);
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
  const targetStr = formatAndValidateTargetUrl(props.to);
  const el = document.createElement("a");

  setupAnchorNavigation(el, router, targetStr, props.replace, props.prefetch);

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

  if (props.children) {
    if (typeof props.children === "function") {
      createEffect(() => {
        const active = isActiveMemo();
        const child = (props.children as (arg: { isActive: boolean; isPending: boolean }) => unknown)({
          isActive: active,
          isPending: false,
        });
        el.textContent = "";
        appendLinkChildValue(el, child);
      });
    } else {
      appendLinkChildValue(el, props.children);
    }
  }

  return el;
}
