/**
 * @dotmix/router — Link & NavLink Navigation Anchor Components
 */

import {
  createEffect,
  createMemo,
  validateSafeUrl,
} from "@dotmix/runtime";
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

/**
 * Tracks the `to` prop (compiled components pass props as getters), so a link that stays mounted
 * while its target changes keeps its href, click target and active state current.
 * An unsafe initial target throws at creation.
 */
function createTargetUrl(readTarget: () => To): () => string {
  const targetUrl = createMemo(() => formatAndValidateTargetUrl(readTarget()));
  targetUrl();
  return targetUrl;
}

function setupAnchorNavigation(
  el: HTMLAnchorElement,
  router: Router,
  targetUrl: () => string,
  replace?: boolean,
  prefetch?: unknown
): void {
  createEffect(() => {
    el.setAttribute("href", targetUrl());
  });

  el.addEventListener("click", (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) {
      return;
    }
    e.preventDefault();
    if (replace) {
      void router.replace(targetUrl());
    } else {
      void router.push(targetUrl());
    }
  });

  if (prefetch === "render") {
    createEffect(() => {
      void router.prefetchRoute(targetUrl());
    });
  } else if (prefetch === "intent") {
    let prefetchedUrl: string | null = null;
    const onIntent = () => {
      const currentUrl = targetUrl();
      if (currentUrl === prefetchedUrl) return;
      prefetchedUrl = currentUrl;
      void router.prefetchRoute(currentUrl);
    };
    el.addEventListener("mouseenter", onIntent);
    el.addEventListener("focus", onIntent);
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

function escapeSsrHtmlAttr(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isPathActive(
  curPath: string,
  targetPath: string,
  exactOrEnd: boolean,
  caseSensitive: boolean
): boolean {
  const cur = caseSensitive ? curPath : curPath.toLowerCase();
  const tgt = caseSensitive ? targetPath : targetPath.toLowerCase();
  if (exactOrEnd) return cur === tgt;
  if (tgt === "/") return cur === "/";
  return cur === tgt || cur.startsWith(tgt + "/");
}

function renderSsrAnchor(
  href: string,
  cls: string,
  active: boolean,
  rawChild: unknown
): string {
  const childHtml = rawChild === null || rawChild === undefined ? "" : String(rawChild);
  const classAttr = cls ? ` class="${escapeSsrHtmlAttr(cls)}"` : "";
  const ariaAttr = active ? ' aria-current="page"' : "";
  return `<a href="${escapeSsrHtmlAttr(href)}"${classAttr}${ariaAttr}>${childHtml}</a>`;
}

export function Link(props: LinkProps): HTMLAnchorElement | string {
  const readTarget = (): To => (props.to !== undefined ? props.to : props.href || "/");
  if (typeof document === "undefined") {
    const href = formatAndValidateTargetUrl(readTarget());
    let active = false;
    try {
      const router = useRouter();
      active = isPathActive(router.currentRoute().pathname, resolvePath(readTarget()).pathname, props.exact ?? false, true);
    } catch {
      // Allow <Link> SSR rendering even without an active RouterContext
    }
    const baseClass = props.className || props.class || "";
    const activeClass = props.activeClass || "active";
    const cls = active ? (baseClass ? `${baseClass} ${activeClass}` : activeClass) : baseClass;
    const childVal =
      typeof props.children === "function" ? (props.children as () => unknown)() : props.children;
    return renderSsrAnchor(href, cls, active, childVal);
  }

  const targetUrl = createTargetUrl(readTarget);
  const router = useRouter();
  const el = document.createElement("a");

  setupAnchorNavigation(el, router, targetUrl, props.replace, props.prefetch);

  const baseClass = props.className || props.class || "";
  const activeClass = props.activeClass || "active";
  const exact = props.exact ?? false;

  const isActive = createMemo(() => {
    const curPath = router.currentRoute().pathname;
    const targetPath = resolvePath(readTarget()).pathname;
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

export function NavLink(props: NavLinkProps): HTMLAnchorElement | string {
  if (typeof document === "undefined") {
    const href = formatAndValidateTargetUrl(props.to);
    let active = false;
    try {
      const router = useRouter();
      active = isPathActive(
        router.currentRoute().pathname,
        resolvePath(props.to).pathname,
        props.end ?? false,
        props.caseSensitive ?? false
      );
    } catch {
      // Allow <NavLink> SSR rendering even without an active RouterContext
    }
    let cls = "";
    if (typeof props.className === "function") {
      cls = props.className({ isActive: active, isPending: false });
    } else if (typeof props.className === "string" || typeof props.class === "string") {
      const baseClass = props.className || props.class || "";
      const activeClass = props.activeClassName || "active";
      cls = active ? (baseClass ? `${baseClass} ${activeClass}` : activeClass) : baseClass;
    } else if (active) {
      cls = props.activeClassName || "active";
    }
    const childVal =
      typeof props.children === "function"
        ? (props.children as (arg: { isActive: boolean; isPending: boolean }) => unknown)({
            isActive: active,
            isPending: false
          })
        : props.children;
    return renderSsrAnchor(href, cls, active, childVal);
  }

  const router = useRouter();
  const targetUrl = createTargetUrl(() => props.to);
  const el = document.createElement("a");

  setupAnchorNavigation(el, router, targetUrl, props.replace, props.prefetch);

  const end = props.end ?? false;
  const caseSensitive = props.caseSensitive ?? false;

  const isActiveMemo = createMemo(() => {
    const curPath = router.currentRoute().pathname;
    const targetPath = resolvePath(props.to).pathname;
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
