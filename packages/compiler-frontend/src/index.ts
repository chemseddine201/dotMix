/**
 * @mix/compiler-frontend — Lexer, expression boundary parser, and template AST builder.
 *
 * Implements Phase Gate 2 canonical contracts:
 * - R-SYN-01 / R-SYN-01a: Acorn + `@sveltejs/acorn-typescript` `parseExpressionAt` with `preserveParens: true`
 * - D-105 / R-SYN-02 / R-SYN-03 / TECH-06: `<{~expr}>...</{~expr}>` and `<{~expr} />` with preserved attributes and token-sequence verification
 * - TECH-07: PascalCase `<Component />` parsed into `ComponentCallNode`
 * - Control flow: `{#if ...}...{:else if ...}...{:else}...{/if}` and `{#each list as item, idx (key)}...{/each}`
 * - Deeply frozen AST nodes with exact 1-based line/column and 0-based offset SourceSpans
 */

import {
  deepFreeze,
  createComponentNode,
  createElementNode,
  createComponentCallNode,
  createDynamicElementNode
} from "@mix/ast";
import type {
  ComponentNode,
  ScriptBlockNode,
  StyleBlockNode,
  TemplateNode,
  AttributeNode,
  IfBlockNode,
  EachBlockNode
} from "@mix/ast";
import { MixDiagnosticError, DiagnosticCodes } from "@mix/diagnostics";
import { LineMap } from "./location.js";
import {
  parseEmbeddedExpression,
  parseExpressionSlice,
  compareExpressionTokens,
  skipJsWhitespaceAndComments,
  parseScriptProgram,
  createTsTokenizer
} from "./expression.js";

export { LineMap } from "./location.js";
export {
  parseEmbeddedExpression,
  parseExpressionSlice,
  compareExpressionTokens,
  skipJsWhitespaceAndComments,
  parseScriptProgram,
  createTsTokenizer
} from "./expression.js";

const HTML_VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

export interface ParseOptions {
  filename?: string;
}

function failSyntax(
  code: (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes],
  message: string,
  lineMap: LineMap,
  startOffset: number,
  endOffset: number = startOffset + 1
): never {
  throw new MixDiagnosticError({
    code,
    message,
    severity: "error",
    span: lineMap.span(startOffset, Math.max(startOffset, endOffset))
  });
}

function isAsciiWhitespace(ch: number): boolean {
  return ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 12;
}

function isTagNameStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
}

function isTagNameChar(ch: number): boolean {
  return (
    isTagNameStart(ch) ||
    (ch >= 48 && ch <= 57) ||
    ch === 45 /* - */ ||
    ch === 95 /* _ */ ||
    ch === 58 /* : */
  );
}

function isPascalCaseComponent(tagName: string): boolean {
  const first = tagName.charCodeAt(0);
  return first >= 65 && first <= 90;
}

function blankRangePreservingNewlines(buffer: string[], start: number, end: number): void {
  for (let i = start; i < end; i++) {
    if (buffer[i] !== "\n" && buffer[i] !== "\r") {
      buffer[i] = " ";
    }
  }
}

interface ExtractedSections {
  script: ScriptBlockNode | null;
  style: StyleBlockNode | null;
  templateBuffer: string;
}

/**
 * Extracts top-level `<script>` and `<style>` blocks while blanking their characters
 * with spaces (preserving `\n` and `\r`) so template character offsets remain 100% identical
 * to the original source file.
 */
