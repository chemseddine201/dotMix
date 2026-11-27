/**
 * @dotmix/compiler-frontend/ts-parser — TypeScript single-parser engine entry points.
 *
 * Implements R1, R3, R4, R5, R6, R7, R8, R9 and FIX1 (D1, D2, D3) using the official
 * TypeScript Compiler API (`typescript@6.0.3`, `ScriptTarget.Latest`, `ScriptKind.TS`).
 */

import ts from "typescript";
import type { ESTreeNode } from "@dotmix/ast";
import type { LineMap } from "../location.js";
import {
  skipJsWhitespaceAndComments,
  convertAcornNodeToESTree
} from "../expression.js";
import type { ParsedExpressionResult } from "../expression.js";
import {
  findExpressionBoundary,
  snapOffsetToTokenStart
} from "./scanner.js";
import {
  EXPR_WRAPPER_PREFIX,
  EXPR_WRAPPER_PREFIX_LEN,
  throwSyntaxDiagnostic,
  checkJsxLogicalProbe,
  validateRegexLiterals,
  throwIfEmbeddedTrailingToken,
  throwIfSliceTrailingToken
} from "./probes.js";
import type { SourceFileWithParseDiagnostics } from "./probes.js";
import { tsCreateTsTokenizer, tsCompareExpressionTokens } from "./tokenizer.js";
import type { TsTokenizer } from "./tokenizer.js";
import { convertExpression } from "./convert-expressions.js";
import { convertProgram } from "./convert-statements.js";

export { tsCreateTsTokenizer, tsCompareExpressionTokens };
export type { TsTokenizer };

function getFirstParseDiagnostic(
  sf: ts.SourceFile
): { start: number; message: string } | null {
  const diags = (sf as SourceFileWithParseDiagnostics).parseDiagnostics;
  if (!diags || diags.length === 0) return null;
  const first = diags[0]!;
  return {
    start: typeof first.start === "number" ? first.start : 0,
    message: ts.flattenDiagnosticMessageText(first.messageText, " ")
  };
}

