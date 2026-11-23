/**
 * @dotmix/runtime/dom/control-flow — Slot rendering, {#await}, {#if}, dynamic elements,
 * and component mounting primitives.
 */

import { MixError, DiagnosticCodes } from "../errors.js";
import {
  createEffect,
  createRoot,
  getCurrentOwner,
  onCleanup,
  untrack,
  getActiveComponentProps,
  OwnerState
} from "../core/index.js";
import {
  getHydrationContext,
  runWithHydrationSubtree
} from "./hydration.js";
import {
  createElement,
  createComment,
  insertNode,
  removeNode,
  normalizeToNodeArray
} from "./nodes.js";

export {
  mountComponent,
  hydrateRoot,
  mount,
  type MountedComponent,
  type MountHandle
} from "./mount.js";

export function renderSlot(
  parent: Node,
  name: string | null = null,
  fallback?: (() => Node | readonly Node[]) | null
): Node {
  const slotName = name ?? "default";
  const marker = createComment(`slot:${slotName}`);
  insertNode(parent, marker);

  const props = getActiveComponentProps() as {
    slots?: Record<string, () => unknown>;
    children?: unknown;
  } | null;

  let slotFn: (() => unknown) | null = null;
  if (props?.slots && typeof props.slots[slotName] === "function") {
    slotFn = props.slots[slotName]!;
  } else if (slotName === "default" && props?.children !== undefined) {
    if (typeof props.children === "function") {
      slotFn = props.children as () => unknown;
    } else {
      slotFn = () => props.children;
    }
  }

  const renderContent = slotFn ?? fallback ?? null;
  if (renderContent) {
    const parentOwner = getCurrentOwner();
    createRoot((dispose) => {
      onCleanup(dispose);
      const res = renderContent() as Node | readonly Node[] | null | undefined;
      const nodes = normalizeToNodeArray(res);
      const targetParent = marker.parentNode ?? parent;
      for (const n of nodes) {
        targetParent.insertBefore(n, marker);
      }
      onCleanup(() => {
        for (const n of nodes) {
          removeNode(n);
        }
      });
    }, parentOwner);
  }

  return marker;
}

export function createAwaitBlock(
  parent: Node,
  promiseSource: () => unknown,
  pendingRender: () => Node | readonly Node[],
  thenRender: (valGetter: () => unknown) => Node | readonly Node[],
  catchRender?: ((errGetter: () => unknown) => Node | readonly Node[]) | null
): Node {
  const marker = createComment("await");
  insertNode(parent, marker);

  let activeDispose: (() => void) | null = null;
  let activeNodes: Node[] = [];
  let currentGen = 0;
  const parentOwner = getCurrentOwner();

  function teardown(): void {
    if (activeDispose) {
      try {
        activeDispose();
      } finally {
        activeDispose = null;
      }
    }
    for (const n of activeNodes) {
      removeNode(n);
    }
    activeNodes = [];
  }

  onCleanup(teardown);

  function mountBranch(renderFn: () => Node | readonly Node[]): void {
    teardown();
    createRoot((dispose) => {
      activeDispose = dispose;
      const res = renderFn() as Node | readonly Node[] | null | undefined;
      const nodes = normalizeToNodeArray(res);
      activeNodes = nodes;
      const targetParent = marker.parentNode ?? parent;
      for (const n of nodes) {
        targetParent.insertBefore(n, marker);
      }
    }, parentOwner);
  }

  createEffect(() => {
    const raw = promiseSource();
    const myGen = ++currentGen;

    // Show pending branch initially
    mountBranch(pendingRender);

    // If it's a promise (or has .then)
    if (raw && typeof (raw as Promise<unknown>).then === "function") {
      (raw as Promise<unknown>).then(
        (data) => {
          if (
            myGen === currentGen &&
            (!parentOwner || parentOwner.ownerState === OwnerState.ACTIVE)
          ) {
            mountBranch(() => thenRender(() => data));
          }
        },
        (err) => {
          if (
            myGen === currentGen &&
            (!parentOwner || parentOwner.ownerState === OwnerState.ACTIVE)
          ) {
            if (catchRender) {
              mountBranch(() => catchRender(() => err));
            }
          }
        }
      );
    } else {
      // Synchronous resolved value
      mountBranch(() => thenRender(() => raw));
    }
  });

  return marker;
}

export interface ConditionalBranch {
  readonly condition: () => unknown;
  readonly render: () => Node | readonly Node[];
}

