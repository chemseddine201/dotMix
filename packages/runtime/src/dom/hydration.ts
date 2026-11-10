/**
 * @mix/runtime/dom/hydration — SSR Hydration walker and claim primitives.
 */

import { createRoot } from "../core/index.js";

export interface HydrationMismatch {
  expected: string;
  actual: string;
  node: Node;
}

export interface HydrateOptions {
  onMismatch?: (mismatch: HydrationMismatch) => void;
}

export class HydrationWalker {
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
      if (this.current.nodeType === 8) {
        // Comment
        this.current = this.advanceNext(this.current);
        continue;
      }
      if (this.current.nodeType === 3) {
        // Text
        if (!this.current.textContent || !this.current.textContent.trim()) {
          this.current = this.advanceNext(this.current);
          continue;
        }
      }
      if (this.current.nodeType === 1) {
        // Element
        const el = this.current as Element;
        if (el.tagName.toLowerCase() === tag.toLowerCase()) {
          this.current = this.advanceNext(el);
          return el;
        } else {
          // Mismatch
          const mismatch: HydrationMismatch = {
            expected: tag.toLowerCase(),
            actual: el.tagName.toLowerCase(),
            node: el
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
      if (this.current.nodeType === 8) {
        // Comment
        this.current = this.advanceNext(this.current);
        continue;
      }
      if (this.current.nodeType === 3) {
        // Text
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
      if (this.current.nodeType === 8) {
        // Comment
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

  const unmount = (): void => {
    if (rootDisposer) {
      rootDisposer();
      rootDisposer = null;
    }
  };
  unmount.unmount = unmount;
  return unmount;
}
