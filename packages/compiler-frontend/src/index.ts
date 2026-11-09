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
  createDynamicElementNode,
  createSlotOutletNode,
  createAwaitBlockNode
} from "@mix/ast";
import type {
  ComponentNode,
  ScriptBlockNode,
  StyleBlockNode,
  TemplateNode,
  AttributeNode,
  IfBlockNode,
  EachBlockNode,
  AwaitBlockNode,
  ESTreeNode
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
 * Extracts a React-style functional `.mix` or `.tix` component (`export default function App(props) { ... return ( <...> ); }`)
 * into a `ScriptBlockNode` and a blanked `templateBuffer` preserving exact 1-based line/column and 0-based byte offsets.
 */
function tryExtractFunctionalComponent(
  source: string,
  chars: string[],
  lineMap: LineMap,
  isDefaultTs: boolean
): ScriptBlockNode | null {
  const currentText = chars.join("");
  const fnRe = /(?:export\s+default\s+function|export\s+function|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  const fnMatch = fnRe.exec(currentText);
  if (!fnMatch) {
    return null;
  }

  const fnStart = fnMatch.index;
  const openParenIdx = fnStart + fnMatch[0].length - 1;

  // Balance parentheses to extract parameter list
  let parenDepth = 1;
  let pos = openParenIdx + 1;
  while (pos < currentText.length && parenDepth > 0) {
    const ch = currentText[pos]!;
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    pos++;
  }
  if (parenDepth !== 0) {
    return null;
  }
  const closeParenIdx = pos - 1;
  const rawParams = currentText.slice(openParenIdx + 1, closeParenIdx).trim();

  // Find opening `{` of component function body (skipping optional `: ReturnType`)
  while (pos < currentText.length && currentText[pos] !== "{") {
    pos++;
  }
  if (pos >= currentText.length) {
    return null;
  }
  const bodyOpenBraceIdx = pos;

  // Scan function body at top braceDepth === 1 to locate the top-level `return` statement
  // and the closing `}` of the component function
  let braceDepth = 1;
  let returnKeywordIdx = -1;
  let fnCloseBraceIdx = -1;
  pos = bodyOpenBraceIdx + 1;

  while (pos < currentText.length && braceDepth > 0) {
    const ch = currentText[pos]!;
    // Skip strings and comments while scanning before `return`
    if (returnKeywordIdx === -1) {
      if (ch === "'" || ch === '"' || ch === "`") {
        const quote = ch;
        pos++;
        while (pos < currentText.length) {
          if (currentText[pos] === "\\") {
            pos += 2;
            continue;
          }
          if (currentText[pos] === quote) {
            pos++;
            break;
          }
          pos++;
        }
        continue;
      }
      if (currentText.startsWith("//", pos)) {
        const nl = currentText.indexOf("\n", pos + 2);
        pos = nl === -1 ? currentText.length : nl + 1;
        continue;
      }
      if (currentText.startsWith("/*", pos)) {
        const closeCmt = currentText.indexOf("*/", pos + 2);
        pos = closeCmt === -1 ? currentText.length : closeCmt + 2;
        continue;
      }
    }

    if (ch === "{") {
      braceDepth++;
      pos++;
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        fnCloseBraceIdx = pos;
        break;
      }
      pos++;
      continue;
    }

    if (
      braceDepth === 1 &&
      returnKeywordIdx === -1 &&
      currentText.startsWith("return", pos) &&
      (pos === bodyOpenBraceIdx + 1 || !/[A-Za-z0-9_$]/.test(currentText[pos - 1]!)) &&
      (pos + 6 >= currentText.length || !/[A-Za-z0-9_$]/.test(currentText[pos + 6]!))
    ) {
      returnKeywordIdx = pos;
    }
    pos++;
  }

  if (returnKeywordIdx === -1 || fnCloseBraceIdx === -1) {
    return null;
  }

  // Locate the returned markup range `[templateStart, templateEnd)` inside `return (...)` or `return <...>`
  let afterReturn = returnKeywordIdx + 6;
  while (afterReturn < fnCloseBraceIdx && isAsciiWhitespace(currentText.charCodeAt(afterReturn))) {
    afterReturn++;
  }

  let templateStart = afterReturn;
  let templateEnd = fnCloseBraceIdx;
  while (templateEnd > templateStart && isAsciiWhitespace(currentText.charCodeAt(templateEnd - 1))) {
    templateEnd--;
  }
  if (templateEnd > templateStart && currentText[templateEnd - 1] === ";") {
    templateEnd--;
    while (templateEnd > templateStart && isAsciiWhitespace(currentText.charCodeAt(templateEnd - 1))) {
      templateEnd--;
    }
  }

  if (currentText[templateStart] === "(" && currentText[templateEnd - 1] === ")") {
    templateStart++;
    templateEnd--;
  }

  // Build synthesized script content from preamble + optional props parameter + function body before `return`
  const preamble = currentText.slice(0, fnStart).trim();
  const bodyBeforeReturn = currentText.slice(bodyOpenBraceIdx + 1, returnKeywordIdx).trim();

  let propStmt = "";
  if (rawParams.length > 0) {
    const identMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(rawParams);
    if (identMatch) {
      const paramName = identMatch[1]!;
      let pIdx = identMatch[0].length;
      while (pIdx < rawParams.length && isAsciiWhitespace(rawParams.charCodeAt(pIdx))) {
        pIdx++;
      }
      let typeAnn: string | undefined;
      let defaultExpr: string | undefined;

      if (rawParams[pIdx] === ":") {
        pIdx++;
        const typeStart = pIdx;
        let angle = 0;
        let paren = 0;
        let brace = 0;
        let bracket = 0;
        while (pIdx < rawParams.length) {
          const c = rawParams[pIdx]!;
          if (c === "<") angle++;
          else if (c === ">" && rawParams[pIdx - 1] !== "=") angle = Math.max(0, angle - 1);
          else if (c === "(") paren++;
          else if (c === ")") paren = Math.max(0, paren - 1);
          else if (c === "{") brace++;
          else if (c === "}") brace = Math.max(0, brace - 1);
          else if (c === "[") bracket++;
          else if (c === "]") bracket = Math.max(0, bracket - 1);
          else if (
            c === "=" &&
            rawParams[pIdx + 1] !== ">" &&
            rawParams[pIdx + 1] !== "=" &&
            angle === 0 &&
            paren === 0 &&
            brace === 0 &&
            bracket === 0
          ) {
            break;
          }
          pIdx++;
        }
        typeAnn = rawParams.slice(typeStart, pIdx).trim();
      }

      if (rawParams[pIdx] === "=") {
        defaultExpr = rawParams.slice(pIdx + 1).trim();
      }

      if (typeAnn && defaultExpr) {
        propStmt = `const ${paramName} = defineProps<${typeAnn}>(${defaultExpr});`;
      } else if (typeAnn) {
        propStmt = `const ${paramName} = defineProps<${typeAnn}>();`;
      } else if (defaultExpr) {
        propStmt = `const ${paramName} = defineProps(${defaultExpr});`;
      } else {
        propStmt = `const ${paramName} = defineProps();`;
      }
    }
  }

  const scriptParts = [preamble, propStmt, bodyBeforeReturn].filter((s) => s.length > 0);
  const scriptContent = scriptParts.join("\n");
  const lang: "js" | "ts" = isDefaultTs ? "ts" : "js";

  if (scriptContent.trim().length > 0) {
    parseScriptProgram(scriptContent, 0, lineMap);
  }

  // Blank everything outside `[templateStart, templateEnd)` in `chars` so template offsets match original source
  blankRangePreservingNewlines(chars, 0, templateStart);
  blankRangePreservingNewlines(chars, templateEnd, source.length);

  return deepFreeze({
    type: "ScriptBlock",
    lang,
    content: scriptContent,
    contentSpan: lineMap.span(0, returnKeywordIdx),
    span: lineMap.span(0, fnCloseBraceIdx + 1)
  });
}

/**
 * Extracts top-level `<script>` and `<style>` blocks (or Functional React-style component definitions)
 * while blanking their characters with spaces (preserving `\n` and `\r`) so template character offsets
 * remain 100% identical to the original source file.
 */
function extractTopLevelSections(
  source: string,
  lineMap: LineMap,
  filename?: string
): ExtractedSections {
  const chars = source.split("");
  let script: ScriptBlockNode | null = null;
  let style: StyleBlockNode | null = null;

  const isDefaultTs = filename?.endsWith(".tix") ?? false;
  const trimmedStart = source.trimStart();
  const isFunctionalSource =
    !trimmedStart.startsWith("<script") &&
    /(?:^|\n)\s*(?:export\s+default\s+function|export\s+function|function)\s+[A-Za-z_$]/.test(
      source
    );

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

    if (
      !isFunctionalSource &&
      source.startsWith("<script", pos) &&
      pos + 7 < source.length &&
      (isAsciiWhitespace(source.charCodeAt(pos + 7)) || source.charCodeAt(pos + 7) === 62 /* > */)
    ) {
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

  if (script === null && isFunctionalSource) {
    script = tryExtractFunctionalComponent(source, chars, lineMap, isDefaultTs);
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

  private isIfOpenAt(pos: number): number {
    if (this.source.startsWith("{if", pos)) {
      const next = this.source.charCodeAt(pos + 3);
      if (isAsciiWhitespace(next) || next === 40 /* ( */) return 3;
    }
    if (this.source.startsWith("{#if", pos)) {
      const next = this.source.charCodeAt(pos + 4);
      if (isAsciiWhitespace(next) || next === 40 /* ( */) return 4;
    }
    return 0;
  }

  private isEachOpenAt(pos: number): number {
    if (this.source.startsWith("{each", pos)) {
      const next = this.source.charCodeAt(pos + 5);
      if (isAsciiWhitespace(next) || next === 40 /* ( */) return 5;
    }
    if (this.source.startsWith("{#each", pos)) {
      const next = this.source.charCodeAt(pos + 6);
      if (isAsciiWhitespace(next) || next === 40 /* ( */) return 6;
    }
    return 0;
  }

  private matchElseOrElseIf(pos: number): { kind: "else" | "elseif"; afterKeywordOffset: number } | null {
    if (this.source.charCodeAt(pos) !== 123 /* { */) return null;
    const slice = this.source.slice(pos, pos + 24);
    const elseIfMatch = /^\{\s*(?:[:#]?elseif|[:#]?else\s+if)(?=\s|\()/.exec(slice);
    if (elseIfMatch) {
      return { kind: "elseif", afterKeywordOffset: pos + elseIfMatch[0].length };
    }
    const elseMatch = /^\{\s*(?:[:#]?else)\b/.exec(slice);
    if (elseMatch) {
      return { kind: "else", afterKeywordOffset: pos + elseMatch[0].length };
    }
    return null;
  }

  private isElseOrElseIfAt(pos: number): boolean {
    return this.matchElseOrElseIf(pos) !== null;
  }

  private isEndIfAt(pos: number): number {
    if (this.source.charCodeAt(pos) !== 123 /* { */) return 0;
    const m = /^\{\s*(?:endif|#endif|\/if)\s*\}/.exec(this.source.slice(pos, pos + 20));
    return m ? m[0].length : 0;
  }

  private isEndEachAt(pos: number): number {
    if (this.source.charCodeAt(pos) !== 123 /* { */) return 0;
    const m = /^\{\s*(?:endeach|#endeach|\/each)\s*\}/.exec(this.source.slice(pos, pos + 20));
    return m ? m[0].length : 0;
  }

  private isAwaitOpenAt(pos: number): number {
    if (this.source.startsWith("{await", pos)) {
      const next = this.source.charCodeAt(pos + 6);
      if (isAsciiWhitespace(next) || next === 40 /* ( */) return 6;
    }
    if (this.source.startsWith("{#await", pos)) {
      const next = this.source.charCodeAt(pos + 7);
      if (isAsciiWhitespace(next) || next === 40 /* ( */) return 7;
    }
    return 0;
  }

  private isThenAt(pos: number): { len: number; ident: string | null } | null {
    if (this.source.charCodeAt(pos) !== 123 /* { */) return null;
    const slice = this.source.slice(pos, pos + 40);
    const m = /^\{\s*(?:[:#]?then)\b(?:\s+([A-Za-z_$][A-Za-z0-9_$]*))?\s*\}/.exec(slice);
    if (m) {
      return { len: m[0].length, ident: m[1] ?? null };
    }
    return null;
  }

  private isCatchAt(pos: number): { len: number; ident: string | null } | null {
    if (this.source.charCodeAt(pos) !== 123 /* { */) return null;
    const slice = this.source.slice(pos, pos + 40);
    const m = /^\{\s*(?:[:#]?catch)\b(?:\s+([A-Za-z_$][A-Za-z0-9_$]*))?\s*\}/.exec(slice);
    if (m) {
      return { len: m[0].length, ident: m[1] ?? null };
    }
    return null;
  }

  private isEndAwaitAt(pos: number): number {
    if (this.source.charCodeAt(pos) !== 123 /* { */) return 0;
    const m = /^\{\s*(?:endawait|#endawait|\/await)\s*\}/.exec(this.source.slice(pos, pos + 20));
    return m ? m[0].length : 0;
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

      if (this.source.startsWith("<$", this.pos)) {
        children.push(this.parseDollarDynamicElement());
        continue;
      }

      if (this.source.startsWith("<{~", this.pos)) {
        children.push(this.parseDynamicElement());
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

      if (this.isIfOpenAt(this.pos) > 0) {
        children.push(this.parseIfBlock());
        continue;
      }

      if (this.isEachOpenAt(this.pos) > 0) {
        children.push(this.parseEachBlock());
        continue;
      }

      if (this.isAwaitOpenAt(this.pos) > 0) {
        children.push(this.parseAwaitBlock());
        continue;
      }

      if (
        this.isElseOrElseIfAt(this.pos) ||
        this.isEndIfAt(this.pos) > 0 ||
        this.isEndEachAt(this.pos) > 0 ||
        this.isThenAt(this.pos) !== null ||
        this.isCatchAt(this.pos) !== null ||
        this.isEndAwaitAt(this.pos) > 0
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
    const isSlot = tagName === "slot";

    const attributes = this.parseAttributes();
    this.skipWhitespace();

    if (this.source.startsWith("/>", this.pos)) {
      this.pos += 2;
      const span = this.lineMap.span(start, this.pos);
      if (isSlot) {
        const nameAttr = attributes.find(a => a.type === "StaticAttribute" && a.name === "name");
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
    if (isSlot) {
      const nameAttr = attributes.find(a => a.type === "StaticAttribute" && a.name === "name");
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
  private parseDollarDynamicElement(): TemplateNode {
    const start = this.pos; // at '<$'
    this.pos += 2; // advance past '<$'

    let openExpression: import("@mix/ast").ESTreeNode;
    let openRawExpression: string;

    if (this.source.charCodeAt(this.pos) === 123 /* { */) {
      this.pos++; // skip '{'
      const parsed = parseEmbeddedExpression(this.source, this.pos, "}", this.lineMap);
      this.pos = parsed.afterDelimiterOffset;
      openExpression = parsed.expression;
      openRawExpression = parsed.rawExpression;
    } else {
      const exprStart = this.pos;
      let parenDepth = 0;
      let bracketDepth = 0;
      while (this.pos < this.source.length) {
        const ch = this.source.charCodeAt(this.pos);
        if (ch === 40 /* ( */) parenDepth++;
        else if (ch === 41 /* ) */) parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === 91 /* [ */) bracketDepth++;
        else if (ch === 93 /* ] */) bracketDepth = Math.max(0, bracketDepth - 1);
        else if (
          parenDepth === 0 &&
          bracketDepth === 0 &&
          (isAsciiWhitespace(ch) || ch === 62 /* > */ || this.source.startsWith("/>", this.pos))
        ) {
          break;
        }
        this.pos++;
      }
      openRawExpression = this.source.slice(exprStart, this.pos).trim();
      if (!openRawExpression) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Expected tag expression after '<$' in dynamic element.",
          this.lineMap,
          start,
          this.pos
        );
      }
      openExpression = parseExpressionSlice(openRawExpression, exprStart, this.lineMap);
    }

    const attributes = this.parseAttributes();
    this.skipWhitespace();

    if (this.source.startsWith("/>", this.pos)) {
      this.pos += 2;
      return createDynamicElementNode({
        span: this.lineMap.span(start, this.pos),
        tagExpression: openExpression,
        rawTagExpression: openRawExpression,
        attributes,
        children: [],
        selfClosing: true
      });
    }

    if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 62 /* > */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Expected '>' or '/>' to complete dynamic element opening tag '<$...'.",
        this.lineMap,
        start,
        this.pos
      );
    }
    this.pos++; // skip '>'

    const children = this.parseChildren(() => this.source.startsWith("</$", this.pos));

    if (!this.source.startsWith("</$", this.pos)) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        `Unclosed dynamic element '<$${openRawExpression}>': missing matching '</$${openRawExpression}>'.`,
        this.lineMap,
        start,
        this.pos
      );
    }

    const closeTagStart = this.pos;
    this.pos += 3; // skip '</$'

    let closeRawExpression: string;
    if (this.source.charCodeAt(this.pos) === 123 /* { */) {
      this.pos++;
      const closeParsed = parseEmbeddedExpression(this.source, this.pos, "}", this.lineMap);
      this.pos = closeParsed.afterDelimiterOffset;
      closeRawExpression = closeParsed.rawExpression;
    } else {
      const closeExprStart = this.pos;
      while (
        this.pos < this.source.length &&
        this.source.charCodeAt(this.pos) !== 62 /* > */
      ) {
        this.pos++;
      }
      closeRawExpression = this.source.slice(closeExprStart, this.pos).trim();
    }

    this.skipWhitespace();
    if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 62 /* > */) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Expected '>' in dynamic closing tag '</$...>'.",
        this.lineMap,
        closeTagStart,
        this.pos
      );
    }
    this.pos++; // skip '>'

    if (!compareExpressionTokens(openRawExpression, closeRawExpression)) {
      throw new MixDiagnosticError({
        code: DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        message: `Dynamic closing tag '</$${closeRawExpression}>' does not match opening tag '<$${openRawExpression}>' token sequence (R-SYN-02).`,
        severity: "error",
        span: this.lineMap.span(closeTagStart, this.pos),
        notes: [
          `Opening tag at ${this.lineMap.locationAt(start).line}:${this.lineMap.locationAt(start).column}`
        ]
      });
    }

    return createDynamicElementNode({
      span: this.lineMap.span(start, this.pos),
      tagExpression: openExpression,
      rawTagExpression: openRawExpression,
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
    const start = this.pos; // at '{if' or '{#if'
    const openLen = this.isIfOpenAt(start);
    this.pos += openLen > 0 ? openLen : 3;
    const condResult = parseEmbeddedExpression(this.source, this.pos, "}", this.lineMap);
    this.pos = condResult.afterDelimiterOffset;

    const consequent = this.parseChildren(
      () =>
        this.isElseOrElseIfAt(this.pos) ||
        this.isEndIfAt(this.pos) > 0
    );

    let alternate: readonly TemplateNode[] | IfBlockNode | null = null;

    const branch = this.matchElseOrElseIf(this.pos);
    if (branch) {
      const branchStart = this.pos;
      this.pos = branch.afterKeywordOffset;

      if (branch.kind === "elseif") {
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

      this.skipWhitespace();
      if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 125 /* } */) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Expected '}' or 'if <condition>}' in '{else}' branch.",
          this.lineMap,
          branchStart,
          this.pos
        );
      }
      this.pos++; // skip '}'

      alternate = this.parseChildren(() => this.isEndIfAt(this.pos) > 0);
    }

    const endLen = this.isEndIfAt(this.pos);
    if (endLen === 0) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Unclosed '{if}' block: missing '{endif}' (or '{/if}').",
        this.lineMap,
        start,
        this.pos
      );
    }
    this.pos += endLen;

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
        this.isElseOrElseIfAt(this.pos) ||
        this.isEndIfAt(this.pos) > 0
    );

    let alternate: readonly TemplateNode[] | IfBlockNode | null = null;

    const branch = this.matchElseOrElseIf(this.pos);
    if (branch) {
      const nextBranchStart = this.pos;
      this.pos = branch.afterKeywordOffset;

      if (branch.kind === "elseif") {
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

      this.skipWhitespace();
      if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 125 /* } */) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Expected '}' in '{else}' branch.",
          this.lineMap,
          nextBranchStart,
          this.pos
        );
      }
      this.pos++;
      alternate = this.parseChildren(() => this.isEndIfAt(this.pos) > 0);
    }

    const endLen = this.isEndIfAt(this.pos);
    if (endLen === 0) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Unclosed '{elseif}' block: missing '{endif}' (or '{/if}').",
        this.lineMap,
        branchStart,
        this.pos
      );
    }
    this.pos += endLen;

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
    const start = this.pos; // at '{each' or '{#each'
    const isLegacyHashEach = this.source.startsWith("{#each", start);
    const openLen = this.isEachOpenAt(start);
    const headerStart = start + (openLen > 0 ? openLen : 5);

    // Scan tokens with TsParser.tokenizer to find the closing `}` of `{each ... }`
    // and top-level `in`/`of` or `as` keywords at braceDepth === 1 && parenDepth === 0
    const sliceFromHeader = this.source.slice(headerStart);
    const tokenizer = createTsTokenizer(sliceFromHeader);

    let braceDepth = 1;
    let parenDepth = 0;
    let bracketDepth = 0;
    let headerEndRel = -1;
    let lastTopLevelAsRel: { start: number; end: number } | null = null;
    let firstTopLevelInOrOfRel: { start: number; end: number; keyword: "in" | "of" } | null = null;

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
          bracketDepth === 0
        ) {
          if (tok.value === "as") {
            lastTopLevelAsRel = { start: tok.start, end: tok.end };
          } else if (
            !firstTopLevelInOrOfRel &&
            (tok.value === "in" || tok.type.label === "in" || tok.value === "of")
          ) {
            firstTopLevelInOrOfRel = {
              start: tok.start,
              end: tok.end,
              keyword: tok.value === "of" ? "of" : "in"
            };
          }
        }
      }
    } catch {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Malformed '{each}' header expression.",
        this.lineMap,
        start,
        Math.min(this.source.length, start + 30)
      );
    }

    if (headerEndRel === -1 || (!lastTopLevelAsRel && !firstTopLevelInOrOfRel)) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        "Invalid '{each}' syntax: expected '{each (item, idx) in collection}' or '{each collection as (item, idx)}'.",
        this.lineMap,
        start,
        Math.min(this.source.length, start + 30)
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
      // HAA-06 canonical form: `{each (task, idx) in tasks()}` or `{each task in tasks()}`
      const lhsStart = skipJsWhitespaceAndComments(
        this.source,
        headerStart,
        this.lineMap,
        headerStart + firstTopLevelInOrOfRel.start
      );
      const lhsRaw = this.source.slice(lhsStart, headerStart + firstTopLevelInOrOfRel.start).trim();
      const innerLhs =
        lhsRaw.startsWith("(") && lhsRaw.endsWith(")")
          ? lhsRaw.slice(1, -1).trim()
          : lhsRaw;

      const tupleMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?(?:\s*,\s*([\s\S]+))?$/.exec(
        innerLhs
      );
      if (!tupleMatch) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Invalid '{each}' loop binding: expected '{each (item, idx) in collection}' or '{each item in collection}'.",
          this.lineMap,
          lhsStart,
          headerStart + firstTopLevelInOrOfRel.start
        );
      }

      itemIdentifier = tupleMatch[1]!;
      indexIdentifier = tupleMatch[2] ?? null;
      const explicitTupleKey = tupleMatch[3]?.trim() ?? null;

      const collectionStart = skipJsWhitespaceAndComments(
        this.source,
        headerStart + firstTopLevelInOrOfRel.end,
        this.lineMap,
        headerCloseOffset
      );
      rawCollection = this.source.slice(collectionStart, headerCloseOffset).trimEnd();
      if (!rawCollection) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Missing collection expression in '{each}' block.",
          this.lineMap,
          start,
          headerCloseOffset
        );
      }
      collectionExpr = parseExpressionSlice(rawCollection, collectionStart, this.lineMap);

      const itemOffsetInSource = headerStart + this.source.slice(headerStart, headerStart + firstTopLevelInOrOfRel.start).indexOf(itemIdentifier);
      if (explicitTupleKey) {
        rawKeyExpression = explicitTupleKey;
        keyExpression = parseExpressionSlice(rawKeyExpression, lhsStart, this.lineMap);
      } else {
        rawKeyExpression = itemIdentifier;
        keyExpression = parseExpressionSlice(rawKeyExpression, itemOffsetInSource, this.lineMap);
      }
    } else {
      // `as` form: `{each tasks() as (task, idx)}` or `{#each tasks() as task, idx (task.id)}`
      const asRel = lastTopLevelAsRel!;
      const collectionStart = skipJsWhitespaceAndComments(
        this.source,
        headerStart,
        this.lineMap,
        headerStart + asRel.start
      );
      const collectionEndRaw = headerStart + asRel.start;
      rawCollection = this.source.slice(collectionStart, collectionEndRaw).trimEnd();
      if (!rawCollection) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
          "Missing collection expression in '{each}' block.",
          this.lineMap,
          start,
          collectionEndRaw
        );
      }

      collectionExpr = parseExpressionSlice(rawCollection, collectionStart, this.lineMap);

      const bindingSliceStart = headerStart + asRel.end;
      const bindingSlice = this.source.slice(bindingSliceStart, headerCloseOffset);

      // Check for HAA-06 tuple binding after `as`: `as (item, idx)` or `as (item, idx, item.id)`
      const asTupleMatch = /^\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?(?:\s*,\s*([^)]+))?\s*\)\s*$/.exec(
        bindingSlice
      );

      if (asTupleMatch) {
        itemIdentifier = asTupleMatch[1]!;
        indexIdentifier = asTupleMatch[2] ?? null;
        const explicitTupleKey = asTupleMatch[3]?.trim() ?? null;
        const itemOffsetInSource = bindingSliceStart + bindingSlice.indexOf(itemIdentifier);
        if (explicitTupleKey) {
          rawKeyExpression = explicitTupleKey;
          keyExpression = parseExpressionSlice(rawKeyExpression, bindingSliceStart, this.lineMap);
        } else {
          rawKeyExpression = itemIdentifier;
          keyExpression = parseExpressionSlice(rawKeyExpression, itemOffsetInSource, this.lineMap);
        }
      } else {
        // Check for explicit `(keyExpression)` after `as item, idx`
        const bindingMatch = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s*\(/.exec(
          bindingSlice
        );

        if (bindingMatch) {
          itemIdentifier = bindingMatch[1]!;
          indexIdentifier = bindingMatch[2] ?? null;
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
              "Unexpected tokens after '(key)' in '{each}' block.",
              this.lineMap,
              afterKeyParen,
              headerCloseOffset + 1
            );
          }

          keyExpression = keyParsed.expression;
          rawKeyExpression = keyParsed.rawExpression;
        } else if (!isLegacyHashEach) {
          // Clean `{each items as item, idx}` without `#` automatically resolves key
          const simpleMatch = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s*$/.exec(
            bindingSlice
          );
          if (!simpleMatch) {
            failSyntax(
              DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
              "Invalid '{each}' loop binding.",
              this.lineMap,
              bindingSliceStart,
              headerCloseOffset + 1
            );
          }
          itemIdentifier = simpleMatch[1]!;
          indexIdentifier = simpleMatch[2] ?? null;
          const itemOffsetInSource = bindingSliceStart + bindingSlice.indexOf(itemIdentifier);
          rawKeyExpression = itemIdentifier;
          keyExpression = parseExpressionSlice(rawKeyExpression, itemOffsetInSource, this.lineMap);
        } else {
          failSyntax(
            DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
            "Keyed '{#each}' block requires an item identifier and explicit '(key)' expression (D-110): '{#each items as item (item.id)}'.",
            this.lineMap,
            bindingSliceStart,
            headerCloseOffset + 1
          );
        }
      }
    }

    this.pos = headerCloseOffset + 1; // advance past `}`

    const children = this.parseChildren(() => this.isEndEachAt(this.pos) > 0);
    const endLen = this.isEndEachAt(this.pos);
    if (endLen === 0) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Unclosed '{each}' block: missing '{endeach}' (or '{/each}').",
        this.lineMap,
        start,
        this.pos
      );
    }
    this.pos += endLen;

    return deepFreeze({
      type: "EachBlock",
      collection: collectionExpr,
      rawCollection,
      itemIdentifier,
      indexIdentifier,
      keyExpression,
      rawKeyExpression,
      children,
      span: this.lineMap.span(start, this.pos)
    });
  }

  private parseAwaitBlock(): AwaitBlockNode {
    const start = this.pos; // at '{await' or '{#await'
    const openLen = this.isAwaitOpenAt(start);
    this.pos += openLen > 0 ? openLen : 6;
    const exprResult = parseEmbeddedExpression(this.source, this.pos, "}", this.lineMap);
    this.pos = exprResult.afterDelimiterOffset;

    const pending = this.parseChildren(
      () =>
        this.isThenAt(this.pos) !== null ||
        this.isCatchAt(this.pos) !== null ||
        this.isEndAwaitAt(this.pos) > 0
    );

    let thenIdentifier: string | null = null;
    let thenBranch: TemplateNode[] = [];
    const thenMatch = this.isThenAt(this.pos);
    if (thenMatch) {
      thenIdentifier = thenMatch.ident;
      this.pos += thenMatch.len;
      thenBranch = this.parseChildren(
        () => this.isCatchAt(this.pos) !== null || this.isEndAwaitAt(this.pos) > 0
      );
    }

    let catchIdentifier: string | null = null;
    let catchBranch: TemplateNode[] = [];
    const catchMatch = this.isCatchAt(this.pos);
    if (catchMatch) {
      catchIdentifier = catchMatch.ident;
      this.pos += catchMatch.len;
      catchBranch = this.parseChildren(() => this.isEndAwaitAt(this.pos) > 0);
    }

    const endLen = this.isEndAwaitAt(this.pos);
    if (endLen === 0) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_UNCLOSED_TAG,
        "Unclosed '{await}' block: missing '{endawait}' (or '{/await}').",
        this.lineMap,
        start,
        this.pos
      );
    }
    this.pos += endLen;

    return createAwaitBlockNode({
      span: this.lineMap.span(start, this.pos),
      expression: exprResult.expression,
      rawExpression: exprResult.rawExpression,
      pending,
      thenIdentifier,
      thenBranch,
      catchIdentifier,
      catchBranch
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
