/**
 * @mix/compiler-frontend/expression — Acorn + TypeScript expression parser & token comparator.
 *
 * Implements R-SYN-01, R-SYN-01a, R-SYN-01b, R-SYN-01c, and R-SYN-02 from spec/LANGUAGE.md.
 */

import { Parser } from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import { deepFreeze } from "@mix/ast";
import type { ESTreeNode } from "@mix/ast";
import { MixDiagnosticError, DiagnosticCodes } from "@mix/diagnostics";
import type { LineMap } from "./location.js";

const TsParser = Parser.extend(
  tsPlugin({ jsx: false }) as unknown as Parameters<typeof Parser.extend>[0]
);

export function createTsTokenizer(input: string): {
  getToken(): { type: { label: string }; value: unknown; start: number; end: number };
} {
  return TsParser.tokenizer(input, {
    ecmaVersion: "latest",
    sourceType: "module"
  }) as unknown as {
    getToken(): { type: { label: string }; value: unknown; start: number; end: number };
  };
}

interface AcornRawNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface AcornToken {
  type: {
    label: string;
  };
  value: unknown;
  start: number;
  end: number;
}

export interface ParsedExpressionResult {
  readonly expression: ESTreeNode;
  readonly rawExpression: string;
  readonly exprStartOffset: number;
  readonly exprEndOffset: number;
  readonly afterDelimiterOffset: number;
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
 * Converts an Acorn AST node into a deeply frozen structural ESTreeNode with exact SourceSpan coordinates.
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
 * R-SYN-01 & R-SYN-01a: Parses an embedded TS/JS expression starting at `startOffset` using
 * `Parser.parseExpressionAt` with `preserveParens: true`, then verifies the expected closing delimiter.
 */
export function parseEmbeddedExpression(
  source: string,
  startOffset: number,
  expectedClosingDelimiter: string,
  lineMap: LineMap,
  limitOffset: number = source.length
): ParsedExpressionResult {
  const exprStart = skipJsWhitespaceAndComments(source, startOffset, lineMap, limitOffset);

  if (
    exprStart >= limitOffset ||
    (expectedClosingDelimiter.length > 0 &&
      source.startsWith(expectedClosingDelimiter, exprStart))
  ) {
    throwSyntaxDiagnostic(
      "Embedded expression cannot be empty.",
      lineMap,
      startOffset,
      Math.min(limitOffset, exprStart + expectedClosingDelimiter.length)
    );
  }

  // R-SYN-01c: Check for obvious HTML/template closing tag or markup inside expression
  let rawNode: AcornRawNode;
  try {
    rawNode = TsParser.parseExpressionAt(source, exprStart, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      preserveParens: true
    }) as unknown as AcornRawNode;
  } catch (err: unknown) {
    const pos =
      typeof err === "object" && err !== null && "pos" in err && typeof (err as { pos: unknown }).pos === "number"
        ? (err as { pos: number }).pos
        : exprStart;
    // D-133 (Option b): Detect JSX-style logical/conditional markup `{cond && <el/>}` or `{cond ? <a/> : <b/>}`
    const probeSlice = source.slice(exprStart, Math.min(limitOffset, exprStart + 300));
    if (/(?:&&|\|\||\?|:)\s*<(?:[A-Za-z$]|\/)/.test(probeSlice)) {
      throw new MixDiagnosticError({
        code: DiagnosticCodes.MIX_ERR_JSX_LOGICAL_EXPRESSION,
        message:
          "JSX-style inline markup in expressions (e.g. '{cond && <Element />}') is not supported in Mix/Tix templates. Use '{if cond}<Element />{endif}' instead (D-133).",
        severity: "error",
        span: lineMap.span(exprStart, Math.min(limitOffset, pos + 1))
      });
    }
    const msg = err instanceof Error ? err.message : "Invalid expression syntax";
    throwSyntaxDiagnostic(`Invalid expression syntax: ${msg}`, lineMap, pos, pos + 1);
  }

  if (rawNode.end > limitOffset) {
    throwSyntaxDiagnostic(
      `Unterminated expression: expected '${expectedClosingDelimiter}'.`,
      lineMap,
      exprStart,
      limitOffset
    );
  }

  const afterExpr = skipJsWhitespaceAndComments(source, rawNode.end, lineMap, limitOffset);
  if (!source.startsWith(expectedClosingDelimiter, afterExpr)) {
    const probeSlice = source.slice(exprStart, Math.min(limitOffset, afterExpr + 100));
    if (/(?:&&|\|\||\?|:)\s*<(?:[A-Za-z$]|\/)/.test(probeSlice)) {
      throw new MixDiagnosticError({
        code: DiagnosticCodes.MIX_ERR_JSX_LOGICAL_EXPRESSION,
        message:
          "JSX-style inline markup in expressions (e.g. '{cond && <Element />}') is not supported in Mix/Tix templates. Use '{if cond}<Element />{endif}' instead (D-133).",
        severity: "error",
        span: lineMap.span(exprStart, Math.min(limitOffset, afterExpr + 1))
      });
    }
    throwSyntaxDiagnostic(
      `Expected closing delimiter '${expectedClosingDelimiter}' after expression, but found '${source.slice(afterExpr, afterExpr + 10)}'.`,
      lineMap,
      afterExpr,
      Math.min(limitOffset, afterExpr + Math.max(1, expectedClosingDelimiter.length))
    );
  }

