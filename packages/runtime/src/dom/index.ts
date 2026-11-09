/**
 * @mix/runtime/dom — Surgical DOM adapter, conditional rendering, dynamic elements (D-105),
 * LIS keyed list reconciliation with Atomic Duplicate-Update Rejection (D-110 / HAA-02 Option A),
 * and HMR stable scope / trampoline dispatch (D-111).
 */

import { MixError, DiagnosticCodes } from "../errors.js";
import {
  signal,
  createEffect,
  createRoot,
  getCurrentOwner,
  runWithOwner,
  disposeOwner,
  onCleanup,
  untrack,
  withComponentProps,
  getActiveComponentProps,
  OwnerState,
  type Signal,
  type Owner
} from "../core/index.js";
import {
  setSafeSrcset,
  setSafeUrlAttribute,
  setSafeStyleProperty,
  setSafeStyleObject,
  setTrustedHtml
} from "../security/index.js";

// ============================================================================
// 1. Surgical DOM Creation & Mutation Primitives
// ============================================================================

export interface HydrationMismatch {
  expected: string;
  actual: string;
  node: Node;
}

export interface HydrateOptions {
  onMismatch?: (mismatch: HydrationMismatch) => void;
}

class HydrationWalker {
  public current: Node | null;
  public readonly container: Element;
  public readonly options?: HydrateOptions | undefined;

  constructor(container: Element, options?: HydrateOptions | undefined) {
    this.container = container;
    this.current = container.firstChild;
    this.options = options;
  }

  private advanceNext(node: Node): Node | null {
    if (node.firstChild) {
      return node.firstChild;
    }
    let p: Node | null = node;
    while (p && p !== this.container) {
      if (p.nextSibling) {
        return p.nextSibling;
      }
      p = p.parentNode;
    }
    return null;
  }

  public claimElement(tag: string): Element | null {
    while (this.current) {
      if (this.current.nodeType === 8) { // Comment
        this.current = this.advanceNext(this.current);
        continue;
      }
      if (this.current.nodeType === 3) { // Text
        if (!this.current.textContent || !this.current.textContent.trim()) {
          this.current = this.advanceNext(this.current);
          continue;
        }
      }
      if (this.current.nodeType === 1) { // Element
        const el = this.current as Element;
        if (el.tagName.toLowerCase() === tag.toLowerCase()) {
          this.current = this.advanceNext(el);
          return el;
        } else {
          // Mismatch
          const mismatch: HydrationMismatch = {
            expected: tag.toLowerCase(),
            actual: el.tagName.toLowerCase(),
            node: el,
          };
          this.options?.onMismatch?.(mismatch);
          return null;
        }
      }
      this.current = this.advanceNext(this.current);
    }
    return null;
  }

  public claimText(): Text | null {
    while (this.current) {
      if (this.current.nodeType === 8) { // Comment
        this.current = this.advanceNext(this.current);
        continue;
      }
      if (this.current.nodeType === 3) { // Text
        const textNode = this.current as Text;
        this.current = this.advanceNext(textNode);
        return textNode;
      }
      break;
    }
    return null;
  }

  public claimComment(dataPrefix?: string): Comment | null {
    while (this.current) {
      if (this.current.nodeType === 8) { // Comment
        const commentNode = this.current as Comment;
        if (!dataPrefix || commentNode.data.startsWith(dataPrefix)) {
          this.current = this.advanceNext(commentNode);
          return commentNode;
        }
      }
      this.current = this.advanceNext(this.current);
    }
    return null;
  }
}

let activeHydrationContext: HydrationWalker | null = null;

export function getHydrationContext(): HydrationWalker | null {
  return activeHydrationContext;
}

export function hydrate(
  component: (props?: Record<string, unknown>) => unknown,
  container: HTMLElement,
  options?: HydrateOptions
): () => void {
  const walker = new HydrationWalker(container, options);
  activeHydrationContext = walker;

  let rootDisposer: (() => void) | null = null;
  try {
    createRoot((dispose) => {
      rootDisposer = dispose;
      component();
    });
  } finally {
    activeHydrationContext = null;
  }

  return () => {
    if (rootDisposer) {
      rootDisposer();
      rootDisposer = null;
    }
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "poster"]);
const BOOLEAN_ATTRIBUTES = new Set([
  "disabled",
  "readonly",
  "required",
  "checked",
  "selected",
  "hidden",
  "multiple",
  "autofocus",
  "autoplay",
  "controls",
  "loop",
  "muted",
  "novalidate",
  "open",
  "reversed"
]);

