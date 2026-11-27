/**
 * @dotmix/compiler-frontend/ts-parser/probes — Token-based markup probes (F3),
 * trailing-token detection (F1), and regex literal validation.
 */

import ts from "typescript";
import { MixDiagnosticError, DiagnosticCodes } from "@dotmix/diagnostics";
import type { LineMap } from "../location.js";
import { skipJsWhitespaceAndComments } from "../expression.js";
import { advanceScannerState } from "./scanner.js";
import type { FrameKind } from "./scanner.js";

export const EXPR_WRAPPER_PREFIX = "void (";
export const EXPR_WRAPPER_PREFIX_LEN = EXPR_WRAPPER_PREFIX.length;

export interface SourceFileWithParseDiagnostics extends ts.SourceFile {
  readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
}

const REUSABLE_PROBE_SCANNER = ts.createScanner(
  ts.ScriptTarget.Latest,
  true,
  ts.LanguageVariant.Standard
);

export function throwSyntaxDiagnostic(
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

function isAsciiAlpha(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
}

function isTokenNameStart(kind: ts.SyntaxKind, scanner: ts.Scanner, allowDollar: boolean): boolean {
  if (
    kind === ts.SyntaxKind.Identifier ||
    (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword)
  ) {
    const ch = scanner.getTokenText().charCodeAt(0);
    return isAsciiAlpha(ch) || (allowDollar && ch === 36 /* $ */);
  }
  return false;
}

function isJsxTriggerOp(kind: ts.SyntaxKind | null): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionToken ||
    kind === ts.SyntaxKind.ColonToken
  );
}

/**
 * F3 (M3): Probes TypeScript scanner tokens (never raw text inside strings, templates, or comments)
 * for JSX-style logical markup.
 */
export function scanMarkupProbe(text: string): boolean {
  if (!text.includes("<")) return false;

  const scanner = REUSABLE_PROBE_SCANNER;
  scanner.setText(text, 0, text.length);
  const stack: FrameKind[] = [];
  let prevKind: ts.SyntaxKind | null = null;
  let prevWasAfterDot = false;
  let exprAllowed = true;

  let sawOp = false;
  let sawOpLessThan = false;

  while (true) {
    let kind = scanner.scan();
    if (
      (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      exprAllowed
    ) {
      kind = scanner.reScanSlashToken();
    }

    if (kind === ts.SyntaxKind.CloseBraceToken && stack[stack.length - 1] === "${") {
      stack.pop();
      kind = scanner.reScanTemplateToken(false);
      if (kind === ts.SyntaxKind.TemplateMiddle) {
        stack.push("${");
        exprAllowed = true;
      } else {
        exprAllowed = false;
      }
      prevWasAfterDot = false;
      prevKind = kind;
      sawOp = false;
      sawOpLessThan = false;
      continue;
    }

    if (kind === ts.SyntaxKind.EndOfFileToken) {
      return false;
    }

    if (
      sawOpLessThan &&
      (isTokenNameStart(kind, scanner, true) ||
        kind === ts.SyntaxKind.SlashToken ||
        kind === ts.SyntaxKind.SlashEqualsToken ||
        kind === ts.SyntaxKind.RegularExpressionLiteral)
    ) {
      return true;
    }
    sawOpLessThan = sawOp && kind === ts.SyntaxKind.LessThanToken;
    sawOp = isJsxTriggerOp(kind);

    const next = advanceScannerState(kind, stack, prevKind, prevWasAfterDot);
    exprAllowed = next.exprAllowed;
    prevWasAfterDot = next.prevWasAfterDot;
    prevKind = next.prevKind;
  }
}

export function checkJsxLogicalProbe(
  slice: string,
  lineMap: LineMap,
  spanStart: number,
  spanEnd: number
): void {
  if (scanMarkupProbe(slice)) {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_JSX_LOGICAL_EXPRESSION,
      message:
        "JSX-style inline markup in expressions (e.g. '{cond && <Element />}') is not supported in Mix/Tix templates. Use '{if cond}<Element />{endif}' instead.",
      severity: "error",
      span: lineMap.span(spanStart, spanEnd)
    });
  }
}

