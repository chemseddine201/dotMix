/**
 * @dotmix/runtime/dom/directives/shared — Shared anchor-region mounting and disposal helpers.
 */

import {
  createRoot,
  getCurrentOwner,
  onCleanup,
  untrack,
  type Owner
} from "../../core/index.js";
import {
  createComment,
  insertNode,
  normalizeToNodeArray,
  removeNode
} from "../nodes.js";

export interface AnchorRegion {
  readonly marker: Comment;
  readonly parentOwner: Owner | null;
  mount(renderFn: (() => Node | readonly Node[]) | null | undefined): void;
  teardown(): void;
}

export function createAnchorRegion(
  parent: Node,
  label: string,
  anchor?: Node | null
): AnchorRegion {
  const marker = createComment(label);
  insertNode(parent, marker, anchor ?? null);

  let activeDispose: (() => void) | null = null;
  let activeNodes: Node[] = [];
  const parentOwner = getCurrentOwner();

  const teardown = (): void => {
    if (activeDispose) {
      const dispose = activeDispose;
      activeDispose = null;
      dispose();
    }
    for (const node of activeNodes) {
      removeNode(node);
    }
    activeNodes = [];
  };

  if (parentOwner) {
    onCleanup(() => {
      teardown();
      removeNode(marker);
    });
  }

  const mount = (renderFn: (() => Node | readonly Node[]) | null | undefined): void => {
    teardown();
    if (!renderFn) {
      return;
    }
    untrack(() => {
      createRoot((dispose) => {
        activeDispose = dispose;
        const rendered = renderFn();
        const nodes = normalizeToNodeArray(rendered);
        activeNodes = nodes;
        const targetParent = marker.parentNode ?? parent;
        for (const node of nodes) {
          insertNode(targetParent, node, marker);
        }
      }, parentOwner);
    });
  };

  return {
    marker,
    parentOwner,
    mount,
    teardown
  };
}
