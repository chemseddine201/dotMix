/**
 * @dotmix/compiler-frontend/ts-parser/tokenizer — Acorn-compatible tokenizer (R6) and
 * token-sequence comparator (R7) backed by `ts.createScanner`.
 */

import ts from "typescript";
import {
  isExprBeforeRegexKind,
  isStatementParenKeyword,
  isDotToken
} from "./scanner.js";
import type { FrameKind } from "./scanner.js";

export interface RawToken {
  type: { label: string };
  value: unknown;
  start: number;
  end: number;
}

export interface TsTokenizer {
  getToken(): RawToken;
}

const RESERVED_WORD_LABELS: ReadonlyMap<ts.SyntaxKind, string> = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.BreakKeyword, "break"],
  [ts.SyntaxKind.CaseKeyword, "case"],
  [ts.SyntaxKind.CatchKeyword, "catch"],
  [ts.SyntaxKind.ClassKeyword, "class"],
  [ts.SyntaxKind.ConstKeyword, "const"],
  [ts.SyntaxKind.ContinueKeyword, "continue"],
  [ts.SyntaxKind.DebuggerKeyword, "debugger"],
  [ts.SyntaxKind.DefaultKeyword, "default"],
  [ts.SyntaxKind.DeleteKeyword, "delete"],
  [ts.SyntaxKind.DoKeyword, "do"],
  [ts.SyntaxKind.ElseKeyword, "else"],
  [ts.SyntaxKind.EnumKeyword, "enum"],
  [ts.SyntaxKind.ExportKeyword, "export"],
  [ts.SyntaxKind.ExtendsKeyword, "extends"],
  [ts.SyntaxKind.FalseKeyword, "false"],
  [ts.SyntaxKind.FinallyKeyword, "finally"],
  [ts.SyntaxKind.ForKeyword, "for"],
  [ts.SyntaxKind.FunctionKeyword, "function"],
  [ts.SyntaxKind.IfKeyword, "if"],
  [ts.SyntaxKind.ImportKeyword, "import"],
  [ts.SyntaxKind.InKeyword, "in"],
  [ts.SyntaxKind.InstanceOfKeyword, "instanceof"],
  [ts.SyntaxKind.NewKeyword, "new"],
  [ts.SyntaxKind.NullKeyword, "null"],
  [ts.SyntaxKind.ReturnKeyword, "return"],
  [ts.SyntaxKind.SuperKeyword, "super"],
  [ts.SyntaxKind.SwitchKeyword, "switch"],
  [ts.SyntaxKind.ThisKeyword, "this"],
  [ts.SyntaxKind.ThrowKeyword, "throw"],
  [ts.SyntaxKind.TrueKeyword, "true"],
  [ts.SyntaxKind.TryKeyword, "try"],
  [ts.SyntaxKind.TypeOfKeyword, "typeof"],
  [ts.SyntaxKind.VarKeyword, "var"],
  [ts.SyntaxKind.VoidKeyword, "void"],
  [ts.SyntaxKind.WhileKeyword, "while"],
  [ts.SyntaxKind.WithKeyword, "with"]
]);