function extractTopLevelSections(
  source: string,
  lineMap: LineMap,
  filename?: string
): ExtractedSections {
  const chars = Array.from(source);
  let script: ScriptBlockNode | null = null;
  let style: StyleBlockNode | null = null;

  const isDefaultTs = filename?.endsWith(".tix") ?? false;
  let pos = 0;

  while (pos < source.length) {
    // Skip HTML comments at top level so commented-out <script> or <style> is ignored
    if (source.startsWith("<!--", pos)) {
      const commentClose = source.indexOf("-->", pos + 4);
      if (commentClose === -1) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Unterminated HTML comment '<!--'.",
          lineMap,
          pos,
          source.length
        );
      }
      pos = commentClose + 3;
      continue;
    }

    if (source.startsWith("<script", pos) && (pos + 7 < source.length && (isAsciiWhitespace(source.charCodeAt(pos + 7)) || source.charCodeAt(pos + 7) === 62 /* > */))) {
      const blockStart = pos;
      if (script !== null) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Duplicate <script> block: a component may contain at most one <script> block.",
          lineMap,
          blockStart,
          blockStart + 7
        );
      }
      const openTagEnd = source.indexOf(">", pos + 7);
      if (openTagEnd === -1) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
          "Unclosed <script> opening tag.",
          lineMap,
          blockStart,
          source.length
        );
      }
      const openTagAttrText = source.slice(pos + 7, openTagEnd);
      const langMatch = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(openTagAttrText);
      const langAttr = langMatch ? (langMatch[1] ?? langMatch[2] ?? "") : "";
      if (langAttr !== "" && langAttr !== "ts" && langAttr !== "js") {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          `Unsupported <script lang="${langAttr}"> attribute; expected "ts" or "js".`,
          lineMap,
          blockStart,
          openTagEnd + 1
        );
      }
      const lang: "js" | "ts" = langAttr === "ts" || (langAttr === "" && isDefaultTs) ? "ts" : "js";
      const contentStart = openTagEnd + 1;
      const closeTagStart = source.indexOf("</script>", contentStart);
      if (closeTagStart === -1) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
          "Unclosed <script> block: missing '</script>'.",
          lineMap,
          blockStart,
          source.length
        );
      }
      const blockEnd = closeTagStart + 9;
      const content = source.slice(contentStart, closeTagStart);

      // Verify script syntax via Acorn-TypeScript
      parseScriptProgram(content, contentStart, lineMap);

      script = deepFreeze({
        type: "ScriptBlock",
        lang,
        content,
        contentSpan: lineMap.span(contentStart, closeTagStart),
        span: lineMap.span(blockStart, blockEnd)
      });

      blankRangePreservingNewlines(chars, blockStart, blockEnd);
      pos = blockEnd;
      continue;
    }

    if (source.startsWith("<style", pos) && (pos + 6 < source.length && (isAsciiWhitespace(source.charCodeAt(pos + 6)) || source.charCodeAt(pos + 6) === 62 /* > */))) {
      const blockStart = pos;
      if (style !== null) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Duplicate <style> block: a component may contain at most one <style> block.",
          lineMap,
          blockStart,
          blockStart + 6
        );
      }
      const openTagEnd = source.indexOf(">", pos + 6);
      if (openTagEnd === -1) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
          "Unclosed <style> opening tag.",
          lineMap,
          blockStart,
          source.length
        );
      }
      const openTagAttrText = source.slice(pos + 6, openTagEnd);
      // Component styles are scoped by default per spec/CSS_SCOPING.md §1 unless explicitly scoped="false"
      const scopedFalse = /\bscoped\s*=\s*(?:"false"|'false')/.test(openTagAttrText);
      const contentStart = openTagEnd + 1;
      const closeTagStart = source.indexOf("</style>", contentStart);
      if (closeTagStart === -1) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
          "Unclosed <style> block: missing '</style>'.",
          lineMap,
          blockStart,
          source.length
        );
      }
      const blockEnd = closeTagStart + 8;
      const content = source.slice(contentStart, closeTagStart);

      style = deepFreeze({
        type: "StyleBlock",
        scoped: !scopedFalse,
        content,
        contentSpan: lineMap.span(contentStart, closeTagStart),
        span: lineMap.span(blockStart, blockEnd)
      });

      blankRangePreservingNewlines(chars, blockStart, blockEnd);
      pos = blockEnd;
      continue;
    }

    pos++;
  }

  return {
    script,
    style,
    templateBuffer: chars.join("")
  };
}

