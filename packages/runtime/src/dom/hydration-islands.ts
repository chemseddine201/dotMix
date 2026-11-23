/**
 * @dotmix/runtime/dom/hydration-islands — Partial hydration island bootstrap for static SSG pages.
 */

import { hydrateRoot, type MountedComponent } from "./mount.js";
import type { HydrateOptions } from "./hydration.js";

export type IslandTrigger = "load" | "visible" | "idle" | "media";

export interface IslandBootstrapEntry {
  readonly id: string;
  readonly component: string;
  readonly trigger: IslandTrigger;
  readonly media?: string | undefined;
  readonly moduleUrl: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export type IslandLoader = (
  moduleUrl: string,
  componentName: string
) => Promise<((props: Record<string, unknown>) => Node | readonly Node[]) | null>;

function defaultLoadIslandComponent(
  moduleUrl: string,
  componentName: string
): Promise<((props: Record<string, unknown>) => Node | readonly Node[]) | null> {
  return import(moduleUrl).then((mod: Record<string, unknown>) => {
    const fn = mod[componentName] ?? mod.default;
    return typeof fn === "function"
      ? (fn as (props: Record<string, unknown>) => Node | readonly Node[])
      : null;
  });
}

function parseIslandProps(el: Element): Record<string, unknown> {
  const raw = el.getAttribute("data-props");
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function waitForTrigger(
  el: Element,
  trigger: IslandTrigger,
  mediaQuery?: string
): Promise<void> {
  if (trigger === "load") {
    return Promise.resolve();
  }

  if (trigger === "idle") {
    return new Promise((resolve) => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
      if (typeof ric === "function") {
        ric(() => resolve());
      } else {
        setTimeout(resolve, 50);
      }
    });
  }

  if (trigger === "media" && mediaQuery && typeof globalThis.matchMedia === "function") {
    const mql = globalThis.matchMedia(mediaQuery);
    if (mql.matches) return Promise.resolve();
    return new Promise((resolve) => {
      const onChange = (ev: MediaQueryListEvent) => {
        if (ev.matches) {
          mql.removeEventListener("change", onChange);
          resolve();
        }
      };
      mql.addEventListener("change", onChange);
    });
  }

  if (trigger === "visible" && typeof IntersectionObserver === "function") {
    return new Promise((resolve) => {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(el);
    });
  }

  return Promise.resolve();
}

export async function hydrateIslands(
  root: ParentNode | undefined = typeof document !== "undefined" ? document : undefined,
  options?: HydrateOptions & { loader?: IslandLoader | undefined }
): Promise<readonly MountedComponent[]> {
  if (!root) return [];
  const islandElements = Array.from(root.querySelectorAll("mix-island[data-island-module]"));
  if (islandElements.length === 0) return [];

  const loadComponent = options?.loader ?? defaultLoadIslandComponent;
  const mounted: MountedComponent[] = [];

  await Promise.all(
    islandElements.map(async (el) => {
      const moduleUrl = el.getAttribute("data-island-module");
      const componentName = el.getAttribute("data-component") ?? "default";
      const triggerAttr = (el.getAttribute("data-hydrate") ?? "idle") as IslandTrigger;
      const media = el.getAttribute("data-media") ?? undefined;
      if (!moduleUrl) return;

      await waitForTrigger(el, triggerAttr, media);
      const ComponentFn = await loadComponent(moduleUrl, componentName);
      if (!ComponentFn) return;
      const props = parseIslandProps(el);
      const handle = hydrateRoot(ComponentFn, el, props, options);
      el.setAttribute("data-hydrated", "true");
      mounted.push(handle);
    })
  );

  return mounted;
}
