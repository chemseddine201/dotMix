/**
 * @mix/compiler-css/types — CSS compilation options, result types, FNV-1a scope hash, and span conversion helpers.
 */

import type { CssLocation } from "css-tree";
import { createSpan, type SourceSpan } from "@mix/ast";

export interface CssCompileOptions {
  scopeId?: string;
  scopeHash?: string;
  scoped?: boolean;
  filename?: string;
  baseOffset?: number;
  baseLine?: number;
}

export interface CssCompileResult {
  readonly code: string;
  readonly css: string;
  readonly scopeId: string;
  readonly scopeAttribute: string;
}

/**
 * Deterministic FNV-1a 32-bit hash formatted as 6 hex chars (e.g. `c8f2a1`).
 */
export function computeScopeHash(seed: string, extra?: string): string {
  const combined = extra !== undefined ? `${seed}:${extra}` : seed;
  let hash = 0x811c9dc5;
  for (let i = 0; i < combined.length; i++) {
    hash ^= combined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(6, "0").slice(0, 6);
}

export function toMixSpan(
  loc: CssLocation | null | undefined,
  options?: CssCompileOptions
): SourceSpan {
  const baseOffset = options?.baseOffset ?? 0;
  const baseLine = (options?.baseLine ?? 1) - 1;
  const startLine = (loc?.start.line ?? 1) + baseLine;
  const startCol = loc?.start.column ?? 1;
  const startOff = (loc?.start.offset ?? 0) + baseOffset;
  const endLine = (loc?.end.line ?? startLine - baseLine) + baseLine;
  const endCol = loc?.end.column ?? startCol + 1;
  const endOff = Math.max(startOff, (loc?.end.offset ?? startOff - baseOffset + 1) + baseOffset);

  return createSpan(
    { line: startLine, column: startCol, offset: startOff },
    { line: Math.max(startLine, endLine), column: endCol, offset: endOff },
    options?.filename
  );
}
