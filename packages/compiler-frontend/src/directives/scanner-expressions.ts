/**
 * @dotmix/compiler-frontend/directives/scanner-expressions — Header expression slicing and script import scanning.
 */

import {
  DIRECTIVE_GRAMMAR,
  DIRECTIVES_IMPORT_PATH,
  type DirectiveGrammarEntry,
  type ESTreeNode
} from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import {
  createTsTokenizer,
  parseExpressionSlice,
  skipJsWhitespaceAndComments
} from "../expression.js";
import type { LineMap } from "../location.js";
import { failSyntax, type ParserContext } from "../types.js";
import { matchDirectiveBranchAt, matchDirectiveCloseAt } from "./scanner.js";

export interface TopLevelKeywordSlice {
  readonly keyword: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

const CONTEXTUAL_KEYWORD_SET = new Set<string>(DIRECTIVE_GRAMMAR.contextualKeywords);

export function findHeaderCloseOffset(
  source: string,
  headerStart: number,
  lineMap: LineMap,
  blockStart: number,
  blockLabel: string
): number {
  const tokenizer = createTsTokenizer(source.slice(headerStart));
  let braceDepth = 1;

  try {
    while (true) {
      const tok = tokenizer.getToken();
      if (tok.type.label === "eof") {
        break;
      }
      if (tok.type.label === "{") {
        braceDepth++;
      } else if (tok.type.label === "}") {
        braceDepth--;
        if (braceDepth === 0) {
          return headerStart + tok.start;
        }
      }
    }
  } catch {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      `Malformed '{${blockLabel}}' header expression.`,
      lineMap,
      blockStart,
      Math.min(source.length, headerStart + 24)
    );
  }

  failSyntax(
    DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
    `Unclosed '{${blockLabel}}' header: missing '}'.`,
    lineMap,
    blockStart,
    Math.min(source.length, headerStart + 24)
  );
}

export function scanTopLevelKeywords(
  source: string,
  sliceStart: number,
  sliceEnd: number,
  keywords: ReadonlySet<string>
): TopLevelKeywordSlice[] {
  const matches: TopLevelKeywordSlice[] = [];
  const tokenizer = createTsTokenizer(source.slice(sliceStart, sliceEnd));
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (true) {
    const tok = tokenizer.getToken();
    if (tok.type.label === "eof") {
      break;
    }
    if (tok.type.label === "{") braceDepth++;
    else if (tok.type.label === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (tok.type.label === "(") parenDepth++;
    else if (tok.type.label === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (tok.type.label === "[") bracketDepth++;
    else if (tok.type.label === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      const word = typeof tok.value === "string" ? tok.value : tok.type.label;
      if (
        keywords.has(word) &&
        (CONTEXTUAL_KEYWORD_SET.has(word) ||
          word === "in" ||
          word === "if" ||
          word === "with" ||
          word === "default" ||
          word === "else")
      ) {
        matches.push({
          keyword: word,
          startOffset: sliceStart + tok.start,
          endOffset: sliceStart + tok.end
        });
      }
    }
  }

  return matches;
}

export function splitTopLevelCommas(
  source: string,
  sliceStart: number,
  sliceEnd: number,
  lineMap: LineMap
): Array<{ raw: string; startOffset: number; expression: ESTreeNode }> {
  const trimmedStart = skipJsWhitespaceAndComments(source, sliceStart, lineMap, sliceEnd);
  if (trimmedStart >= sliceEnd) {
    return [];
  }
  const tokenizer = createTsTokenizer(source.slice(sliceStart, sliceEnd));
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  const commaOffsets: number[] = [];

  while (true) {
    const tok = tokenizer.getToken();
    if (tok.type.label === "eof") {
      break;
    }
    if (tok.type.label === "{") braceDepth++;
    else if (tok.type.label === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (tok.type.label === "(") parenDepth++;
    else if (tok.type.label === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (tok.type.label === "[") bracketDepth++;
    else if (tok.type.label === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0 && tok.type.label === ",") {
      commaOffsets.push(sliceStart + tok.start);
    }
  }

  const segments: Array<{ raw: string; startOffset: number; expression: ESTreeNode }> = [];
  const boundaries = [sliceStart, ...commaOffsets.map((offset) => offset + 1)];
  const ends = [...commaOffsets, sliceEnd];

  for (let i = 0; i < boundaries.length; i++) {
    const segStart = skipJsWhitespaceAndComments(source, boundaries[i]!, lineMap, ends[i]!);
    const rawSeg = source.slice(segStart, ends[i]!).trimEnd();
    if (!rawSeg) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Expected expression in comma-separated directive list.",
        lineMap,
        boundaries[i]!,
        Math.max(boundaries[i]! + 1, ends[i]!)
      );
    }
    segments.push({
      raw: rawSeg,
      startOffset: segStart,
      expression: parseExpressionSlice(rawSeg, segStart, lineMap)
    });
  }

  return segments;
}

export function parseSliceRequired(
  source: string,
  sliceStart: number,
  sliceEnd: number,
  lineMap: LineMap,
  label: string
): { raw: string; expression: ESTreeNode } {
  const exprStart = skipJsWhitespaceAndComments(source, sliceStart, lineMap, sliceEnd);
  const raw = source.slice(exprStart, sliceEnd).trimEnd();
  if (!raw) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      `Missing expression for ${label}.`,
      lineMap,
      sliceStart,
      Math.max(sliceStart + 1, sliceEnd)
    );
  }
  return {
    raw,
    expression: parseExpressionSlice(raw, exprStart, lineMap)
  };
}

