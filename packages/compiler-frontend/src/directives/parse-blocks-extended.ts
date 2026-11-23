/**
 * @dotmix/compiler-frontend/directives/parse-blocks-extended — Form, layout, stack, composition, render-control, server, and debug block parsers.
 */

import {
  createDirectiveNode,
  deepFreeze,
  parseHydrateWhenSpec,
  type ContextBlockNode,
  type DirectiveGrammarEntry,
  type DumpNode,
  type ESTreeNode,
  type HydrateNode,
  type IncludeFirstNode,
  type IncludeNode,
  type JsonNode,
  type KeepAliveBlockNode,
  type LazyNode,
  type MemoNode,
  type OnceNode,
  type SessionBlockNode,
  type TemplateNode,
  type VerbatimNode
} from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import { skipJsWhitespaceAndComments } from "../expression.js";
import { failSyntax, type ParserContext } from "../types.js";
import { parseFormOrLayoutBlock } from "./parse-forms-layouts.js";
import { isValidIdentifierName, matchDirectiveCloseAt } from "./scanner.js";
import {
  findHeaderCloseOffset,
  parseOptionalElseBlockBodies,
  parseSingleBody,
  parseSliceRequired,
  scanTopLevelKeywords
} from "./scanner-expressions.js";

function parseAsIdentSlice(ctx: ParserContext, asStart: number, headerClose: number, blockName: string): string {
  const identStart = skipJsWhitespaceAndComments(ctx.source, asStart, ctx.lineMap, headerClose);
  const identRaw = ctx.source.slice(identStart, headerClose).trim();
  if (!isValidIdentifierName(identRaw)) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      `Expected valid identifier after 'as' in '{${blockName}}' block.`,
      ctx.lineMap,
      identStart,
      Math.max(identStart + 1, headerClose)
    );
  }
  return identRaw;
}

