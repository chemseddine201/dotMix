/**
 * @mix/compiler-frontend/element-parser — Element, component, <$tag>, and <{~expr}> parser.
 */

import {
  HTML_VOID_ELEMENTS,
  createElementNode,
  createComponentCallNode,
  createDynamicElementNode,
  createSlotOutletNode
} from "@mix/ast";
import type { TemplateNode, ESTreeNode } from "@mix/ast";
import { MixDiagnosticError, DiagnosticCodes } from "@mix/diagnostics";
import {
  parseEmbeddedExpression,
  parseExpressionSlice,
  compareExpressionTokens
} from "./expression.js";
import { parseAttributes } from "./attribute-parser.js";
import {
  failSyntax,
  isAsciiWhitespace,
  isTagNameChar,
  isPascalCaseComponent
} from "./types.js";
import type { ParserContext } from "./types.js";

export function parseElementOrComponent(ctx: ParserContext): TemplateNode {
  const start = ctx.pos; // at '<'
  ctx.pos++; // skip '<'
  const nameStart = ctx.pos;
  while (ctx.pos < ctx.source.length && isTagNameChar(ctx.source.charCodeAt(ctx.pos))) {
    ctx.pos++;
  }
  const tagName = ctx.source.slice(nameStart, ctx.pos);
  const isComponent = isPascalCaseComponent(tagName);
  const isSlot = tagName === "slot";

  const attributes = parseAttributes(ctx);
  ctx.skipWhitespace();

  if (ctx.source.startsWith("/>", ctx.pos)) {
    ctx.pos += 2;
    const span = ctx.lineMap.span(start, ctx.pos);
    if (isSlot) {
      const nameAttr = attributes.find((a) => a.type === "StaticAttribute" && a.name === "name");
      const slotName = nameAttr && nameAttr.type === "StaticAttribute" ? nameAttr.value : null;
      return createSlotOutletNode({
        span,
        name: slotName,
        fallback: [],
        selfClosing: true
      });
    }
    return isComponent
      ? createComponentCallNode({
          span,
          name: tagName,
          attributes,
          children: [],
          selfClosing: true
        })
      : createElementNode({
          span,
          tag: tagName,
          attributes,
          children: [],
          selfClosing: true
        });
  }

  if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 62 /* > */) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      `Expected '>' or '/>' to close opening tag '<${tagName}'.`,
      ctx.lineMap,
      start,
      ctx.pos
    );
  }

  ctx.pos++; // skip '>'

  // Void HTML elements (e.g. <input>, <br>, <img>) do not take children or closing tags
  if (!isComponent && HTML_VOID_ELEMENTS.has(tagName.toLowerCase())) {
    const span = ctx.lineMap.span(start, ctx.pos);
    return createElementNode({
      span,
      tag: tagName,
      attributes,
      children: [],
      selfClosing: true
    });
  }

  const expectedClosePrefix = `</${tagName}`;
  const children = ctx.parseChildren(() => {
    if (!ctx.source.startsWith(expectedClosePrefix, ctx.pos)) {
      return false;
    }
    const nextCh = ctx.source.charCodeAt(ctx.pos + expectedClosePrefix.length);
    return isAsciiWhitespace(nextCh) || nextCh === 62 /* > */;
  });

  if (!ctx.source.startsWith(expectedClosePrefix, ctx.pos)) {
    // Check if another closing tag is present (mismatched closing tag)
    if (ctx.source.startsWith("</", ctx.pos)) {
      const closeEnd = ctx.source.indexOf(">", ctx.pos + 2);
      const foundClose = ctx.source.slice(
        ctx.pos,
        closeEnd !== -1 ? closeEnd + 1 : Math.min(ctx.source.length, ctx.pos + 15)
      );
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        `Mismatched closing tag: expected '</${tagName}>' to close '<${tagName}>', but found '${foundClose}'.`,
        ctx.lineMap,
        ctx.pos,
        closeEnd !== -1 ? closeEnd + 1 : ctx.source.length
      );
    }
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      `Unclosed tag '<${tagName}>': missing closing tag '</${tagName}>'.`,
      ctx.lineMap,
      start,
      ctx.pos
    );
  }

  ctx.pos += expectedClosePrefix.length;
  ctx.skipWhitespace();
  if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 62 /* > */) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      `Expected '>' in closing tag '</${tagName}>'.`,
      ctx.lineMap,
      ctx.pos,
      ctx.pos + 1
    );
  }
  ctx.pos++; // skip '>'

  const span = ctx.lineMap.span(start, ctx.pos);
  if (isSlot) {
    const nameAttr = attributes.find((a) => a.type === "StaticAttribute" && a.name === "name");
    const slotName = nameAttr && nameAttr.type === "StaticAttribute" ? nameAttr.value : null;
    return createSlotOutletNode({
      span,
      name: slotName,
      fallback: children,
      selfClosing: false
    });
  }
  return isComponent
    ? createComponentCallNode({
        span,
        name: tagName,
        attributes,
        children,
        selfClosing: false
      })
    : createElementNode({
        span,
        tag: tagName,
        attributes,
        children,
        selfClosing: false
      });
}