class TemplateParser {
  private readonly source: string;
  private readonly lineMap: LineMap;
  private pos: number = 0;

  constructor(templateBuffer: string, lineMap: LineMap) {
    this.source = templateBuffer;
    this.lineMap = lineMap;
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && isAsciiWhitespace(this.source.charCodeAt(this.pos))) {
      this.pos++;
    }
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

  private parseChildren(shouldStop: () => boolean): TemplateNode[] {
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

      if (this.source.startsWith("<{~", this.pos)) {
        children.push(this.parseDynamicElement());
        continue;
      }

      if (this.source.startsWith("<{", this.pos)) {
        // Check for illegal whitespace inside `<{ ~` or missing `~` (D-105 / R-SYN-02)
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Invalid dynamic element syntax: dynamic elements must start with '<{~' with no intervening whitespace (D-105).",
          this.lineMap,
          this.pos,
          Math.min(this.source.length, this.pos + 5)
        );
      }

      if (this.source.charCodeAt(this.pos) === 60 /* < */) {
        const nextChar = this.source.charCodeAt(this.pos + 1);
        if (isTagNameStart(nextChar)) {
          children.push(this.parseElementOrComponent());
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

      if (this.source.startsWith("{#if", this.pos) && isAsciiWhitespace(this.source.charCodeAt(this.pos + 4))) {
        children.push(this.parseIfBlock());
        continue;
      }

      if (this.source.startsWith("{#each", this.pos) && isAsciiWhitespace(this.source.charCodeAt(this.pos + 6))) {
        children.push(this.parseEachBlock());
        continue;
      }

      if (
        this.source.startsWith("{:else", this.pos) ||
        this.source.startsWith("{/if}", this.pos) ||
        this.source.startsWith("{/each}", this.pos)
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
    if (this.source.startsWith("{#", start) || this.source.startsWith("{/", start) || this.source.startsWith("{:", start)) {
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

  private parseAttributes(): AttributeNode[] {
    const attributes: AttributeNode[] = [];

    while (this.pos < this.source.length) {
      this.skipWhitespace();
      if (
        this.pos >= this.source.length ||
        this.source.charCodeAt(this.pos) === 62 /* > */ ||
        this.source.startsWith("/>", this.pos)
      ) {
        break;
      }

      const attrStart = this.pos;
      // Read attribute name (@click, on:click, ref, mix-html, class, data-*, etc.)
      let nameEnd = attrStart;
      while (nameEnd < this.source.length) {
        const c = this.source.charCodeAt(nameEnd);
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
          `Unexpected character '${this.source[this.pos]}' while parsing element attributes.`,
          this.lineMap,
          this.pos,
          this.pos + 1
        );
      }

      const rawName = this.source.slice(attrStart, nameEnd);
      this.pos = nameEnd;
      this.skipWhitespace();

      // Check for `=`
      if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 61 /* = */) {
        // Boolean shorthand attribute (e.g. `disabled`)
        if (rawName.startsWith("@") || rawName.startsWith("on:") || rawName === "ref" || rawName === "mix-html") {
          failSyntax(
            DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
            `Directive or binding '${rawName}' requires an expression value.`,
            this.lineMap,
            attrStart,
            nameEnd
          );
        }
        attributes.push(
          deepFreeze({
            type: "StaticAttribute",
            name: rawName,
            value: "",
            span: this.lineMap.span(attrStart, nameEnd)
          })
        );
        continue;
      }

      // Advance past `=`
      this.pos++;
      this.skipWhitespace();

      if (this.pos >= this.source.length) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          `Expected attribute value after '${rawName}='.`,
          this.lineMap,
          attrStart,
          this.pos
        );
      }

      const valChar = this.source.charCodeAt(this.pos);
      if (valChar === 34 /* " */ || valChar === 39 /* ' */) {
        if (rawName.startsWith("@") || rawName.startsWith("on:") || rawName === "ref" || rawName === "mix-html") {
          failSyntax(
            DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
            `Binding '${rawName}' requires a '{...}' expression rather than a string literal.`,
            this.lineMap,
            attrStart,
            this.pos + 1
          );
        }
        const quote = this.source[this.pos]!;
        const strStart = this.pos + 1;
        const closeQuote = this.source.indexOf(quote, strStart);
        if (closeQuote === -1) {
          failSyntax(
            DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
            `Unterminated string attribute value for '${rawName}'.`,
            this.lineMap,
            attrStart,
            this.source.length
          );
        }
        const value = this.source.slice(strStart, closeQuote);
        this.pos = closeQuote + 1;
        attributes.push(
          deepFreeze({
            type: "StaticAttribute",
            name: rawName,
            value,
            span: this.lineMap.span(attrStart, this.pos)
          })
        );
        continue;
      }

      if (valChar === 123 /* { */) {
        const parsed = parseEmbeddedExpression(this.source, this.pos + 1, "}", this.lineMap);
        this.pos = parsed.afterDelimiterOffset;
        const attrSpan = this.lineMap.span(attrStart, this.pos);

        if (rawName.startsWith("@") || rawName.startsWith("on:")) {
          const eventName = rawName.startsWith("@") ? rawName.slice(1) : rawName.slice(3);
          if (!eventName) {
            failSyntax(
              DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
              "Event binding name cannot be empty.",
              this.lineMap,
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
        this.lineMap,
        this.pos,
        this.pos + 1
      );
    }

    return attributes;
  }

  private parseElementOrComponent(): TemplateNode {
    const start = this.pos; // at '<'
    this.pos++; // skip '<'
    const nameStart = this.pos;
    while (this.pos < this.source.length && isTagNameChar(this.source.charCodeAt(this.pos))) {
      this.pos++;
    }
    const tagName = this.source.slice(nameStart, this.pos);
    const isComponent = isPascalCaseComponent(tagName);

    const attributes = this.parseAttributes();
    this.skipWhitespace();

    if (this.source.startsWith("/>", this.pos)) {
      this.pos += 2;
      const span = this.lineMap.span(start, this.pos);
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

    if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 62 /* > */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        `Expected '>' or '/>' to close opening tag '<${tagName}'.`,
        this.lineMap,
        start,
        this.pos
      );
    }

    this.pos++; // skip '>'

    // Void HTML elements (e.g. <input>, <br>, <img>) do not take children or closing tags
    if (!isComponent && HTML_VOID_ELEMENTS.has(tagName.toLowerCase())) {
      const span = this.lineMap.span(start, this.pos);
      return createElementNode({
        span,
        tag: tagName,
        attributes,
        children: [],
        selfClosing: true
      });
    }

    const expectedClosePrefix = `</${tagName}`;
    const children = this.parseChildren(() => {
      if (!this.source.startsWith(expectedClosePrefix, this.pos)) {
        return false;
      }
      const nextCh = this.source.charCodeAt(this.pos + expectedClosePrefix.length);
      return isAsciiWhitespace(nextCh) || nextCh === 62 /* > */;
    });

    if (!this.source.startsWith(expectedClosePrefix, this.pos)) {
      // Check if another closing tag is present (mismatched closing tag)
      if (this.source.startsWith("</", this.pos)) {
        const closeEnd = this.source.indexOf(">", this.pos + 2);
        const foundClose = this.source.slice(
          this.pos,
          closeEnd !== -1 ? closeEnd + 1 : Math.min(this.source.length, this.pos + 15)
        );
        failSyntax(
          DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
          `Mismatched closing tag: expected '</${tagName}>' to close '<${tagName}>', but found '${foundClose}'.`,
          this.lineMap,
          this.pos,
          closeEnd !== -1 ? closeEnd + 1 : this.source.length
        );
      }
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        `Unclosed tag '<${tagName}>': missing closing tag '</${tagName}>'.`,
        this.lineMap,
        start,
        this.pos
      );
    }

    this.pos += expectedClosePrefix.length;
    this.skipWhitespace();
    if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 62 /* > */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        `Expected '>' in closing tag '</${tagName}>'.`,
        this.lineMap,
        this.pos,
        this.pos + 1
      );
    }
    this.pos++; // skip '>'

