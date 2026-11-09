/**
 * @mix/router — Navigation History Drivers (Browser, Hash, Memory)
 */

import type { RouterHistory } from "./types.js";

export function createMemoryHistory(initialPath = "/"): RouterHistory {
  let entries: string[] = [initialPath];
  let index = 0;
  const listeners = new Set<(url: string) => void>();

  function notify(): void {
    const loc = entries[index]!;
    for (const l of listeners) {
      try {
        l(loc);
      } catch (err) {
        console.error("Router listener error:", err);
      }
    }
  }

  return {
    get location(): string {
      return entries[index] || "/";
    },
    push(url: string): void {
      entries = entries.slice(0, index + 1);
      entries.push(url);
      index++;
      notify();
    },
    replace(url: string): void {
      entries[index] = url;
      notify();
    },
    back(): void {
      this.go(-1);
    },
    forward(): void {
      this.go(1);
    },
    go(delta: number): void {
      const next = index + delta;
      if (next >= 0 && next < entries.length) {
        index = next;
        notify();
      }
    },
    listen(listener: (url: string) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy(): void {
      listeners.clear();
      entries = ["/"];
      index = 0;
    },
  };
}

export function createBrowserHistory(): RouterHistory {
  if (typeof window === "undefined" || !window.history) {
    return createMemoryHistory();
  }

  const listeners = new Set<(url: string) => void>();

  const onPopState = () => {
    const loc = window.location.pathname + window.location.search + window.location.hash;
    for (const l of listeners) {
      try {
        l(loc);
      } catch (err) {
        console.error("Router listener error:", err);
      }
    }
  };

  window.addEventListener("popstate", onPopState);

  return {
    get location(): string {
      return window.location.pathname + window.location.search + window.location.hash;
    },
    push(url: string): void {
      window.history.pushState(null, "", url);
      onPopState();
    },
    replace(url: string): void {
      window.history.replaceState(null, "", url);
      onPopState();
    },
    back(): void {
      window.history.back();
    },
    forward(): void {
      window.history.forward();
    },
    go(delta: number): void {
      window.history.go(delta);
    },
    listen(listener: (url: string) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy(): void {
      window.removeEventListener("popstate", onPopState);
      listeners.clear();
    },
  };
}

export function createHashHistory(): RouterHistory {
  if (typeof window === "undefined" || !window.location) {
    return createMemoryHistory();
  }

  const listeners = new Set<(url: string) => void>();

  function getHashPath(): string {
    const raw = window.location.hash.slice(1);
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  const onHashChange = () => {
    const loc = getHashPath();
    for (const l of listeners) {
      try {
        l(loc);
      } catch (err) {
        console.error("Router listener error:", err);
      }
    }
  };

  window.addEventListener("hashchange", onHashChange);

  return {
    get location(): string {
      return getHashPath();
    },
    push(url: string): void {
      const clean = url.startsWith("/") ? url : `/${url}`;
      window.location.hash = clean;
    },
    replace(url: string): void {
      const clean = url.startsWith("/") ? url : `/${url}`;
      const base = window.location.href.split("#")[0]!;
      window.location.replace(`${base}#${clean}`);
    },
    back(): void {
      window.history.back();
    },
    forward(): void {
      window.history.forward();
    },
    go(delta: number): void {
      window.history.go(delta);
    },
    listen(listener: (url: string) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy(): void {
      window.removeEventListener("hashchange", onHashChange);
      listeners.clear();
    },
  };
}
