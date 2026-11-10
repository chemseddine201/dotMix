/**
 * @mix/compiler-frontend/block-parser — Control-flow block parsers ({if}, {each}, {await}).
 */

import { deepFreeze, createAwaitBlockNode } from "@mix/ast";
import type { TemplateNode, IfBlockNode, EachBlockNode, AwaitBlockNode, ESTreeNode } from "@mix/ast";
import { DiagnosticCodes } from "@mix/diagnostics";
import {
  parseEmbeddedExpression,
  parseExpressionSlice,
  skipJsWhitespaceAndComments,
  createTsTokenizer
} from "./expression.js";
import {
  isIfOpenAt,
  isEachOpenAt,
  matchElseOrElseIf,
  isElseOrElseIfAt,
  isEndIfAt,
  isEndEachAt,
  isAwaitOpenAt,
  isThenAt,
  isCatchAt,
  isEndAwaitAt
} from "./control-flow-scanner.js";
import { failSyntax } from "./types.js";
import type { ParserContext } from "./types.js";

export function parseIfBlock(ctx: ParserContext): IfBlockNode {
  const start = ctx.pos;
  const isLegacyHashIf = ctx.source.startsWith("{#if", start);
  const openLen = isIfOpenAt(ctx.source, start);
  ctx.pos += openLen > 0 ? openLen : 3;
  const condResult = parseEmbeddedExpression(ctx.source, ctx.pos, "}", ctx.lineMap);
  ctx.pos = condResult.afterDelimiterOffset;

  const consequent = ctx.parseChildren(
    () => isElseOrElseIfAt(ctx.source, ctx.pos) || isEndIfAt(ctx.source, ctx.pos) > 0
  );

  let alternate: readonly TemplateNode[] | IfBlockNode | null = null;
  const branch = matchElseOrElseIf(ctx.source, ctx.pos);
  if (branch) {
    const branchStart = ctx.pos;
    ctx.pos = branch.afterKeywordOffset;

    if (branch.kind === "elseif") {
      alternate = parseElseIfChain(ctx, branchStart);
      return deepFreeze({
        type: "IfBlock",
        condition: condResult.expression,
        rawCondition: condResult.rawExpression,
        consequent,
        alternate,
        span: ctx.lineMap.span(start, ctx.pos),
        ...(isLegacyHashIf ? { legacySyntax: true } : {})
      });
    }

    ctx.skipWhitespace();
    if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 125 /* } */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Expected '}' or 'if <condition>}' in '{else}' branch.",
        ctx.lineMap,
        branchStart,
        ctx.pos
      );
    }
    ctx.pos++;
    alternate = ctx.parseChildren(() => isEndIfAt(ctx.source, ctx.pos) > 0);
  }

  const endLen = isEndIfAt(ctx.source, ctx.pos);
  if (endLen === 0) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      "Unclosed '{if}' block: missing '{endif}' (or '{/if}').",
      ctx.lineMap,
      start,
      ctx.pos
    );
  }
  ctx.pos += endLen;

  return deepFreeze({
    type: "IfBlock",
    condition: condResult.expression,
    rawCondition: condResult.rawExpression,
    consequent,
    alternate,
    span: ctx.lineMap.span(start, ctx.pos),
    ...(isLegacyHashIf ? { legacySyntax: true } : {})
  });
}

