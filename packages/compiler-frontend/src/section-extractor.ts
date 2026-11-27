/**
 * @dotmix/compiler-frontend/section-extractor — Top-level <script>, <style>, and functional component extraction.
 */

import { deepFreeze } from "@dotmix/ast";
import type { ScriptBlockNode, StyleBlockNode } from "@dotmix/ast";
import { DiagnosticCodes, MixDiagnosticError } from "@dotmix/diagnostics";
import type { LineMap } from "./location.js";
import { parseScriptProgram } from "./expression.js";
import { findFunctionalComponent } from "./functional-finder.js";
import { stripCommentsPreservingLiterals } from "./script-scanner.js";
import {
  failSyntax,
  isAsciiWhitespace,
  blankRangePreservingNewlines
} from "./types.js";
import type { ParseOptions, ExtractedSections } from "./types.js";

function trimTrailingCommentsAndWs(text: string, start: number, end: number): number {
  let cursor = end;
  while (cursor > start) {
    while (cursor > start && isAsciiWhitespace(text.charCodeAt(cursor - 1))) {
      cursor--;
    }
    if (cursor >= start + 2 && text[cursor - 2] === "*" && text[cursor - 1] === "/") {
      const openIdx = text.lastIndexOf("/*", cursor - 2);
      if (openIdx >= start) {
        cursor = openIdx;
        continue;
      }
    }
    const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
    const lineSlice = text.slice(Math.max(start, lineStart), cursor);
    const trimmedLine = lineSlice.trimStart();
    if (trimmedLine.startsWith("//")) {
      cursor = Math.max(start, lineStart);
      continue;
    }
    break;
  }
  return cursor;
}

function mapSyntheticOffsetToSource(
  offset: number,
  segments: readonly { readonly contentStart: number; readonly contentEnd: number; readonly sourceOffset: number }[]
): number {
  for (const seg of segments) {
    if (offset >= seg.contentStart && offset <= seg.contentEnd) {
      return seg.sourceOffset + (offset - seg.contentStart);
    }
  }
  const last = segments[segments.length - 1];
  return last ? last.sourceOffset + (last.contentEnd - last.contentStart) : 0;
}

/**
 * Extracts a React-style functional `.mix` or `.tix` component (`export default function App(props) { ... return ( <...> ); }`)
 * into a `ScriptBlockNode` and a blanked `templateBuffer` preserving exact 1-based line/column and 0-based byte offsets.
 */