/**
 * HAA-06 & D-105: Parses clean `<$tagName ...>...</$tagName>` and `<$tagName ... />`
 * (or `<${expr} ...>...</${expr}>`) dynamic elements with preserved attributes (TECH-06)
 * and closing tag token-sequence verification (R-SYN-02).
 */
export function parseDollarDynamicElement(ctx: ParserContext): TemplateNode {
  const start = ctx.pos; // at '<$'
  ctx.pos += 2; // advance past '<$'

  let openExpression: ESTreeNode;
  let openRawExpression: string;

  if (ctx.source.charCodeAt(ctx.pos) === 123 /* { */) {
    ctx.pos++; // skip '{'
    const parsed = parseEmbeddedExpression(ctx.source, ctx.pos, "}", ctx.lineMap);
    ctx.pos = parsed.afterDelimiterOffset;
    openExpression = parsed.expression;
    openRawExpression = parsed.rawExpression;
  } else {
    const exprStart = ctx.pos;
    let parenDepth = 0;
    let bracketDepth = 0;
    while (ctx.pos < ctx.source.length) {
      const ch = ctx.source.charCodeAt(ctx.pos);
      if (ch === 40 /* ( */) parenDepth++;
      else if (ch === 41 /* ) */) parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === 91 /* [ */) bracketDepth++;
      else if (ch === 93 /* ] */) bracketDepth = Math.max(0, bracketDepth - 1);
      else if (
        parenDepth === 0 &&
        bracketDepth === 0 &&
        (isAsciiWhitespace(ch) || ch === 62 /* > */ || ctx.source.startsWith("/>", ctx.pos))
      ) {
        break;
      }
      ctx.pos++;
    }
    openRawExpression = ctx.source.slice(exprStart, ctx.pos).trim();
    if (!openRawExpression) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Expected tag expression after '<$' in dynamic element.",
        ctx.lineMap,
        start,
        ctx.pos
      );
    }
    openExpression = parseExpressionSlice(openRawExpression, exprStart, ctx.lineMap);
  }

  const attributes = parseAttributes(ctx);
  ctx.skipWhitespace();

  if (ctx.source.startsWith("/>", ctx.pos)) {
    ctx.pos += 2;
    return createDynamicElementNode({
      span: ctx.lineMap.span(start, ctx.pos),
      tagExpression: openExpression,
      rawTagExpression: openRawExpression,
      attributes,
      children: [],
      selfClosing: true
    });
  }

  if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 62 /* > */) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      "Expected '>' or '/>' to complete dynamic element opening tag '<$...'.",
      ctx.lineMap,
      start,
      ctx.pos
    );
  }
  ctx.pos++; // skip '>'

  const children = ctx.parseChildren(() => ctx.source.startsWith("</$", ctx.pos));

  if (!ctx.source.startsWith("</$", ctx.pos)) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      `Unclosed dynamic element '<$${openRawExpression}>': missing matching '</$${openRawExpression}>'.`,
      ctx.lineMap,
      start,
      ctx.pos
    );
  }

  const closeTagStart = ctx.pos;
  ctx.pos += 3; // skip '</$'

  let closeRawExpression: string;
  if (ctx.source.charCodeAt(ctx.pos) === 123 /* { */) {
    ctx.pos++;
    const closeParsed = parseEmbeddedExpression(ctx.source, ctx.pos, "}", ctx.lineMap);
    ctx.pos = closeParsed.afterDelimiterOffset;
    closeRawExpression = closeParsed.rawExpression;
  } else {
    const closeExprStart = ctx.pos;
    while (ctx.pos < ctx.source.length && ctx.source.charCodeAt(ctx.pos) !== 62 /* > */) {
      ctx.pos++;
    }
    closeRawExpression = ctx.source.slice(closeExprStart, ctx.pos).trim();
  }

  ctx.skipWhitespace();
  if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 62 /* > */) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      "Expected '>' in dynamic closing tag '</$...>'.",
      ctx.lineMap,
      closeTagStart,
      ctx.pos
    );
  }
  ctx.pos++; // skip '>'

  if (!compareExpressionTokens(openRawExpression, closeRawExpression)) {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      message: `Dynamic closing tag '</$${closeRawExpression}>' does not match opening tag '<$${openRawExpression}>' token sequence (R-SYN-02).`,
      severity: "error",
      span: ctx.lineMap.span(closeTagStart, ctx.pos),
      notes: [
        `Opening tag at ${ctx.lineMap.locationAt(start).line}:${ctx.lineMap.locationAt(start).column}`
      ]
    });
  }

  return createDynamicElementNode({
    span: ctx.lineMap.span(start, ctx.pos),
    tagExpression: openExpression,
    rawTagExpression: openRawExpression,
    attributes,
    children,
    selfClosing: false
  });
}