export function createElement(tag: string, scopeAttr?: string): HTMLElement {
  if (activeHydrationContext) {
    const claimed = activeHydrationContext.claimElement(tag);
    if (claimed) {
      if (scopeAttr && !claimed.hasAttribute(scopeAttr)) {
        claimed.setAttribute(scopeAttr, "");
      }
      return claimed as HTMLElement;
    }
  }
  const el = document.createElement(tag);
  if (scopeAttr) {
    el.setAttribute(scopeAttr, "");
  }
  return el;
}

export function createSvgElement(tag: string, scopeAttr?: string): SVGElement {
  if (activeHydrationContext) {
    const claimed = activeHydrationContext.claimElement(tag);
    if (claimed) {
      if (scopeAttr && !claimed.hasAttribute(scopeAttr)) {
        claimed.setAttribute(scopeAttr, "");
      }
      return claimed as SVGElement;
    }
  }
  const el = document.createElementNS(SVG_NS, tag);
  if (scopeAttr) {
    el.setAttribute(scopeAttr, "");
  }
  return el;
}

export function createTextNode(text: string | number = ""): Text {
  if (activeHydrationContext) {
    const claimed = activeHydrationContext.claimText();
    if (claimed) {
      return claimed;
    }
  }
  return document.createTextNode(String(text));
}

export function createComment(data: string = ""): Comment {
  if (activeHydrationContext) {
    const claimed = activeHydrationContext.claimComment(data);
    if (claimed) {
      return claimed;
    }
  }
  return document.createComment(data);
}

const insertedNodesMap = new WeakMap<Text, Node[]>();

function isDomNode(val: unknown): val is Node {
  return typeof (val as { nodeType?: unknown })?.nodeType === "number";
}

export function setText(node: Text, value: unknown): void {
  const resolved = typeof value === "function" ? (value as () => unknown)() : value;

  if (isDomNode(resolved) || (Array.isArray(resolved) && resolved.length > 0 && isDomNode(resolved[0]))) {
    const prevNodes = insertedNodesMap.get(node) ?? [];
    for (const prev of prevNodes) {
      removeNode(prev);
    }
    const newNodes = normalizeToNodeArray(resolved);
    insertedNodesMap.set(node, newNodes);
    node.data = "";
    const parent = node.parentNode;
    if (parent) {
      for (const n of newNodes) {
        parent.insertBefore(n, node);
      }
    }
    return;
  }

  const prevNodes = insertedNodesMap.get(node);
  if (prevNodes && prevNodes.length > 0) {
    for (const prev of prevNodes) {
      removeNode(prev);
    }
    insertedNodesMap.delete(node);
  }

  const next = resolved === null || resolved === undefined || resolved === false ? "" : String(resolved);
  if (node.data !== next) {
    node.data = next;
  }
}

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

export function bindValue(
  el: HTMLElement,
  getter: () => unknown,
  setter: (val: unknown) => void
): void {
  const isInput = el.tagName === "INPUT";
  const inputType = isInput ? (el as HTMLInputElement).type : "";
  const isNumeric = inputType === "number" || inputType === "range";

  createEffect(() => {
    const val = getter();
    const str = val === null || val === undefined ? "" : String(val);
    if ((el as HTMLInputElement).value !== str) {
      (el as HTMLInputElement).value = str;
    }
  });

  const onInput = () => {
    const raw = (el as HTMLInputElement).value;
    if (isNumeric) {
      const num = raw === "" ? 0 : Number(raw);
      setter(Number.isNaN(num) ? raw : num);
    } else {
      setter(raw);
    }
  };

  el.addEventListener("input", onInput);
  el.addEventListener("change", onInput);
}

