/**
 * @dotmix/runtime/dom/directives/async-lazy — F4, F10, F11 async timeout, composition, caching & lazy helpers.
 */

import {
  OwnerState,
  createEffect,
  onCleanup,
  untrack,
  withComponentProps
} from "../../core/index.js";
import { removeNode } from "../nodes.js";
import type {
  AwaitTimeoutBranches,
  ComponentLoader,
  DirectiveComponent,
  IncludeMountOptions
} from "./contract-types.js";
import { createAnchorRegion } from "./shared.js";

function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function __mixAwaitWithTimeout<T>(
  parent: Node,
  promiseFn: () => Promise<T> | T,
  timeoutMs: number,
  branches: AwaitTimeoutBranches<T>,
  anchor?: Node | null
): Comment {
  const region = createAnchorRegion(parent, "mix:await-timeout", anchor);
  let currentGen = 0;
  let activeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const clearTimer = (): void => {
    if (activeTimer !== null) {
      globalThis.clearTimeout(activeTimer);
      activeTimer = null;
    }
  };

  if (region.parentOwner) {
    onCleanup(() => {
      currentGen++;
      clearTimer();
    });
  }

  createEffect(() => {
    const raw = promiseFn();
    const myGen = ++currentGen;
    clearTimer();

    if (!isThenable<T>(raw)) {
      region.mount(() => branches.then(() => raw));
      return;
    }

    region.mount(branches.pending);

    if (branches.timeout && Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      activeTimer = globalThis.setTimeout(() => {
        activeTimer = null;
        if (
          myGen === currentGen &&
          (!region.parentOwner || region.parentOwner.ownerState === OwnerState.ACTIVE)
        ) {
          region.mount(branches.timeout!);
        }
      }, timeoutMs);
    }

    raw.then(
      (data) => {
        if (
          myGen !== currentGen ||
          (region.parentOwner && region.parentOwner.ownerState !== OwnerState.ACTIVE)
        ) {
          return;
        }
        clearTimer();
        region.mount(() => branches.then(() => data));
      },
      (err) => {
        if (
          myGen !== currentGen ||
          (region.parentOwner && region.parentOwner.ownerState !== OwnerState.ACTIVE)
        ) {
          return;
        }
        clearTimer();
        if (branches.catch) {
          region.mount(() => branches.catch!(() => err));
        }
      }
    );
  });

  return region.marker;
}

function extractLoadedComponent<P extends object>(
  loaded: unknown
): DirectiveComponent<P> | null {
  if (typeof loaded === "function") {
    return loaded as DirectiveComponent<P>;
  }
  if (loaded && typeof loaded === "object" && "default" in loaded) {
    const def = (loaded as { default?: unknown }).default;
    if (typeof def === "function") {
      return def as DirectiveComponent<P>;
    }
  }
  return null;
}

export function __mixInclude<P extends object = Record<string, unknown>>(
  parent: Node,
  componentOrLoader: () => DirectiveComponent<P> | ComponentLoader<P>,
  propsFn?: (() => P) | null,
  options?: IncludeMountOptions,
  anchor?: Node | null
): Comment {
  const region = createAnchorRegion(parent, "mix:include", anchor);
  let currentGen = 0;

  if (region.parentOwner) {
    onCleanup(() => {
      currentGen++;
    });
  }

  createEffect(() => {
    const myGen = ++currentGen;
    if (options?.condition !== undefined && !options.condition()) {
      region.mount(options.fallback);
      return;
    }
    if (options?.unless !== undefined && options.unless()) {
      region.mount(options.fallback);
      return;
    }

    const target = componentOrLoader();
    const resolvedProps = propsFn ? propsFn() : ({} as P);
    const propsRecord = resolvedProps as Record<string, unknown>;

    let pendingPromise: PromiseLike<unknown> | null = null;

    region.mount(() => {
      const rendered = withComponentProps(propsRecord, () => target(resolvedProps));
      if (isThenable(rendered)) {
        pendingPromise = rendered;
        return [];
      }
      return (rendered as Node | readonly Node[] | null | undefined) ?? [];
    });

    if (!pendingPromise) {
      return;
    }

    const activePromise = pendingPromise as PromiseLike<unknown>;
    region.mount(options?.pending);

    activePromise.then(
      (mod) => {
        if (
          myGen !== currentGen ||
          (region.parentOwner && region.parentOwner.ownerState !== OwnerState.ACTIVE)
        ) {
          return;
        }
        const comp = extractLoadedComponent<P>(mod);
        if (!comp) {
          region.mount(options?.fallback);
          return;
        }
        region.mount(
          () =>
            (withComponentProps(propsRecord, () => comp(resolvedProps)) as
              | Node
              | readonly Node[]
              | null
              | undefined) ?? []
        );
      },
      () => {
        if (
          myGen !== currentGen ||
          (region.parentOwner && region.parentOwner.ownerState !== OwnerState.ACTIVE)
        ) {
          return;
        }
        region.mount(options?.fallback);
      }
    );
  });

  return region.marker;
}

