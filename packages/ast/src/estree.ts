/**
 * @dotmix/ast/estree — Structural, self-contained ESTree-compatible expression interfaces and type guards.
 * Prevents third-party AST parser types from leaking into public .d.ts declarations.
 */

import type { SourceSpan } from "@dotmix/diagnostics";

export interface ESTreeNode {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly loc?: SourceSpan;
  readonly range?: readonly [number, number];
  readonly [key: string]: unknown;
}

export function isESTreeNode(val: unknown): val is ESTreeNode {
  return (
    val !== null &&
    typeof val === "object" &&
    "type" in val &&
    typeof (val as { type: unknown }).type === "string"
  );
}

