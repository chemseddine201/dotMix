/**
 * @mix/compiler-frontend/parser — TemplateParser coordinator and top-level parse() entry point.
 */

import { deepFreeze, createComponentNode } from "@mix/ast";
import type { ComponentNode, TemplateNode } from "@mix/ast";
import { DiagnosticCodes } from "@mix/diagnostics";
import { LineMap } from "./location.js";
import { parseEmbeddedExpression } from "./expression.js";
import { extractTopLevelSections } from "./section-extractor.js";
import {
  isIfOpenAt,
  isEachOpenAt,
  isElseOrElseIfAt,
  isEndIfAt,
  isEndEachAt,
  isAwaitOpenAt,
  isThenAt,
  isCatchAt,
  isEndAwaitAt
} from "./control-flow-scanner.js";
import {
  parseElementOrComponent,
  parseDollarDynamicElement,
  parseDynamicElement
} from "./element-parser.js";
import {
  parseIfBlock,
  parseEachBlock,
  parseAwaitBlock
} from "./block-parser.js";
import {
  failSyntax,
  isAsciiWhitespace,
  isTagNameStart
} from "./types.js";
import type { ParseOptions, ParserContext } from "./types.js";

export class TemplateParser implements ParserContext {
  readonly source: string;
  readonly lineMap: LineMap;
  pos: number = 0;

  constructor(templateBuffer: string, lineMap: LineMap) {
    this.source = templateBuffer;
    this.lineMap = lineMap;
  }

  skipWhitespace(): void {
    while (this.pos < this.source.length && isAsciiWhitespace(this.source.charCodeAt(this.pos))) {
      this.pos++;
    }
  }

  parseElementOrComponent(): TemplateNode {
    return parseElementOrComponent(this);
  }

  parseDollarDynamicElement(): TemplateNode {
    return parseDollarDynamicElement(this);
  }

  parseRootTemplate(): readonly TemplateNode[] {
    const nodes = this.parseChildren(() => this.pos >= this.source.length);
    if (this.pos < this.source.length) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        `Unexpected template token at '${this.source.slice(this.pos, this.pos + 20)}'.`,
        this.lineMap,
        this.pos,
        Math.min(this.source.length, this.pos + 10)
      );
    }
    return this.trimOuterWhitespaceNodes(nodes);
  }

  private trimOuterWhitespaceNodes(nodes: readonly TemplateNode[]): readonly TemplateNode[] {
    const result = [...nodes];
    while (result.length > 0) {
      const first = result[0]!;
      if (first.type === "Text" && first.value.trim() === "") {
        result.shift();
      } else {
        break;
      }
    }
    while (result.length > 0) {
      const last = result[result.length - 1]!;
      if (last.type === "Text" && last.value.trim() === "") {
        result.pop();
      } else {
        break;
      }
    }
    return deepFreeze(result);
  }

  parseChildren(shouldStop: () => boolean): TemplateNode[] {
    const children: TemplateNode[] = [];

    while (this.pos < this.source.length && !shouldStop()) {
      if (this.source.startsWith("<!--", this.pos)) {
        children.push(this.parseComment());
        continue;
      }

      if (this.source.startsWith("</", this.pos)) {
        // Unexpected closing tag if caller's shouldStop didn't claim it
        break;
      }

      if (this.source.startsWith("<$", this.pos)) {
        children.push(parseDollarDynamicElement(this));
        continue;
      }

      if (this.source.startsWith("<{~", this.pos)) {
        children.push(parseDynamicElement(this));
        continue;
      }

      if (this.source.startsWith("<{", this.pos)) {
        // Check for illegal whitespace inside `<{ ~` or missing `$` / `~` (D-105 / R-SYN-02)
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Invalid dynamic element syntax: use '<$tagName>' (or '<{~expr}>') with no intervening whitespace (D-105).",
          this.lineMap,
          this.pos,
          Math.min(this.source.length, this.pos + 5)
        );
      }

      if (this.source.charCodeAt(this.pos) === 60 /* < */) {
        const nextChar = this.source.charCodeAt(this.pos + 1);
        if (isTagNameStart(nextChar)) {
          children.push(parseElementOrComponent(this));
          continue;
        }
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          `Unexpected '<' in template markup.`,
          this.lineMap,
          this.pos,
          this.pos + 1
        );
      }

      if (isIfOpenAt(this.source, this.pos) > 0) {
        children.push(parseIfBlock(this));
        continue;
      }

      if (isEachOpenAt(this.source, this.pos) > 0) {
        children.push(parseEachBlock(this));
        continue;
      }

      if (isAwaitOpenAt(this.source, this.pos) > 0) {
        children.push(parseAwaitBlock(this));
        continue;
      }

      if (
        isElseOrElseIfAt(this.source, this.pos) ||
        isEndIfAt(this.source, this.pos) > 0 ||
        isEndEachAt(this.source, this.pos) > 0 ||
        isThenAt(this.source, this.pos) !== null ||
        isCatchAt(this.source, this.pos) !== null ||
        isEndAwaitAt(this.source, this.pos) > 0
      ) {
        // Let enclosing control-flow parser handle branch/closing tags
        break;
      }

      if (this.source.charCodeAt(this.pos) === 123 /* { */) {
        children.push(this.parseInterpolation());
        continue;
      }

      children.push(this.parseTextNode(shouldStop));
    }

    return children;
  }

  private parseComment(): TemplateNode {
    const start = this.pos;
    const closeIdx = this.source.indexOf("-->", start + 4);
    if (closeIdx === -1) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Unterminated HTML comment '<!--'.",
        this.lineMap,
        start,
        this.source.length
      );
    }
    const end = closeIdx + 3;
    const value = this.source.slice(start + 4, closeIdx);
    this.pos = end;
    return deepFreeze({
      type: "Comment",
      value,
      span: this.lineMap.span(start, end)
    });
  }

  private parseTextNode(shouldStop: () => boolean): TemplateNode {
    const start = this.pos;
    while (this.pos < this.source.length && !shouldStop()) {
      const ch = this.source.charCodeAt(this.pos);
      if (ch === 60 /* < */ || ch === 123 /* { */) {
        break;
      }
      this.pos++;
    }
    const end = this.pos;
    return deepFreeze({
      type: "Text",
      value: this.source.slice(start, end),
      span: this.lineMap.span(start, end)
    });
  }

  private parseInterpolation(): TemplateNode {
    const start = this.pos; // at '{'
    if (
      this.source.startsWith("{#", start) ||
      this.source.startsWith("{/", start) ||
      this.source.startsWith("{:", start)
    ) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        `Unexpected control flow tag '${this.source.slice(start, start + 10)}'.`,
        this.lineMap,
        start,
        Math.min(this.source.length, start + 8)
      );
    }
    const parsed = parseEmbeddedExpression(this.source, start + 1, "}", this.lineMap);
    this.pos = parsed.afterDelimiterOffset;
    return deepFreeze({
      type: "Interpolation",
      expression: parsed.expression,
      rawExpression: parsed.rawExpression,
      span: this.lineMap.span(start, this.pos)
    });
  }
}

export function parse(source: string, options?: ParseOptions): ComponentNode {
  const filename = options?.filename;
  const lineMap = new LineMap(source, filename);
  const { script, style, templateBuffer } = extractTopLevelSections(source, lineMap, filename, options);
  const parser = new TemplateParser(templateBuffer, lineMap);
  const template = parser.parseRootTemplate();

  return createComponentNode({
    span: lineMap.span(0, source.length),
    script,
    style,
    template
  });
}