export function parseElseIfChain(ctx: ParserContext, branchStart: number): IfBlockNode {
  const condResult = parseEmbeddedExpression(ctx.source, ctx.pos, "}", ctx.lineMap);
  ctx.pos = condResult.afterDelimiterOffset;

  const consequent = ctx.parseChildren(
    () => isElseOrElseIfAt(ctx.source, ctx.pos) || isEndIfAt(ctx.source, ctx.pos) > 0
  );

  let alternate: readonly TemplateNode[] | IfBlockNode | null = null;
  const branch = matchElseOrElseIf(ctx.source, ctx.pos);
  if (branch) {
    const nextBranchStart = ctx.pos;
    ctx.pos = branch.afterKeywordOffset;

    if (branch.kind === "elseif") {
      alternate = parseElseIfChain(ctx, nextBranchStart);
      return deepFreeze({
        type: "IfBlock",
        condition: condResult.expression,
        rawCondition: condResult.rawExpression,
        consequent,
        alternate,
        span: ctx.lineMap.span(branchStart, ctx.pos)
      });
    }

    ctx.skipWhitespace();
    if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 125 /* } */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Expected '}' in '{else}' branch.",
        ctx.lineMap,
        nextBranchStart,
        ctx.pos
      );
    }
    ctx.pos++;
    alternate = ctx.parseChildren(() => isEndIfAt(ctx.source, ctx.pos) > 0);
  }

  const endLen = isEndIfAt(ctx.source, ctx.pos);
  if (endLen === 0) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      "Unclosed '{elseif}' block: missing '{endif}' (or '{/if}').",
      ctx.lineMap,
      branchStart,
      ctx.pos
    );
  }
  ctx.pos += endLen;

  return deepFreeze({
    type: "IfBlock",
    condition: condResult.expression,
    rawCondition: condResult.rawExpression,
    consequent,
    alternate,
    span: ctx.lineMap.span(branchStart, ctx.pos)
  });
}