export function tryExtractFunctionalComponent(
  source: string,
  chars: string[],
  lineMap: LineMap,
  isDefaultTs: boolean
): ScriptBlockNode | null {
  const currentText = chars.join("");
  const found = findFunctionalComponent(currentText);
  if (!found) {
    return null;
  }

  const {
    fnStart,
    openParenIdx,
    closeParenIdx,
    bodyOpenBraceIdx,
    returnKeywordIdx,
    fnCloseBraceIdx
  } = found;

  const rawParams = stripCommentsPreservingLiterals(
    currentText.slice(openParenIdx + 1, closeParenIdx)
  );

  // Locate the returned markup range `[templateStart, templateEnd)` inside `return (...)` or `return <...>`
  let afterReturn = returnKeywordIdx + 6;
  while (afterReturn < fnCloseBraceIdx && isAsciiWhitespace(currentText.charCodeAt(afterReturn))) {
    afterReturn++;
  }

  let templateStart = afterReturn;
  let templateEnd = trimTrailingCommentsAndWs(currentText, templateStart, fnCloseBraceIdx);
  if (templateEnd > templateStart && currentText[templateEnd - 1] === ";") {
    templateEnd = trimTrailingCommentsAndWs(currentText, templateStart, templateEnd - 1);
  }

  if (currentText[templateStart] === "(" && currentText[templateEnd - 1] === ")") {
    templateStart++;
    templateEnd--;
  }

  // Build synthesized script content from preamble + optional props parameter + function body before `return`
  const trimSlice = (rawStart: number, rawEnd: number): { text: string; startOffset: number } => {
    let s = rawStart;
    let e = rawEnd;
    while (s < e && isAsciiWhitespace(currentText.charCodeAt(s))) s++;
    while (e > s && isAsciiWhitespace(currentText.charCodeAt(e - 1))) e--;
    return { text: currentText.slice(s, e), startOffset: s };
  };
  const preambleSlice = trimSlice(0, fnStart);
  const bodySlice = trimSlice(bodyOpenBraceIdx + 1, returnKeywordIdx);
  const postambleSlice = trimSlice(fnCloseBraceIdx + 1, currentText.length);
  const preamble = preambleSlice.text;
  const bodyBeforeReturn = bodySlice.text;
  const postamble = postambleSlice.text;

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

  const scriptPartEntries: Array<{ text: string; sourceOffset: number }> = [];
  if (preamble.length > 0) scriptPartEntries.push({ text: preamble, sourceOffset: preambleSlice.startOffset });
  if (propStmt.length > 0) scriptPartEntries.push({ text: propStmt, sourceOffset: fnStart });
  if (bodyBeforeReturn.length > 0) scriptPartEntries.push({ text: bodyBeforeReturn, sourceOffset: bodySlice.startOffset });

  const sourceSegments: Array<{ contentStart: number; contentEnd: number; sourceOffset: number }> = [];
  let contentCursor = 0;
  for (let i = 0; i < scriptPartEntries.length; i++) {
    const entry = scriptPartEntries[i]!;
    if (i > 0) contentCursor += 1; // "\n" separator
    sourceSegments.push({
      contentStart: contentCursor,
      contentEnd: contentCursor + entry.text.length,
      sourceOffset: entry.sourceOffset
    });
    contentCursor += entry.text.length;
  }
  const scriptContent = scriptPartEntries.map((p) => p.text).join("\n");
  const lang: "js" | "ts" = isDefaultTs ? "ts" : "js";

  const fullScriptSegments = [...sourceSegments];
  if (postamble.length > 0) {
    const postStart = scriptContent.length > 0 ? scriptContent.length + 1 : 0;
    fullScriptSegments.push({
      contentStart: postStart,
      contentEnd: postStart + postamble.length,
      sourceOffset: postambleSlice.startOffset
    });
  }
  const fullScriptForCheck = [scriptContent, postamble].filter((s) => s.length > 0).join("\n");
  if (fullScriptForCheck.trim().length > 0) {
    try {
      parseScriptProgram(fullScriptForCheck, 0, lineMap);
    } catch (err: unknown) {
      if (err instanceof MixDiagnosticError) {
        const mappedStart = mapSyntheticOffsetToSource(err.diagnostic.span.start.offset, fullScriptSegments);
        const mappedEnd = Math.min(source.length, mappedStart + 1);
        throw new MixDiagnosticError({
          ...err.diagnostic,
          span: lineMap.span(mappedStart, mappedEnd)
        });
      }
      throw err;
    }
  }

  // Blank everything outside `[templateStart, templateEnd)` in `chars` so template offsets match original source
  blankRangePreservingNewlines(chars, 0, templateStart);
  blankRangePreservingNewlines(chars, templateEnd, source.length);

  return deepFreeze({
    type: "ScriptBlock",
    lang,
    content: scriptContent,
    contentSpan: lineMap.span(0, returnKeywordIdx),
    span: lineMap.span(0, source.length),
    sourceSegments,
    ...(postamble.length > 0 ? { postamble, postambleStartOffset: postambleSlice.startOffset } : {})
  });
}

/**
 * Extracts top-level `<script>` and `<style>` blocks (or Functional React-style component definitions)
 * while blanking their characters with spaces (preserving `\n` and `\r`) so template character offsets
 * remain 100% identical to the original source file.
 */
export function extractTopLevelSections(
  source: string,
  lineMap: LineMap,
  filename?: string,
  options?: ParseOptions
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

      // Verify script syntax with the TypeScript parser
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

    if (
      source.startsWith("<style", pos) &&
      pos + 6 < source.length &&
      (isAsciiWhitespace(source.charCodeAt(pos + 6)) || source.charCodeAt(pos + 6) === 62 /* > */)
    ) {
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
      const isSelfClosing = openTagAttrText.trimEnd().endsWith("/");
      const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(openTagAttrText);
      const srcAttr = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? "") : undefined;

      let blockEnd: number;
      let content = "";
      const contentStart = openTagEnd + 1;
      let contentEnd = contentStart;

      if (isSelfClosing) {
        blockEnd = openTagEnd + 1;
      } else {
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
        blockEnd = closeTagStart + 8;
        contentEnd = closeTagStart;
        content = source.slice(contentStart, closeTagStart);
      }

      if (srcAttr && content.trim().length === 0 && options?.readFile) {
        try {
          content = options.readFile(srcAttr);
        } catch {
          // Keep content empty if readFile fails; let analyzer/codegen diagnose if needed
        }
      }

      style = deepFreeze({
        type: "StyleBlock",
        scoped: !scopedFalse,
        content,
        contentSpan: lineMap.span(contentStart, contentEnd),
        span: lineMap.span(blockStart, blockEnd),
        ...(srcAttr ? { src: srcAttr } : {})
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
