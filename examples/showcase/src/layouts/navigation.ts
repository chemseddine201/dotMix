import type { RouteObject } from "@dotmix/router";

export interface NavEntry {
  path: string;
  title: string;
  section: string;
  order: number;
  keywords: readonly string[];
}

export interface NavGroup {
  section: string;
  items: NavEntry[];
}

export interface AdjacentRoutes {
  prev: NavEntry | null;
  next: NavEntry | null;
}

const SECTION_ORDER: readonly string[] = ["Getting started", "Directives", "Features"];

const ROUTE_KEYWORDS: Record<string, readonly string[]> = {
  "/": ["overview", "home", "counter", "install", "cli", "mix create"],
  "/start/project-structure": ["folders", "files", "tix", "mix", "entry", "routes"],
  "/start/first-component": ["component", "props", "signal", "state"],
  "/directives/conditionals": ["if", "elseif", "else", "unless", "show", "If", "Unless"],
  "/directives/switch": ["switch", "case", "default", "Switch", "Case"],
  "/directives/loops": ["each", "for", "key", "Each", "For"],
  "/directives/async": ["await", "then", "catch", "promise", "Await"],
  "/directives/authentication": ["auth", "guest", "AuthProvider", "Auth", "Guest"],
  "/directives/authorization": ["can", "cannot", "elsecan", "canany", "policy", "Can", "Cannot"],
  "/directives/environment-context": ["env", "development", "production", "context", "ContextProvider"],
  "/directives/forms": ["csrf", "method", "honeypot", "error", "validation"],
  "/directives/layouts": ["layout", "section", "yield", "stack", "push", "head", "title", "meta"],
  "/directives/composition": ["include", "includefirst", "includeif", "dynamic", "Include"],
  "/directives/render-control": ["lazy", "defer", "preload", "raw", "once"],
  "/directives/attributes": ["class", "style", "event", "modifier", "prevent", "spread"],
  "/directives/server-rendering": ["ssr", "mount", "hydrate", "streaming"],
  "/directives/debug-text": ["dump", "json", "text", "debug"],
  "/features/signals": ["signal", "computed", "createEffect", "createMemo", "batch", "reactivity"],
  "/features/components": ["props", "slot", "children", "context", "ref"],
  "/features/scoped-styles": ["css", "scoped", "deep", "global", "tokens"],
  "/features/router": ["hash", "browser", "Link", "NavLink", "Outlet", "useNavigate", "params"],
  "/features/permissions": ["gate", "role", "ability", "permission", "Can"],
  "/features/forms": ["createForm", "field", "validate", "dirty", "submit"],
  "/features/sync": ["local-first", "collection", "offline", "mutation", "conflict", "sync"],
  "/features/helpers": ["debounce", "throttle", "format", "helper"],
  "/features/interop": ["custom element", "web component", "tc39", "interop"],
  "/features/ssr": ["renderToString", "streaming", "edge", "server"]
};

function readMeta(route: RouteObject): NavEntry | null {
  if (!route.meta || typeof route.meta !== "object") {
    return null;
  }
  const meta = route.meta as {
    title?: unknown;
    section?: unknown;
    order?: unknown;
    keywords?: unknown;
  };
  if (typeof meta.title !== "string" || typeof meta.section !== "string" || typeof meta.order !== "number") {
    return null;
  }
  const routePath = route.path;
  if (routePath === undefined) {
    return null;
  }
  const metaKeywords = Array.isArray(meta.keywords)
    ? meta.keywords.filter((item): item is string => typeof item === "string")
    : [];
  const defaultKeywords = ROUTE_KEYWORDS[routePath] ?? [];
  const keywords = [...metaKeywords, ...defaultKeywords];

  return {
    path: routePath,
    title: meta.title,
    section: meta.section,
    order: meta.order,
    keywords
  };
}

export function buildNavigation(routes: readonly RouteObject[]): NavGroup[] {
  const groups = new Map<string, NavEntry[]>();
  for (const route of routes) {
    const entry = readMeta(route);
    if (!entry) {
      continue;
    }
    const existing = groups.get(entry.section) ?? [];
    existing.push(entry);
    groups.set(entry.section, existing);
  }
  const result: NavGroup[] = [];
  for (const section of SECTION_ORDER) {
    const items = groups.get(section);
    if (!items || items.length === 0) {
      continue;
    }
    items.sort((a, b) => a.order - b.order);
    result.push({ section, items });
  }
  return result;
}

export function flattenNavigation(routes: readonly RouteObject[]): NavEntry[] {
  const groups = buildNavigation(routes);
  const flat: NavEntry[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      flat.push(item);
    }
  }
  return flat;
}

export function getAdjacentRoutes(routes: readonly RouteObject[], currentPath: string): AdjacentRoutes {
  const flat = flattenNavigation(routes);
  const index = flat.findIndex((item) => item.path === currentPath);
  if (index === -1) {
    return { prev: null, next: null };
  }
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index < flat.length - 1 ? flat[index + 1] : null
  };
}

export function filterNavigationRoutes(routes: readonly RouteObject[], rawQuery: string): NavEntry[] {
  const flat = flattenNavigation(routes);
  const terms = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return flat;
  }

  const scored: Array<{ entry: NavEntry; score: number }> = [];
  for (const entry of flat) {
    const titleLower = entry.title.toLowerCase();
    const sectionLower = entry.section.toLowerCase();
    const pathLower = entry.path.toLowerCase();
    const keywordsLower = entry.keywords.join(" ").toLowerCase();
    const haystack = `${titleLower} ${sectionLower} ${pathLower} ${keywordsLower}`;

    let matchesAll = true;
    for (const term of terms) {
      if (!haystack.includes(term)) {
        matchesAll = false;
        break;
      }
    }
    if (!matchesAll) {
      continue;
    }

    let score = 0;
    const joined = terms.join(" ");
    if (titleLower === joined) {
      score += 100;
    } else if (titleLower.startsWith(joined)) {
      score += 60;
    } else if (titleLower.includes(joined)) {
      score += 30;
    }
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.entry);
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function trapFocusOnTab(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== "Tab" || !container) {
    return;
  }
  const focusables = container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
  );
  if (focusables.length === 0) {
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