export function parseEachBlock(ctx: ParserContext): EachBlockNode {
  const start = ctx.pos;
  const isLegacyHashEach = ctx.source.startsWith("{#each", start);
  const openLen = isEachOpenAt(ctx.source, start);
  const headerStart = start + (openLen > 0 ? openLen : 5);
  const tokenizer = createTsTokenizer(ctx.source.slice(headerStart));

  let braceDepth = 1;
  let parenDepth = 0;
  let bracketDepth = 0;
  let headerEndRel = -1;
  let lastTopLevelAsRel: { start: number; end: number } | null = null;
  let firstTopLevelInOrOfRel: { start: number; end: number; keyword: "in" | "of" } | null = null;

  try {
    while (true) {
      const tok = tokenizer.getToken();
      if (tok.type.label === "eof") break;
      if (tok.type.label === "{") braceDepth++;
      else if (tok.type.label === "}") {
        braceDepth--;
        if (braceDepth === 0) {
          headerEndRel = tok.start;
          break;
        }
      } else if (tok.type.label === "(") parenDepth++;
      else if (tok.type.label === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (tok.type.label === "[") bracketDepth++;
      else if (tok.type.label === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (braceDepth === 1 && parenDepth === 0 && bracketDepth === 0) {
        if (tok.value === "as") {
          lastTopLevelAsRel = { start: tok.start, end: tok.end };
        } else if (
          !firstTopLevelInOrOfRel &&
          (tok.value === "in" || tok.type.label === "in" || tok.value === "of")
        ) {
          firstTopLevelInOrOfRel = { start: tok.start, end: tok.end, keyword: tok.value === "of" ? "of" : "in" };
        }
      }
    }
  } catch {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      "Malformed '{each}' header expression.",
      ctx.lineMap,
      start,
      Math.min(ctx.source.length, start + 30)
    );
  }

  if (headerEndRel === -1 || (!lastTopLevelAsRel && !firstTopLevelInOrOfRel)) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      "Invalid '{each}' syntax: expected '{each (item, idx) in collection}' or '{each collection as (item, idx)}'.",
      ctx.lineMap,
      start,
      Math.min(ctx.source.length, start + 30)
    );
  }

  const headerCloseOffset = headerStart + headerEndRel;
  let rawCollection = "";
  let collectionExpr: ESTreeNode;
  let itemIdentifier = "";
  let indexIdentifier: string | null = null;
  let keyExpression: ESTreeNode;
  let rawKeyExpression = "";

  if (firstTopLevelInOrOfRel && !lastTopLevelAsRel) {
    const lhsEnd = headerStart + firstTopLevelInOrOfRel.start;
    const lhsStart = skipJsWhitespaceAndComments(ctx.source, headerStart, ctx.lineMap, lhsEnd);
    const lhsRaw = ctx.source.slice(lhsStart, lhsEnd).trim();
    const innerLhs = lhsRaw.startsWith("(") && lhsRaw.endsWith(")") ? lhsRaw.slice(1, -1).trim() : lhsRaw;

    const tupleMatch =
      /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?(?:\s*,\s*([\s\S]+))?$/.exec(innerLhs);
    if (!tupleMatch) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Invalid '{each}' loop binding: expected '{each (item, idx) in collection}' or '{each item in collection}'.",
        ctx.lineMap,
        lhsStart,
        lhsEnd
      );
    }

    itemIdentifier = tupleMatch[1]!;
    indexIdentifier = tupleMatch[2] ?? null;
    const explicitTupleKey = tupleMatch[3]?.trim() ?? null;
    const collectionStart = skipJsWhitespaceAndComments(
      ctx.source,
      headerStart + firstTopLevelInOrOfRel.end,
      ctx.lineMap,
      headerCloseOffset
    );
    rawCollection = ctx.source.slice(collectionStart, headerCloseOffset).trimEnd();
    if (!rawCollection) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Missing collection expression in '{each}' block.",
        ctx.lineMap,
        start,
        headerCloseOffset
      );
    }
    collectionExpr = parseExpressionSlice(rawCollection, collectionStart, ctx.lineMap);

    const itemOffsetInSource = headerStart + ctx.source.slice(headerStart, lhsEnd).indexOf(itemIdentifier);
    rawKeyExpression = explicitTupleKey ?? itemIdentifier;
    keyExpression = parseExpressionSlice(
      rawKeyExpression,
      explicitTupleKey ? lhsStart : itemOffsetInSource,
      ctx.lineMap
    );
  } else {
    const asRel = lastTopLevelAsRel!;
    const collectionEndRaw = headerStart + asRel.start;
    const collectionStart = skipJsWhitespaceAndComments(ctx.source, headerStart, ctx.lineMap, collectionEndRaw);
    rawCollection = ctx.source.slice(collectionStart, collectionEndRaw).trimEnd();
    if (!rawCollection) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Missing collection expression in '{each}' block.",
        ctx.lineMap,
        start,
        collectionEndRaw
      );
    }

    collectionExpr = parseExpressionSlice(rawCollection, collectionStart, ctx.lineMap);
    const bindingSliceStart = headerStart + asRel.end;
    const bindingSlice = ctx.source.slice(bindingSliceStart, headerCloseOffset);
    const asTupleMatch =
      /^\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?(?:\s*,\s*([^)]+))?\s*\)\s*$/.exec(
        bindingSlice
      );

    if (asTupleMatch) {
      itemIdentifier = asTupleMatch[1]!;
      indexIdentifier = asTupleMatch[2] ?? null;
      const explicitTupleKey = asTupleMatch[3]?.trim() ?? null;
      const itemOffsetInSource = bindingSliceStart + bindingSlice.indexOf(itemIdentifier);
      rawKeyExpression = explicitTupleKey ?? itemIdentifier;
      keyExpression = parseExpressionSlice(
        rawKeyExpression,
        explicitTupleKey ? bindingSliceStart : itemOffsetInSource,
        ctx.lineMap
      );
    } else {
      const bindingMatch =
        /^\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s*\(/.exec(bindingSlice);

      if (bindingMatch) {
        itemIdentifier = bindingMatch[1]!;
        indexIdentifier = bindingMatch[2] ?? null;
        const keyOpenParenOffset = bindingSliceStart + bindingMatch[0].length - 1;
        const keyParsed = parseEmbeddedExpression(
          ctx.source,
          keyOpenParenOffset + 1,
          ")",
          ctx.lineMap,
          headerCloseOffset
        );
        const afterKeyParen = skipJsWhitespaceAndComments(
          ctx.source,
          keyParsed.afterDelimiterOffset,
          ctx.lineMap,
          headerCloseOffset + 1
        );
        if (afterKeyParen !== headerCloseOffset) {
          failSyntax(
            DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
            "Unexpected tokens after '(key)' in '{each}' block.",
            ctx.lineMap,
            afterKeyParen,
            headerCloseOffset + 1
          );
        }
        keyExpression = keyParsed.expression;
        rawKeyExpression = keyParsed.rawExpression;
      } else if (!isLegacyHashEach) {
        const simpleMatch =
          /^\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s*$/.exec(bindingSlice);
        if (!simpleMatch) {
          failSyntax(
            DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
            "Invalid '{each}' loop binding.",
            ctx.lineMap,
            bindingSliceStart,
            headerCloseOffset + 1
          );
        }
        itemIdentifier = simpleMatch[1]!;
        indexIdentifier = simpleMatch[2] ?? null;
        const itemOffsetInSource = bindingSliceStart + bindingSlice.indexOf(itemIdentifier);
        rawKeyExpression = itemIdentifier;
        keyExpression = parseExpressionSlice(rawKeyExpression, itemOffsetInSource, ctx.lineMap);
      } else {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Keyed '{#each}' block requires an item identifier and explicit '(key)' expression (D-110): '{#each items as item (item.id)}'.",
          ctx.lineMap,
          bindingSliceStart,
          headerCloseOffset + 1
        );
      }
    }
  }

  ctx.pos = headerCloseOffset + 1;
  const children = ctx.parseChildren(() => isEndEachAt(ctx.source, ctx.pos) > 0);
  const endLen = isEndEachAt(ctx.source, ctx.pos);
  if (endLen === 0) {
    failSyntax(DiagnosticCodes.MIX_ERR_UNCLOSED_TAG, "Unclosed '{each}' block: missing '{endeach}' (or '{/each}').", ctx.lineMap, start, ctx.pos);
  }
  ctx.pos += endLen;

  return deepFreeze({
    type: "EachBlock",
    collection: collectionExpr,
    rawCollection,
    itemIdentifier,
    indexIdentifier,
    keyExpression,
    rawKeyExpression,
    children,
    span: ctx.lineMap.span(start, ctx.pos),
    ...(isLegacyHashEach ? { legacySyntax: true } : {})
  });
}

