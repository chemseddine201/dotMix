/**
 * @dotmix/compiler-frontend/functional-finder — Locates the component function and its
 * template return boundary in functional `.mix` / `.tix` components using TypeScript-accurate
 * lexical scanning (D-190 B3 & B4).
 */

import { isAsciiWhitespace } from "./types.js";
import { ScriptLexicalScanner, type ScriptToken } from "./script-scanner.js";

export interface FunctionalComponentMatch {
  readonly fnStart: number;
  readonly openParenIdx: number;
  readonly closeParenIdx: number;
  readonly bodyOpenBraceIdx: number;
  readonly returnKeywordIdx: number;
  readonly fnCloseBraceIdx: number;
  readonly priority: number;
  readonly returnsMarkup: boolean;
}

function skipWsAndCommentsOffset(src: string, start: number, limit: number): number {
  let pos = start;
  while (pos < limit) {
    const ch = src.charCodeAt(pos);
    if (isAsciiWhitespace(ch)) {
      pos++;
      continue;
    }
    if (ch === 47 && pos + 1 < limit && src.charCodeAt(pos + 1) === 47) {
      const nl = src.indexOf("\n", pos + 2);
      pos = nl === -1 || nl >= limit ? limit : nl + 1;
      continue;
    }
    if (ch === 47 && pos + 1 < limit && src.charCodeAt(pos + 1) === 42) {
      const endCmt = src.indexOf("*/", pos + 2);
      pos = endCmt === -1 || endCmt + 2 > limit ? limit : endCmt + 2;
      continue;
    }
    break;
  }
  return pos;
}

const TEMPLATE_BLOCK_STARTERS = new Set([
  "if",
  "each",
  "await",
  "switch",
  "unless",
  "isset",
  "isempty",
  "auth",
  "guest",
  "can",
  "cannot",
  "canany",
  "env",
  "context",
  "hydrate",
  "try",
  "once",
  "memo",
  "lazy",
  "verbatim",
  "#if",
  "#each",
  "#await"
]);

function looksLikeMarkupAfterReturn(src: string, returnEndOffset: number): boolean {
  let pos = skipWsAndCommentsOffset(src, returnEndOffset, src.length);
  if (pos < src.length && src.charCodeAt(pos) === 40 /* ( */) {
    pos = skipWsAndCommentsOffset(src, pos + 1, src.length);
  }
  if (pos >= src.length) return false;
  const ch = src.charCodeAt(pos);
  if (ch === 60 /* < */) return true;
  if (ch === 123 /* { */) {
    let cursor = pos + 1;
    while (cursor < src.length && isAsciiWhitespace(src.charCodeAt(cursor))) cursor++;
    const wordStart = cursor;
    if (cursor < src.length && src.charCodeAt(cursor) === 35 /* # */) cursor++;
    while (cursor < src.length) {
      const c = src.charCodeAt(cursor);
      if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) cursor++;
      else break;
    }
    return TEMPLATE_BLOCK_STARTERS.has(src.slice(wordStart, cursor));
  }
  return false;
}

function isTemplateMarkupStart(src: string, offset: number): boolean {
  const pos = skipWsAndCommentsOffset(src, offset, src.length);
  if (pos >= src.length || src.charCodeAt(pos) !== 60 /* < */) return false;
  if (pos + 1 >= src.length) return false;
  const next = src.charCodeAt(pos + 1);
  return (
    (next >= 65 && next <= 90) ||
    (next >= 97 && next <= 122) ||
    next === 36 /* $ */ ||
    next === 62 /* > */ ||
    next === 123 /* { */
  );
}

/**
 * Scans forward through template markup starting at `startOffset` until a closing `}`
 * at the current template level is found. Returns the index of that `}`, or -1 on EOF.
 */
function findCloseBraceInTemplate(src: string, startOffset: number): number {
  let pos = startOffset;
  const len = src.length;
  let inTag = false;

  while (pos < len) {
    if (!inTag && src.startsWith("<!--", pos)) {
      const endCmt = src.indexOf("-->", pos + 4);
      pos = endCmt === -1 ? len : endCmt + 3;
      continue;
    }
    const ch = src.charCodeAt(pos);
    if (inTag) {
      if (ch === 34 /* " */ || ch === 39 /* ' */) {
        const quote = ch;
        pos++;
        while (pos < len && src.charCodeAt(pos) !== quote) pos++;
        if (pos < len) pos++;
        continue;
      }
      if (ch === 62 /* > */) {
        inTag = false;
        pos++;
        continue;
      }
    } else if (ch === 60 /* < */ && pos + 1 < len) {
      const next = src.charCodeAt(pos + 1);
      if (
        (next >= 65 && next <= 90) ||
        (next >= 97 && next <= 122) ||
        next === 47 ||
        next === 36 ||
        next === 123 ||
        next === 62
      ) {
        inTag = true;
        pos++;
        continue;
      }
    }

    if (ch === 123 /* { */) {
      const afterBrace = scanTemplateBraceExpression(src, pos);
      if (afterBrace === -1) return -1;
      pos = afterBrace;
      continue;
    }

    if (ch === 125 /* } */) {
      return pos;
    }

    pos++;
  }
  return -1;
}