export function bindChecked(
  el: HTMLElement,
  getter: () => boolean,
  setter: (val: boolean) => void
): void {
  createEffect(() => {
    const checked = Boolean(getter());
    if ((el as HTMLInputElement).checked !== checked) {
      (el as HTMLInputElement).checked = checked;
    }
  });

  const onChange = () => {
    setter((el as HTMLInputElement).checked);
  };

  el.addEventListener("change", onChange);
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
          if (myGen === currentGen && (!parentOwner || parentOwner.ownerState === OwnerState.ACTIVE)) {
            mountBranch(() => thenRender(() => data));
          }
        },
        (err) => {
          if (myGen === currentGen && (!parentOwner || parentOwner.ownerState === OwnerState.ACTIVE)) {
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

export function setClassName(el: Element, value: unknown): void {
  if (value === null || value === undefined || value === false || value === "") {
    el.removeAttribute("class");
  } else {
    const str = String(value);
    if (el.getAttribute("class") !== str) {
      el.setAttribute("class", str);
    }
  }
}

export function toggleClass(el: Element, className: string, active: unknown): void {
  if (active) {
    el.classList.add(className);
  } else {
    el.classList.remove(className);
  }
}

export function setAttribute(el: Element, name: string, value: unknown): void {
  if (name === "mix-html") {
    setTrustedHtml(el, value);
    return;
  }
  if (name === "class" || name === "className") {
    setClassName(el, value);
    return;
  }
  if (name === "srcset") {
    if (value === null || value === undefined || value === false) {
      el.removeAttribute("srcset");
    } else {
      setSafeSrcset(el, String(value));
    }
    return;
  }
  if (URL_ATTRIBUTES.has(name.toLowerCase())) {
    if (value === null || value === undefined || value === false) {
      el.removeAttribute(name);
    } else {
      setSafeUrlAttribute(el, name, String(value));
    }
    return;
  }
  if (name === "style") {
    const htmlEl = el as HTMLElement;
    if (value === null || value === undefined || value === false || value === "") {
      htmlEl.removeAttribute("style");
      return;
    }
    if (typeof value === "object") {
      setSafeStyleObject(
        htmlEl,
        value as Record<string, string | number | null | undefined>
      );
      return;
    }
    if (typeof value === "string") {
      // Parse declarations and validate each property/value pair via D-108 security boundary
      const parts = value.split(";");
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) {
          throw new MixError(
            DiagnosticCodes.MIX_SEC_CSS_PROPERTY,
            `Malformed style declaration "${trimmed}".`
          );
        }
        const prop = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        setSafeStyleProperty(htmlEl, prop, val);
      }
      return;
    }
  }
  if (name.startsWith("style:")) {
    const prop = name.slice("style:".length);
    setSafeStyleProperty(
      el as HTMLElement,
      prop,
      value === null || value === undefined || value === false ? null : String(value)
    );
    return;
  }
  if (name.startsWith("class:")) {
    const cls = name.slice("class:".length);
    toggleClass(el, cls, value);
    return;
  }
  if (name === "value" && "value" in el) {
    const nextVal = value === null || value === undefined ? "" : String(value);
    if ((el as HTMLInputElement).value !== nextVal) {
      (el as HTMLInputElement).value = nextVal;
    }
    if (value === null || value === undefined) {
      el.removeAttribute("value");
    } else {
      el.setAttribute("value", nextVal);
    }
    return;
  }
  if (BOOLEAN_ATTRIBUTES.has(name.toLowerCase())) {
    const boolVal = Boolean(value);
    if (name in el) {
      try {
        (el as unknown as Record<string, unknown>)[name] = boolVal;
      } catch {
        // Ignore read-only DOM properties
      }
    }
    if (boolVal) {
      el.setAttribute(name, "");
    } else {
      el.removeAttribute(name);
    }
    return;
  }
  if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
  } else if (value === true) {
    el.setAttribute(name, "");
  } else {
    const str = String(value);
    if (el.getAttribute(name) !== str) {
      el.setAttribute(name, str);
    }
  }
}

export function addEventListener(
  el: EventTarget,
  eventName: string,
  handler: EventListener
): () => void {
  el.addEventListener(eventName, handler);
  const cleanup = (): void => {
    el.removeEventListener(eventName, handler);
  };
  if (getCurrentOwner()) {
    onCleanup(cleanup);
  }
  return cleanup;
}

export function bindRef<T extends Element>(
  el: T,
  target: ((node: T | null) => void) | { current: T | null } | null | undefined
): void {
  if (!target) return;
  if (typeof target === "function") {
    target(el);
    if (getCurrentOwner()) {
      onCleanup(() => target(null));
    }
  } else if (typeof target === "object" && "current" in target) {
    target.current = el;
    if (getCurrentOwner()) {
      onCleanup(() => {
        if (target.current === el) {
          target.current = null;
        }
      });
    }
  }
}

