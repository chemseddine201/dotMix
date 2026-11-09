/**
 * @mix/router — Radix-Trie Route Matching Engine
 */

import type { RouteRecord, MatchedRoute } from "./types.js";

export function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  // Ensure leading slash, remove trailing slash (unless root)
  let normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function joinPaths(parent: string, child: string): string {
  if (!child) return normalizePath(parent);
  if (child.startsWith("/")) return normalizePath(child);
  const p = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  const c = child.startsWith("/") ? child.slice(1) : child;
  return normalizePath(`${p}/${c}`);
}

interface TrieNode {
  segment: string;
  isParam: boolean;
  paramName?: string | undefined;
  isWildcard: boolean;
  wildcardName?: string | undefined;
  staticChildren: Map<string, TrieNode>;
  paramChild: TrieNode | null;
  wildcardChild: TrieNode | null;
  record: RouteRecord | null;
  chain: RouteRecord[];
  fullPathPattern: string;
}

function createNode(segment = ""): TrieNode {
  const isParam = segment.startsWith(":") && segment.length > 1;
  const isWildcard = segment.startsWith("*");
  return {
    segment,
    isParam,
    paramName: isParam ? segment.slice(1) : undefined,
    isWildcard,
    wildcardName: isWildcard ? (segment.slice(1) || "wildcard") : undefined,
    staticChildren: new Map(),
    paramChild: null,
    wildcardChild: null,
    record: null,
    chain: [],
    fullPathPattern: "",
  };
}

export interface MatchResult {
  matched: MatchedRoute[];
  params: Record<string, string>;
}

export class RouteTrie {
  private root: TrieNode = createNode();

  constructor(routes: RouteRecord[]) {
    for (const route of routes) {
      this.insertRoute(route, "", []);
    }
  }

  private insertRoute(route: RouteRecord, parentPath: string, parentChain: RouteRecord[]): void {
    const fullPath = joinPaths(parentPath, route.path || "");
    const currentChain = [...parentChain, route];

    const rawSegments = fullPath.split("/").filter(Boolean);
    let current = this.root;

    if (rawSegments.length === 0) {
      // Root route "/"
      current.record = route;
      current.chain = currentChain;
      current.fullPathPattern = "/";
    } else {
      for (let i = 0; i < rawSegments.length; i++) {
        const seg = rawSegments[i]!;
        if (seg.startsWith("*")) {
          if (!current.wildcardChild) {
            current.wildcardChild = createNode(seg);
          }
          current = current.wildcardChild;
          break; // Wildcard is terminal
        } else if (seg.startsWith(":")) {
          if (!current.paramChild) {
            current.paramChild = createNode(seg);
          }
          current = current.paramChild;
        } else {
          let next = current.staticChildren.get(seg);
          if (!next) {
            next = createNode(seg);
            current.staticChildren.set(seg, next);
          }
          current = next;
        }
      }
      current.record = route;
      current.chain = currentChain;
      current.fullPathPattern = fullPath;
    }

    if (route.children && route.children.length > 0) {
      for (const child of route.children) {
        this.insertRoute(child, fullPath, currentChain);
      }
    }
  }

  public match(pathname: string): MatchResult | null {
    const cleanPath = normalizePath(pathname);
    const segments = cleanPath.split("/").filter(Boolean);

    interface Candidate {
      node: TrieNode;
      params: Record<string, string>;
    }

    function search(node: TrieNode, segIndex: number, currentParams: Record<string, string>): Candidate | null {
      if (segIndex === segments.length) {
        if (node.record) {
          return { node, params: { ...currentParams } };
        }
        return null;
      }

      const seg = segments[segIndex]!;

      // 1. Try static match (highest priority)
      const staticNode = node.staticChildren.get(seg);
      if (staticNode) {
        const res = search(staticNode, segIndex + 1, currentParams);
        if (res) return res;
      }

      // 2. Try param match (medium priority)
      if (node.paramChild) {
        const nextParams = { ...currentParams, [node.paramChild.paramName!]: seg };
        const res = search(node.paramChild, segIndex + 1, nextParams);
        if (res) return res;
      }

      // 3. Try wildcard match (lowest priority)
      if (node.wildcardChild) {
        const remainder = segments.slice(segIndex).join("/");
        const nextParams = { ...currentParams, [node.wildcardChild.wildcardName!]: remainder };
        return { node: node.wildcardChild, params: nextParams };
      }

      return null;
    }

    // Root edge case
    let candidate: Candidate | null = null;
    if (segments.length === 0) {
      if (this.root.record) {
        candidate = { node: this.root, params: {} };
      } else if (this.root.wildcardChild) {
        candidate = { node: this.root.wildcardChild, params: { [this.root.wildcardChild.wildcardName!]: "" } };
      }
    } else {
      candidate = search(this.root, 0, {});
    }

    if (!candidate || !candidate.node.record) {
      return null;
    }

    // Build hierarchy of matched routes
    const matched: MatchedRoute[] = [];
    const chain = candidate.node.chain;
    for (const rec of chain) {
      matched.push({
        record: rec,
        route: rec,
        path: rec.path || "",
        pathname: rec.path || "",
        pathnameBase: rec.path || "",
        params: candidate.params,
        component: rec.component ?? rec.element ?? rec.Component,
      });
    }

    return {
      matched,
      params: candidate.params,
    };
  }
}
