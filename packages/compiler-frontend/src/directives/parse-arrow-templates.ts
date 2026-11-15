/**
 * @dotmix/compiler-frontend/directives/parse-arrow-templates — Arrow render-function parsers for children and attribute props.
 */

import {
  createDirectiveNode,
  deepFreeze,
  type AttributeNode,
  type ParameterTypeAnnotation,
  type TemplateNode,
  type TemplateRenderFunctionNode
} from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import { skipJsWhitespaceAndComments } from "../expression.js";
import { failSyntax, isTagNameStart, type ParserContext } from "../types.js";
import { isIdentifierPartChar, isIdentifierStartChar, isValidIdentifierName } from "./scanner.js";

const OPENING_BRACKETS = new Set([40 /* ( */, 91 /* [ */, 123 /* { */, 60 /* < */]);
const CLOSING_BRACKETS = new Set([41 /* ) */, 93 /* ] */, 125 /* } */, 62 /* > */]);
const QUOTE_CHARACTERS = new Set([34 /* " */, 39 /* ' */, 96 /* ` */]);

/**
 * Scans a parameter type annotation starting after its colon. Returns the offset of the
 * top-level comma or closing parenthesis that ends it, or -1 when the annotation is unterminated.
 */
function scanParameterTypeEnd(source: string, start: number): number {
  let depth = 0;
  let cursor = start;
  while (cursor < source.length) {
    const charCode = source.charCodeAt(cursor);
    if (QUOTE_CHARACTERS.has(charCode)) {
      cursor++;
      while (cursor < source.length && source.charCodeAt(cursor) !== charCode) {
        if (source.charCodeAt(cursor) === 92 /* backslash */) cursor++;
        cursor++;
      }
      cursor++;
      continue;
    }
    if (charCode === 61 /* = */ && source.charCodeAt(cursor + 1) === 62 /* > */) {
      cursor += 2;
      continue;
    }
    if (depth === 0 && (charCode === 44 /* , */ || charCode === 41 /* ) */)) {
      return cursor;
    }
    if (OPENING_BRACKETS.has(charCode)) depth++;
    else if (CLOSING_BRACKETS.has(charCode)) depth--;
    if (depth < 0) return -1;
    cursor++;
  }
  return -1;
}

interface ArrowHeader {
  readonly params: string[];
  readonly paramTypes: (ParameterTypeAnnotation | null)[];
  readonly bodyStart: number;
  readonly isParenthesized: boolean;
}

function scanArrowHeader(
  source: string,
  braceOffset: number,
  ctx: ParserContext
): ArrowHeader | null {
  let cursor = skipJsWhitespaceAndComments(source, braceOffset + 1, ctx.lineMap);
  if (cursor >= source.length) {
    return null;
  }

  const params: string[] = [];
  const paramTypes: (ParameterTypeAnnotation | null)[] = [];
  if (source.charCodeAt(cursor) === 40 /* ( */) {
    cursor++;
    while (cursor < source.length) {
      cursor = skipJsWhitespaceAndComments(source, cursor, ctx.lineMap);
      if (cursor >= source.length) return null;
      if (source.charCodeAt(cursor) === 41 /* ) */) {
        cursor++;
        break;
      }
      if (!isIdentifierStartChar(source.charCodeAt(cursor))) return null;
      const identStart = cursor;
      cursor++;
      while (cursor < source.length && isIdentifierPartChar(source.charCodeAt(cursor))) {
        cursor++;
      }
      params.push(source.slice(identStart, cursor));
      cursor = skipJsWhitespaceAndComments(source, cursor, ctx.lineMap);
      if (source.charCodeAt(cursor) === 58 /* : */) {
        const typeStart = skipJsWhitespaceAndComments(source, cursor + 1, ctx.lineMap);
        const typeEnd = scanParameterTypeEnd(source, typeStart);
        if (typeEnd < 0) return null;
        const typeText = source.slice(typeStart, typeEnd).trimEnd();
        if (typeText.length === 0) return null;
        paramTypes.push({ raw: typeText, start: typeStart });
        cursor = typeEnd;
      } else {
        paramTypes.push(null);
      }
      if (source.charCodeAt(cursor) === 44 /* , */) {
        cursor++;
        continue;
      }
      if (source.charCodeAt(cursor) === 41 /* ) */) {
        cursor++;
        break;
      }
      return null;
    }
  } else if (isIdentifierStartChar(source.charCodeAt(cursor))) {
    const identStart = cursor;
    cursor++;
    while (cursor < source.length && isIdentifierPartChar(source.charCodeAt(cursor))) {
      cursor++;
    }
    const singleParam = source.slice(identStart, cursor);
    if (!isValidIdentifierName(singleParam)) return null;
    params.push(singleParam);
    paramTypes.push(null);
  } else {
    return null;
  }

  cursor = skipJsWhitespaceAndComments(source, cursor, ctx.lineMap);
  if (!source.startsWith("=>", cursor)) return null;
  cursor = skipJsWhitespaceAndComments(source, cursor + 2, ctx.lineMap);

  let isParenthesized = false;
  if (source.charCodeAt(cursor) === 40 /* ( */) {
    const insideParen = skipJsWhitespaceAndComments(source, cursor + 1, ctx.lineMap);
    if (insideParen < source.length && source.charCodeAt(insideParen) === 60 /* < */) {
      isParenthesized = true;
      cursor = insideParen;
    }
  }

  if (cursor >= source.length || source.charCodeAt(cursor) !== 60 /* < */) {
    return null;
  }
  const afterLt = source.charCodeAt(cursor + 1);
  if (
    !isTagNameStart(afterLt) &&
    !source.startsWith("<>", cursor) &&
    !source.startsWith("<$", cursor)
  ) {
    return null;
  }

  return { params, paramTypes, bodyStart: cursor, isParenthesized };
}

