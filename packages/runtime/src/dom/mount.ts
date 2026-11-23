/**
 * @dotmix/runtime/dom/mount — Component mounting and root hydration entry points.
 */

import {
  createRoot,
  getCurrentOwner,
  onCleanup,
  untrack,
  withComponentProps,
  type Owner
} from "../core/index.js";
import {
  HydrationWalker,
  getHydrationContext,
  setHydrationContext,
  runWithoutHydration,
  runWithHydrationSubtree,
  type HydrateOptions,
  type MountOptions
} from "./hydration.js";
import { removeNode, normalizeToNodeArray } from "./nodes.js";
import {
  registerHmrInstance,
  unregisterHmrInstance,
  generateInstanceKey,
  getActiveInstanceKey,
  setActiveInstanceKey,
  type HmrInstanceRecord,
  type HmrComponentFn
} from "./hot/index.js";

type HmrComponentMeta = { __mix_hmr_id?: string };

export interface MountedComponent {
  readonly nodes: readonly Node[];
  readonly owner: Owner | null;
  unmount(): void;
}

export type MountHandle = MountedComponent;

export function mountComponent<P extends Record<string, unknown>>(
  ComponentFn: (props: P) => Node | readonly Node[],
  props: P,
  parent?: Node | null,
  anchor?: Node | null
): MountedComponent {
  const parentOwner = getCurrentOwner();
  let disposeFn: () => void = () => {};
  let compOwner: Owner | null = null;
  let nodes: Node[] = [];

  const hmrId = (ComponentFn as unknown as HmrComponentMeta).__mix_hmr_id;
  let startMarker: Comment | null = null;
  let endMarker: Comment | null = null;
  let hmrRecord: HmrInstanceRecord | null = null;

  if (hmrId && typeof document !== "undefined") {
    const instanceKey = generateInstanceKey(hmrId, props);
    startMarker = document.createComment(`mix:hmr-start:${instanceKey}`);
    endMarker = document.createComment(`mix:hmr-end:${instanceKey}`);
    if (parent) {
      parent.insertBefore(startMarker, anchor ?? null);
    }

    const prevKey = getActiveInstanceKey();
    setActiveInstanceKey(instanceKey);

    try {
      createRoot((dispose) => {
        disposeFn = dispose;
        compOwner = getCurrentOwner();
        nodes = normalizeToNodeArray(
          withComponentProps(props, () => ComponentFn(props))
        );
        if (parent) {
          for (const node of nodes) {
            parent.insertBefore(node, anchor ?? null);
          }
          parent.insertBefore(endMarker!, anchor ?? null);
        }
      }, parentOwner);
    } finally {
      setActiveInstanceKey(prevKey);
    }

    hmrRecord = registerHmrInstance(
      hmrId,
      ComponentFn as unknown as HmrComponentFn,
      props,
      startMarker,
      endMarker,
      compOwner,
      disposeFn,
      instanceKey,
      nodes
    );
  } else {
    const walker = getHydrationContext();
    const compOpen = walker ? walker.claimComment("mix:c:") : null;
    const compClose = walker && compOpen ? walker.findClosingComment(compOpen, "mix:c:") : null;

    createRoot((dispose) => {
      disposeFn = dispose;
      compOwner = getCurrentOwner();
      if (walker && compOpen && compClose) {
        nodes = runWithHydrationSubtree(
          walker,
          compOpen,
          compClose,
          () => {
            walker.pushScope();
            const res = normalizeToNodeArray(withComponentProps(props, () => ComponentFn(props)));
            const scoped = walker.popScope();
            return res.length > 0 ? res : scoped;
          },
          () => {
            const res = normalizeToNodeArray(withComponentProps(props, () => ComponentFn(props)));
            const targetParent = compClose.parentNode ?? parent;
            if (targetParent) {
              for (const node of res) {
                targetParent.insertBefore(node, compClose);
              }
            }
            return res;
          }
        );
        if (parent && parent.nodeType === 11) {
          for (const n of nodes) walker.recordScopeNode(n);
        }
      } else if (walker) {
        walker.pushScope();
        const res = normalizeToNodeArray(withComponentProps(props, () => ComponentFn(props)));
        const scoped = walker.popScope();
        nodes = res.length > 0 ? res : scoped;
        if (walker.hasMismatch() && parent) {
          walker.clearMismatch();
          if (parent.nodeType !== 11 && "replaceChildren" in parent) {
            (parent as Element).replaceChildren();
          }
          nodes = runWithoutHydration(() =>
            normalizeToNodeArray(withComponentProps(props, () => ComponentFn(props)))
          );
          for (const node of nodes) {
            parent.insertBefore(node, anchor ?? null);
          }
        } else if (parent && parent.nodeType === 11) {
          for (const n of nodes) walker.recordScopeNode(n);
        }
      } else {
        nodes = normalizeToNodeArray(
          withComponentProps(props, () => ComponentFn(props))
        );
        if (parent) {
          for (const node of nodes) {
            parent.insertBefore(node, anchor ?? null);
          }
        }
      }
    }, parentOwner);
  }

  const cleanup = (): void => {
    if (hmrRecord) {
      unregisterHmrInstance(hmrRecord);
    }
    disposeFn();
    for (const node of nodes) {
      removeNode(node);
    }
    if (startMarker) removeNode(startMarker);
    if (endMarker) removeNode(endMarker);
  };

  if (parentOwner && compOwner) {
    onCleanup(cleanup);
  }

  return {
    nodes,
    owner: compOwner,
    unmount: cleanup
  };
}

export function hydrateRoot(
  ComponentFn: (props: Record<string, unknown>) => Node | readonly Node[],
  target: Element,
  props: Record<string, unknown> = {},
  options?: HydrateOptions
): MountedComponent {
  const walker = new HydrationWalker(target, options);
  const prevContext = setHydrationContext(walker);
  let mounted!: MountedComponent;
  try {
    mounted = untrack(() => mountComponent(ComponentFn, props, target, null));
  } finally {
    setHydrationContext(prevContext);
  }
  if (target.hasAttribute("data-mix-ssr")) {
    target.removeAttribute("data-mix-ssr");
  }
  return mounted;
}

export function mount(
  ComponentFn: (props: Record<string, unknown>) => Node | readonly Node[],
  target: Element,
  props: Record<string, unknown> = {},
  options?: MountOptions
): MountedComponent {
  const shouldHydrate =
    options?.hydrate === true ||
    (options?.hydrate !== false && target.hasAttribute("data-mix-ssr"));

  if (shouldHydrate) {
    return hydrateRoot(ComponentFn, target, props, options);
  }

  if (target.hasAttribute("data-mix-prerendered")) {
    target.removeAttribute("data-mix-prerendered");
    target.replaceChildren();
  }
  return mountComponent(ComponentFn, props, target, null);
}