export function parseExtendedDirectiveBlock(
  ctx: ParserContext,
  entry: DirectiveGrammarEntry,
  startOffset: number,
  afterKeywordOffset: number
): TemplateNode | null {
  if (entry.id === "verbatim") {
    const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, startOffset, "verbatim");
    if (ctx.source.slice(afterKeywordOffset, headerClose).trim().length > 0) {
      failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'{verbatim}' does not accept header arguments.", ctx.lineMap, startOffset, headerClose + 1);
    }
    const contentStart = headerClose + 1;
    let scanOffset = contentStart;
    let closeStart = -1;
    let closeEnd = -1;
    while (scanOffset < ctx.source.length) {
      const nextBrace = ctx.source.indexOf("{", scanOffset);
      if (nextBrace === -1) break;
      const closeMatch = matchDirectiveCloseAt(ctx.source, nextBrace);
      if (closeMatch && closeMatch.entry.id === "verbatim") {
        closeStart = nextBrace;
        closeEnd = closeMatch.closeEnd;
        break;
      }
      scanOffset = nextBrace + 1;
    }
    if (closeStart === -1) {
      failSyntax(DiagnosticCodes.MIX_ERR_UNCLOSED_TAG, "Unclosed '{verbatim}' block: missing '{endverbatim}'.", ctx.lineMap, startOffset, ctx.source.length);
    }
    const content = ctx.source.slice(contentStart, closeStart);
    ctx.pos = closeEnd;
    return createDirectiveNode<VerbatimNode>({
      type: "Verbatim",
      form: "block",
      content,
      span: ctx.lineMap.span(startOffset, ctx.pos)
    });
  }

  const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, startOffset, entry.blockOpen);
  const formOrLayoutNode = parseFormOrLayoutBlock(ctx, entry, startOffset, afterKeywordOffset, headerClose);
  if (formOrLayoutNode) {
    return formOrLayoutNode;
  }

  switch (entry.id) {
    case "context": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["as"]));
      const asKw = keywords[0];
      if (!asKw) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'{context}' requires 'as <ident>'.", ctx.lineMap, startOffset, headerClose + 1);
      }
      const ctxExpr = parseSliceRequired(ctx.source, afterKeywordOffset, asKw.startOffset, ctx.lineMap, "'{context}'");
      const asIdentifier = parseAsIdentSlice(ctx, asKw.endOffset, headerClose, "context");
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, startOffset);
      return createDirectiveNode<ContextBlockNode>({
        type: "ContextBlock",
        form: "block",
        contextExpr: ctxExpr.expression,
        rawContextExpr: ctxExpr.raw,
        asIdentifier,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "include": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["with", "if", "unless"]));
      const withKw = keywords.find((kw) => kw.keyword === "with") ?? null;
      const ifKw = keywords.find((kw) => kw.keyword === "if") ?? null;
      const unlessKw = keywords.find((kw) => kw.keyword === "unless") ?? null;
      const firstKwOffset = keywords[0] ? keywords[0].startOffset : headerClose;
      const compSlice = parseSliceRequired(ctx.source, afterKeywordOffset, firstKwOffset, ctx.lineMap, "'{include}' component");
      let propsSlice: { raw: string; expression: ESTreeNode } | null = null;
      if (withKw) {
        const withIdx = keywords.indexOf(withKw);
        const nextBoundary = withIdx + 1 < keywords.length ? keywords[withIdx + 1]!.startOffset : headerClose;
        propsSlice = parseSliceRequired(ctx.source, withKw.endOffset, nextBoundary, ctx.lineMap, "'{include} with'");
      }
      let condSlice: { raw: string; expression: ESTreeNode } | null = null;
      if (ifKw) {
        const ifIdx = keywords.indexOf(ifKw);
        const nextBoundary = ifIdx + 1 < keywords.length ? keywords[ifIdx + 1]!.startOffset : headerClose;
        condSlice = parseSliceRequired(ctx.source, ifKw.endOffset, nextBoundary, ctx.lineMap, "'{include} if'");
      }
      let unlessSlice: { raw: string; expression: ESTreeNode } | null = null;
      if (unlessKw) {
        const unlessIdx = keywords.indexOf(unlessKw);
        const nextBoundary = unlessIdx + 1 < keywords.length ? keywords[unlessIdx + 1]!.startOffset : headerClose;
        unlessSlice = parseSliceRequired(ctx.source, unlessKw.endOffset, nextBoundary, ctx.lineMap, "'{include} unless'");
      }
      ctx.pos = headerClose + 1;
      return createDirectiveNode<IncludeNode>({
        type: "Include",
        form: "block",
        component: compSlice.expression,
        rawComponent: compSlice.raw,
        props: propsSlice ? propsSlice.expression : null,
        rawProps: propsSlice ? propsSlice.raw : null,
        condition: condSlice ? condSlice.expression : null,
        rawCondition: condSlice ? condSlice.raw : null,
        unless: unlessSlice ? unlessSlice.expression : null,
        rawUnless: unlessSlice ? unlessSlice.raw : null,
        pending: deepFreeze([]),
        fallback: deepFreeze([]),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "includefirst": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["with"]));
      const withKw = keywords[0];
      const candidatesSlice = parseSliceRequired(
        ctx.source,
        afterKeywordOffset,
        withKw ? withKw.startOffset : headerClose,
        ctx.lineMap,
        "'{includefirst}'"
      );
      const propsSlice = withKw
        ? parseSliceRequired(ctx.source, withKw.endOffset, headerClose, ctx.lineMap, "'{includefirst} with'")
        : null;
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, startOffset);
      return createDirectiveNode<IncludeFirstNode>({
        type: "IncludeFirst",
        form: "block",
        candidates: candidatesSlice.expression,
        rawCandidates: candidatesSlice.raw,
        props: propsSlice ? propsSlice.expression : null,
        rawProps: propsSlice ? propsSlice.raw : null,
        pending: deepFreeze(consequent),
        fallback: deepFreeze(alternate ?? []),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "once": {
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      return createDirectiveNode<OnceNode>({
        type: "Once",
        form: "block",
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "memo": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["on", "by"]));
      const onKw = keywords.find((kw) => kw.keyword === "on");
      const byKw = keywords.find((kw) => kw.keyword === "by");
      const depsStart = onKw ? onKw.endOffset : afterKeywordOffset;
      const depsSlice = parseSliceRequired(ctx.source, depsStart, byKw ? byKw.startOffset : headerClose, ctx.lineMap, "'{memo}'");
      const equalsSlice = byKw
        ? parseSliceRequired(ctx.source, byKw.endOffset, headerClose, ctx.lineMap, "'{memo} by'")
        : null;
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      return createDirectiveNode<MemoNode>({
        type: "Memo",
        form: "block",
        deps: depsSlice.expression,
        rawDeps: depsSlice.raw,
        equals: equalsSlice ? equalsSlice.expression : null,
        rawEquals: equalsSlice ? equalsSlice.raw : null,
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "lazy": {
      const rawHeader = ctx.source.slice(afterKeywordOffset, headerClose).trim();
      let trigger: "visible" | "idle" = "visible";
      let triggerExpr: ESTreeNode | null = null;
      let rawTriggerExpr: string | null = null;
      if (rawHeader.length > 0) {
        if (rawHeader === "idle" || rawHeader === "visible") {
          trigger = rawHeader;
        } else {
          const triggerSlice = parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{lazy}'");
          triggerExpr = triggerSlice.expression;
          rawTriggerExpr = triggerSlice.raw;
          if (triggerSlice.raw === '"idle"' || triggerSlice.raw === "'idle'") {
            trigger = "idle";
          }
        }
      }
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, startOffset);
      return createDirectiveNode<LazyNode>({
        type: "Lazy",
        form: "block",
        trigger,
        triggerExpr,
        rawTriggerExpr,
        children: deepFreeze(consequent),
        fallback: deepFreeze(alternate ?? []),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "hydrate": {
      const rawHeader = ctx.source.slice(afterKeywordOffset, headerClose).trim();
      const spec = parseHydrateWhenSpec(rawHeader);
      if (!spec) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "'{hydrate}' requires one of: load, idle, visible, media \"<query>\", or never.",
          ctx.lineMap,
          startOffset,
          headerClose + 1
        );
      }
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      return createDirectiveNode<HydrateNode>({
        type: "Hydrate",
        form: "block",
        when: spec.when,
        media: spec.media,
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "keepalive": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["max", "as"]));
      const maxKw = keywords.find((kw) => kw.keyword === "max");
      const asKw = keywords.find((kw) => kw.keyword === "as");
      const firstKwOffset = keywords[0] ? keywords[0].startOffset : headerClose;
      const keySlice = parseSliceRequired(ctx.source, afterKeywordOffset, firstKwOffset, ctx.lineMap, "'{keepalive}'");
      const maxSlice = maxKw
        ? parseSliceRequired(
            ctx.source,
            maxKw.endOffset,
            asKw && asKw.startOffset > maxKw.endOffset ? asKw.startOffset : headerClose,
            ctx.lineMap,
            "'{keepalive} max'"
          )
        : null;
      const asIdentifier = asKw ? parseAsIdentSlice(ctx, asKw.endOffset, headerClose, "keepalive") : null;
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      return createDirectiveNode<KeepAliveBlockNode>({
        type: "KeepAliveBlock",
        form: "block",
        activeKey: keySlice.expression,
        rawActiveKey: keySlice.raw,
        max: maxSlice ? maxSlice.expression : null,
        rawMax: maxSlice ? maxSlice.raw : null,
        asIdentifier,
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "session": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["as"]));
      const asKw = keywords[0];
      const keySlice = parseSliceRequired(
        ctx.source,
        afterKeywordOffset,
        asKw ? asKw.startOffset : headerClose,
        ctx.lineMap,
        "'{session}'"
      );
      const asIdentifier = asKw ? parseAsIdentSlice(ctx, asKw.endOffset, headerClose, "session") : null;
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, startOffset);
      return createDirectiveNode<SessionBlockNode>({
        type: "SessionBlock",
        form: "block",
        key: keySlice.expression,
        rawKey: keySlice.raw,
        asIdentifier,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "json": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["as"]));
      const asKw = keywords[0];
      if (!asKw) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'{json}' requires 'as <id>'.", ctx.lineMap, startOffset, headerClose + 1);
      }
      const dataSlice = parseSliceRequired(ctx.source, afterKeywordOffset, asKw.startOffset, ctx.lineMap, "'{json}' data");
      const idSlice = parseSliceRequired(ctx.source, asKw.endOffset, headerClose, ctx.lineMap, "'{json}' id");
      ctx.pos = headerClose + 1;
      return createDirectiveNode<JsonNode>({
        type: "Json",
        form: "block",
        id: idSlice.expression,
        rawId: idSlice.raw,
        data: dataSlice.expression,
        rawData: dataSlice.raw,
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "dump": {
      const valSlice = parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{dump}'");
      ctx.pos = headerClose + 1;
      return createDirectiveNode<DumpNode>({
        type: "Dump",
        form: "block",
        value: valSlice.expression,
        rawValue: valSlice.raw,
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    default:
      return null;
  }
}