export function insertNode(parent: Node, node: Node, anchor?: Node | null): void {
  if (activeHydrationContext) {
    if (node.parentNode === parent) {
      return;
    }
  }
  parent.insertBefore(node, anchor ?? null);
}

export function removeNode(node: Node): void {
  if (node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

export function injectStylesheet(id: string, cssText: string): HTMLStyleElement | null {
  if (typeof document === "undefined" || !document.head) {
    return null;
  }
  const existing = document.head.querySelector(`style[data-mix-style="${id}"]`) as HTMLStyleElement | null;
  if (existing) {
    if (existing.textContent !== cssText) {
      existing.textContent = cssText;
    }
    return existing;
  }
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-mix-style", id);
  styleEl.textContent = cssText;
  document.head.appendChild(styleEl);
  return styleEl;
}

function normalizeToNodeArray(rendered: Node | readonly Node[] | null | undefined): Node[] {
  if (!rendered) return [];
  if (Array.isArray(rendered)) {
    return [...(rendered as readonly Node[])];
  }
  return [rendered as Node];
}

// ============================================================================
// 2. Conditional Rendering ({#if} / {:else if} / {:else})
// ============================================================================

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
  const marker = document.createComment("mix:if");
  parent.insertBefore(marker, anchor ?? null);

  let activeBranchIdx = -2;
  let activeDispose: (() => void) | null = null;
  let activeNodes: Node[] = [];
  const parentOwner = getCurrentOwner();

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
      chosenIdx >= 0
        ? branches[chosenIdx]!.render
        : elseRender ?? null;

    if (renderFn) {
      untrack(() => {
        createRoot((dispose) => {
          activeDispose = dispose;
          const nodes = normalizeToNodeArray(renderFn());
          activeNodes = nodes;
          const targetParent = marker.parentNode ?? parent;
          for (const node of nodes) {
            targetParent.insertBefore(node, marker);
          }
        }, parentOwner);
      });
    }
  });

  return marker;
}

// ============================================================================
// 3. Dynamic Elements (<{~expr}> — D-105, TECH-06) & Component Mounting
// ============================================================================

export interface MountedComponent {
  readonly nodes: readonly Node[];
  readonly owner: Owner | null;
  unmount(): void;
}

/**
 * D-105 & TECH-06: Resolves dynamic tag expression ONCE per element instance,
 * creates the element (or mounts component), and applies preserved attributes/children.
 */
export function createDynamicElement(
  tagOrFn: unknown,
  setupFn?: (el: Element) => void,
  scopeAttr?: string
): Node {
  const resolved = typeof tagOrFn === "function" && tagOrFn.length === 0
    ? untrack(() => (tagOrFn as () => unknown)())
    : tagOrFn;

  if (typeof resolved === "function") {
    // Component constructor/function
    const compNodes = normalizeToNodeArray(
      untrack(() => (resolved as (props: Record<string, unknown>) => Node | readonly Node[])({}))
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
      `Invalid dynamic element tag name: "${String(resolved)}" (D-105).`
    );
  }

  const el = createElement(resolved, scopeAttr);
  if (setupFn) {
    setupFn(el);
  }
  return el;
}

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

  createRoot((dispose) => {
    disposeFn = dispose;
    compOwner = getCurrentOwner();
    nodes = normalizeToNodeArray(withComponentProps(props, () => ComponentFn(props)));
    if (parent) {
      for (const node of nodes) {
        parent.insertBefore(node, anchor ?? null);
      }
    }
  }, parentOwner);

  if (parentOwner && compOwner) {
    onCleanup(() => {
      disposeFn();
      for (const node of nodes) {
        removeNode(node);
      }
    });
  }

  return {
    nodes,
    owner: compOwner,
    unmount(): void {
      disposeFn();
      for (const node of nodes) {
        removeNode(node);
      }
    }
  };
}

export function mount(
  ComponentFn: (props: Record<string, unknown>) => Node | readonly Node[],
  target: Element,
  props: Record<string, unknown> = {}
): MountedComponent {
  return mountComponent(ComponentFn, props, target, null);
}

// ============================================================================
// 4. Keyed List Reconciliation & O(N log N) LIS (D-110 / HAA-02 Option A)
// ============================================================================