function parseTemplateMarkupAtCursor(ctx: ParserContext): TemplateNode[] {
  if (ctx.source.startsWith("<>", ctx.pos)) {
    const fragStart = ctx.pos;
    ctx.pos += 2;
    const nodes = ctx.parseChildren(() => ctx.source.startsWith("</>", ctx.pos));
    if (!ctx.source.startsWith("</>", ctx.pos)) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Unclosed fragment '<>' inside render function: missing '</>'.",
        ctx.lineMap,
        fragStart,
        ctx.pos
      );
    }
    ctx.pos += 3;
    return nodes;
  }
  if (ctx.source.startsWith("<$", ctx.pos)) {
    return [ctx.parseDollarDynamicElement()];
  }
  return [ctx.parseElementOrComponent()];
}

function finishArrowBody(
  ctx: ParserContext,
  isParenthesized: boolean,
  startOffset: number,
  label: string
): void {
  ctx.pos = skipJsWhitespaceAndComments(ctx.source, ctx.pos, ctx.lineMap);
  if (isParenthesized) {
    if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 41 /* ) */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        `Expected ')' after parenthesized ${label}.`,
        ctx.lineMap,
        startOffset,
        Math.min(ctx.source.length, ctx.pos + 1)
      );
    }
    ctx.pos++;
    ctx.pos = skipJsWhitespaceAndComments(ctx.source, ctx.pos, ctx.lineMap);
  }
  if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 125 /* } */) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      `Expected closing '}' after ${label}.`,
      ctx.lineMap,
      startOffset,
      Math.min(ctx.source.length, ctx.pos + 1)
    );
  }
  ctx.pos++;
}

export function tryParseArrowTemplateRender(ctx: ParserContext): TemplateRenderFunctionNode | null {
  const braceStart = ctx.pos;
  if (ctx.source.charCodeAt(braceStart) !== 123 /* { */) {
    return null;
  }
  const header = scanArrowHeader(ctx.source, braceStart, ctx);
  if (!header) {
    return null;
  }

  ctx.pos = header.bodyStart;
  const body = parseTemplateMarkupAtCursor(ctx);
  finishArrowBody(ctx, header.isParenthesized, braceStart, "template render function");

  return createDirectiveNode<TemplateRenderFunctionNode>({
    type: "TemplateRenderFunction",
    params: deepFreeze(header.params),
    paramTypes: deepFreeze(header.paramTypes),
    body: deepFreeze(body),
    span: ctx.lineMap.span(braceStart, ctx.pos)
  });
}

export function tryParseArrowAttributeTemplate(
  ctx: ParserContext,
  attrName: string,
  attrStart: number
): AttributeNode | null {
  const braceStart = ctx.pos;
  if (ctx.source.charCodeAt(braceStart) !== 123 /* { */) {
    return null;
  }
  const header = scanArrowHeader(ctx.source, braceStart, ctx);
  if (!header) {
    return null;
  }

  const innerStart = header.bodyStart;
  ctx.pos = header.bodyStart;
  const templateNodes = parseTemplateMarkupAtCursor(ctx);
  const innerEnd = ctx.pos;
  finishArrowBody(ctx, header.isParenthesized, attrStart, `attribute render function for '${attrName}'`);

  const attrSpan = ctx.lineMap.span(attrStart, ctx.pos);
  const exprSpan = ctx.lineMap.span(innerStart, innerEnd);
  return deepFreeze({
    type: "DynamicAttribute",
    name: attrName,
    expression: deepFreeze({
      type: "TemplateAttributeExpression",
      start: innerStart,
      end: innerEnd,
      range: [innerStart, innerEnd] as const,
      loc: exprSpan
    }),
    rawExpression: ctx.source.slice(innerStart, innerEnd),
    templateValue: deepFreeze(templateNodes),
    templateParams: deepFreeze(header.params),
    span: attrSpan
  });
}
