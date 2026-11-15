/**
 * @dotmix/runtime/dom/directives/stacks-head — Stacks, JSON helpers & head re-exports.
 */

import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getContext,
  getCurrentOwner,
  onCleanup,
  untrack,
  type Signal
} from "../../core/index.js";
import {
  createComment,
  createElement,
  insertNode,
  normalizeToNodeArray,
  removeNode
} from "../nodes.js";
import type { StackCollector } from "./contract-types.js";

export { __mixCreateHeadCollector, __mixHead } from "./head.js";

// ---------------------------------------------------------------------------
// SSR Stack Collector
// ---------------------------------------------------------------------------

interface SsrStackBucket {
  readonly prepends: string[];
  readonly pushes: string[];
  readonly seenOnce: Set<string>;
}

export function __mixCreateStackCollector(): StackCollector {
  const stacks = new Map<string, SsrStackBucket>();

  const getBucket = (name: string): SsrStackBucket => {
    let bucket = stacks.get(name);
    if (!bucket) {
      bucket = { prepends: [], pushes: [], seenOnce: new Set() };
      stacks.set(name, bucket);
    }
    return bucket;
  };

  const getEntries = (stackName: string): readonly string[] => {
    const bucket = stacks.get(stackName);
    if (!bucket) {
      return [];
    }
    return [...bucket.prepends, ...bucket.pushes];
  };

  return {
    push(stackName: string, content: string, onceId?: string): void {
      const bucket = getBucket(stackName);
      if (onceId !== undefined) {
        if (bucket.seenOnce.has(onceId)) {
          return;
        }
        bucket.seenOnce.add(onceId);
      }
      bucket.pushes.push(content);
    },
    prepend(stackName: string, content: string, onceId?: string): void {
      const bucket = getBucket(stackName);
      if (onceId !== undefined) {
        if (bucket.seenOnce.has(onceId)) {
          return;
        }
        bucket.seenOnce.add(onceId);
      }
      bucket.prepends.push(content);
    },
    getEntries,
    render(stackName: string): string {
      return getEntries(stackName).join("");
    },
    has(stackName: string): boolean {
      const bucket = stacks.get(stackName);
      return bucket !== undefined && bucket.prepends.length + bucket.pushes.length > 0;
    }
  };
}

// ---------------------------------------------------------------------------
// Client DOM Stacks
// ---------------------------------------------------------------------------

interface DomStackEntry {
  readonly id: symbol;
  readonly onceId: string | undefined;
  readonly nodes: Node[];
  readonly dispose: () => void;
}

interface DomStackBucket {
  readonly prepends: DomStackEntry[];
  readonly pushes: DomStackEntry[];
  readonly onceIds: Set<string>;
  readonly version: Signal<number>;
}

export interface DomStackRegistry {
  getBucket(name: string): DomStackBucket;
}

function createDomStackRegistry(): DomStackRegistry {
  const buckets = new Map<string, DomStackBucket>();
  return {
    getBucket(name: string): DomStackBucket {
      let bucket = buckets.get(name);
      if (!bucket) {
        bucket = {
          prepends: [],
          pushes: [],
          onceIds: new Set(),
          version: createSignal(0)
        };
        buckets.set(name, bucket);
      }
      return bucket;
    }
  };
}

export const DomStackRegistryContext = createContext<DomStackRegistry | null>(null);
const defaultDomStackRegistry = createDomStackRegistry();

function resolveDomStackRegistry(): DomStackRegistry {
  return getContext(DomStackRegistryContext) ?? defaultDomStackRegistry;
}

function addStackEntry(
  stackName: string,
  mode: "push" | "prepend",
  factory: () => Node | readonly Node[],
  onceId?: string
): void {
  const registry = resolveDomStackRegistry();
  const bucket = registry.getBucket(stackName);

  if (onceId !== undefined && bucket.onceIds.has(onceId)) {
    return;
  }
  if (onceId !== undefined) {
    bucket.onceIds.add(onceId);
  }

  const pushOwner = getCurrentOwner();
  let disposeEntry: () => void = () => {};
  let nodes: Node[] = [];

  untrack(() => {
    createRoot((dispose) => {
      disposeEntry = dispose;
      nodes = normalizeToNodeArray(factory());
    }, pushOwner);
  });

  const entry: DomStackEntry = {
    id: Symbol("mix.stack.entry"),
    onceId,
    nodes,
    dispose: disposeEntry
  };

  if (mode === "prepend") {
    bucket.prepends.push(entry);
  } else {
    bucket.pushes.push(entry);
  }
  bucket.version.set((v) => v + 1);

  if (pushOwner) {
    onCleanup(() => {
      const targetList = mode === "prepend" ? bucket.prepends : bucket.pushes;
      const idx = targetList.indexOf(entry);
      if (idx !== -1) {
        targetList.splice(idx, 1);
      }
      if (entry.onceId !== undefined) {
        bucket.onceIds.delete(entry.onceId);
      }
      entry.dispose();
      for (const node of entry.nodes) {
        removeNode(node);
      }
      bucket.version.set((v) => v + 1);
    });
  }
}

export function __mixPushStack(
  stackName: string,
  factory: () => Node | readonly Node[],
  onceId?: string
): void {
  addStackEntry(stackName, "push", factory, onceId);
}

export function __mixPrependStack(
  stackName: string,
  factory: () => Node | readonly Node[],
  onceId?: string
): void {
  addStackEntry(stackName, "prepend", factory, onceId);
}

export function __mixRenderStack(
  parent: Node,
  stackName: string,
  anchor?: Node | null
): Comment {
  const marker = createComment(`mix:stack:${stackName}`);
  insertNode(parent, marker, anchor ?? null);
  const registry = resolveDomStackRegistry();
  const bucket = registry.getBucket(stackName);

  createEffect(() => {
    void bucket.version();
    const targetParent = marker.parentNode ?? parent;
    const allNodes: Node[] = [];
    for (let i = 0; i < bucket.prepends.length; i++) {
      allNodes.push(...bucket.prepends[i]!.nodes);
    }
    for (let i = 0; i < bucket.pushes.length; i++) {
      allNodes.push(...bucket.pushes[i]!.nodes);
    }

    let nextAnchor: Node = marker;
    for (let i = allNodes.length - 1; i >= 0; i--) {
      const node = allNodes[i]!;
      if (node.parentNode !== targetParent || node.nextSibling !== nextAnchor) {
        targetParent.insertBefore(node, nextAnchor);
      }
      nextAnchor = node;
    }
  });

  if (getCurrentOwner()) {
    onCleanup(() => {
      removeNode(marker);
    });
  }

  return marker;
}

// ---------------------------------------------------------------------------
// JSON Escaping & <script type="application/json">
// ---------------------------------------------------------------------------

export function __mixEscapeJson(jsonText: string): string {
  return jsonText
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function __mixJson(value: unknown, space?: number): string {
  const serialized = JSON.stringify(value, null, space) ?? "null";
  return __mixEscapeJson(serialized);
}

export function __mixJsonScript(
  parent: Node,
  id: string,
  valueFn: () => unknown,
  anchor?: Node | null
): HTMLScriptElement {
  const script = createElement("script") as HTMLScriptElement;
  script.setAttribute("type", "application/json");
  script.setAttribute("id", id);
  createEffect(() => {
    script.textContent = __mixJson(valueFn());
  });
  insertNode(parent, script, anchor ?? null);
  return script;
}
