/**
 * @mix/runtime/dom/nodes — Surgical DOM node creation, text mutation, and insertion helpers.
 */

import { getHydrationContext } from "./hydration.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function createElement(tag: string, scopeAttr?: string): HTMLElement {
  const activeHydrationContext = getHydrationContext();
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
  const activeHydrationContext = getHydrationContext();
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
  const activeHydrationContext = getHydrationContext();
  if (activeHydrationContext) {
    const claimed = activeHydrationContext.claimText();
    if (claimed) {
      return claimed;
    }
  }
  return document.createTextNode(String(text));
}

export function createComment(data: string = ""): Comment {
  const activeHydrationContext = getHydrationContext();
  if (activeHydrationContext) {
    const claimed = activeHydrationContext.claimComment(data);
    if (claimed) {
      return claimed;
    }
  }
  return document.createComment(data);
}

const insertedNodesMap = new WeakMap<Text, Node[]>();

export function isDomNode(val: unknown): val is Node {
  return typeof (val as { nodeType?: unknown })?.nodeType === "number";
}

export function insertNode(parent: Node, node: Node, anchor?: Node | null): void {
  const activeHydrationContext = getHydrationContext();
  if (activeHydrationContext) {
    if (node.parentNode === parent || (parent.nodeType === 11 && node.parentNode !== null)) {
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

export function normalizeToNodeArray(
  rendered: Node | readonly Node[] | null | undefined
): Node[] {
  if (!rendered) return [];
  if (Array.isArray(rendered)) {
    const out: Node[] = [];
    for (const item of rendered) {
      if (item && (item as Node).nodeType === 11) {
        out.push(...Array.from((item as DocumentFragment).childNodes));
      } else if (item) {
        out.push(item as Node);
      }
    }
    return out;
  }
  if ((rendered as Node).nodeType === 11) {
    return Array.from((rendered as DocumentFragment).childNodes);
  }
  return [rendered as Node];
}

export function setText(node: Text, value: unknown): void {
  const resolved = typeof value === "function" ? (value as () => unknown)() : value;

  if (
    isDomNode(resolved) ||
    (Array.isArray(resolved) && resolved.length > 0 && isDomNode(resolved[0]))
  ) {
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

  const next =
    resolved === null || resolved === undefined || resolved === false
      ? ""
      : String(resolved);
  if (node.data !== next) {
    node.data = next;
  }
}
