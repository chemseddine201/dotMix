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
import { handleRootFailure } from "./error-boundary.js";
import {
  registerHmrInstance,
  unregisterHmrInstance,
  generateInstanceKey,
  getActiveInstanceKey,
  setActiveInstanceKey,
  type HmrInstanceRecord,
  type HmrComponentFn
} from "./hot/index.js";

type HmrComponentMeta = {
  __mix_hmr_id?: string;
  __mix_dev?: { readonly name: string; readonly file?: string };
};

export interface MountedComponent {
  readonly nodes: readonly Node[];
  readonly owner: Owner | null;
  unmount(): void;
}

export type MountHandle = MountedComponent;

let lastFailedMountOwner: Owner | null = null;

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

  const meta = ComponentFn as unknown as HmrComponentMeta;
  const hmrId = meta.__mix_hmr_id;
  const devMeta = meta.__mix_dev;
  const tagOwner = (o: Owner | null): void => {
    if (!o) return;
    if (devMeta) {
      o.componentName = devMeta.name;
      if (devMeta.file) o.componentFile = devMeta.file;
    } else if (ComponentFn.name) {
      o.componentName = ComponentFn.name;
    }
  };
  let startMarker: Comment | null = null;
  let endMarker: Comment | null = null;
  let hmrRecord: HmrInstanceRecord | null = null;

  const invoke = (): Node[] => {
    try {
      return normalizeToNodeArray(withComponentProps(props, () => ComponentFn(props)));
    } catch (err) {
      if (!lastFailedMountOwner) lastFailedMountOwner = compOwner;
      throw err;
    }
  };

  if (hmrId && typeof document !== "undefined") {
    const instanceKey = generateInstanceKey(hmrId, props);
    startMarker = document.createComment(`mix:hmr-start:${instanceKey}`);
    endMarker = document.createComment(`mix:hmr-end:${instanceKey}`);
    if (parent) parent.insertBefore(startMarker, anchor ?? null);

    const prevKey = getActiveInstanceKey();
    setActiveInstanceKey(instanceKey);

    try {
      createRoot((dispose) => {
        disposeFn = dispose;
        compOwner = getCurrentOwner();
        tagOwner(compOwner);
        nodes = invoke();
        if (parent) {
          for (const node of nodes) parent.insertBefore(node, anchor ?? null);
          parent.insertBefore(endMarker!, anchor ?? null);
        }
      }, parentOwner);
    } finally {
      setActiveInstanceKey(prevKey);
    }

    hmrRecord = registerHmrInstance(
      hmrId, ComponentFn as unknown as HmrComponentFn, props,
      startMarker, endMarker, compOwner, disposeFn, instanceKey, nodes
    );
  } else {
    const walker = getHydrationContext();
    const compOpen = walker ? walker.claimComment("mix:c:") : null;
    const compClose = walker && compOpen ? walker.findClosingComment(compOpen, "mix:c:") : null;

    createRoot((dispose) => {
      disposeFn = dispose;
      compOwner = getCurrentOwner();
      tagOwner(compOwner);
      if (walker && compOpen && compClose) {
        nodes = runWithHydrationSubtree(
          walker, compOpen, compClose,
          () => {
            walker.pushScope();
            const res = invoke();
            const scoped = walker.popScope();
            return res.length > 0 ? res : scoped;
          },
          () => {
            const res = invoke();
            const targetParent = compClose.parentNode ?? parent;
            if (targetParent) {
              for (const node of res) targetParent.insertBefore(node, compClose);
            }
            return res;
          }
        );
        if (parent && parent.nodeType === 11) {
          for (const n of nodes) walker.recordScopeNode(n);
        }
      } else if (walker) {
        walker.pushScope();
        const res = invoke();
        const scoped = walker.popScope();
        nodes = res.length > 0 ? res : scoped;
        if (walker.hasMismatch() && parent) {
          walker.clearMismatch();
          if (parent.nodeType !== 11 && "replaceChildren" in parent) {
            (parent as Element).replaceChildren();
          }
          nodes = runWithoutHydration(() => invoke());
          for (const node of nodes) parent.insertBefore(node, anchor ?? null);
        } else if (parent && parent.nodeType === 11) {
          for (const n of nodes) walker.recordScopeNode(n);
        }
      } else {
        nodes = invoke();
        if (parent) {
          for (const node of nodes) parent.insertBefore(node, anchor ?? null);
        }
      }
    }, parentOwner);
  }

  const cleanup = (): void => {
    if (hmrRecord) unregisterHmrInstance(hmrRecord);
    disposeFn();
    for (const node of nodes) removeNode(node);
    if (startMarker) removeNode(startMarker);
    if (endMarker) removeNode(endMarker);
  };

  if (parentOwner && compOwner) onCleanup(cleanup);

  return { nodes, owner: compOwner, unmount: cleanup };
}

function runWithRootSafetyNet(
  source: "mount" | "hydrate",
  target: Element,
  options: HydrateOptions | undefined,
  run: () => MountedComponent
): MountedComponent {
  let activeHandle: MountedComponent | null = null;
  let rootOwner: Owner | null = null;
  let didMount = false;
  let outerDispose: () => void = () => {};

  lastFailedMountOwner = null;
  try {
    createRoot((dispose) => {
      outerDispose = dispose;
      rootOwner = getCurrentOwner();
      if (rootOwner) {
        rootOwner.errorHandler = (err) => {
          const handled = handleRootFailure(err, source, target, lastFailedMountOwner ?? activeHandle?.owner ?? rootOwner, options, !didMount);
          if (!handled && !didMount) throw err;
        };
      }
      activeHandle = run();
      didMount = true;
    }, null);
  } catch (err) {
    const failedOwner = lastFailedMountOwner ?? (activeHandle as MountedComponent | null)?.owner ?? rootOwner;
    lastFailedMountOwner = null;
    const handled = handleRootFailure(err, source, target, failedOwner, options, true);
    try { outerDispose(); } catch { /* ignore */ }
    if (!handled) throw err;
    return { nodes: [], owner: rootOwner, unmount: outerDispose };
  }
  lastFailedMountOwner = null;

  const handle = activeHandle!;
  return {
    nodes: handle.nodes,
    owner: handle.owner,
    unmount: () => {
      handle.unmount();
      outerDispose();
    }
  };
}

export function hydrateRoot(
  ComponentFn: (props: Record<string, unknown>) => Node | readonly Node[],
  target: Element,
  props: Record<string, unknown> = {},
  options?: HydrateOptions
): MountedComponent {
  return runWithRootSafetyNet("hydrate", target, options, () => {
    const walker = new HydrationWalker(target, options);
    const prevContext = setHydrationContext(walker);
    let mounted!: MountedComponent;
    try {
      mounted = untrack(() => mountComponent(ComponentFn, props, target, null));
    } finally {
      setHydrationContext(prevContext);
    }
    if (target.hasAttribute("data-mix-ssr")) target.removeAttribute("data-mix-ssr");
    return mounted;
  });
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

  if (shouldHydrate) return hydrateRoot(ComponentFn, target, props, options);

  return runWithRootSafetyNet("mount", target, options, () => {
    if (target.hasAttribute("data-mix-prerendered")) {
      target.removeAttribute("data-mix-prerendered");
      target.replaceChildren();
    }
    return mountComponent(ComponentFn, props, target, null);
  });
}