export function collectVerbatimTagNames(scriptSource: string): ReadonlySet<string> {
  const names = new Set<string>();
  if (!scriptSource.includes("Verbatim")) {
    return names;
  }
  try {
    const tokenizer = createTsTokenizer(scriptSource);
    const tokens: Array<{ label: string; value: unknown }> = [];
    while (true) {
      const tok = tokenizer.getToken();
      if (tok.type.label === "eof") {
        break;
      }
      tokens.push({ label: tok.type.label, value: tok.value });
    }

    for (let i = 0; i < tokens.length; i++) {
      const current = tokens[i]!;
      if (current.label !== "import") continue;
      let cursor = i + 1;
      if (tokens[cursor]?.value === "type") continue;
      if (tokens[cursor]?.label !== "{") continue;
      cursor++;
      const candidates: string[] = [];
      while (cursor < tokens.length && tokens[cursor]!.label !== "}") {
        const specTok = tokens[cursor]!;
        if (specTok.label === "name" && specTok.value === "Verbatim") {
          if (tokens[cursor + 1]?.label === "as" || tokens[cursor + 1]?.value === "as") {
            const aliasTok = tokens[cursor + 2];
            if (aliasTok?.label === "name" && typeof aliasTok.value === "string") {
              candidates.push(aliasTok.value);
            }
            cursor += 3;
            continue;
          }
          candidates.push("Verbatim");
        }
        cursor++;
      }
      if (tokens[cursor]?.label !== "}") continue;
      cursor++;
      if (tokens[cursor]?.value !== "from") continue;
      cursor++;
      const modTok = tokens[cursor];
      if (modTok?.label === "string" && modTok.value === DIRECTIVES_IMPORT_PATH) {
        for (const candidate of candidates) {
          names.add(candidate);
        }
      }
    }
  } catch {
    return names;
  }
  return names;
}

export function isClosingTagFor(source: string, pos: number, entry: DirectiveGrammarEntry): boolean {
  const closed = matchDirectiveCloseAt(source, pos);
  return closed !== null && closed.entry.id === entry.id;
}

export function isSimpleElseAt(source: string, pos: number): boolean {
  const branch = matchDirectiveBranchAt(source, pos);
  return branch !== null && branch.marker === "else" && branch.noArgCloseEnd !== null;
}

export function consumeExpectedClose(
  ctx: ParserContext,
  entry: DirectiveGrammarEntry,
  startOffset: number
): void {
  const closed = matchDirectiveCloseAt(ctx.source, ctx.pos);
  if (!closed || closed.entry.id !== entry.id) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      `Unclosed '{${entry.blockOpen}}' block: missing '{${entry.blockClose}}'.`,
      ctx.lineMap,
      startOffset,
      ctx.pos
    );
  }
  ctx.pos = closed.closeEnd;
}

export function parseSingleBody(
  ctx: ParserContext,
  entry: DirectiveGrammarEntry,
  startOffset: number
): import("@dotmix/ast").TemplateNode[] {
  const children = ctx.parseChildren(() => isClosingTagFor(ctx.source, ctx.pos, entry));
  consumeExpectedClose(ctx, entry, startOffset);
  return children;
}

export function parseOptionalElseBlockBodies(
  ctx: ParserContext,
  entry: DirectiveGrammarEntry,
  startOffset: number
): { consequent: import("@dotmix/ast").TemplateNode[]; alternate: import("@dotmix/ast").TemplateNode[] | null } {
  const consequent = ctx.parseChildren(
    () => (entry.supportsElse && isSimpleElseAt(ctx.source, ctx.pos)) || isClosingTagFor(ctx.source, ctx.pos, entry)
  );
  let alternate: import("@dotmix/ast").TemplateNode[] | null = null;
  if (entry.supportsElse) {
    const branch = matchDirectiveBranchAt(ctx.source, ctx.pos);
    if (branch && branch.marker === "else" && branch.noArgCloseEnd !== null) {
      ctx.pos = branch.noArgCloseEnd;
      alternate = ctx.parseChildren(() => isClosingTagFor(ctx.source, ctx.pos, entry));
    }
  }
  consumeExpectedClose(ctx, entry, startOffset);
  return { consequent, alternate };
}
