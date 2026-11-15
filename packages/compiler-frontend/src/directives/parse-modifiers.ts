/**
 * @dotmix/compiler-frontend/directives/parse-modifiers — Arrow template functions and attribute/event/class/style modifier parsers.
 */

import {
  DIRECTIVE_GRAMMAR,
  createDirectiveNode,
  type AttributeNode,
  type ClassMapNode,
  type ConditionalAttributeNode,
  type ConditionalEventNode,
  type ConditionalSpreadNode,
  type ESTreeNode,
  type StyleMapNode
} from "@dotmix/ast";
import { DiagnosticCodes, type SourceSpan } from "@dotmix/diagnostics";
import { parseEmbeddedExpression } from "../expression.js";
import { failSyntax, type ParserContext } from "../types.js";
import { isIdentifierPartChar, isIdentifierStartChar } from "./scanner.js";

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isCamelCaseEventPrefix(name: string): boolean {
  if (name.length < 3 || !name.startsWith("on")) return false;
  const third = name.charCodeAt(2);
  if (third < 65 || third > 90) return false;
  for (let i = 3; i < name.length; i++) {
    if (!isAsciiLetter(name.charCodeAt(i))) return false;
  }
  return true;
}

function extractEventName(baseName: string): string | null {
  if (baseName.startsWith("@")) {
    const sub = baseName.slice(1);
    return sub.length > 0 ? sub : null;
  }
  if (baseName.startsWith("on:")) {
    const sub = baseName.slice(3);
    return sub.length > 0 ? sub : null;
  }
  if (isCamelCaseEventPrefix(baseName)) {
    return baseName.slice(2).toLowerCase();
  }
  return null;
}

function isValidCaseToken(token: string): boolean {
  if (token.length === 0) return false;
  let isAllDigits = true;
  for (let i = 0; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    if (ch < 48 || ch > 57) {
      isAllDigits = false;
      break;
    }
  }
  if (isAllDigits) return true;
  for (let i = 0; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    if (!(isIdentifierPartChar(ch) || ch === 45)) return false;
  }
  return isIdentifierStartChar(token.charCodeAt(0));
}

export function tryParseSpreadAttribute(
  ctx: ParserContext,
  attributes: AttributeNode[]
): boolean {
  if (!ctx.source.startsWith("{...", ctx.pos)) {
    return false;
  }
  const spreadStart = ctx.pos;
  const parsed = parseEmbeddedExpression(ctx.source, ctx.pos + 4, "}", ctx.lineMap);
  ctx.pos = parsed.afterDelimiterOffset;
  attributes.push(
    createDirectiveNode<ConditionalSpreadNode>({
      type: "ConditionalSpread",
      spreadExpression: parsed.expression,
      rawSpreadExpression: parsed.rawExpression,
      condition: null,
      rawCondition: null,
      span: ctx.lineMap.span(spreadStart, ctx.pos)
    })
  );
  return true;
}

export function tryBuildStaticDirectiveAttribute(
  rawName: string,
  value: string,
  attrSpan: SourceSpan
): AttributeNode | null {
  const colonIdx = rawName.lastIndexOf(":");
  if (colonIdx <= 0) {
    return null;
  }
  const baseName = rawName.slice(0, colonIdx);
  const suffix = rawName.slice(colonIdx + 1);
  if (suffix === "else") {
    return createDirectiveNode<ConditionalAttributeNode>({
      type: "ConditionalAttribute",
      name: baseName,
      modifier: "else",
      caseToken: null,
      expression: null,
      rawExpression: value,
      isStatic: true,
      staticValue: value,
      span: attrSpan
    });
  }
  if (suffix.startsWith("case-")) {
    const token = suffix.slice(5);
    if (!isValidCaseToken(token)) {
      return null;
    }
    return createDirectiveNode<ConditionalAttributeNode>({
      type: "ConditionalAttribute",
      name: baseName,
      modifier: "case",
      caseToken: token,
      expression: null,
      rawExpression: value,
      isStatic: true,
      staticValue: value,
      span: attrSpan
    });
  }
  return null;
}

