/**
 * @mix/compiler-frontend/attribute-parser — Element and component attribute parser.
 */

import { deepFreeze } from "@mix/ast";
import type { AttributeNode, TemplateNode } from "@mix/ast";
import { DiagnosticCodes } from "@mix/diagnostics";
import {
  parseEmbeddedExpression,
  skipJsWhitespaceAndComments
} from "./expression.js";
import {
  failSyntax,
  isAsciiWhitespace,
  isTagNameStart
} from "./types.js";
import type { ParserContext } from "./types.js";

export function parseAttributes(ctx: ParserContext): AttributeNode[] {
  const attributes: AttributeNode[] = [];

  while (ctx.pos < ctx.source.length) {
    ctx.skipWhitespace();
    if (
      ctx.pos >= ctx.source.length ||
      ctx.source.charCodeAt(ctx.pos) === 62 /* > */ ||
      ctx.source.startsWith("/>", ctx.pos)
    ) {
      break;
    }

    const attrStart = ctx.pos;
    // Read attribute name (@click, on:click, ref, mix-html, class, data-*, etc.)
    let nameEnd = attrStart;
    while (nameEnd < ctx.source.length) {
      const c = ctx.source.charCodeAt(nameEnd);
      if (
        isAsciiWhitespace(c) ||
        c === 61 /* = */ ||
        c === 62 /* > */ ||
        c === 47 /* / */ ||
        c === 123 /* { */
      ) {
        break;
      }
      nameEnd++;
    }

    if (nameEnd === attrStart) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        `Unexpected character '${ctx.source[ctx.pos]}' while parsing element attributes.`,
        ctx.lineMap,
        ctx.pos,
        ctx.pos + 1
      );
    }

    const rawName = ctx.source.slice(attrStart, nameEnd);
    ctx.pos = nameEnd;
    ctx.skipWhitespace();

    // Check for `=`
    if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 61 /* = */) {
      // Boolean shorthand attribute (e.g. `disabled`)
      if (rawName.startsWith("@") || rawName.startsWith("on:") || rawName === "ref" || rawName === "mix-html") {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          `Directive or binding '${rawName}' requires an expression value.`,
          ctx.lineMap,
          attrStart,
          nameEnd
        );
      }
      attributes.push(
        deepFreeze({
          type: "StaticAttribute",
          name: rawName,
          value: "",
          span: ctx.lineMap.span(attrStart, nameEnd)
        })
      );
      continue;
    }

    // Advance past `=`
    ctx.pos++;
    ctx.skipWhitespace();

    if (ctx.pos >= ctx.source.length) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        `Expected attribute value after '${rawName}='.`,
        ctx.lineMap,
        attrStart,
        ctx.pos
      );
    }

    const valChar = ctx.source.charCodeAt(ctx.pos);
    if (valChar === 34 /* " */ || valChar === 39 /* ' */) {
      if (rawName.startsWith("@") || rawName.startsWith("on:") || rawName === "ref" || rawName === "mix-html") {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          `Binding '${rawName}' requires a '{...}' expression rather than a string literal.`,
          ctx.lineMap,
          attrStart,
          ctx.pos + 1
        );
      }
      const quote = ctx.source[ctx.pos]!;
      const strStart = ctx.pos + 1;
      const closeQuote = ctx.source.indexOf(quote, strStart);
      if (closeQuote === -1) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          `Unterminated string attribute value for '${rawName}'.`,
          ctx.lineMap,
          attrStart,
          ctx.source.length
        );
      }
      const value = ctx.source.slice(strStart, closeQuote);
      ctx.pos = closeQuote + 1;
      attributes.push(
        deepFreeze({
          type: "StaticAttribute",
          name: rawName,
          value,
          span: ctx.lineMap.span(attrStart, ctx.pos)
        })
      );
      continue;
    }

    if (valChar === 123 /* { */) {
      const isSpecialBinding =
        rawName.startsWith("@") ||
        rawName.startsWith("on:") ||
        /^on[A-Z][A-Za-z]+$/.test(rawName) ||
        rawName === "ref" ||
        rawName === "mix-html" ||
        rawName.startsWith("bind:");

      if (!isSpecialBinding) {
        const innerStart = skipJsWhitespaceAndComments(ctx.source, ctx.pos + 1, ctx.lineMap);
        if (
          innerStart < ctx.source.length &&
          ctx.source.charCodeAt(innerStart) === 60 /* < */ &&
          (isTagNameStart(ctx.source.charCodeAt(innerStart + 1)) ||
            ctx.source.startsWith("<$", innerStart) ||
            ctx.source.startsWith("<>", innerStart))
        ) {
          ctx.pos = innerStart;
          let templateNodes: TemplateNode[];
          if (ctx.source.startsWith("<>", ctx.pos)) {
            const fragStart = ctx.pos;
            ctx.pos += 2;
            templateNodes = ctx.parseChildren(() => ctx.source.startsWith("</>", ctx.pos));
            if (!ctx.source.startsWith("</>", ctx.pos)) {
              failSyntax(
                DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
                "Unclosed fragment '<>' inside attribute expression: missing '</>'.",
                ctx.lineMap,
                fragStart,
                ctx.pos
              );
            }
            ctx.pos += 3;
          } else if (ctx.source.startsWith("<$", ctx.pos)) {
            templateNodes = [ctx.parseDollarDynamicElement()];
          } else {
            templateNodes = [ctx.parseElementOrComponent()];
          }

          const innerEnd = ctx.pos;
          ctx.pos = skipJsWhitespaceAndComments(ctx.source, ctx.pos, ctx.lineMap);
          if (ctx.pos >= ctx.source.length || ctx.source.charCodeAt(ctx.pos) !== 125 /* } */) {
            failSyntax(
              DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
              `Expected closing '}' after attribute element expression for '${rawName}'.`,
              ctx.lineMap,
              ctx.pos,
              Math.min(ctx.source.length, ctx.pos + 1)
            );
          }
          ctx.pos++; // skip '}'
          const attrSpan = ctx.lineMap.span(attrStart, ctx.pos);
          const rawExpression = ctx.source.slice(innerStart, innerEnd);
          const exprSpan = ctx.lineMap.span(innerStart, innerEnd);
          attributes.push(
            deepFreeze({
              type: "DynamicAttribute",
              name: rawName,
              expression: deepFreeze({
                type: "TemplateAttributeExpression",
                start: innerStart,
                end: innerEnd,
                range: [innerStart, innerEnd] as const,
                loc: exprSpan
              }),
              rawExpression,
              templateValue: deepFreeze(templateNodes),
              span: attrSpan
            })
          );
          continue;
        }
      }

      const parsed = parseEmbeddedExpression(ctx.source, ctx.pos + 1, "}", ctx.lineMap);
      ctx.pos = parsed.afterDelimiterOffset;
      const attrSpan = ctx.lineMap.span(attrStart, ctx.pos);

      if (rawName.startsWith("@") || rawName.startsWith("on:") || /^on[A-Z][A-Za-z]+$/.test(rawName)) {
        const eventName = rawName.startsWith("@")
          ? rawName.slice(1)
          : rawName.startsWith("on:")
            ? rawName.slice(3)
            : rawName.slice(2).toLowerCase();
        if (!eventName) {
          failSyntax(
            DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
            "Event binding name cannot be empty.",
            ctx.lineMap,
            attrStart,
            nameEnd
          );
        }
        attributes.push(
          deepFreeze({
            type: "EventBinding",
            name: eventName,
            handler: parsed.expression,
            rawHandler: parsed.rawExpression,
            span: attrSpan
          })
        );
      } else if (rawName === "ref") {
        attributes.push(
          deepFreeze({
            type: "RefBinding",
            target: parsed.expression,
            rawTarget: parsed.rawExpression,
            span: attrSpan
          })
        );
      } else if (rawName === "mix-html") {
        attributes.push(
          deepFreeze({
            type: "DirectiveAttribute",
            name: "mix-html",
            expression: parsed.expression,
            rawExpression: parsed.rawExpression,
            span: attrSpan
          })
        );
      } else if (rawName.startsWith("bind:")) {
        const bindName = rawName.slice(5);
        attributes.push(
          deepFreeze({
            type: "BindBinding",
            name: bindName,
            target: parsed.expression,
            rawTarget: parsed.rawExpression,
            span: attrSpan
          })
        );
      } else {
        attributes.push(
          deepFreeze({
            type: "DynamicAttribute",
            name: rawName,
            expression: parsed.expression,
            rawExpression: parsed.rawExpression,
            span: attrSpan
          })
        );
      }
      continue;
    }

    failSyntax(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      `Attribute '${rawName}' value must be a quoted string or '{...}' expression.`,
      ctx.lineMap,
      ctx.pos,
      ctx.pos + 1
    );
  }

  return attributes;
}
