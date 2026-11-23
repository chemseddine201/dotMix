/**
 * @dotmix/runtime/dom/hydration — SSR/SSG Hydration walker, claim primitives, and subtree mismatch recovery.
 */

import { createRoot } from "../core/index.js";

export interface HydrationMismatch {
  readonly expected: string;
  readonly actual: string;
  readonly node: Node | null;
  readonly component?: string | undefined;
}

export interface HydrateOptions {
  readonly onMismatch?: ((mismatch: HydrationMismatch) => void) | undefined;
  readonly dev?: boolean | undefined;
}

export interface MountOptions extends HydrateOptions {
  /**
   * When true, adopts SSR/SSG DOM inside `target`.
   * When omitted, auto-hydrates if `target.hasAttribute("data-mix-ssr")`.
   * When false, clears `target` and mounts client-side from scratch.
   */
  readonly hydrate?: boolean | undefined;
}

export class HydrationWalker {
  public current: Node | null;
  public readonly container: Element;
  public readonly options?: HydrateOptions | undefined;
  private readonly scopeStack: Node[][] = [];
  private mismatchFlag = false;

  constructor(container: Element, options?: HydrateOptions | undefined) {
    this.container = container;
    this.current = container.firstChild;
    this.options = options;
  }

  public hasMismatch(): boolean {
    return this.mismatchFlag;
  }

  public clearMismatch(): void {
    this.mismatchFlag = false;
  }

  public pushScope(): void {
    this.scopeStack.push([]);
  }

  public recordScopeNode(node: Node): void {
    const top = this.scopeStack[this.scopeStack.length - 1];
    if (top && !top.includes(node)) {
      top.push(node);
    }
  }

  public popScope(): Node[] {
    return this.scopeStack.pop() ?? [];
  }

  public reportMismatch(mismatch: HydrationMismatch): void {
    this.mismatchFlag = true;
    if (this.options?.onMismatch) {
      this.options.onMismatch(mismatch);
    } else if (this.options?.dev) {
      console.warn(
        `[MIX_SSR_HYDRATION_MISMATCH] Hydration mismatch: expected "${mismatch.expected}", got "${mismatch.actual}". Re-rendering subtree.`
      );
    }
  }

  private advanceNext(node: Node): Node | null {
    if (node.firstChild) {
      return node.firstChild;
    }
    return this.advanceSiblingOrParent(node);
  }

  public advanceSiblingOrParent(node: Node): Node | null {
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
      if (this.current.nodeType === 8) {
        this.current = this.advanceNext(this.current);
        continue;
      }
      if (this.current.nodeType === 3) {
        if (!this.current.textContent || !this.current.textContent.trim()) {
          this.current = this.advanceNext(this.current);
          continue;
        }
        this.reportMismatch({
          expected: tag.toLowerCase(),
          actual: "#text",
          node: this.current
        });
        return null;
      }
      if (this.current.nodeType === 1) {
        const el = this.current as Element;
        if (el.tagName.toLowerCase() === tag.toLowerCase()) {
          this.current = this.advanceNext(el);
          return el;
        }
        this.reportMismatch({
          expected: tag.toLowerCase(),
          actual: el.tagName.toLowerCase(),
          node: el
        });
        return null;
      }
      this.current = this.advanceNext(this.current);
    }
    this.reportMismatch({
      expected: tag.toLowerCase(),
      actual: "eof",
      node: null
    });
    return null;
  }

  public claimText(): Text | null {
    let openTextMarkerId: string | null = null;
    while (this.current) {
      if (this.current.nodeType === 8) {
        const comment = this.current as Comment;
        if (comment.data.startsWith("mix:t:")) {
          openTextMarkerId = comment.data.slice("mix:t:".length);
          this.current = this.advanceNext(comment);
          continue;
        }
        if (
          openTextMarkerId !== null &&
          comment.data === `/mix:t:${openTextMarkerId}` &&
          comment.parentNode
        ) {
          // Empty SSR interpolation (`<!--mix:t:id--><!--/mix:t:id-->`) has no Text node; insert one before closing marker.
          const emptyText = comment.ownerDocument.createTextNode("");
          comment.parentNode.insertBefore(emptyText, comment);
          this.current = this.advanceSiblingOrParent(comment);
          return emptyText;
        }
        this.current = this.advanceNext(this.current);
        continue;
      }
      if (this.current.nodeType === 3) {
        const textNode = this.current as Text;
        this.current = this.advanceNext(textNode);
        return textNode;
      }
      break;
    }
    return null;
  }

  public claimComment(dataPrefix?: string): Comment | null {
    const savedCurrent = this.current;
    while (this.current) {
      if (this.current.nodeType === 8) {
        const commentNode = this.current as Comment;
        if (!dataPrefix || commentNode.data.startsWith(dataPrefix)) {
          this.current = this.advanceNext(commentNode);
          return commentNode;
        }
        this.current = this.advanceNext(commentNode);
        continue;
      }
      if (this.current.nodeType === 3 && (!this.current.textContent || !this.current.textContent.trim())) {
        this.current = this.advanceNext(this.current);
        continue;
      }
      break;
    }
    this.current = savedCurrent;
    return null;
  }

  /**
   * Finds the matching closing comment for a marker like `mix:if:0` -> `/mix:if:0`
   * among siblings of `openComment`.
   */
  public findClosingComment(openComment: Comment, kindPrefix: string): Comment | null {
    const idSuffix = openComment.data.slice(kindPrefix.length);
    const closeData = `/${kindPrefix}${idSuffix}`;
    let cursor: Node | null = openComment.nextSibling;
    while (cursor) {
      if (cursor.nodeType === 8 && (cursor as Comment).data === closeData) {
        return cursor as Comment;
      }
      cursor = cursor.nextSibling;
    }
    return null;
  }

  /**
   * Removes SSR nodes strictly between `openMarker` and `closeMarker` so a mismatched
   * subtree can be cleanly client-rendered in place without touching ancestor/sibling nodes.
   */
  public clearSubtreeBetween(openMarker: Comment, closeMarker: Comment): Node[] {
    const parent = closeMarker.parentNode;
    if (!parent) return [];
    const removed: Node[] = [];
    let cursor = openMarker.nextSibling;
    while (cursor && cursor !== closeMarker) {
      const next = cursor.nextSibling;
      parent.removeChild(cursor);
      removed.push(cursor);
      cursor = next;
    }
    return removed;
  }
}