  const rawExpression = source.slice(exprStart, rawNode.end);
  // D-133 (Option b): Reject JSX logical/conditional markup that Acorn parsed as comparison/type-assertion
  if (/(?:&&|\|\||\?|:)\s*<(?:[A-Za-z$]|\/)/.test(rawExpression)) {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_JSX_LOGICAL_EXPRESSION,
      message:
        "JSX-style inline markup in expressions (e.g. '{cond && <Element />}') is not supported in Mix/Tix templates. Use '{if cond}<Element />{endif}' instead (D-133).",
      severity: "error",
      span: lineMap.span(exprStart, rawNode.end)
    });
  }
  // R-SYN-01c: Reject closing HTML tags like `</tag>` that might have been misparsed as regex/comparison
  if (/<\/[A-Za-z]/.test(rawExpression)) {
    throwSyntaxDiagnostic(
      "Template markup tags are not allowed inside embedded expressions (R-SYN-01c).",
      lineMap,
      exprStart,
      rawNode.end
    );
  }

  const expression = convertAcornNodeToESTree(rawNode, lineMap, 0);

  return {
    expression,
    rawExpression,
    exprStartOffset: exprStart,
    exprEndOffset: rawNode.end,
    afterDelimiterOffset: afterExpr + expectedClosingDelimiter.length
  };
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
  const result = parseEmbeddedExpression(
    exprSlice,
    0,
    "",
    lineMap,
    exprSlice.length
  );
  const afterTrim = skipJsWhitespaceAndComments(
    exprSlice,
    result.exprEndOffset,
    lineMap,
    exprSlice.length
  );
  if (afterTrim !== exprSlice.length) {
    throwSyntaxDiagnostic(
      `Unexpected trailing token in expression at '${exprSlice.slice(afterTrim)}'.`,
      lineMap,
      baseOffset + afterTrim,
      baseOffset + exprSlice.length
    );
  }
  const rawNode = TsParser.parseExpressionAt(exprSlice, result.exprStartOffset, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    preserveParens: true
  });
  return convertAcornNodeToESTree(rawNode, lineMap, baseOffset);
}

/**
 * R-SYN-02: Compares two expression strings by their normalized token sequence (type + value/slice),
 * ignoring whitespace and comments, using the Acorn-TypeScript tokenizer.
 */
export function compareExpressionTokens(exprA: string, exprB: string): boolean {
  function tokenize(input: string): Array<{ type: string; text: string }> | null {
    try {
      const tokenizer = TsParser.tokenizer(input, {
        ecmaVersion: "latest",
        sourceType: "module"
      }) as unknown as { getToken(): AcornToken };
      const tokens: Array<{ type: string; text: string }> = [];
      while (true) {
        const tok = tokenizer.getToken();
        if (tok.type.label === "eof") {
          break;
        }
        const rawText = input.slice(tok.start, tok.end);
        tokens.push({
          type: tok.type.label,
          text: tok.value !== undefined ? String(tok.value) : rawText
        });
      }
      return tokens;
    } catch {
      return null;
    }
  }

  const tokensA = tokenize(exprA);
  const tokensB = tokenize(exprB);
  if (!tokensA || !tokensB || tokensA.length !== tokensB.length) {
    return false;
  }
  for (let i = 0; i < tokensA.length; i++) {
    const a = tokensA[i]!;
    const b = tokensB[i]!;
    if (a.type !== b.type || a.text !== b.text) {
      return false;
    }
  }
  return true;
}

/**
 * Parses a full `<script>` block program into an ESTree Program node with file-global spans.
 */
export function parseScriptProgram(
  scriptContent: string,
  baseOffset: number,
  lineMap: LineMap
): ESTreeNode {
  try {
    const rawProgram = TsParser.parse(scriptContent, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      preserveParens: true
    });
    return convertAcornNodeToESTree(rawProgram, lineMap, baseOffset);
  } catch (err: unknown) {
    const pos =
      typeof err === "object" && err !== null && "pos" in err && typeof (err as { pos: unknown }).pos === "number"
        ? baseOffset + (err as { pos: number }).pos
        : baseOffset;
    const msg = err instanceof Error ? err.message : "Invalid script syntax";
    throwSyntaxDiagnostic(`Script syntax error: ${msg}`, lineMap, pos, pos + 1);
  }
}
