/**
 * @mix/runtime/dom/portal — Surgical portal mounting (Teleport / createPortal, Phase 19 / D-122).
 */

import {
  createRoot,
  createEffect,
  getCurrentOwner,
  onCleanup
} from "../core/index.js";
import { removeNode, normalizeToNodeArray } from "./nodes.js";

export interface TeleportProps {
  to: string | Element;
  disabled?: boolean | (() => boolean) | undefined;
  children?: Node | readonly Node[] | (() => unknown) | unknown;
}

export type PortalHandle = Node | readonly Node[];

/**
 * Surgically mounts children into a target DOM container (e.g. document.body)
 * while preserving parent Owner hierarchy, context inheritance, and scoped styles.
 */
export function Teleport(
  props: TeleportProps,
  parent?: Node | null,
  anchor?: Node | null
): PortalHandle {
  const marker = document.createComment("mix:teleport");
  const parentOwner = getCurrentOwner();

  if (parent) {
    parent.insertBefore(marker, anchor ?? null);
  }

  let childNodes: Node[] = [];
  let rootDisposer: (() => void) | null = null;

  createRoot((dispose) => {
    rootDisposer = dispose;
    const raw =
      typeof props.children === "function"
        ? (props.children as () => unknown)()
        : props.children;
    childNodes = normalizeToNodeArray(raw as Node | readonly Node[] | null | undefined);
  }, parentOwner);

  function resolveTarget(): Element | null {
    if (typeof props.to === "string") {
      if (typeof document !== "undefined") {
        return document.querySelector(props.to);
      }
      return null;
    }
    return props.to;
  }

  function isDisabled(): boolean {
    if (typeof props.disabled === "function") {
      return Boolean(props.disabled());
    }
    return Boolean(props.disabled);
  }

  let isFirstRun = true;

  createEffect(() => {
    const disabled = isDisabled();
    const target = resolveTarget();

    if (isFirstRun) {
      isFirstRun = false;
      if (!disabled && target) {
        for (const node of childNodes) {
          target.appendChild(node);
        }
      }
      return;
    }

    if (disabled || !target) {
      const p = marker.parentNode;
      if (p) {
        for (const node of childNodes) {
          p.insertBefore(node, marker);
        }
      }
    } else {
      for (const node of childNodes) {
        target.appendChild(node);
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

  const initiallyDisabled = isDisabled();
  const initialTarget = resolveTarget();
  if (initiallyDisabled || !initialTarget) {
    return [...childNodes, marker];
  }

  return marker;
}

export function createPortal(
  children: Node | readonly Node[] | (() => unknown) | unknown,
  container: string | Element,
  options?: { disabled?: boolean | (() => boolean) }
): PortalHandle {
  return Teleport({
    to: container,
    disabled: options?.disabled,
    children
  });
}