let activeHydrationContext: HydrationWalker | null = null;

export function getHydrationContext(): HydrationWalker | null {
  return activeHydrationContext;
}

export function setHydrationContext(walker: HydrationWalker | null): HydrationWalker | null {
  const prev = activeHydrationContext;
  activeHydrationContext = walker;
  return prev;
}

export function runWithoutHydration<T>(fn: () => T): T {
  const prev = activeHydrationContext;
  activeHydrationContext = null;
  try {
    return fn();
  } finally {
    activeHydrationContext = prev;
  }
}

export function runWithHydrationSubtree<T>(
  walker: HydrationWalker,
  openMarker: Comment | null,
  closeMarker: Comment | null,
  hydrateFn: () => T,
  fallbackClientFn: () => T
): T {
  const prevFlag = walker.hasMismatch();
  walker.clearMismatch();
  if (openMarker) {
    walker.current = openMarker.nextSibling;
  }
  const result = hydrateFn();
  if (walker.hasMismatch() && openMarker && closeMarker) {
    walker.clearSubtreeBetween(openMarker, closeMarker);
    walker.clearMismatch();
    const clientResult = runWithoutHydration(fallbackClientFn);
    walker.current = walker.advanceSiblingOrParent(closeMarker);
    if (prevFlag) {
      // Subtree recovered locally; parent mismatch flag remains isolated.
    }
    return clientResult;
  }
  if (closeMarker) {
    walker.current = walker.advanceSiblingOrParent(closeMarker);
  }
  if (prevFlag) {
    walker.reportMismatch({ expected: "subtree", actual: "mismatch", node: openMarker });
  }
  return result;
}

export interface HydrateHandle {
  (): void;
  unmount(): void;
}

export function hydrate(
  component: (props?: Record<string, unknown>) => unknown,
  container: HTMLElement,
  options?: HydrateOptions
): HydrateHandle {
  const walker = new HydrationWalker(container, options);
  const prevContext = activeHydrationContext;
  activeHydrationContext = walker;

  let rootDisposer: (() => void) | null = null;
  try {
    createRoot((dispose) => {
      rootDisposer = dispose;
      component();
    });
  } finally {
    activeHydrationContext = prevContext;
  }

  const unmount = (): void => {
    if (rootDisposer) {
      rootDisposer();
      rootDisposer = null;
    }
  };
  unmount.unmount = unmount;
  return unmount;
}