export function tryBuildDynamicDirectiveAttribute(
  rawName: string,
  expression: ESTreeNode,
  rawExpression: string,
  attrSpan: SourceSpan,
  ctx: ParserContext,
  attributes: AttributeNode[]
): AttributeNode | "consumed" | null {
  if (rawName === DIRECTIVE_GRAMMAR.attributeModifiers.spread) {
    for (let idx = attributes.length - 1; idx >= 0; idx--) {
      const existing = attributes[idx]!;
      if (existing.type === "ConditionalSpread" && existing.condition === null) {
        const updated = createDirectiveNode<ConditionalSpreadNode>({
          type: "ConditionalSpread",
          spreadExpression: existing.spreadExpression,
          rawSpreadExpression: existing.rawSpreadExpression,
          condition: expression,
          rawCondition: rawExpression,
          span: ctx.lineMap.span(existing.span.start.offset, attrSpan.end.offset)
        });
        attributes[idx] = updated;
        return "consumed";
      }
    }
    failSyntax(
      DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE,
      "'spread:if' must follow a '{...expr}' attribute spread on the same element.",
      ctx.lineMap,
      attrSpan.start.offset,
      attrSpan.end.offset
    );
  }

  if (rawName.startsWith(DIRECTIVE_GRAMMAR.attributeModifiers.classPrefix)) {
    const className = rawName.slice(DIRECTIVE_GRAMMAR.attributeModifiers.classPrefix.length);
    if (!className) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Class directive 'class:' requires a class name.",
        ctx.lineMap,
        attrSpan.start.offset,
        attrSpan.end.offset
      );
    }
    return createDirectiveNode<ClassMapNode>({
      type: "ClassMap",
      kind: "directive",
      className,
      expression,
      rawExpression,
      span: attrSpan
    });
  }

  if (rawName === "class") {
    if (expression.type === "ObjectExpression") {
      return createDirectiveNode<ClassMapNode>({
        type: "ClassMap",
        kind: "object",
        className: null,
        expression,
        rawExpression,
        span: attrSpan
      });
    }
    if (expression.type === "ArrayExpression") {
      return createDirectiveNode<ClassMapNode>({
        type: "ClassMap",
        kind: "array",
        className: null,
        expression,
        rawExpression,
        span: attrSpan
      });
    }
    return null;
  }

  if (rawName.startsWith(DIRECTIVE_GRAMMAR.attributeModifiers.stylePrefix)) {
    const propName = rawName.slice(DIRECTIVE_GRAMMAR.attributeModifiers.stylePrefix.length);
    if (!propName) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Style directive 'style:' requires a property name.",
        ctx.lineMap,
        attrSpan.start.offset,
        attrSpan.end.offset
      );
    }
    return createDirectiveNode<StyleMapNode>({
      type: "StyleMap",
      kind: "directive",
      property: propName,
      expression,
      rawExpression,
      span: attrSpan
    });
  }

  if (rawName === "style" && expression.type === "ObjectExpression") {
    return createDirectiveNode<StyleMapNode>({
      type: "StyleMap",
      kind: "object",
      property: null,
      expression,
      rawExpression,
      span: attrSpan
    });
  }

  const colonIdx = rawName.lastIndexOf(":");
  if (colonIdx <= 0) {
    return null;
  }
  const baseName = rawName.slice(0, colonIdx);
  const suffix = rawName.slice(colonIdx + 1);

  const eventName = extractEventName(baseName);
  if (eventName && (suffix === "if" || suffix === "unless" || suffix === "else")) {
    return createDirectiveNode<ConditionalEventNode>({
      type: "ConditionalEvent",
      eventName,
      rawName: baseName,
      modifier: suffix,
      expression,
      rawExpression,
      span: attrSpan
    });
  }

  if (suffix === "if" || suffix === "unless" || suffix === "else" || suffix === "match") {
    return createDirectiveNode<ConditionalAttributeNode>({
      type: "ConditionalAttribute",
      name: baseName,
      modifier: suffix,
      caseToken: null,
      expression,
      rawExpression,
      isStatic: false,
      staticValue: null,
      span: attrSpan
    });
  }

  if (suffix.startsWith("case-")) {
    const token = suffix.slice(5);
    if (!isValidCaseToken(token)) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        `Invalid ':case-' token '${token}' on attribute '${baseName}'.`,
        ctx.lineMap,
        attrSpan.start.offset,
        attrSpan.end.offset
      );
    }
    return createDirectiveNode<ConditionalAttributeNode>({
      type: "ConditionalAttribute",
      name: baseName,
      modifier: "case",
      caseToken: token,
      expression,
      rawExpression,
      isStatic: false,
      staticValue: null,
      span: attrSpan
    });
  }

  return null;
}