/**
 * Scans a `{ ... }` expression embedded inside template markup, returning the offset
 * immediately after its matching `}` (or -1 on EOF). Supports both JS/TS expressions
 * and inline template subtrees (`fallback={<span/>}`, `{(u) => <p>{u.name}</p>}`).
 */
function scanTemplateBraceExpression(src: string, openBracePos: number): number {
  if (isTemplateMarkupStart(src, openBracePos + 1)) {
    const closeIdx = findCloseBraceInTemplate(src, openBracePos + 1);
    return closeIdx === -1 ? -1 : closeIdx + 1;
  }

  const exprScanner = new ScriptLexicalScanner(src, openBracePos + 1, 1);
  while (exprScanner.braceDepth > 0) {
    const tok = exprScanner.nextToken();
    if (tok.kind === "eof") return -1;

    if (exprScanner.braceDepth === 1 && tok.kind === "punct" && tok.value === "=>") {
      let afterArrow = skipWsAndCommentsOffset(src, tok.end, src.length);
      if (afterArrow < src.length && src.charCodeAt(afterArrow) === 40 /* ( */) {
        afterArrow = skipWsAndCommentsOffset(src, afterArrow + 1, src.length);
      }
      if (isTemplateMarkupStart(src, afterArrow)) {
        const closeIdx = findCloseBraceInTemplate(src, afterArrow);
        return closeIdx === -1 ? -1 : closeIdx + 1;
      }
    }
  }
  return exprScanner.pos;
}

/**
 * Scans forward from the start of a functional component's returned template (at braceDepth === 1)
 * to locate the component function's closing `}` while safely skipping HTML comments, tag attribute
 * strings, and embedded JS `{...}` expressions (with full TS lexical scanning).
 */
function findFunctionCloseAfterTemplateReturn(src: string, startOffset: number): number {
  return findCloseBraceInTemplate(src, startOffset);
}

function scanFunctionBody(
  src: string,
  fnStart: number,
  openParenIdx: number,
  closeParenIdx: number,
  bodyOpenBraceIdx: number,
  priority: number
): FunctionalComponentMatch | null {
  const scanner = new ScriptLexicalScanner(src, bodyOpenBraceIdx + 1, 1);
  let fallbackReturnIdx = -1;

  while (scanner.braceDepth > 0) {
    const tok = scanner.nextToken();
    if (tok.kind === "eof") return null;

    if (scanner.braceDepth === 0) {
      if (fallbackReturnIdx !== -1) {
        return {
          fnStart,
          openParenIdx,
          closeParenIdx,
          bodyOpenBraceIdx,
          returnKeywordIdx: fallbackReturnIdx,
          fnCloseBraceIdx: tok.start,
          priority,
          returnsMarkup: false
        };
      }
      return null;
    }

    if (scanner.braceDepth === 1 && tok.kind === "ident" && tok.value === "return") {
      if (looksLikeMarkupAfterReturn(src, tok.end)) {
        const fnCloseBraceIdx = findFunctionCloseAfterTemplateReturn(src, tok.end);
        if (fnCloseBraceIdx === -1) return null;
        return {
          fnStart,
          openParenIdx,
          closeParenIdx,
          bodyOpenBraceIdx,
          returnKeywordIdx: tok.start,
          fnCloseBraceIdx,
          priority,
          returnsMarkup: true
        };
      }
      fallbackReturnIdx = tok.start;
    }
  }
  return null;
}

/**
 * Finds the component function in a functional `.mix` / `.tix` source file using
 * TypeScript-accurate lexical scanning. Prefers `export default function` over
 * `export function` over plain `function`, and prefers functions returning markup.
 */
