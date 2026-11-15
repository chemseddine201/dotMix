/**
 * @dotmix/compiler-frontend/directives/parse-forms-layouts — Form, section, stack, and partial block parsers.
 */

import {
  createDirectiveNode,
  createDirectiveSubNode,
  deepFreeze,
  type CsrfNode,
  type DirectiveGrammarEntry,
  type ESTreeNode,
  type ElementNode,
  type FieldErrorNode,
  type FieldValidNode,
  type FormErrorsNode,
  type HasSectionNode,
  type HeadChildEntry,
  type HeadGroupNode,
  type MethodNode,
  type PartialNode,
  type SectionMissingNode,
  type SectionNode,
  type StackNode,
  type StackPushNode,
  type TemplateNode,
  type YieldNode
} from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import { skipJsWhitespaceAndComments } from "../expression.js";
import { failSyntax, type ParserContext } from "../types.js";
import { isValidIdentifierName } from "./scanner.js";
import {
  parseSingleBody,
  parseSliceRequired,
  scanTopLevelKeywords
} from "./scanner-expressions.js";

function parseAsIdentSlice(ctx: ParserContext, asStart: number, headerClose: number, blockName: string): string {
  const identStart = skipJsWhitespaceAndComments(ctx.source, asStart, ctx.lineMap, headerClose);
  const identRaw = ctx.source.slice(identStart, headerClose).trim();
  if (!isValidIdentifierName(identRaw)) {
    failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, `Expected valid identifier after 'as' in '{${blockName}}' block.`, ctx.lineMap, identStart, Math.max(identStart + 1, headerClose));
  }
  return identRaw;
}

function parseHeadGroupIfEligible(
  ctx: ParserContext,
  targetExpr: ESTreeNode,
  onceId: ESTreeNode | null,
  children: readonly TemplateNode[],
  startOffset: number
): HeadGroupNode | null {
  if (onceId !== null || targetExpr.type !== "Literal" || targetExpr.value !== "head") {
    return null;
  }
  const entries: HeadChildEntry[] = [];
  for (const child of children) {
    if (child.type === "Text" && child.value.trim() === "") continue;
    if (child.type !== "Element") return null;
    const elementNode = child as ElementNode;
    const tagLower = elementNode.tag.toLowerCase();
    if (tagLower !== "title" && tagLower !== "meta" && tagLower !== "link") return null;
    entries.push(
      createDirectiveSubNode<HeadChildEntry>({
        tag: tagLower,
        attributes: elementNode.attributes,
        children: elementNode.children,
        span: elementNode.span
      })
    );
  }
  return createDirectiveNode<HeadGroupNode>({
    type: "HeadGroup",
    form: "block",
    entries: deepFreeze(entries),
    children: deepFreeze(children),
    span: ctx.lineMap.span(startOffset, ctx.pos)
  });
}