export function __mixIncludeFirst<P extends object = Record<string, unknown>>(
  parent: Node,
  candidatesFn: () => readonly ComponentLoader<P>[],
  propsFn?: (() => P) | null,
  options?: IncludeMountOptions,
  anchor?: Node | null
): Comment {
  const region = createAnchorRegion(parent, "mix:includefirst", anchor);
  let currentGen = 0;

  if (region.parentOwner) {
    onCleanup(() => {
      currentGen++;
    });
  }

  createEffect(() => {
    const myGen = ++currentGen;
    if (options?.condition !== undefined && !options.condition()) {
      region.mount(options.fallback);
      return;
    }
    if (options?.unless !== undefined && options.unless()) {
      region.mount(options.fallback);
      return;
    }

    const candidates = candidatesFn();
    const resolvedProps = propsFn ? propsFn() : ({} as P);

    if (candidates.length === 0) {
      region.mount(options?.fallback);
      return;
    }

    region.mount(options?.pending);

    void (async () => {
      for (let i = 0; i < candidates.length; i++) {
        const loader = candidates[i]!;
        try {
          const mod = await loader();
          if (
            myGen !== currentGen ||
            (region.parentOwner && region.parentOwner.ownerState !== OwnerState.ACTIVE)
          ) {
            return;
          }
          const comp = extractLoadedComponent<P>(mod);
          if (comp) {
            const propsRecord = resolvedProps as Record<string, unknown>;
            region.mount(
              () =>
                (withComponentProps(propsRecord, () => comp(resolvedProps)) as
                  | Node
                  | readonly Node[]
                  | null
                  | undefined) ?? []
            );
            return;
          }
        } catch {
          // Try next candidate
        }
      }
      if (
        myGen === currentGen &&
        (!region.parentOwner || region.parentOwner.ownerState === OwnerState.ACTIVE)
      ) {
        region.mount(options?.fallback);
      }
    })();
  });

  return region.marker;
}

export function __mixOnce(
  parent: Node,
  factory: () => Node | readonly Node[],
  _keyOrId?: string | null,
  anchor?: Node | null
): Comment {
  const region = createAnchorRegion(parent, "mix:once", anchor);
  untrack(() => {
    region.mount(factory);
  });
  return region.marker;
}

function depsEqual(
  prev: readonly unknown[],
  next: readonly unknown[],
  equals?: ((prev: readonly unknown[], next: readonly unknown[]) => boolean) | null
): boolean {
  if (equals) {
    return equals(prev, next);
  }
  if (prev.length !== next.length) {
    return false;
  }
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) {
      return false;
    }
  }
  return true;
}

export function __mixMemo(
  parent: Node,
  depsFn: () => readonly unknown[],
  factory: () => Node | readonly Node[],
  equals?: ((prev: readonly unknown[], next: readonly unknown[]) => boolean) | null,
  anchor?: Node | null
): Comment {
  const region = createAnchorRegion(parent, "mix:memo", anchor);
  let prevDeps: readonly unknown[] | null = null;

  createEffect(() => {
    const nextDeps = depsFn();
    if (prevDeps !== null && depsEqual(prevDeps, nextDeps, equals)) {
      return;
    }
    prevDeps = [...nextDeps];
    region.mount(factory);
  });

  return region.marker;
}

function findFirstElement(parent: Node, marker: Comment): Element | null {
  let cursor: Node | null = marker.previousSibling;
  while (cursor) {
    if (cursor.nodeType === 1) {
      return cursor as Element;
    }
    cursor = cursor.previousSibling;
  }
  return parent.nodeType === 1 ? (parent as Element) : null;
}

export function __mixLazy(
  parent: Node,
  trigger: "visible" | "idle",
  factory: () => Node | readonly Node[],
  fallback?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const region = createAnchorRegion(parent, "mix:lazy", anchor);
  let triggered = false;
  let observer: IntersectionObserver | null = null;
  let sentinelEl: HTMLSpanElement | null = null;
  let cancelIdle: (() => void) | null = null;

  const cleanupTrigger = (): void => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (sentinelEl) {
      removeNode(sentinelEl);
      sentinelEl = null;
    }
    if (cancelIdle) {
      cancelIdle();
      cancelIdle = null;
    }
  };

  if (region.parentOwner) {
    onCleanup(cleanupTrigger);
  }

  const activate = (): void => {
    if (triggered) {
      return;
    }
    if (region.parentOwner && region.parentOwner.ownerState !== OwnerState.ACTIVE) {
      return;
    }
    triggered = true;
    cleanupTrigger();
    region.mount(factory);
  };

  if (typeof document === "undefined" || typeof window === "undefined") {
    activate();
    return region.marker;
  }

  if (trigger === "visible") {
    if (typeof globalThis.IntersectionObserver !== "function") {
      activate();
      return region.marker;
    }
    if (fallback) {
      region.mount(fallback);
    }
    let observeTarget = findFirstElement(parent, region.marker);
    if (!observeTarget) {
      sentinelEl = document.createElement("span");
      sentinelEl.setAttribute("data-mix-lazy-sentinel", "");
      sentinelEl.style.display = "inline-block";
      sentinelEl.style.width = "0";
      sentinelEl.style.height = "0";
      const targetParent = region.marker.parentNode ?? parent;
      targetParent.insertBefore(sentinelEl, region.marker);
      observeTarget = sentinelEl;
    }
    observer = new globalThis.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          activate();
          break;
        }
      }
    });
    observer.observe(observeTarget);
    return region.marker;
  }

  // trigger === "idle"
  if (fallback) {
    region.mount(fallback);
  }
  const idleGlobal = globalThis as {
    requestIdleCallback?: (callback: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof idleGlobal.requestIdleCallback === "function") {
    const id = idleGlobal.requestIdleCallback(() => {
      cancelIdle = null;
      activate();
    });
    cancelIdle = () => {
      idleGlobal.cancelIdleCallback?.(id);
    };
  } else if (typeof globalThis.setTimeout === "function") {
    const id = globalThis.setTimeout(() => {
      cancelIdle = null;
      activate();
    }, 0);
    cancelIdle = () => {
      globalThis.clearTimeout(id);
    };
  } else {
    activate();
  }

  return region.marker;
}