export function findFunctionalComponent(source: string): FunctionalComponentMatch | null {
  const scanner = new ScriptLexicalScanner(source, 0, 0);
  const candidates: FunctionalComponentMatch[] = [];

  const nextTopToken = (): ScriptToken => scanner.nextToken();
  let tok = nextTopToken();

  while (tok.kind !== "eof") {
    if (scanner.braceDepth === 0 && scanner.parenDepth === 0 && scanner.bracketDepth === 0 && tok.kind === "ident") {
      let fnStart = -1;
      let priority = 0;

      if (tok.value === "export") {
        fnStart = tok.start;
        tok = nextTopToken();
        if (tok.kind === "ident" && tok.value === "default") {
          priority = 3;
          tok = nextTopToken();
        } else {
          priority = 2;
        }
        if (tok.kind === "ident" && tok.value === "async") {
          tok = nextTopToken();
        }
        if (tok.kind !== "ident" || tok.value !== "function") {
          continue;
        }
      } else if (tok.value === "async") {
        fnStart = tok.start;
        priority = 1;
        tok = nextTopToken();
        if (tok.kind !== "ident" || tok.value !== "function") {
          continue;
        }
      } else if (tok.value === "function") {
        fnStart = tok.start;
        priority = 1;
      }

      if (fnStart !== -1) {
        tok = nextTopToken();
        if (tok.kind === "ident") {
          tok = nextTopToken();
        }
        if (tok.kind === "punct" && tok.value === "<") {
          let angleDepth = 1;
          tok = nextTopToken();
          while (tok.kind !== "eof" && angleDepth > 0) {
            if (tok.kind === "punct" && tok.value === "<") angleDepth++;
            else if (tok.kind === "punct" && tok.value === ">") angleDepth--;
            else if (tok.kind === "punct" && tok.value === ">>") angleDepth = Math.max(0, angleDepth - 2);
            tok = nextTopToken();
          }
        }
        if (tok.kind === "punct" && tok.value === "(") {
          const openParenIdx = tok.start;
          const targetParenDepth = scanner.parenDepth - 1;
          while (tok.kind !== "eof" && scanner.parenDepth > targetParenDepth) {
            tok = nextTopToken();
          }
          if (tok.kind !== "punct" || tok.value !== ")") {
            continue;
          }
          const closeParenIdx = tok.start;

          tok = nextTopToken();
          let bodyOpenBraceIdx = -1;
          if (tok.kind === "punct" && tok.value === "{") {
            bodyOpenBraceIdx = tok.start;
          } else if (tok.kind === "punct" && tok.value === ":") {
            let prevTokVal = ":";
            let angleDepth = 0;
            tok = nextTopToken();
            while (tok.kind !== "eof") {
              if (scanner.parenDepth === 0 && scanner.bracketDepth === 0 && angleDepth === 0) {
                if (tok.kind === "punct" && tok.value === "{") {
                  const startsTypeLiteral =
                    prevTokVal === ":" ||
                    prevTokVal === "|" ||
                    prevTokVal === "&" ||
                    prevTokVal === "=>" ||
                    prevTokVal === "<" ||
                    prevTokVal === ",";
                  if (startsTypeLiteral) {
                    const targetBrace = scanner.braceDepth - 1;
                    while (tok.kind !== "eof" && scanner.braceDepth > targetBrace) {
                      tok = nextTopToken();
                    }
                    prevTokVal = "}";
                    tok = nextTopToken();
                    continue;
                  }
                  bodyOpenBraceIdx = tok.start;
                  break;
                }
                if (tok.kind === "punct" && tok.value === ";") {
                  break;
                }
              }
              if (tok.kind === "punct" && tok.value === "<") angleDepth++;
              else if (tok.kind === "punct" && tok.value === ">") angleDepth = Math.max(0, angleDepth - 1);
              else if (tok.kind === "punct" && tok.value === ">>") angleDepth = Math.max(0, angleDepth - 2);
              prevTokVal = tok.value;
              tok = nextTopToken();
            }
          }

          if (bodyOpenBraceIdx !== -1) {
            const match = scanFunctionBody(
              source,
              fnStart,
              openParenIdx,
              closeParenIdx,
              bodyOpenBraceIdx,
              priority
            );
            if (match) {
              candidates.push(match);
              scanner.pos = match.fnCloseBraceIdx + 1;
              scanner.braceDepth = 0;
            }
          }
        }
      }
    }
    tok = nextTopToken();
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.returnsMarkup !== b.returnsMarkup) return a.returnsMarkup ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.fnStart - b.fnStart;
  });
  return candidates[0]!;
}