    const span = this.lineMap.span(start, this.pos);
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

  private parseDynamicElement(): TemplateNode {
    const start = this.pos; // at '<{~'
    this.pos += 3; // advance past '<{~'

    // Parse the tag expression up to '}' (D-105, R-SYN-01)
    const openExpr = parseEmbeddedExpression(this.source, this.pos, "}", this.lineMap);
    this.pos = openExpr.afterDelimiterOffset;

    // TECH-06: Preserve all attributes on `<{~expr} ...>`
    const attributes = this.parseAttributes();
    this.skipWhitespace();

    if (this.source.startsWith("/>", this.pos)) {
      this.pos += 2;
      return createDynamicElementNode({
        span: this.lineMap.span(start, this.pos),
        tagExpression: openExpr.expression,
        rawTagExpression: openExpr.rawExpression,
        attributes,
        children: [],
        selfClosing: true
      });
    }

    if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 62 /* > */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Expected '>' or '/>' to complete dynamic element opening tag '<{~...}'.",
        this.lineMap,
        start,
        this.pos
      );
    }
    this.pos++; // skip '>'

    const children = this.parseChildren(() => this.source.startsWith("</{~", this.pos));

    if (!this.source.startsWith("</{~", this.pos)) {
      if (this.source.startsWith("</{", this.pos)) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Invalid dynamic closing tag: no whitespace is allowed inside '</{~' (R-SYN-02).",
          this.lineMap,
          this.pos,
          Math.min(this.source.length, this.pos + 6)
        );
      }
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        `Unclosed dynamic element '<{~${openExpr.rawExpression}}>': missing matching '</{~${openExpr.rawExpression}}>'.`,
        this.lineMap,
        start,
        this.pos
      );
    }

    const closeTagStart = this.pos;
    this.pos += 4; // skip '</{~'
    const closeExpr = parseEmbeddedExpression(this.source, this.pos, "}", this.lineMap);
    this.pos = closeExpr.afterDelimiterOffset;
    this.skipWhitespace();

    if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 62 /* > */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Expected '>' after '}' in dynamic closing tag '</{~...}>'.",
        this.lineMap,
        closeTagStart,
        this.pos
      );
    }
    this.pos++; // skip '>'

    // R-SYN-02: Compare opening and closing tag expressions by token sequence (type + value)
    if (!compareExpressionTokens(openExpr.rawExpression, closeExpr.rawExpression)) {
      throw new MixDiagnosticError({
        code: DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        message: `Dynamic closing tag '</{~${closeExpr.rawExpression}}>' does not match opening tag '<{~${openExpr.rawExpression}}>' token sequence (R-SYN-02).`,
        severity: "error",
        span: this.lineMap.span(closeTagStart, this.pos),
        notes: [
          `Opening tag at ${this.lineMap.locationAt(start).line}:${this.lineMap.locationAt(start).column}`
        ]
      });
    }

    return createDynamicElementNode({
      span: this.lineMap.span(start, this.pos),
      tagExpression: openExpr.expression,
      rawTagExpression: openExpr.rawExpression,
      attributes,
      children,
      selfClosing: false
    });
  }

  private parseIfBlock(): IfBlockNode {
    const start = this.pos; // at '{#if'
    this.pos += 4; // skip '{#if'
    const condResult = parseEmbeddedExpression(this.source, this.pos, "}", this.lineMap);
    this.pos = condResult.afterDelimiterOffset;

    const consequent = this.parseChildren(
      () =>
        this.source.startsWith("{:else", this.pos) ||
        this.source.startsWith("{/if}", this.pos)
    );

    let alternate: readonly TemplateNode[] | IfBlockNode | null = null;

    if (this.source.startsWith("{:else", this.pos)) {
      const branchStart = this.pos;
      this.pos += 6; // skip '{:else'
      this.skipWhitespace();

      if (this.source.startsWith("if", this.pos) && isAsciiWhitespace(this.source.charCodeAt(this.pos + 2))) {
        this.pos += 2; // skip 'if'
        alternate = this.parseElseIfChain(branchStart);
        return deepFreeze({
          type: "IfBlock",
          condition: condResult.expression,
          rawCondition: condResult.rawExpression,
          consequent,
          alternate,
          span: this.lineMap.span(start, this.pos)
        });
      }

      if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 125 /* } */) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Expected '}' or 'if <condition>}' in '{:else}' branch.",
          this.lineMap,
          branchStart,
          this.pos
        );
      }
      this.pos++; // skip '}'

      alternate = this.parseChildren(() => this.source.startsWith("{/if}", this.pos));
    }

    if (!this.source.startsWith("{/if}", this.pos)) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Unclosed '{#if}' block: missing '{/if}'.",
        this.lineMap,
        start,
        this.pos
      );
    }
    this.pos += 5; // skip '{/if}'

    return deepFreeze({
      type: "IfBlock",
      condition: condResult.expression,
      rawCondition: condResult.rawExpression,
      consequent,
      alternate,
      span: this.lineMap.span(start, this.pos)
    });
  }

  private parseElseIfChain(branchStart: number): IfBlockNode {
    const condResult = parseEmbeddedExpression(this.source, this.pos, "}", this.lineMap);
    this.pos = condResult.afterDelimiterOffset;

    const consequent = this.parseChildren(
      () =>
        this.source.startsWith("{:else", this.pos) ||
        this.source.startsWith("{/if}", this.pos)
    );

    let alternate: readonly TemplateNode[] | IfBlockNode | null = null;

    if (this.source.startsWith("{:else", this.pos)) {
      const nextBranchStart = this.pos;
      this.pos += 6;
      this.skipWhitespace();

      if (this.source.startsWith("if", this.pos) && isAsciiWhitespace(this.source.charCodeAt(this.pos + 2))) {
        this.pos += 2;
        alternate = this.parseElseIfChain(nextBranchStart);
        return deepFreeze({
          type: "IfBlock",
          condition: condResult.expression,
          rawCondition: condResult.rawExpression,
          consequent,
          alternate,
          span: this.lineMap.span(branchStart, this.pos)
        });
      }

      if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 125 /* } */) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Expected '}' in '{:else}' branch.",
          this.lineMap,
          nextBranchStart,
          this.pos
        );
      }
      this.pos++;
      alternate = this.parseChildren(() => this.source.startsWith("{/if}", this.pos));
    }

    if (!this.source.startsWith("{/if}", this.pos)) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Unclosed '{:else if}' block: missing '{/if}'.",
        this.lineMap,
        branchStart,
        this.pos
      );
    }
    this.pos += 5;

    return deepFreeze({
      type: "IfBlock",
      condition: condResult.expression,
      rawCondition: condResult.rawExpression,
      consequent,
      alternate,
      span: this.lineMap.span(branchStart, this.pos)
    });
  }

  private parseEachBlock(): EachBlockNode {
    const start = this.pos; // at '{#each'
    const headerStart = start + 6;

    // Scan tokens with TsParser.tokenizer to find the closing `}` of `{#each ... }`
    // and the last top-level `as` keyword at braceDepth === 1 && parenDepth === 0
    const sliceFromHeader = this.source.slice(headerStart);
    const tokenizer = createTsTokenizer(sliceFromHeader);

    let braceDepth = 1;
    let parenDepth = 0;
    let bracketDepth = 0;
    let headerEndRel = -1;
    let lastTopLevelAsRel: { start: number; end: number } | null = null;

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
            headerEndRel = tok.start;
            break;
          }
        } else if (tok.type.label === "(") {
          parenDepth++;
        } else if (tok.type.label === ")") {
          parenDepth = Math.max(0, parenDepth - 1);
        } else if (tok.type.label === "[") {
          bracketDepth++;
        } else if (tok.type.label === "]") {
          bracketDepth = Math.max(0, bracketDepth - 1);
        } else if (
          braceDepth === 1 &&
          parenDepth === 0 &&
          bracketDepth === 0 &&
          tok.value === "as"
        ) {
          lastTopLevelAsRel = { start: tok.start, end: tok.end };
        }
      }
    } catch {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Malformed '{#each}' header expression.",
        this.lineMap,
        start,
        Math.min(this.source.length, start + 30)
      );
    }

    if (headerEndRel === -1 || !lastTopLevelAsRel) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Invalid '{#each}' syntax: expected '{#each collection as item, index (key)}'.",
        this.lineMap,
        start,
        Math.min(this.source.length, start + 30)
      );
    }

    const collectionStart = skipJsWhitespaceAndComments(
      this.source,
      headerStart,
      this.lineMap,
      headerStart + lastTopLevelAsRel.start
    );
    const collectionEndRaw = headerStart + lastTopLevelAsRel.start;
    const rawCollection = this.source.slice(collectionStart, collectionEndRaw).trimEnd();
    if (!rawCollection) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Missing collection expression in '{#each}' block.",
        this.lineMap,
        start,
        collectionEndRaw
      );
    }

    const collectionExpr = parseExpressionSlice(rawCollection, collectionStart, this.lineMap);

    // Parse `itemIdentifier [, indexIdentifier] (keyExpression)` after `as`
    const bindingSliceStart = headerStart + lastTopLevelAsRel.end;
    const headerCloseOffset = headerStart + headerEndRel;
    const bindingSlice = this.source.slice(bindingSliceStart, headerCloseOffset);
    const bindingMatch = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s*\(/.exec(
      bindingSlice
    );

    if (!bindingMatch) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Keyed '{#each}' block requires an item identifier and explicit '(key)' expression (D-110): '{#each items as item (item.id)}'.",
        this.lineMap,
        bindingSliceStart,
        headerCloseOffset + 1
      );
    }

    const itemIdentifier = bindingMatch[1]!;
    const indexIdentifier = bindingMatch[2] ?? null;
    const keyOpenParenOffset = bindingSliceStart + bindingMatch[0].length - 1;

    const keyParsed = parseEmbeddedExpression(
      this.source,
      keyOpenParenOffset + 1,
      ")",
      this.lineMap,
      headerCloseOffset
    );

    const afterKeyParen = skipJsWhitespaceAndComments(
      this.source,
      keyParsed.afterDelimiterOffset,
      this.lineMap,
      headerCloseOffset + 1
    );
    if (afterKeyParen !== headerCloseOffset) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Unexpected tokens after '(key)' in '{#each}' block.",
        this.lineMap,
        afterKeyParen,
        headerCloseOffset + 1
      );
    }

    this.pos = headerCloseOffset + 1; // advance past `}`

    const children = this.parseChildren(() => this.source.startsWith("{/each}", this.pos));
    if (!this.source.startsWith("{/each}", this.pos)) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Unclosed '{#each}' block: missing '{/each}'.",
        this.lineMap,
        start,
        this.pos
      );
    }
    this.pos += 7; // skip `{/each}`

    return deepFreeze({
      type: "EachBlock",
      collection: collectionExpr,
      rawCollection,
      itemIdentifier,
      indexIdentifier,
      keyExpression: keyParsed.expression,
      rawKeyExpression: keyParsed.rawExpression,
      children,
      span: this.lineMap.span(start, this.pos)
    });
  }
}

export function parse(source: string, options?: ParseOptions): ComponentNode {
  const filename = options?.filename;
  const lineMap = new LineMap(source, filename);
  const { script, style, templateBuffer } = extractTopLevelSections(source, lineMap, filename);
  const parser = new TemplateParser(templateBuffer, lineMap);
  const template = parser.parseRootTemplate();

  return createComponentNode({
    span: lineMap.span(0, source.length),
    script,
    style,
    template
  });
}