function parseWrappedExpression(rawExpression: string): {
  readonly sf: ts.SourceFile;
  readonly wrappedLength: number;
} {
  const wrapped = `${EXPR_WRAPPER_PREFIX}${rawExpression})`;
  const sf = ts.createSourceFile(
    "expr.ts",
    wrapped,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return { sf, wrappedLength: wrapped.length };
}

function unwrapVoidParenExpression(
  sf: ts.SourceFile,
  wrappedLength: number
): ts.Expression | null {
  const stmt = sf.statements[0];
  if (
    sf.statements.length !== 1 ||
    !stmt ||
    !ts.isExpressionStatement(stmt) ||
    !ts.isVoidExpression(stmt.expression) ||
    stmt.expression.pos !== 0 ||
    stmt.expression.end !== wrappedLength ||
    !ts.isParenthesizedExpression(stmt.expression.expression) ||
    stmt.expression.expression.end !== wrappedLength
  ) {
    return null;
  }
  return stmt.expression.expression.expression;
}

/**
 * D1: Maps a TypeScript parse diagnostic offset inside `void (<raw>)` back to the first
 * character of the offending token in `source` (never whitespace or inside a comment).
 */
function mapWrappedDiagOffset(
  source: string,
  exprStart: number,
  diagStart: number,
  limitOffset: number
): number {
  const rawPos = exprStart + Math.max(0, diagStart - EXPR_WRAPPER_PREFIX_LEN);
  return snapOffsetToTokenStart(source, rawPos, limitOffset);
}

/**
 * R3 + FIX1 (D1, D2, D3): Parses an embedded TS/JS expression starting at `startOffset`
 * up to `expectedClosingDelimiter`.
 */
export function tsParseEmbeddedExpression(
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

  const boundary = findExpressionBoundary(
    source,
    exprStart,
    expectedClosingDelimiter,
    limitOffset
  );

  if (boundary.scanErrorOffset !== null && boundary.scanErrorMessage !== null) {
    const probeSlice = source.slice(exprStart, Math.min(limitOffset, exprStart + 300));
    const pos = boundary.scanErrorOffset;
    checkJsxLogicalProbe(probeSlice, lineMap, exprStart, Math.min(limitOffset, pos + 1));
    throwSyntaxDiagnostic(
      `Invalid expression syntax: ${boundary.scanErrorMessage}`,
      lineMap,
      pos,
      Math.min(limitOffset, pos + 1)
    );
  }

  if (!boundary.found) {
    const probeSlice = source.slice(exprStart, Math.min(limitOffset, exprStart + 300));
    checkJsxLogicalProbe(probeSlice, lineMap, exprStart, Math.min(limitOffset, exprStart + 1));

    const availEnd = boundary.exprEndOffset > exprStart ? boundary.exprEndOffset : limitOffset;
    const { sf: sfAvail, wrappedLength: availWrappedLen } = parseWrappedExpression(
      source.slice(exprStart, availEnd)
    );
    throwIfEmbeddedTrailingToken(
      sfAvail,
      availWrappedLen,
      source,
      exprStart,
      expectedClosingDelimiter,
      lineMap,
      limitOffset
    );
    const availDiag = getFirstParseDiagnostic(sfAvail);
    if (availDiag !== null) {
      const pos = mapWrappedDiagOffset(source, exprStart, availDiag.start, limitOffset);
      checkJsxLogicalProbe(probeSlice, lineMap, exprStart, Math.min(limitOffset, pos + 1));
      throwSyntaxDiagnostic(
        `Invalid expression syntax: ${availDiag.message}`,
        lineMap,
        pos,
        Math.min(limitOffset, pos + 1)
      );
    }

    const afterAvail = skipJsWhitespaceAndComments(source, availEnd, lineMap, limitOffset);
    throwSyntaxDiagnostic(
      `Expected closing delimiter '${expectedClosingDelimiter}' after expression, but found '${source.slice(afterAvail, afterAvail + 10)}'.`,
      lineMap,
      afterAvail,
      Math.min(limitOffset, afterAvail + Math.max(1, expectedClosingDelimiter.length))
    );
  }

  const exprEnd = boundary.exprEndOffset;
  if (exprEnd <= exprStart) {
    throwSyntaxDiagnostic(
      "Embedded expression cannot be empty.",
      lineMap,
      startOffset,
      Math.min(limitOffset, boundary.delimiterOffset + expectedClosingDelimiter.length)
    );
  }

  const rawExpression = source.slice(exprStart, exprEnd);
  const { sf, wrappedLength } = parseWrappedExpression(rawExpression);

  throwIfEmbeddedTrailingToken(
    sf,
    wrappedLength,
    source,
    exprStart,
    expectedClosingDelimiter,
    lineMap,
    limitOffset
  );

  const diag = getFirstParseDiagnostic(sf);
  if (diag !== null) {
    const pos = mapWrappedDiagOffset(source, exprStart, diag.start, limitOffset);
    const probeSlice = source.slice(exprStart, Math.min(limitOffset, exprStart + 300));
    checkJsxLogicalProbe(probeSlice, lineMap, exprStart, Math.min(limitOffset, pos + 1));
    throwSyntaxDiagnostic(
      `Invalid expression syntax: ${diag.message}`,
      lineMap,
      pos,
      Math.min(limitOffset, pos + 1)
    );
  }

  const innerExpr = unwrapVoidParenExpression(sf, wrappedLength);
  if (innerExpr === null) {
    const stmt = sf.statements[0];
    const pos = mapWrappedDiagOffset(source, exprStart, stmt ? stmt.end : EXPR_WRAPPER_PREFIX_LEN, limitOffset);
    const probeSlice = source.slice(exprStart, Math.min(limitOffset, exprStart + 300));
    checkJsxLogicalProbe(probeSlice, lineMap, exprStart, Math.min(limitOffset, pos + 1));
    throwSyntaxDiagnostic(
      `Invalid expression syntax: Unexpected token in expression.`,
      lineMap,
      pos,
      Math.min(limitOffset, pos + 1)
    );
  }

  if (boundary.hasRegexLiteral) {
    const regexErr = validateRegexLiterals(innerExpr, sf);
    if (regexErr !== null) {
      const pos = mapWrappedDiagOffset(source, exprStart, regexErr.start, limitOffset);
      throwSyntaxDiagnostic(
        `Invalid expression syntax: ${regexErr.message}`,
        lineMap,
        pos,
        Math.min(limitOffset, pos + 1)
      );
    }
  }

  const afterExpr =
    boundary.delimiterOffset === exprEnd &&
    source.startsWith(expectedClosingDelimiter, exprEnd)
      ? exprEnd
      : skipJsWhitespaceAndComments(source, exprEnd, lineMap, limitOffset);

  if (!source.startsWith(expectedClosingDelimiter, afterExpr)) {
    const probeSlice = source.slice(exprStart, Math.min(limitOffset, afterExpr + 100));
    checkJsxLogicalProbe(probeSlice, lineMap, exprStart, Math.min(limitOffset, afterExpr + 1));
    throwSyntaxDiagnostic(
      `Expected closing delimiter '${expectedClosingDelimiter}' after expression, but found '${source.slice(afterExpr, afterExpr + 10)}'.`,
      lineMap,
      afterExpr,
      Math.min(limitOffset, afterExpr + Math.max(1, expectedClosingDelimiter.length))
    );
  }

  checkJsxLogicalProbe(rawExpression, lineMap, exprStart, exprEnd);

  const rawNode = convertExpression(innerExpr, {
    sourceFile: sf,
    offsetDelta: exprStart - EXPR_WRAPPER_PREFIX_LEN
  });
  return {
    expression: convertAcornNodeToESTree(rawNode, lineMap, 0),
    rawExpression,
    exprStartOffset: exprStart,
    exprEndOffset: exprEnd,
    afterDelimiterOffset: afterExpr + expectedClosingDelimiter.length
  };
}

/**
 * R3 + FIX1 (D1, D2): Parses an isolated expression slice mapped to file-global `baseOffset`.
 */
export function tsParseExpressionSlice(
  exprSlice: string,
  baseOffset: number,
  lineMap: LineMap
): ESTreeNode {
  const exprStart = skipJsWhitespaceAndComments(exprSlice, 0, lineMap, exprSlice.length);
  if (exprStart >= exprSlice.length) {
    throwSyntaxDiagnostic(
      "Embedded expression cannot be empty.",
      lineMap,
      baseOffset,
      baseOffset + exprSlice.length
    );
  }

  const boundary = findExpressionBoundary(exprSlice, exprStart, "", exprSlice.length);
  if (boundary.scanErrorOffset !== null && boundary.scanErrorMessage !== null) {
    const pos = baseOffset + boundary.scanErrorOffset;
    throwSyntaxDiagnostic(`Invalid expression syntax: ${boundary.scanErrorMessage}`, lineMap, pos, pos + 1);
  }

  if (!boundary.found) {
    const availEnd = boundary.exprEndOffset > exprStart ? boundary.exprEndOffset : exprSlice.length;
    const { sf: sfAvail, wrappedLength: availWrappedLen } = parseWrappedExpression(
      exprSlice.slice(exprStart, availEnd)
    );
    throwIfSliceTrailingToken(sfAvail, availWrappedLen, exprSlice, exprStart, baseOffset, lineMap);
    const availDiag = getFirstParseDiagnostic(sfAvail);
    if (availDiag !== null) {
      const pos = baseOffset + mapWrappedDiagOffset(exprSlice, exprStart, availDiag.start, exprSlice.length);
      throwSyntaxDiagnostic(`Invalid expression syntax: ${availDiag.message}`, lineMap, pos, pos + 1);
    }
    const afterAvail = skipJsWhitespaceAndComments(exprSlice, availEnd, lineMap, exprSlice.length);
    throwSyntaxDiagnostic(
      `Unexpected trailing token in expression at '${exprSlice.slice(afterAvail)}'.`,
      lineMap,
      baseOffset + afterAvail,
      baseOffset + exprSlice.length
    );
  }

  const exprEnd = boundary.exprEndOffset;
  const afterTrim =
    exprEnd === exprSlice.length
      ? exprEnd
      : skipJsWhitespaceAndComments(exprSlice, exprEnd, lineMap, exprSlice.length);
  if (afterTrim !== exprSlice.length) {
    throwSyntaxDiagnostic(
      `Unexpected trailing token in expression at '${exprSlice.slice(afterTrim)}'.`,
      lineMap,
      baseOffset + afterTrim,
      baseOffset + exprSlice.length
    );
  }

  const rawExpression = exprSlice.slice(exprStart, exprEnd);
  const { sf, wrappedLength } = parseWrappedExpression(rawExpression);

  throwIfSliceTrailingToken(sf, wrappedLength, exprSlice, exprStart, baseOffset, lineMap);

  const diag = getFirstParseDiagnostic(sf);
  if (diag !== null) {
    const pos = baseOffset + mapWrappedDiagOffset(exprSlice, exprStart, diag.start, exprSlice.length);
    checkJsxLogicalProbe(rawExpression, lineMap, baseOffset + exprStart, pos + 1);
    throwSyntaxDiagnostic(`Invalid expression syntax: ${diag.message}`, lineMap, pos, pos + 1);
  }

  const innerExpr = unwrapVoidParenExpression(sf, wrappedLength);
  if (innerExpr === null) {
    const stmt = sf.statements[0];
    const pos = baseOffset + mapWrappedDiagOffset(exprSlice, exprStart, stmt ? stmt.end : EXPR_WRAPPER_PREFIX_LEN, exprSlice.length);
    throwSyntaxDiagnostic(`Invalid expression syntax: Unexpected token in expression.`, lineMap, pos, pos + 1);
  }

  if (boundary.hasRegexLiteral) {
    const regexErr = validateRegexLiterals(innerExpr, sf);
    if (regexErr !== null) {
      const pos = baseOffset + mapWrappedDiagOffset(exprSlice, exprStart, regexErr.start, exprSlice.length);
      throwSyntaxDiagnostic(`Invalid expression syntax: ${regexErr.message}`, lineMap, pos, pos + 1);
    }
  }

  checkJsxLogicalProbe(rawExpression, lineMap, baseOffset + exprStart, baseOffset + exprEnd);

  const rawNode = convertExpression(innerExpr, {
    sourceFile: sf,
    offsetDelta: exprStart - EXPR_WRAPPER_PREFIX_LEN
  });
  return convertAcornNodeToESTree(rawNode, lineMap, baseOffset);
}

/**
 * R5 + FIX1 (D1): Parses a full `<script>` block program into an ESTree Program node with file-global spans.
 */
export function tsParseScriptProgram(
  scriptContent: string,
  baseOffset: number,
  lineMap: LineMap
): ESTreeNode {
  const sf = ts.createSourceFile(
    "script.ts",
    scriptContent,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );

  const diag = getFirstParseDiagnostic(sf);
  if (diag !== null) {
    const pos = baseOffset + snapOffsetToTokenStart(scriptContent, diag.start, scriptContent.length);
    throwSyntaxDiagnostic(`Script syntax error: ${diag.message}`, lineMap, pos, pos + 1);
  }

  return convertAcornNodeToESTree(convertProgram(sf), lineMap, baseOffset);
}
