/**
 * @dotmix/compiler-frontend/expression — Expression parser & token comparator.
 *
 * Implements R-SYN-01, R-SYN-01a, R-SYN-01b, R-SYN-01c, and R-SYN-02 from spec/LANGUAGE.md.
 */

import { deepFreeze } from "@dotmix/ast";
import type { ESTreeNode } from "@dotmix/ast";
import { MixDiagnosticError, DiagnosticCodes } from "@dotmix/diagnostics";
import type { LineMap } from "./location.js";
import {
  tsCreateTsTokenizer,
  tsParseEmbeddedExpression,
  tsParseExpressionSlice,
  tsCompareExpressionTokens,
  tsParseScriptProgram
} from "./ts-parser/index.js";

export interface ParsedExpressionResult {
  readonly expression: ESTreeNode;
  readonly rawExpression: string;
  readonly exprStartOffset: number;
  readonly exprEndOffset: number;
  readonly afterDelimiterOffset: number;
}

export function createTsTokenizer(input: string): {
  getToken(): { type: { label: string }; value: unknown; start: number; end: number };
} {
  return tsCreateTsTokenizer(input);
}

function throwSyntaxDiagnostic(
  message: string,
  lineMap: LineMap,
  startOffset: number,
  endOffset: number = startOffset + 1
): never {
  throw new MixDiagnosticError({
    code: DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
    message,
    severity: "error",
    span: lineMap.span(startOffset, Math.max(startOffset, endOffset))
  });
}

/**
 * Skips ASCII whitespace and JS single-line (`//`) or multi-line (`/* ... *\/`) comments.
 */
export function skipJsWhitespaceAndComments(
  source: string,
  startOffset: number,
  lineMap: LineMap,
  limitOffset: number = source.length
): number {
  let pos = startOffset;
  while (pos < limitOffset) {
    const ch = source.charCodeAt(pos);
    // Whitespace: space, tab, LF, CR, FF, VT
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 12 || ch === 11) {
      pos++;
      continue;
    }
    // Single-line comment //
    if (ch === 47 /* / */ && pos + 1 < limitOffset && source.charCodeAt(pos + 1) === 47) {
      pos += 2;
      while (pos < limitOffset && source.charCodeAt(pos) !== 10 /* \n */) {
        pos++;
      }
      continue;
    }
    // Block comment /* ... */
    if (ch === 47 /* / */ && pos + 1 < limitOffset && source.charCodeAt(pos + 1) === 42 /* * */) {
      const commentStart = pos;
      pos += 2;
      let closed = false;
      while (pos + 1 < limitOffset) {
        if (source.charCodeAt(pos) === 42 /* * */ && source.charCodeAt(pos + 1) === 47 /* / */) {
          pos += 2;
          closed = true;
          break;
        }
        pos++;
      }
      if (!closed) {
        throwSyntaxDiagnostic("Unterminated block comment inside expression.", lineMap, commentStart, limitOffset);
      }
      continue;
    }
    break;
  }
  return pos;
}

/**
 * Converts an Acorn-shaped AST node into a deeply frozen structural ESTreeNode with exact SourceSpan coordinates.
 */
export function convertAcornNodeToESTree(
  raw: unknown,
  lineMap: LineMap,
  baseOffset: number = 0
): ESTreeNode {
  function transform(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(item => transform(item));
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.type === "string" && typeof obj.start === "number" && typeof obj.end === "number") {
      // R-SYN-01c: Reject any JSX / markup node inside expressions
      if (obj.type.startsWith("JSX")) {
        throwSyntaxDiagnostic(
          "Template markup tags are not allowed inside embedded expressions (R-SYN-01c).",
          lineMap,
          baseOffset + obj.start,
          baseOffset + obj.end
        );
      }
      const start = baseOffset + obj.start;
      const end = baseOffset + obj.end;
      const result: Record<string, unknown> = {
        type: obj.type,
        start,
        end,
        range: [start, end] as const,
        loc: lineMap.span(start, end)
      };
      for (const key of Object.keys(obj)) {
        if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") {
          continue;
        }
        result[key] = transform(obj[key]);
      }
      return result;
    }
    const plainCopy: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      plainCopy[key] = transform(obj[key]);
    }
    return plainCopy;
  }

  return deepFreeze(transform(raw) as ESTreeNode);
}

/**
 * R-SYN-01 & R-SYN-01a: Parses an embedded TS/JS expression starting at `startOffset`
 * with `preserveParens` behavior, then verifies the expected closing delimiter.
 */
export function parseEmbeddedExpression(
  source: string,
  startOffset: number,
  expectedClosingDelimiter: string,
  lineMap: LineMap,
  limitOffset: number = source.length
): ParsedExpressionResult {
  return tsParseEmbeddedExpression(source, startOffset, expectedClosingDelimiter, lineMap, limitOffset);
}

/**
 * Parses an isolated expression string (where the slice boundaries are already known)
 * mapped to a file-global `baseOffset`.
 */
export function parseExpressionSlice(
  exprSlice: string,
  baseOffset: number,
  lineMap: LineMap
): ESTreeNode {
  return tsParseExpressionSlice(exprSlice, baseOffset, lineMap);
}

/**
 * R-SYN-02: Compares two expression strings by their normalized token sequence (type + value/slice),
 * ignoring whitespace and comments.
 */
export function compareExpressionTokens(exprA: string, exprB: string): boolean {
  return tsCompareExpressionTokens(exprA, exprB);
}

/**
 * Parses a full `<script>` block program into an ESTree Program node with file-global spans.
 */
export function parseScriptProgram(
  scriptContent: string,
  baseOffset: number,
  lineMap: LineMap
): ESTreeNode {
  return tsParseScriptProgram(scriptContent, baseOffset, lineMap);
}