export function parseDynamicElement(ctx: ParserContext): TemplateNode {
  const start = ctx.pos; // at '<{~'
  ctx.pos += 3; // advance past '<{~'

  // Parse the tag expression up to '}' (D-105, R-SYN-01)
  const openExpr = parseEmbeddedExpression(ctx.source, ctx.pos, "}", ctx.lineMap);
  ctx.pos = openExpr.afterDelimiterOffset;

  // TECH-06: Preserve all attributes on `<{~expr} ...>`
  const attributes = parseAttributes(ctx);
  ctx.skipWhitespace();

  if (ctx.source.startsWith("/>", ctx.pos)) {
    ctx.pos += 2;
    return createDynamicElementNode({
      span: ctx.lineMap.span(start, ctx.pos),
      tagExpression: openExpr.expression,
      rawTagExpression: openExpr.rawExpression,
      attributes,
      children: [],
      selfClosing: true
    });
  }

  if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 62 /* > */) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      "Expected '>' or '/>' to complete dynamic element opening tag '<{~...}'.",
      ctx.lineMap,
      start,
      ctx.pos
    );
  }
  ctx.pos++; // skip '>'

  const children = ctx.parseChildren(() => ctx.source.startsWith("</{~", ctx.pos));

  if (!ctx.source.startsWith("</{~", ctx.pos)) {
    if (ctx.source.startsWith("</{", ctx.pos)) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Invalid dynamic closing tag: no whitespace is allowed inside '</{~' (R-SYN-02).",
        ctx.lineMap,
        ctx.pos,
        Math.min(ctx.source.length, ctx.pos + 6)
      );
    }
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      `Unclosed dynamic element '<{~${openExpr.rawExpression}}>': missing matching '</{~${openExpr.rawExpression}}>'.`,
      ctx.lineMap,
      start,
      ctx.pos
    );
  }

  const closeTagStart = ctx.pos;
  ctx.pos += 4; // skip '</{~'
  const closeExpr = parseEmbeddedExpression(ctx.source, ctx.pos, "}", ctx.lineMap);
  ctx.pos = closeExpr.afterDelimiterOffset;
  ctx.skipWhitespace();

  if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 62 /* > */) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      "Expected '>' after '}' in dynamic closing tag '</{~...}>'.",
      ctx.lineMap,
      closeTagStart,
      ctx.pos
    );
  }
  ctx.pos++; // skip '>'

  // R-SYN-02: Compare opening and closing tag expressions by token sequence (type + value)
  if (!compareExpressionTokens(openExpr.rawExpression, closeExpr.rawExpression)) {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
      message: `Dynamic closing tag '</{~${closeExpr.rawExpression}}>' does not match opening tag '<{~${openExpr.rawExpression}}>' token sequence (R-SYN-02).`,
      severity: "error",
      span: ctx.lineMap.span(closeTagStart, ctx.pos),
      notes: [
        `Opening tag at ${ctx.lineMap.locationAt(start).line}:${ctx.lineMap.locationAt(start).column}`
      ]
    });
  }

  return createDynamicElementNode({
    span: ctx.lineMap.span(start, ctx.pos),
    tagExpression: openExpr.expression,
    rawTagExpression: openExpr.rawExpression,
    attributes,
    children,
    selfClosing: false
  });
}