/**
 * Computes the Longest Increasing Subsequence of non-negative values in `seq`
 * in O(N log N) time, returning the strictly increasing indices in `seq`.
 * Entries with `seq[i] < 0` (newly created rows) are ignored.
 * `seq[i] === 0` is handled accurately as a valid non-negative index.
 */
export function longestIncreasingSubsequence(seq: readonly number[]): number[] {
  const len = seq.length;
  if (len === 0) return [];

  const tails: number[] = []; // indices into `seq`
  const prev = new Int32Array(len).fill(-1);

  for (let i = 0; i < len; i++) {
    const val = seq[i]!;
    if (val < 0) {
      continue;
    }

    if (tails.length === 0 || seq[tails[tails.length - 1]!]! < val) {
      if (tails.length > 0) {
        prev[i] = tails[tails.length - 1]!;
      }
      tails.push(i);
      continue;
    }

    // Binary search for the smallest tail >= val
    let lo = 0;
    let hi = tails.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < val) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    if (val < seq[tails[lo]!]!) {
      if (lo > 0) {
        prev[i] = tails[lo - 1]!;
      }
      tails[lo] = i;
    }
  }

  const result = new Array<number>(tails.length);
  let k = tails.length;
  let curr = k > 0 ? tails[k - 1]! : -1;
  while (k > 0 && curr !== -1) {
    k--;
    result[k] = curr;
    curr = prev[curr]!;
  }
  return result;
}

interface KeyedRowEntry<T> {
  readonly key: string | number | symbol;
  readonly owner: Owner;
  readonly dispose: () => void;
  readonly itemSignal: Signal<T>;
  readonly indexSignal: Signal<number>;
  readonly nodes: Node[];
}

interface KeyedListState<T> {
  readonly endAnchor: Comment;
  entries: Map<string | number | symbol, KeyedRowEntry<T>>;
  order: KeyedRowEntry<T>[];
}

const containerListStateMap = new WeakMap<Node, KeyedListState<unknown>>();

function normalizeSameValueZeroKey(rawKey: unknown, index: number): string | number | symbol {
  if (
    rawKey === null ||
    rawKey === undefined ||
    (typeof rawKey !== "string" && typeof rawKey !== "number" && typeof rawKey !== "symbol") ||
    (typeof rawKey === "number" && Number.isNaN(rawKey))
  ) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_DUPLICATE_KEY,
      `Invalid key "${String(rawKey)}" at index ${index}: keys must be non-null strings, finite numbers, or symbols (D-110).`
    );
  }
  if (typeof rawKey === "number" && Object.is(rawKey, -0)) {
    return 0;
  }
  return rawKey;
}