export function parseAwaitBlock(ctx: ParserContext): AwaitBlockNode {
  const start = ctx.pos;
  const isLegacyHashAwait = ctx.source.startsWith("{#await", start);
  const openLen = isAwaitOpenAt(ctx.source, start);
  ctx.pos += openLen > 0 ? openLen : 6;
  const exprResult = parseEmbeddedExpression(ctx.source, ctx.pos, "}", ctx.lineMap);
  ctx.pos = exprResult.afterDelimiterOffset;

  const pending = ctx.parseChildren(
    () =>
      isThenAt(ctx.source, ctx.pos) !== null ||
      isCatchAt(ctx.source, ctx.pos) !== null ||
      isEndAwaitAt(ctx.source, ctx.pos) > 0
  );

  let thenIdentifier: string | null = null;
  let thenBranch: TemplateNode[] = [];
  const thenMatch = isThenAt(ctx.source, ctx.pos);
  if (thenMatch) {
    thenIdentifier = thenMatch.ident;
    ctx.pos += thenMatch.len;
    thenBranch = ctx.parseChildren(
      () => isCatchAt(ctx.source, ctx.pos) !== null || isEndAwaitAt(ctx.source, ctx.pos) > 0
    );
  }

  let catchIdentifier: string | null = null;
  let catchBranch: TemplateNode[] = [];
  const catchMatch = isCatchAt(ctx.source, ctx.pos);
  if (catchMatch) {
    catchIdentifier = catchMatch.ident;
    ctx.pos += catchMatch.len;
    catchBranch = ctx.parseChildren(() => isEndAwaitAt(ctx.source, ctx.pos) > 0);
  }

  const endLen = isEndAwaitAt(ctx.source, ctx.pos);
  if (endLen === 0) {
    failSyntax(DiagnosticCodes.MIX_ERR_UNCLOSED_TAG, "Unclosed '{await}' block: missing '{endawait}' (or '{/await}').", ctx.lineMap, start, ctx.pos);
  }
  ctx.pos += endLen;

  return createAwaitBlockNode({
    span: ctx.lineMap.span(start, ctx.pos),
    expression: exprResult.expression,
    rawExpression: exprResult.rawExpression,
    pending,
    thenIdentifier,
    thenBranch,
    catchIdentifier,
    catchBranch,
    ...(isLegacyHashAwait ? { legacySyntax: true } : {})
  });
}
