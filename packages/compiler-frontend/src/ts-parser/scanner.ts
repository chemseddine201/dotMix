/**
 * @dotmix/compiler-frontend/ts-parser/scanner — TypeScript scanner-based expression boundary
 * detector (R3). Uses zero regular expressions for boundary or token kind classification.
 */

import ts from "typescript";

export interface BoundaryResult {
  readonly exprEndOffset: number;
  readonly delimiterOffset: number;
  readonly found: boolean;
  readonly hasRegexLiteral: boolean;
  readonly scanErrorOffset: number | null;
  readonly scanErrorCode: number | null;
  readonly scanErrorMessage: string | null;
}

export type FrameKind = "(" | "stmt-(" | "[" | "{" | "${";

/**
 * Tokens after which a `/` begins a regular expression literal (operand expected).
 * Strictly a named list of TypeScript SyntaxKind values (no regex).
 */
export const EXPR_BEFORE_REGEX_KINDS: readonly ts.SyntaxKind[] = [
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.ColonToken,
  ts.SyntaxKind.QuestionToken,
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.TildeToken,
  ts.SyntaxKind.DotDotDotToken,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.ThrowKeyword,
  ts.SyntaxKind.CaseKeyword,
  ts.SyntaxKind.DeleteKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.YieldKeyword,
  ts.SyntaxKind.AwaitKeyword,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.OfKeyword,
  ts.SyntaxKind.NewKeyword,
  ts.SyntaxKind.ElseKeyword,
  ts.SyntaxKind.DoKeyword,
  ts.SyntaxKind.ExportKeyword,
  ts.SyntaxKind.DefaultKeyword
];

const EXPR_BEFORE_REGEX_TABLE = new Uint8Array(512);
for (const k of EXPR_BEFORE_REGEX_KINDS) {
  if (k < EXPR_BEFORE_REGEX_TABLE.length) {
    EXPR_BEFORE_REGEX_TABLE[k] = 1;
  }
}

export function isExprBeforeRegexKind(kind: ts.SyntaxKind): boolean {
  return kind < EXPR_BEFORE_REGEX_TABLE.length && EXPR_BEFORE_REGEX_TABLE[kind] === 1;
}

export function isStatementParenKeyword(kind: ts.SyntaxKind | null): boolean {
  return (
    kind === ts.SyntaxKind.IfKeyword ||
    kind === ts.SyntaxKind.WhileKeyword ||
    kind === ts.SyntaxKind.ForKeyword ||
    kind === ts.SyntaxKind.WithKeyword
  );
}

export function isDotToken(kind: ts.SyntaxKind | null): boolean {
  return kind === ts.SyntaxKind.DotToken || kind === ts.SyntaxKind.QuestionDotToken;
}

let boundaryErrorOffset: number | null = null;
let boundaryErrorCode: number | null = null;
let boundaryErrorMessage: string | null = null;
const BOUNDARY_STACK: FrameKind[] = [];

const REUSABLE_BOUNDARY_SCANNER = ts.createScanner(
  ts.ScriptTarget.Latest,
  true,
  ts.LanguageVariant.Standard,
  undefined,
  (message: ts.DiagnosticMessage) => {
    if (boundaryErrorOffset === null) {
      boundaryErrorOffset = REUSABLE_BOUNDARY_SCANNER.getTokenStart();
      boundaryErrorCode = message.code;
      boundaryErrorMessage = message.message;
    }
  }
);

const REUSABLE_SNAP_SCANNER = ts.createScanner(
  ts.ScriptTarget.Latest,
  true,
  ts.LanguageVariant.Standard
);

export function advanceScannerState(
  kind: ts.SyntaxKind,
  stack: FrameKind[],
  prevKind: ts.SyntaxKind | null,
  prevWasAfterDot: boolean
): { exprAllowed: boolean; prevKind: ts.SyntaxKind; prevWasAfterDot: boolean } {
  const afterDot = isDotToken(prevKind);
  let exprAllowed: boolean;
  if (kind === ts.SyntaxKind.OpenParenToken) {
    const isStmtParen = !prevWasAfterDot && isStatementParenKeyword(prevKind);
    stack.push(isStmtParen ? "stmt-(" : "(");
    exprAllowed = true;
  } else if (kind === ts.SyntaxKind.CloseParenToken) {
    const top = stack[stack.length - 1];
    if (top === "(" || top === "stmt-(") {
      stack.pop();
      exprAllowed = top === "stmt-(";
    } else {
      exprAllowed = false;
    }
  } else if (kind === ts.SyntaxKind.OpenBracketToken) {
    stack.push("[");
    exprAllowed = true;
  } else if (kind === ts.SyntaxKind.CloseBracketToken) {
    if (stack[stack.length - 1] === "[") stack.pop();
    exprAllowed = false;
  } else if (kind === ts.SyntaxKind.OpenBraceToken) {
    stack.push("{");
    exprAllowed = true;
  } else if (kind === ts.SyntaxKind.CloseBraceToken) {
    if (stack[stack.length - 1] === "{") stack.pop();
    exprAllowed = false;
  } else if (kind === ts.SyntaxKind.TemplateHead) {
    stack.push("${");
    exprAllowed = true;
  } else {
    exprAllowed = !afterDot && isExprBeforeRegexKind(kind);
  }
  return { exprAllowed, prevKind: kind, prevWasAfterDot: afterDot };
}