const PUNCT_LABELS: ReadonlyMap<ts.SyntaxKind, string> = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.OpenBraceToken, "{"],
  [ts.SyntaxKind.CloseBraceToken, "}"],
  [ts.SyntaxKind.OpenBracketToken, "["],
  [ts.SyntaxKind.CloseBracketToken, "]"],
  [ts.SyntaxKind.OpenParenToken, "("],
  [ts.SyntaxKind.CloseParenToken, ")"],
  [ts.SyntaxKind.CommaToken, ","],
  [ts.SyntaxKind.DotToken, "."],
  [ts.SyntaxKind.DotDotDotToken, "..."],
  [ts.SyntaxKind.SemicolonToken, ";"],
  [ts.SyntaxKind.ColonToken, ":"],
  [ts.SyntaxKind.QuestionToken, "?"],
  [ts.SyntaxKind.QuestionDotToken, "?."],
  [ts.SyntaxKind.EqualsGreaterThanToken, "=>"],
  [ts.SyntaxKind.PlusPlusToken, "++/--"],
  [ts.SyntaxKind.MinusMinusToken, "++/--"],
  [ts.SyntaxKind.PlusToken, "+/-"],
  [ts.SyntaxKind.MinusToken, "+/-"],
  [ts.SyntaxKind.TildeToken, "prefix"],
  [ts.SyntaxKind.ExclamationToken, "prefix"],
  [ts.SyntaxKind.SlashToken, "/"],
  [ts.SyntaxKind.AsteriskToken, "*"],
  [ts.SyntaxKind.PercentToken, "%"],
  [ts.SyntaxKind.AsteriskAsteriskToken, "**"],
  [ts.SyntaxKind.EqualsToken, "="],
  [ts.SyntaxKind.LessThanToken, "</>"],
  [ts.SyntaxKind.GreaterThanToken, "</>"],
  [ts.SyntaxKind.LessThanEqualsToken, "</>"],
  [ts.SyntaxKind.GreaterThanEqualsToken, "</>"],
  [ts.SyntaxKind.EqualsEqualsToken, "==/!="],
  [ts.SyntaxKind.ExclamationEqualsToken, "==/!="],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, "==/!="],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, "==/!="],
  [ts.SyntaxKind.LessThanLessThanToken, "<</>>"],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, "<</>>"],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, "<</>>"],
  [ts.SyntaxKind.BarBarToken, "||"],
  [ts.SyntaxKind.AmpersandAmpersandToken, "&&"],
  [ts.SyntaxKind.QuestionQuestionToken, "??"],
  [ts.SyntaxKind.BarToken, "|"],
  [ts.SyntaxKind.CaretToken, "^"],
  [ts.SyntaxKind.AmpersandToken, "&"]
]);

function parseNumericTokenValue(raw: string): number {
  return Number(raw.replaceAll("_", ""));
}

function parseBigIntTokenValue(raw: string): bigint {
  return BigInt(raw.slice(0, -1).replaceAll("_", ""));
}

function decodeRegexToken(raw: string): { pattern: string; flags: string } {
  const lastSlash = raw.lastIndexOf("/");
  return {
    pattern: raw.slice(1, lastSlash),
    flags: raw.slice(lastSlash + 1)
  };
}

/**
 * R6: Creates an Acorn-compatible tokenizer backed by `ts.createScanner`.
 */
