/**
 * packages/compiler-frontend/src/parser/expression.ts
 *
 * Mix v3.2.2 Expression Delimiter & Syntax Subsystem (§4.1).
 * Uses Acorn + @sveltejs/acorn-typescript with preserveParens: true (R-SYN-01, R-SYN-01a..c).
 */

import * as acorn from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import { MixError } from "@mix/runtime/core";

// Extend Acorn with TypeScript grammar plugin (R-SYN-01, R-SYN-01b)
export const TSParser = acorn.Parser.extend(tsPlugin());

export interface ParsedExpressionResult {
  readonly node: acorn.Node;
  readonly endOffset: number; // offset after delimiter
  readonly raw: string;
}

/**
 * Parses a TypeScript expression beginning at startOffset up to its matching delimiter (R-SYN-01).
 * AST node is produced by Acorn with preserveParens: true (R-SYN-01a).
 */
export function parseTSExpression(
  source: string,
  startOffset: number,
  expectedDelimiter = "}"
): ParsedExpressionResult {
  let node: acorn.Node;

  try {
    node = TSParser.parseExpressionAt(source, startOffset, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      preserveParens: true // R-SYN-01a: mandatory
    });
  } catch (err: unknown) {
    const errorDetails = err as { message?: string; pos?: number; loc?: unknown };
    throw new MixError(
      "MIX_SYN_EXPR_INVALID",
      `Invalid TypeScript expression at offset ${startOffset}: ${errorDetails.message ?? String(err)}`,
      {
        offset: startOffset,
        pos: errorDetails.pos,
        loc: errorDetails.loc
      }
    );
  }

  // After node.end: skip whitespace and comments (R-SYN-01 step 2)
  let i = node.end;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    // Block comment
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    // Line comment
    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") {
        i++;
      }
      continue;
    }
    break;
  }

  if (source.slice(i, i + expectedDelimiter.length) !== expectedDelimiter) {
    throw new MixError(
      "MIX_SYN_EXPR_UNTERMINATED",
      `Unterminated expression at offset ${startOffset}: expected delimiter "${expectedDelimiter}" at offset ${i}`,
      {
        startOffset,
        endOffset: node.end,
        expectedDelimiter,
        found: source[i]
      }
    );
  }

  const endOffset = i + expectedDelimiter.length;
  const raw = source.slice(startOffset, i);

  return {
    node,
    endOffset,
    raw
  };
}
