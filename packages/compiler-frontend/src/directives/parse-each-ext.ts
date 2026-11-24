/**
 * @dotmix/compiler-frontend/directives/parse-each-ext — Extended {each} parser supporting {empty}, {continue if}, {break if}, and `render`.
 */

import {
  createDirectiveNode,
  createDirectiveSubNode,
  deepFreeze,
  type ESTreeNode,
  type EachBlockNode,
  type EachExtNode,
  type LoopControlDirective,
  type TemplateNode
} from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import { parseEmbeddedExpression, parseExpressionSlice, skipJsWhitespaceAndComments } from "../expression.js";
import { isEachOpenAt, isEndEachAt } from "../control-flow-scanner.js";
import { failSyntax, isAsciiWhitespace, type ParserContext } from "../types.js";
import {
  isValidIdentifierName,
  matchDirectiveBranchAt,
  matchInlineStatementAt
} from "./scanner.js";
import {
  findHeaderCloseOffset,
  parseSliceRequired,
  scanTopLevelKeywords
} from "./scanner-expressions.js";

function parseSimpleBindingTuple(
  rawSlice: string,
  sliceStart: number,
  ctx: ParserContext
): { itemIdentifier: string; indexIdentifier: string | null; explicitKeyRaw: string | null } {
  const trimmed = rawSlice.trim();
  const unwrapped =
    trimmed.startsWith("(") && trimmed.endsWith(")")
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < unwrapped.length; i++) {
    const ch = unwrapped.charCodeAt(i);
    if (ch === 40 || ch === 91 || ch === 123) depth++;
    else if (ch === 41 || ch === 93 || ch === 125) depth = Math.max(0, depth - 1);
    else if (ch === 44 && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += unwrapped[i]!;
  }
  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  const itemIdentifier = parts[0] ?? "";
  if (!isValidIdentifierName(itemIdentifier)) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      "Invalid '{each}' item identifier.",
      ctx.lineMap,
      sliceStart,
      sliceStart + Math.max(1, rawSlice.length)
    );
  }
  const indexIdentifier = parts[1] ? parts[1] : null;
  if (indexIdentifier !== null && !isValidIdentifierName(indexIdentifier)) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      "Invalid '{each}' index identifier.",
      ctx.lineMap,
      sliceStart,
      sliceStart + Math.max(1, rawSlice.length)
    );
  }
  const explicitKeyRaw = parts[2] ? parts[2] : null;
  return { itemIdentifier, indexIdentifier, explicitKeyRaw };
}

function collectLeadingLoopControls(ctx: ParserContext): LoopControlDirective[] {
  const controls: LoopControlDirective[] = [];
  while (ctx.pos < ctx.source.length) {
    let probe = ctx.pos;
    while (probe < ctx.source.length && isAsciiWhitespace(ctx.source.charCodeAt(probe))) {
      probe++;
    }
    const inlineMatch = matchInlineStatementAt(ctx.source, probe);
    if (!inlineMatch) {
      break;
    }
    ctx.pos = probe;
    const stmtStart = inlineMatch.startOffset;
    const condParsed = parseEmbeddedExpression(
      ctx.source,
      inlineMatch.headerStartOffset,
      "}",
      ctx.lineMap
    );
    ctx.pos = condParsed.afterDelimiterOffset;
    controls.push(
      createDirectiveSubNode<LoopControlDirective>({
        kind: inlineMatch.marker,
        condition: condParsed.expression,
        rawCondition: condParsed.rawExpression,
        span: ctx.lineMap.span(stmtStart, ctx.pos)
      })
    );
  }
  return controls;
}

function isEmptyBranchAt(source: string, pos: number): boolean {
  const branch = matchDirectiveBranchAt(source, pos);
  return branch !== null && branch.marker === "empty" && branch.noArgCloseEnd !== null;
}