export function createConditional(
  parent: Node,
  branches: ReadonlyArray<ConditionalBranch>,
  elseRender?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const initialWalker = getHydrationContext();
  const openMarker = initialWalker ? initialWalker.claimComment("mix:if:") : null;
  const closeMarker =
    initialWalker && openMarker ? initialWalker.findClosingComment(openMarker, "mix:if:") : null;
  const marker = closeMarker ?? document.createComment("mix:if");
  if (!closeMarker) {
    parent.insertBefore(marker, anchor ?? null);
  } else if (parent.nodeType === 11 && initialWalker) {
    initialWalker.recordScopeNode(marker);
  }

  let activeBranchIdx = -2;
  let activeDispose: (() => void) | null = null;
  let activeNodes: Node[] = [];
  const parentOwner = getCurrentOwner();
  let isFirstHydrateRun = Boolean(initialWalker && openMarker && closeMarker);

  const teardownActive = (): void => {
    if (activeDispose) {
      activeDispose();
      activeDispose = null;
    }
    for (const node of activeNodes) {
      removeNode(node);
    }
    activeNodes = [];
  };

  if (parentOwner) {
    onCleanup(teardownActive);
  }

  createEffect(() => {
    let chosenIdx = -1;
    for (let i = 0; i < branches.length; i++) {
      if (branches[i]!.condition()) {
        chosenIdx = i;
        break;
      }
    }

    if (chosenIdx === activeBranchIdx) {
      return;
    }

    teardownActive();
    activeBranchIdx = chosenIdx;

    const renderFn =
      chosenIdx >= 0 ? branches[chosenIdx]!.render : elseRender ?? null;

    if (renderFn) {
      const walkerForRun = isFirstHydrateRun ? initialWalker : null;
      isFirstHydrateRun = false;
      untrack(() => {
        createRoot((dispose) => {
          activeDispose = dispose;
          if (walkerForRun && openMarker && closeMarker) {
            const hydratedNodes = runWithHydrationSubtree(
              walkerForRun,
              openMarker,
              closeMarker,
              () => {
                walkerForRun.pushScope();
                const res = normalizeToNodeArray(renderFn());
                const scoped = walkerForRun.popScope();
                return res.length > 0 ? res : scoped;
              },
              () => {
                const res = normalizeToNodeArray(renderFn());
                const targetParent = closeMarker.parentNode ?? parent;
                for (const node of res) {
                  targetParent.insertBefore(node, closeMarker);
                }
                return res;
              }
            );
            activeNodes = hydratedNodes;
          } else {
            const nodes = normalizeToNodeArray(renderFn());
            activeNodes = nodes;
            const targetParent = marker.parentNode ?? parent;
            for (const node of nodes) {
              targetParent.insertBefore(node, marker);
            }
          }
        }, parentOwner);
      });
    } else if (isFirstHydrateRun && initialWalker && openMarker && closeMarker) {
      isFirstHydrateRun = false;
      runWithHydrationSubtree(
        initialWalker,
        openMarker,
        closeMarker,
        () => [] as Node[],
        () => [] as Node[]
      );
    }
  });

  return marker;
}

/**
 * & TEC: Resolves dynamic tag expression ONCE per element instance,
 * creates the element (or mounts component), and applies preserved attributes/children.
 */
export function createDynamicElement(
  tagOrFn: unknown,
  setupFn?: (el: Element) => void,
  scopeAttr?: string
): Node {
  const resolved =
    typeof tagOrFn === "function" && tagOrFn.length === 0
      ? untrack(() => (tagOrFn as () => unknown)())
      : tagOrFn;

  if (typeof resolved === "function") {
    // Component constructor/function
    const compNodes = normalizeToNodeArray(
      untrack(() =>
        (resolved as (props: Record<string, unknown>) => Node | readonly Node[])({})
      )
    );
    if (compNodes.length === 1) {
      const first = compNodes[0]!;
      if (setupFn && "tagName" in first) {
        setupFn(first as Element);
      }
      return first;
    }
    const frag = document.createDocumentFragment();
    for (const n of compNodes) {
      frag.appendChild(n);
    }
    return frag;
  }

  if (typeof resolved !== "string" || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(resolved)) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      `Invalid dynamic element tag name: "${String(resolved)}".`
    );
  }

  const el = createElement(resolved, scopeAttr);
  if (setupFn) {
    setupFn(el);
  }
  return el;
}