export function validateRegexLiterals(
  root: ts.Node,
  sf: ts.SourceFile
): { start: number; message: string } | null {
  let found: { start: number; message: string } | null = null;
  function visit(node: ts.Node): void {
    if (found !== null) return;
    if (ts.isRegularExpressionLiteral(node)) {
      const start = node.getStart(sf);
      const raw = sf.text.slice(start, node.end);
      const lastSlash = raw.lastIndexOf("/");
      try {
        new RegExp(raw.slice(1, lastSlash), raw.slice(lastSlash + 1));
      } catch (err: unknown) {
        found = { start, message: err instanceof Error ? err.message : "Invalid regular expression" };
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

function hasMissingOrParseError(node: ts.Node): boolean {
  if (node.pos === node.end) return true;
  if ((node.flags & ts.NodeFlags.ThisNodeHasError) !== 0) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && hasMissingOrParseError(child)) {
      found = true;
    }
  });
  return found;
}

/**
 * F1 (M1): Returns the end offset (in `sf.text`) of the inner expression inside
 * `void (<inner>)` when the wrapped parse contains a complete, error-free inner
 * expression followed by extra tokens before our wrapper's closing `)`.
 */
export function findTrailingInnerExpressionEnd(
  sf: ts.SourceFile,
  wrappedLength: number
): number | null {
  const diags = (sf as SourceFileWithParseDiagnostics).parseDiagnostics;
  if (!diags || diags.length === 0) return null;
  const firstDiag = diags[0]!;
  const diagStart = typeof firstDiag.start === "number" ? firstDiag.start : 0;

  const stmt = sf.statements[0];
  if (
    !stmt ||
    !ts.isExpressionStatement(stmt) ||
    !ts.isVoidExpression(stmt.expression) ||
    !ts.isParenthesizedExpression(stmt.expression.expression)
  ) {
    return null;
  }

  const paren = stmt.expression.expression;
  const inner = paren.expression;
  if (
    paren.end >= wrappedLength ||
    diagStart < inner.end ||
    hasMissingOrParseError(inner)
  ) {
    return null;
  }
  return inner.end;
}

export function throwIfEmbeddedTrailingToken(
  sf: ts.SourceFile,
  wrappedLength: number,
  source: string,
  exprStart: number,
  expectedClosingDelimiter: string,
  lineMap: LineMap,
  limitOffset: number
): void {
  const trailingEnd = findTrailingInnerExpressionEnd(sf, wrappedLength);
  if (trailingEnd === null) return;
  const innerEndOffset = exprStart + (trailingEnd - EXPR_WRAPPER_PREFIX_LEN);
  const afterExpr = skipJsWhitespaceAndComments(source, innerEndOffset, lineMap, limitOffset);
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
}

export function throwIfSliceTrailingToken(
  sf: ts.SourceFile,
  wrappedLength: number,
  exprSlice: string,
  exprStart: number,
  baseOffset: number,
  lineMap: LineMap
): void {
  const trailingEnd = findTrailingInnerExpressionEnd(sf, wrappedLength);
  if (trailingEnd === null) return;
  const innerEndOffset = exprStart + (trailingEnd - EXPR_WRAPPER_PREFIX_LEN);
  const innerRaw = exprSlice.slice(exprStart, innerEndOffset);
  checkJsxLogicalProbe(innerRaw, lineMap, baseOffset + exprStart, baseOffset + innerEndOffset);
  const afterTrim = skipJsWhitespaceAndComments(exprSlice, innerEndOffset, lineMap, exprSlice.length);
  throwSyntaxDiagnostic(
    `Unexpected trailing token in expression at '${exprSlice.slice(afterTrim)}'.`,
    lineMap,
    baseOffset + afterTrim,
    baseOffset + exprSlice.length
  );
}