export function parseFormOrLayoutBlock(
  ctx: ParserContext,
  entry: DirectiveGrammarEntry,
  startOffset: number,
  afterKeywordOffset: number,
  headerClose: number
): TemplateNode | null {
  switch (entry.id) {
    case "error": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["in", "as"]));
      const inKw = keywords.find((kw) => kw.keyword === "in");
      if (!inKw) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'{error}' requires 'in <form>'.", ctx.lineMap, startOffset, headerClose + 1);
      }
      const asKw = keywords.find((kw) => kw.keyword === "as" && kw.startOffset > inKw.endOffset);
      const fieldSlice = parseSliceRequired(ctx.source, afterKeywordOffset, inKw.startOffset, ctx.lineMap, "'{error}' field");
      const formSlice = parseSliceRequired(ctx.source, inKw.endOffset, asKw ? asKw.startOffset : headerClose, ctx.lineMap, "'{error}' form");
      const asIdentifier = asKw ? parseAsIdentSlice(ctx, asKw.endOffset, headerClose, "error") : null;
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      return createDirectiveNode<FieldErrorNode>({
        type: "FieldError",
        form: "block",
        fieldName: fieldSlice.expression,
        rawFieldName: fieldSlice.raw,
        formExpr: formSlice.expression,
        rawFormExpr: formSlice.raw,
        asIdentifier,
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "errors": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["in", "as"]));
      const inKw = keywords.find((kw) => kw.keyword === "in");
      if (!inKw) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'{errors}' requires 'in <form>'.", ctx.lineMap, startOffset, headerClose + 1);
      }
      const asKw = keywords.find((kw) => kw.keyword === "as" && kw.startOffset > inKw.endOffset);
      const formSlice = parseSliceRequired(ctx.source, inKw.endOffset, asKw ? asKw.startOffset : headerClose, ctx.lineMap, "'{errors}' form");
      const asIdentifier = asKw ? parseAsIdentSlice(ctx, asKw.endOffset, headerClose, "errors") : null;
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      return createDirectiveNode<FormErrorsNode>({
        type: "FormErrors",
        form: "block",
        formExpr: formSlice.expression,
        rawFormExpr: formSlice.raw,
        asIdentifier,
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "valid": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["in"]));
      const inKw = keywords[0];
      if (!inKw) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'{valid}' requires 'in <form>'.", ctx.lineMap, startOffset, headerClose + 1);
      }
      const fieldSlice = parseSliceRequired(ctx.source, afterKeywordOffset, inKw.startOffset, ctx.lineMap, "'{valid}' field");
      const formSlice = parseSliceRequired(ctx.source, inKw.endOffset, headerClose, ctx.lineMap, "'{valid}' form");
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      return createDirectiveNode<FieldValidNode>({
        type: "FieldValid",
        form: "block",
        fieldName: fieldSlice.expression,
        rawFieldName: fieldSlice.raw,
        formExpr: formSlice.expression,
        rawFormExpr: formSlice.raw,
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "csrf": {
      if (ctx.source.slice(afterKeywordOffset, headerClose).trim().length > 0) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'{csrf}' does not accept arguments.", ctx.lineMap, startOffset, headerClose + 1);
      }
      ctx.pos = headerClose + 1;
      return createDirectiveNode<CsrfNode>({ type: "Csrf", form: "block", span: ctx.lineMap.span(startOffset, ctx.pos) });
    }

    case "method": {
      const valSlice = parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{method}'");
      ctx.pos = headerClose + 1;
      return createDirectiveNode<MethodNode>({
        type: "Method",
        form: "block",
        value: valSlice.expression,
        rawValue: valSlice.raw,
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "section":
    case "hassection":
    case "sectionmissing":
    case "partial": {
      const nameSlice = parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, `'{${entry.blockOpen}}'`);
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      const nodeType =
        entry.id === "section"
          ? "Section"
          : entry.id === "hassection"
            ? "HasSection"
            : entry.id === "sectionmissing"
              ? "SectionMissing"
              : "Partial";
      return createDirectiveNode<SectionNode | HasSectionNode | SectionMissingNode | PartialNode>({
        type: nodeType,
        form: "block",
        name: nameSlice.expression,
        rawName: nameSlice.raw,
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "yield": {
      const nameSlice = parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{yield}'");
      ctx.pos = headerClose + 1;
      const fallback = parseSingleBody(ctx, entry, startOffset);
      return createDirectiveNode<YieldNode>({
        type: "Yield",
        form: "block",
        name: nameSlice.expression,
        rawName: nameSlice.raw,
        fallback: deepFreeze(fallback),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "push":
    case "prepend": {
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["once"]));
      const onceKw = keywords[0];
      const targetSlice = parseSliceRequired(ctx.source, afterKeywordOffset, onceKw ? onceKw.startOffset : headerClose, ctx.lineMap, `'{${entry.blockOpen}}'`);
      const onceSlice = onceKw ? parseSliceRequired(ctx.source, onceKw.endOffset, headerClose, ctx.lineMap, `'{${entry.blockOpen}} once'`) : null;
      ctx.pos = headerClose + 1;
      const children = parseSingleBody(ctx, entry, startOffset);
      if (entry.id === "push") {
        const headGroup = parseHeadGroupIfEligible(ctx, targetSlice.expression, onceSlice ? onceSlice.expression : null, children, startOffset);
        if (headGroup) return headGroup;
      }
      return createDirectiveNode<StackPushNode>({
        type: "StackPush",
        form: "block",
        operation: entry.id === "prepend" ? "prepend" : "push",
        target: targetSlice.expression,
        rawTarget: targetSlice.raw,
        onceId: onceSlice ? onceSlice.expression : null,
        rawOnceId: onceSlice ? onceSlice.raw : null,
        children: deepFreeze(children),
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    case "stack": {
      const nameSlice = parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{stack}'");
      ctx.pos = headerClose + 1;
      return createDirectiveNode<StackNode>({
        type: "Stack",
        form: "block",
        name: nameSlice.expression,
        rawName: nameSlice.raw,
        span: ctx.lineMap.span(startOffset, ctx.pos)
      });
    }

    default:
      return null;
  }
}