export function tryParseExtendedEach(ctx: ParserContext): EachBlockNode | EachExtNode | null {
  const start = ctx.pos;
  const openLen = isEachOpenAt(ctx.source, start);
  if (openLen === 0) {
    return null;
  }

  const headerStart = start + openLen;
  const headerClose = findHeaderCloseOffset(ctx.source, headerStart, ctx.lineMap, start, "each");
  const keywords = scanTopLevelKeywords(
    ctx.source,
    headerStart,
    headerClose,
    new Set(["in", "as", "render"])
  );
  const renderKeyword = keywords.find((entry) => entry.keyword === "render") ?? null;

  if (!renderKeyword) {
    // Check whether body uses {continue if}, {break if}, or {empty}. If not, delegate to frozen parseEachBlock.
    return null;
  }

  const inKeyword = keywords.find((entry) => entry.keyword === "in") ?? null;
  if (!inKeyword || inKeyword.startOffset >= renderKeyword.startOffset) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      "Expected '{each item in collection render ComponentRef}'.",
      ctx.lineMap,
      start,
      headerClose + 1
    );
  }

  const bindingRaw = ctx.source.slice(headerStart, inKeyword.startOffset);
  const binding = parseSimpleBindingTuple(bindingRaw, headerStart, ctx);
  const collectionSlice = parseSliceRequired(
    ctx.source,
    inKeyword.endOffset,
    renderKeyword.startOffset,
    ctx.lineMap,
    "'{each}' collection"
  );
  const renderSlice = parseSliceRequired(
    ctx.source,
    renderKeyword.endOffset,
    headerClose,
    ctx.lineMap,
    "'{each ... render Component}'"
  );

  const keyStart = binding.explicitKeyRaw
    ? headerStart + Math.max(0, bindingRaw.lastIndexOf(binding.explicitKeyRaw))
    : headerStart + Math.max(0, bindingRaw.indexOf(binding.itemIdentifier));
  const rawKey = binding.explicitKeyRaw ?? binding.itemIdentifier;
  const keyExpr = parseExpressionSlice(rawKey, keyStart, ctx.lineMap);
  const explicitKey = binding.explicitKeyRaw !== null;

  ctx.pos = headerClose + 1;
  const bodyChildren = ctx.parseChildren(
    () => isEmptyBranchAt(ctx.source, ctx.pos) || isEndEachAt(ctx.source, ctx.pos) > 0
  );
  const hasVisibleBody = bodyChildren.some(
    (child) => !(child.type === "Text" && child.value.trim() === "")
  );
  if (hasVisibleBody) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      "'{each ... render Component}' cannot have a template body before '{empty}' or '{endeach}'.",
      ctx.lineMap,
      start,
      ctx.pos
    );
  }

  let emptyChildren: TemplateNode[] = [];
  const branch = matchDirectiveBranchAt(ctx.source, ctx.pos);
  if (branch && branch.marker === "empty" && branch.noArgCloseEnd !== null) {
    ctx.pos = branch.noArgCloseEnd;
    emptyChildren = ctx.parseChildren(() => isEndEachAt(ctx.source, ctx.pos) > 0);
  }

  const endLen = isEndEachAt(ctx.source, ctx.pos);
  if (endLen === 0) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      "Unclosed '{each}' block: missing '{endeach}'.",
      ctx.lineMap,
      start,
      ctx.pos
    );
  }
  ctx.pos += endLen;

  return createDirectiveNode<EachExtNode>({
    type: "EachExtBlock",
    form: "block",
    collection: collectionSlice.expression,
    rawCollection: collectionSlice.raw,
    itemIdentifier: binding.itemIdentifier,
    indexIdentifier: binding.indexIdentifier,
    keyExpression: keyExpr,
    rawKeyExpression: rawKey,
    explicitKey,
    controls: deepFreeze([]),
    skipExpression: null,
    rawSkipExpression: null,
    stopExpression: null,
    rawStopExpression: null,
    renderComponent: renderSlice.expression,
    rawRenderComponent: renderSlice.raw,
    renderPropName: binding.itemIdentifier,
    children: deepFreeze([]),
    empty: deepFreeze(emptyChildren),
    span: ctx.lineMap.span(start, ctx.pos)
  });
}

export function finishEachBlockWithDirectives(
  ctx: ParserContext,
  start: number,
  headerCloseOffset: number,
  collectionExpr: ESTreeNode,
  rawCollection: string,
  itemIdentifier: string,
  indexIdentifier: string | null,
  keyExpression: ESTreeNode,
  rawKeyExpression: string,
  isLegacyHashEach: boolean,
  explicitKey: boolean = false
): EachBlockNode | EachExtNode {
  ctx.pos = headerCloseOffset + 1;
  const controls = collectLeadingLoopControls(ctx);
  const children = ctx.parseChildren(
    () => isEmptyBranchAt(ctx.source, ctx.pos) || isEndEachAt(ctx.source, ctx.pos) > 0
  );

  let hasEmptyBranch = false;
  let emptyChildren: TemplateNode[] = [];
  const branch = matchDirectiveBranchAt(ctx.source, ctx.pos);
  if (branch && branch.marker === "empty" && branch.noArgCloseEnd !== null) {
    hasEmptyBranch = true;
    ctx.pos = branch.noArgCloseEnd;
    emptyChildren = ctx.parseChildren(() => isEndEachAt(ctx.source, ctx.pos) > 0);
  }

  const endLen = isEndEachAt(ctx.source, ctx.pos);
  if (endLen === 0) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      "Unclosed '{each}' block: missing '{endeach}' (or '{/each}').",
      ctx.lineMap,
      start,
      ctx.pos
    );
  }
  ctx.pos += endLen;

  if (controls.length === 0 && !hasEmptyBranch) {
    return deepFreeze({
      type: "EachBlock",
      collection: collectionExpr,
      rawCollection,
      itemIdentifier,
      indexIdentifier,
      keyExpression,
      rawKeyExpression,
      explicitKey,
      children,
      span: ctx.lineMap.span(start, ctx.pos),
      ...(isLegacyHashEach ? { legacySyntax: true } : {})
    });
  }

  // Verify no late {continue if} / {break if} after empty
  void skipJsWhitespaceAndComments;

  return createDirectiveNode<EachExtNode>({
    type: "EachExtBlock",
    form: "block",
    collection: collectionExpr,
    rawCollection,
    itemIdentifier,
    indexIdentifier,
    keyExpression,
    rawKeyExpression,
    explicitKey,
    controls: deepFreeze(controls),
    skipExpression: null,
    rawSkipExpression: null,
    stopExpression: null,
    rawStopExpression: null,
    renderComponent: null,
    rawRenderComponent: null,
    renderPropName: null,
    children: deepFreeze(children),
    empty: deepFreeze(emptyChildren),
    span: ctx.lineMap.span(start, ctx.pos)
  });
}