export function tsCreateTsTokenizer(input: string): TsTokenizer {
  let hasError = false;
  let errorMsg = "";

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    input,
    (message: ts.DiagnosticMessage) => {
      if (!hasError) {
        hasError = true;
        errorMsg = message.message;
      }
    }
  );

  const queue: RawToken[] = [];
  const stack: FrameKind[] = [];
  let prevKind: ts.SyntaxKind | null = null;
  let prevWasAfterDot = false;
  let exprAllowed = true;

  function enqueueTemplateLiteral(
    kind: ts.SyntaxKind,
    start: number,
    end: number,
    cooked: string
  ): void {
    if (kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      queue.push({ type: { label: "`" }, value: undefined, start, end: start + 1 });
      queue.push({ type: { label: "template" }, value: cooked, start: start + 1, end: end - 1 });
      queue.push({ type: { label: "`" }, value: undefined, start: end - 1, end });
    } else if (kind === ts.SyntaxKind.TemplateHead) {
      queue.push({ type: { label: "`" }, value: undefined, start, end: start + 1 });
      queue.push({ type: { label: "template" }, value: cooked, start: start + 1, end: end - 2 });
      queue.push({ type: { label: "${" }, value: undefined, start: end - 2, end });
    } else if (kind === ts.SyntaxKind.TemplateMiddle) {
      queue.push({ type: { label: "}" }, value: undefined, start, end: start + 1 });
      queue.push({ type: { label: "template" }, value: cooked, start: start + 1, end: end - 2 });
      queue.push({ type: { label: "${" }, value: undefined, start: end - 2, end });
    } else {
      queue.push({ type: { label: "}" }, value: undefined, start, end: start + 1 });
      queue.push({ type: { label: "template" }, value: cooked, start: start + 1, end: end - 1 });
      queue.push({ type: { label: "`" }, value: undefined, start: end - 1, end });
    }
  }

  function scanNext(): RawToken {
    if (queue.length > 0) {
      return queue.shift()!;
    }

    let kind = scanner.scan();
    if (
      (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      exprAllowed
    ) {
      kind = scanner.reScanSlashToken();
    } else if (kind === ts.SyntaxKind.GreaterThanToken) {
      kind = scanner.reScanGreaterToken();
    }

    if (kind === ts.SyntaxKind.CloseBraceToken && stack[stack.length - 1] === "${") {
      stack.pop();
      kind = scanner.reScanTemplateToken(false);
      if (hasError) {
        throw new SyntaxError(errorMsg);
      }
      const start = scanner.getTokenStart();
      const end = scanner.getTextPos();
      const cooked = scanner.getTokenValue();
      if (kind === ts.SyntaxKind.TemplateMiddle) {
        stack.push("${");
        exprAllowed = true;
      } else {
        exprAllowed = false;
      }
      prevWasAfterDot = false;
      prevKind = kind;
      enqueueTemplateLiteral(kind, start, end, cooked);
      return queue.shift()!;
    }

    if (hasError) {
      throw new SyntaxError(errorMsg);
    }

    const start = scanner.getTokenStart();
    const end = scanner.getTextPos();

    if (kind === ts.SyntaxKind.EndOfFileToken) {
      return { type: { label: "eof" }, value: undefined, start, end };
    }

    const afterDot = isDotToken(prevKind);
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
    prevWasAfterDot = afterDot;
    prevKind = kind;

    if (
      kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === ts.SyntaxKind.TemplateHead
    ) {
      enqueueTemplateLiteral(kind, start, end, scanner.getTokenValue());
      return queue.shift()!;
    }

    if (kind === ts.SyntaxKind.StringLiteral) {
      return { type: { label: "string" }, value: scanner.getTokenValue(), start, end };
    }
    if (kind === ts.SyntaxKind.NumericLiteral) {
      return { type: { label: "num" }, value: parseNumericTokenValue(input.slice(start, end)), start, end };
    }
    if (kind === ts.SyntaxKind.BigIntLiteral) {
      return { type: { label: "num" }, value: parseBigIntTokenValue(input.slice(start, end)), start, end };
    }
    if (kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const decoded = decodeRegexToken(input.slice(start, end));
      return {
        type: { label: "regexp" },
        value: { pattern: decoded.pattern, flags: decoded.flags, value: new RegExp(decoded.pattern, decoded.flags) },
        start,
        end
      };
    }
    if (kind === ts.SyntaxKind.PrivateIdentifier) {
      return { type: { label: "privateId" }, value: scanner.getTokenValue().slice(1), start, end };
    }
    if (kind === ts.SyntaxKind.Identifier) {
      return { type: { label: "name" }, value: scanner.getTokenValue(), start, end };
    }

    const reserved = RESERVED_WORD_LABELS.get(kind);
    if (reserved !== undefined) {
      return { type: { label: reserved }, value: reserved, start, end };
    }

    if (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword) {
      return { type: { label: "name" }, value: scanner.getTokenValue(), start, end };
    }

    const punct = PUNCT_LABELS.get(kind);
    if (punct !== undefined) {
      const rawText = input.slice(start, end);
      const needsVal =
        punct === "+/-" ||
        punct === "++/--" ||
        punct === "prefix" ||
        punct === "</>" ||
        punct === "==/!=" ||
        punct === "<</>>" ||
        punct === "/";
      return {
        type: { label: punct },
        value: needsVal ? rawText : undefined,
        start,
        end
      };
    }

    const rawText = input.slice(start, end);
    return { type: { label: rawText }, value: rawText, start, end };
  }

  return { getToken: scanNext };
}

/**
 * R7: Compares two expression strings by normalized token sequence, ignoring whitespace and comments.
 */
export function tsCompareExpressionTokens(exprA: string, exprB: string): boolean {
  function tokenize(input: string): Array<{ type: string; text: string }> | null {
    try {
      const tokenizer = tsCreateTsTokenizer(input);
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