/**
 * D1: Snaps a mapped diagnostic offset to the first character of the offending token
 * at or after `offset` (never whitespace and never inside a comment), using the TS scanner.
 */
export function snapOffsetToTokenStart(
  source: string,
  offset: number,
  limitOffset: number
): number {
  const clamped = Math.max(0, Math.min(limitOffset, offset));
  if (clamped >= limitOffset) {
    return limitOffset;
  }
  REUSABLE_SNAP_SCANNER.setText(source, clamped, limitOffset - clamped);
  const kind = REUSABLE_SNAP_SCANNER.scan();
  if (kind === ts.SyntaxKind.EndOfFileToken) {
    return limitOffset;
  }
  return REUSABLE_SNAP_SCANNER.getTokenStart();
}

/**
 * R3.1 & R3.2: Finds the end of an embedded expression using the TypeScript scanner.
 */
export function findExpressionBoundary(
  source: string,
  exprStart: number,
  expectedClosingDelimiter: string,
  limitOffset: number
): BoundaryResult {
  boundaryErrorOffset = null;
  boundaryErrorCode = null;
  boundaryErrorMessage = null;
  BOUNDARY_STACK.length = 0;

  const scanner = REUSABLE_BOUNDARY_SCANNER;
  scanner.setText(source, exprStart, limitOffset - exprStart);

  const stack = BOUNDARY_STACK;
  let lastTokenEnd = exprStart;
  let prevKind: ts.SyntaxKind | null = null;
  let prevWasAfterDot = false;
  let exprAllowed = true;
  let hasRegexLiteral = false;

  while (true) {
    let kind = scanner.scan();

    if (
      (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      exprAllowed
    ) {
      kind = scanner.reScanSlashToken();
      if (kind === ts.SyntaxKind.RegularExpressionLiteral) {
        hasRegexLiteral = true;
      }
    }

    if (kind === ts.SyntaxKind.EndOfFileToken) {
      if (expectedClosingDelimiter === "" && stack.length === 0) {
        return {
          exprEndOffset: lastTokenEnd,
          delimiterOffset: lastTokenEnd,
          found: true,
          hasRegexLiteral,
          scanErrorOffset: boundaryErrorOffset,
          scanErrorCode: boundaryErrorCode,
          scanErrorMessage: boundaryErrorMessage
        };
      }
      return {
        exprEndOffset: lastTokenEnd,
        delimiterOffset: -1,
        found: false,
        hasRegexLiteral,
        scanErrorOffset: boundaryErrorOffset,
        scanErrorCode: boundaryErrorCode,
        scanErrorMessage: boundaryErrorMessage
      };
    }

    const tokStart = scanner.getTokenStart();

    if (stack.length === 0) {
      if (expectedClosingDelimiter === "}" && kind === ts.SyntaxKind.CloseBraceToken) {
        return {
          exprEndOffset: lastTokenEnd,
          delimiterOffset: tokStart,
          found: true,
          hasRegexLiteral,
          scanErrorOffset: boundaryErrorOffset,
          scanErrorCode: boundaryErrorCode,
          scanErrorMessage: boundaryErrorMessage
        };
      }
      if (expectedClosingDelimiter === "}>" && kind === ts.SyntaxKind.CloseBraceToken) {
        if (source.charCodeAt(scanner.getTextPos()) === 62 /* > */) {
          return {
            exprEndOffset: lastTokenEnd,
            delimiterOffset: tokStart,
            found: true,
            hasRegexLiteral,
            scanErrorOffset: boundaryErrorOffset,
            scanErrorCode: boundaryErrorCode,
            scanErrorMessage: boundaryErrorMessage
          };
        }
        return {
          exprEndOffset: lastTokenEnd,
          delimiterOffset: tokStart,
          found: false,
          hasRegexLiteral,
          scanErrorOffset: boundaryErrorOffset,
          scanErrorCode: boundaryErrorCode,
          scanErrorMessage: boundaryErrorMessage
        };
      }
      if (expectedClosingDelimiter === ")" && kind === ts.SyntaxKind.CloseParenToken) {
        return {
          exprEndOffset: lastTokenEnd,
          delimiterOffset: tokStart,
          found: true,
          hasRegexLiteral,
          scanErrorOffset: boundaryErrorOffset,
          scanErrorCode: boundaryErrorCode,
          scanErrorMessage: boundaryErrorMessage
        };
      }
      if (
        kind === ts.SyntaxKind.CloseParenToken ||
        kind === ts.SyntaxKind.CloseBracketToken
      ) {
        return {
          exprEndOffset: lastTokenEnd,
          delimiterOffset: tokStart,
          found: false,
          hasRegexLiteral,
          scanErrorOffset: boundaryErrorOffset,
          scanErrorCode: boundaryErrorCode,
          scanErrorMessage: boundaryErrorMessage
        };
      }
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
      lastTokenEnd = scanner.getTextPos();
      prevWasAfterDot = false;
      prevKind = kind;
      continue;
    }

    const next = advanceScannerState(kind, stack, prevKind, prevWasAfterDot);
    exprAllowed = next.exprAllowed;
    prevWasAfterDot = next.prevWasAfterDot;
    prevKind = next.prevKind;
    lastTokenEnd = scanner.getTextPos();
  }
}
