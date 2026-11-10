/**
 * @mix/runtime/dom/transition — Enter/leave CSS lifecycle classes and delayed unmounting
 * (Transition / createTransition, Phase 19 / D-122).
 */

import {
  createRoot,
  createEffect,
  getCurrentOwner,
  onCleanup
} from "../core/index.js";
import { removeNode, normalizeToNodeArray } from "./nodes.js";

export interface TransitionProps {
  name?: string | undefined;
  show?: boolean | (() => boolean) | undefined;
  durationMs?: number | undefined;
  onBeforeEnter?: ((el: HTMLElement) => void) | undefined;
  onAfterEnter?: ((el: HTMLElement) => void) | undefined;
  onBeforeLeave?: ((el: HTMLElement) => void) | undefined;
  onAfterLeave?: ((el: HTMLElement) => void) | undefined;
  children?: Node | (() => unknown) | unknown;
}

export type TransitionHandle = Node | readonly Node[];

/**
 * Applies enter/leave CSS lifecycle classes and delays physical DOM unmounting
 * until leave transitions complete.
 */
export function Transition(
  props: TransitionProps,
  parent?: Node | null,
  anchor?: Node | null
): TransitionHandle {
  const marker = document.createComment("mix:transition");
  const parentOwner = getCurrentOwner();
  const name = props.name ?? "v";
  const duration = props.durationMs ?? 300;

  if (parent) {
    parent.insertBefore(marker, anchor ?? null);
  }

  let childNodes: Node[] = [];
  let rootDisposer: (() => void) | null = null;
  let isMounted = false;

  createRoot((dispose) => {
    rootDisposer = dispose;
    const raw =
      typeof props.children === "function"
        ? (props.children as () => unknown)()
        : props.children;
    childNodes = normalizeToNodeArray(raw as Node | readonly Node[] | null | undefined);
  }, parentOwner);

  function isShowing(): boolean {
    if (typeof props.show === "function") {
      return Boolean(props.show());
    }
    return props.show !== undefined ? Boolean(props.show) : true;
  }

  function getFirstElement(): HTMLElement | null {
    for (const node of childNodes) {
      if (node.nodeType === 1) {
        return node as HTMLElement;
      }
    }
    return null;
  }

  const initialShow = isShowing();
  isMounted = initialShow;
  const initialEl = getFirstElement();
  if (initialShow && initialEl) {
    props.onBeforeEnter?.(initialEl);
    initialEl.classList.add(`${name}-enter-from`, `${name}-enter-active`);

    const enterFrame = () => {
      initialEl.classList.remove(`${name}-enter-from`);
      initialEl.classList.add(`${name}-enter-to`);

      const cleanupEnter = () => {
        initialEl.classList.remove(`${name}-enter-active`, `${name}-enter-to`);
        props.onAfterEnter?.(initialEl);
      };

      if (typeof globalThis.setTimeout === "function") {
        globalThis.setTimeout(cleanupEnter, duration);
      }
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(enterFrame);
    } else {
      enterFrame();
    }
  }

  let isFirstRun = true;

  createEffect(() => {
    const show = isShowing();
    if (isFirstRun) {
      isFirstRun = false;
      return;
    }
    const el = getFirstElement();

    if (show) {
      if (!isMounted) {
        isMounted = true;
        const p = marker.parentNode;
        if (p) {
          for (const node of childNodes) {
            p.insertBefore(node, marker);
          }
        }

        if (el) {
          props.onBeforeEnter?.(el);
          el.classList.add(`${name}-enter-from`, `${name}-enter-active`);

          const enterFrame = () => {
            el.classList.remove(`${name}-enter-from`);
            el.classList.add(`${name}-enter-to`);

            const cleanupEnter = () => {
              el.classList.remove(`${name}-enter-active`, `${name}-enter-to`);
              props.onAfterEnter?.(el);
            };

            if (typeof globalThis.setTimeout === "function") {
              globalThis.setTimeout(cleanupEnter, duration);
            }
          };

          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(enterFrame);
          } else {
            enterFrame();
          }
        }
      }
    } else {
      if (isMounted) {
        if (el) {
          props.onBeforeLeave?.(el);
          el.classList.add(`${name}-leave-from`, `${name}-leave-active`);

          const leaveFrame = () => {
            el.classList.remove(`${name}-leave-from`);
            el.classList.add(`${name}-leave-to`);

            const cleanupLeave = () => {
              el.classList.remove(`${name}-leave-active`, `${name}-leave-to`);
              for (const node of childNodes) {
                removeNode(node);
              }
              isMounted = false;
              props.onAfterLeave?.(el);
            };

            if (typeof globalThis.setTimeout === "function") {
              globalThis.setTimeout(cleanupLeave, duration);
            } else {
              cleanupLeave();
            }
          };

          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(leaveFrame);
          } else {
            leaveFrame();
          }
        } else {
          for (const node of childNodes) {
            removeNode(node);
          }
          isMounted = false;
        }
      }
    }
  });

  if (parentOwner) {
    onCleanup(() => {
      for (const node of childNodes) {
        removeNode(node);
      }
      if (rootDisposer) {
        rootDisposer();
        rootDisposer = null;
      }
    });
  }

  if (initialShow) {
    return [...childNodes, marker];
  }
  return marker;
}

export const createTransition = Transition;