function reconcileKeyedListInternal<T>(
  parent: Node,
  state: KeyedListState<T>,
  items: readonly T[],
  keyFn: (item: T, index: number) => string | number | symbol,
  createRowNodes: (item: T, indexSignal: Signal<number>, itemSignal: Signal<T>) => Node | readonly Node[],
  parentOwner: Owner | null
): void {
  // -------------------------------------------------------------------------
  // Step 1 (D-110 / HAA-02 Option A Strict): Pre-reconciliation Key Validation
  // Validate the ENTIRE incoming key collection upfront BEFORE any DOM/owner
  // allocation, movement, or disposal.
  // -------------------------------------------------------------------------
  const seenKeys = new Map<string | number | symbol, number>();
  const incomingKeys = new Array<string | number | symbol>(items.length);

  for (let i = 0; i < items.length; i++) {
    const rawKey = keyFn(items[i]!, i);
    const key = normalizeSameValueZeroKey(rawKey, i);
    const firstSeenIdx = seenKeys.get(key);
    if (firstSeenIdx !== undefined) {
      // Atomic rejection: zero DOM mutations, zero owner allocations/disposals
      throw new MixError(
        DiagnosticCodes.MIX_ERR_DUPLICATE_KEY,
        `Duplicate key "${String(key)}" detected at index ${i} (first seen at index ${firstSeenIdx}). Collection update atomically rejected (D-110 / HAA-02).`
      );
    }
    seenKeys.set(key, i);
    incomingKeys[i] = key;
  }

  // -------------------------------------------------------------------------
  // Step 2: Dispose and remove obsolete rows not present in `seenKeys`
  // -------------------------------------------------------------------------
  const survivingOrder: KeyedRowEntry<T>[] = [];
  for (const oldEntry of state.order) {
    if (!seenKeys.has(oldEntry.key)) {
      oldEntry.dispose();
      disposeOwner(oldEntry.owner);
      for (const node of oldEntry.nodes) {
        removeNode(node);
      }
      state.entries.delete(oldEntry.key);
    } else {
      survivingOrder.push(oldEntry);
    }
  }

  // Map surviving keys to their relative index in `survivingOrder` (0 .. survivingOrder.length - 1)
  const survivingIndexMap = new Map<string | number | symbol, number>();
  for (let i = 0; i < survivingOrder.length; i++) {
    survivingIndexMap.set(survivingOrder[i]!.key, i);
  }

  // -------------------------------------------------------------------------
  // Step 3: Build `nextOrder` and `seq` (old surviving indices or -1 for new)
  // -------------------------------------------------------------------------
  const nextOrder = new Array<KeyedRowEntry<T>>(items.length);
  const seq = new Array<number>(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const key = incomingKeys[i]!;
    const existing = state.entries.get(key);

    if (existing !== undefined) {
      existing.itemSignal.set(item);
      existing.indexSignal.set(i);
      nextOrder[i] = existing;
      seq[i] = survivingIndexMap.get(key)!;
    } else {
      let rowOwner!: Owner;
      let rowDispose!: () => void;
      const itemSig: Signal<T> = signal<T>(item);
      const indexSig: Signal<number> = signal<number>(i);
      let rowNodes: Node[] = [];

      untrack(() => {
        createRoot((dispose) => {
          rowDispose = dispose;
          rowOwner = getCurrentOwner()!;
          rowNodes = normalizeToNodeArray(createRowNodes(item, indexSig, itemSig));
        }, parentOwner);
      });

      const newEntry: KeyedRowEntry<T> = {
        key,
        owner: rowOwner,
        dispose: rowDispose,
        itemSignal: itemSig,
        indexSignal: indexSig,
        nodes: rowNodes
      };
      state.entries.set(key, newEntry);
      nextOrder[i] = newEntry;
      seq[i] = -1;
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Compute O(N log N) LIS of surviving indices and apply minimal moves
  // -------------------------------------------------------------------------
  const lisIndices = longestIncreasingSubsequence(seq);
  let lisPtr = lisIndices.length - 1;
  let nextAnchor: Node | null = state.endAnchor.parentNode === parent ? state.endAnchor : null;

  for (let i = nextOrder.length - 1; i >= 0; i--) {
    const entry = nextOrder[i]!;
    const isNew = seq[i] === -1;
    const isInLis = !isNew && lisPtr >= 0 && lisIndices[lisPtr] === i;

    if (isInLis) {
      lisPtr--;
    } else {
      // Insert or move row nodes before `nextAnchor`
      for (const node of entry.nodes) {
        parent.insertBefore(node, nextAnchor);
      }
    }

    if (entry.nodes.length > 0) {
      nextAnchor = entry.nodes[0]!;
    }
  }

  state.order = nextOrder;
}

/**
 * Direct imperative keyed list reconciler for `parent` container (D-110 / HAA-02).
 * Maintains reconciliation state per container across consecutive calls.
 */
export function renderKeyedList<T>(
  parent: HTMLElement,
  items: readonly T[],
  keyFn: (item: T, index: number) => string | number | symbol,
  renderFn: (item: T, indexGetter: () => number, itemGetter: () => T) => Node | readonly Node[]
): void {
  let state = containerListStateMap.get(parent) as KeyedListState<T> | undefined;
  if (!state) {
    const endAnchor = document.createComment("mix:each");
    parent.appendChild(endAnchor);
    state = {
      endAnchor,
      entries: new Map(),
      order: []
    };
    containerListStateMap.set(parent, state as KeyedListState<unknown>);
  }

  reconcileKeyedListInternal(
    parent,
    state,
    items,
    keyFn,
    (item, indexSig, itemSig) => renderFn(item, () => indexSig(), () => itemSig()),
    getCurrentOwner()
  );
}

/**
 * Reactive keyed `{#each}` block primitive used by compiled Mix/Tix templates.
 */
export function createKeyedEach<T>(
  parent: Node,
  itemsFn: () => readonly T[],
  keyFn: (item: T, index: number) => string | number | symbol,
  renderRowFn: (itemGetter: () => T, indexGetter: () => number) => Node | readonly Node[],
  anchor?: Node | null
): Comment {
  const endAnchor = document.createComment("mix:each");
  parent.insertBefore(endAnchor, anchor ?? null);

  const state: KeyedListState<T> = {
    endAnchor,
    entries: new Map(),
    order: []
  };
  const parentOwner = getCurrentOwner();

  if (parentOwner) {
    onCleanup(() => {
      for (const entry of state.order) {
        entry.dispose();
        disposeOwner(entry.owner);
        for (const node of entry.nodes) {
          removeNode(node);
        }
      }
      state.entries.clear();
      state.order = [];
      removeNode(endAnchor);
    });
  }

  createEffect(() => {
    const items = itemsFn();
    const targetParent = endAnchor.parentNode ?? parent;
    reconcileKeyedListInternal(
      targetParent,
      state,
      items,
      keyFn,
      (_item, indexSig, itemSig) =>
        runWithOwner(getCurrentOwner(), () =>
          renderRowFn(
            () => itemSig(),
            () => indexSig()
          )
        ),
      parentOwner
    );
  });

  return endAnchor;
}

// ============================================================================
// 5. HMR Stable Scope & Trampoline Dispatch Contract (D-111)
// ============================================================================

export type HmrMethod = (scope: Record<string, unknown>, ...args: unknown[]) => unknown;

export interface HmrScopeHandle<T extends Record<string, unknown>> {
  readonly scope: T;
  trampoline<Args extends unknown[], R>(methodName: string): (...args: Args) => R;
  dispose(): void;
}

interface HmrComponentRecord {
  signature: string;
  methods: Record<string, HmrMethod>;
  instances: Set<{
    scope: Record<string, unknown>;
    remount?: (() => void) | undefined;
  }>;
}

const hmrComponentRegistry = new Map<string, HmrComponentRecord>();

/**
 * D-111: Creates a stable per-instance `scope` object and returns a `trampoline`
 * dispatcher so event handlers and methods can be hot-swapped in place without
 * rebinding lexical closures or unmounting DOM state.
 */
export function createHmrScope<T extends Record<string, unknown>>(
  componentId: string,
  initialScope: T,
  methods: Record<string, HmrMethod> = {},
  signature: string = "v1",
  remount?: () => void
): HmrScopeHandle<T> {
  let record = hmrComponentRegistry.get(componentId);
  if (!record) {
    record = {
      signature,
      methods: { ...methods },
      instances: new Set()
    };
    hmrComponentRegistry.set(componentId, record);
  } else {
    record.methods = { ...record.methods, ...methods };
  }

  const instanceEntry = {
    scope: initialScope as Record<string, unknown>,
    remount
  };
  record.instances.add(instanceEntry);

  const cleanup = (): void => {
    record?.instances.delete(instanceEntry);
  };
  if (getCurrentOwner()) {
    onCleanup(cleanup);
  }

  return {
    scope: initialScope,
    trampoline<Args extends unknown[], R>(methodName: string): (...args: Args) => R {
      return (...args: Args): R => {
        const activeRecord = hmrComponentRegistry.get(componentId);
        const fn = activeRecord?.methods[methodName];
        if (typeof fn !== "function") {
          throw new MixError(
            DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER,
            `HMR trampoline method "${methodName}" not found on component "${componentId}".`
          );
        }
        return fn.call(initialScope, initialScope, ...args) as R;
      };
    },
    dispose: cleanup
  };
}

/**
 * Applies an HMR update for `componentId`.
 * Returns `true` if hot-swapped in place (signature matched), or `false` if a
 * structural signature change triggered instance remounts.
 */
export function applyHmrUpdate(
  componentId: string,
  update: {
    methods: Record<string, HmrMethod>;
    signature?: string;
  }
): boolean {
  const record = hmrComponentRegistry.get(componentId);
  if (!record) {
    hmrComponentRegistry.set(componentId, {
      signature: update.signature ?? "v1",
      methods: { ...update.methods },
      instances: new Set()
    });
    return true;
  }

  const nextSignature = update.signature ?? record.signature;
  record.methods = { ...record.methods, ...update.methods };

  if (nextSignature !== record.signature) {
    record.signature = nextSignature;
    for (const inst of [...record.instances]) {
      inst.remount?.();
    }
    return false;
  }

  return true;
}
