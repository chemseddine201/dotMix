/**
 * @mix/router — Lightweight client-side reactive router for Mix & Tix SPA applications.
 */

import { signal, type Signal } from "@mix/runtime";

export interface RouteRecord {
  readonly path: string;
  readonly component?: unknown;
}

export interface RouterOptions {
  readonly routes: readonly RouteRecord[];
  readonly initialPath?: string;
}

export interface RouterInstance {
  readonly currentPath: Signal<string>;
  navigate(path: string): void;
  matches(path: string): boolean;
}

export function createRouter(options: RouterOptions): RouterInstance {
  const defaultPath = typeof globalThis !== "undefined" && (globalThis as unknown as { window?: { location?: { pathname?: string } } }).window?.location?.pathname
    ? (globalThis as unknown as { window: { location: { pathname: string } } }).window.location.pathname
    : "/";

  const currentPath = signal<string>(options.initialPath ?? defaultPath);

  function navigate(path: string): void {
    currentPath.set(() => path);
    if (typeof globalThis !== "undefined") {
      const g = globalThis as unknown as { window?: { history?: { pushState: (data: unknown, unused: string, url?: string) => void } } };
      if (g.window?.history?.pushState) {
        g.window.history.pushState(null, "", path);
      }
    }
  }

  function matches(path: string): boolean {
    return currentPath() === path;
  }

  return Object.freeze({
    currentPath,
    navigate,
    matches
  });
}
