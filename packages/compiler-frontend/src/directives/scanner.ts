/**
 * @dotmix/compiler-frontend/directives/scanner — Registry-driven directive lookahead helpers.
 */

import { DIRECTIVE_GRAMMAR, type DirectiveGrammarEntry } from "@dotmix/ast";
import { isAsciiWhitespace } from "../types.js";

export interface BracedKeywordMatch {
  readonly word: string;
  readonly wordStart: number;
  readonly wordEnd: number;
  readonly afterWord: number;
}

export interface DirectiveCloseMatch {
  readonly entry: DirectiveGrammarEntry;
  readonly closeEnd: number;
}

export interface DirectiveBranchMatch {
  readonly marker: string;
  readonly startOffset: number;
  readonly afterKeywordOffset: number;
  readonly noArgCloseEnd: number | null;
}

export interface InlineStatementMatch {
  readonly marker: "continue" | "break";
  readonly startOffset: number;
  readonly headerStartOffset: number;
}

const ZERO_ARG_CAPABLE_IDS = new Set([
  "switch",
  "auth",
  "guest",
  "dev",
  "production",
  "csrf",
  "once",
  "lazy",
  "verbatim"
]);

const EXISTING_CONTROL_FLOW_IDS = new Set(["if", "each", "await", "head"]);

const BLOCK_OPEN_LOOKUP = new Map<string, DirectiveGrammarEntry>();
const BLOCK_CLOSE_LOOKUP = new Map<string, DirectiveGrammarEntry>();
const BRANCH_MARKER_SET = new Set<string>();

for (const entry of DIRECTIVE_GRAMMAR.directives) {
  if (!EXISTING_CONTROL_FLOW_IDS.has(entry.id) && !BLOCK_OPEN_LOOKUP.has(entry.blockOpen)) {
    BLOCK_OPEN_LOOKUP.set(entry.blockOpen, entry);
  }
  if (
    !EXISTING_CONTROL_FLOW_IDS.has(entry.id) &&
    entry.blockClose !== null &&
    !BLOCK_CLOSE_LOOKUP.has(entry.blockClose)
  ) {
    BLOCK_CLOSE_LOOKUP.set(entry.blockClose, entry);
  }
  for (const marker of entry.branchMarkers) {
    BRANCH_MARKER_SET.add(marker);
  }
}

export function isIdentifierStartChar(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36
  );
}

export function isIdentifierPartChar(code: number): boolean {
  return isIdentifierStartChar(code) || (code >= 48 && code <= 57);
}

export function isValidIdentifierName(text: string): boolean {
  if (text.length === 0 || !isIdentifierStartChar(text.charCodeAt(0))) {
    return false;
  }
  for (let i = 1; i < text.length; i++) {
    if (!isIdentifierPartChar(text.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function skipSimpleWhitespace(source: string, pos: number): number {
  let cursor = pos;
  while (cursor < source.length && isAsciiWhitespace(source.charCodeAt(cursor))) {
    cursor++;
  }
  return cursor;
}

function isNonArgumentStarter(code: number): boolean {
  return (
    code === 46 ||
    code === 63 ||
    code === 58 ||
    code === 44 ||
    code === 59 ||
    code === 41 ||
    code === 93 ||
    code === 61 ||
    code === 38 ||
    code === 124 ||
    code === 43 ||
    code === 42 ||
    code === 47 ||
    code === 37 ||
    code === 62 ||
    code === 94
  );
}

export function matchBracedWord(source: string, pos: number): BracedKeywordMatch | null {
  if (source.charCodeAt(pos) !== 123 /* { */) {
    return null;
  }
  const wordStart = skipSimpleWhitespace(source, pos + 1);
  if (wordStart >= source.length || !isIdentifierStartChar(source.charCodeAt(wordStart))) {
    return null;
  }
  let wordEnd = wordStart + 1;
  while (wordEnd < source.length && isIdentifierPartChar(source.charCodeAt(wordEnd))) {
    wordEnd++;
  }
  return {
    word: source.slice(wordStart, wordEnd),
    wordStart,
    wordEnd,
    afterWord: wordEnd
  };
}

export function matchDirectiveOpenAt(
  source: string,
  pos: number
): { entry: DirectiveGrammarEntry; afterKeywordOffset: number; braceOffset: number } | null {
  const matched = matchBracedWord(source, pos);
  if (!matched) return null;
  const entry = BLOCK_OPEN_LOOKUP.get(matched.word);
  if (!entry) return null;
  const nextPos = skipSimpleWhitespace(source, matched.afterWord);
  if (nextPos >= source.length) return null;
  const nextChar = source.charCodeAt(nextPos);
  if (nextChar === 125 /* } */) {
    return ZERO_ARG_CAPABLE_IDS.has(entry.id)
      ? { entry, afterKeywordOffset: matched.afterWord, braceOffset: pos }
      : null;
  }
  const immediateChar = source.charCodeAt(matched.afterWord);
  const hasWhitespaceOrParen =
    isAsciiWhitespace(immediateChar) ||
    (immediateChar === 40 /* ( */ &&
      (entry.id === "unless" ||
        entry.id === "isset" ||
        entry.id === "isempty" ||
        entry.id === "switch" ||
        entry.id === "env" ||
        entry.id === "context"));
  if (!hasWhitespaceOrParen || isNonArgumentStarter(nextChar)) {
    return null;
  }
  return { entry, afterKeywordOffset: matched.afterWord, braceOffset: pos };
}

export function matchDirectiveCloseAt(
  source: string,
  pos: number
): DirectiveCloseMatch | null {
  const matched = matchBracedWord(source, pos);
  if (!matched) return null;
  const entry = BLOCK_CLOSE_LOOKUP.get(matched.word);
  if (!entry) return null;
  const afterWs = skipSimpleWhitespace(source, matched.afterWord);
  if (afterWs < source.length && source.charCodeAt(afterWs) === 125 /* } */) {
    return { entry, closeEnd: afterWs + 1 };
  }
  return null;
}

export function matchDirectiveBranchAt(
  source: string,
  pos: number
): DirectiveBranchMatch | null {
  const matched = matchBracedWord(source, pos);
  if (!matched || !BRANCH_MARKER_SET.has(matched.word)) return null;
  const afterWs = skipSimpleWhitespace(source, matched.afterWord);
  if (afterWs >= source.length) return null;
  const nextChar = source.charCodeAt(afterWs);
  if (nextChar === 125 /* } */) {
    return {
      marker: matched.word,
      startOffset: pos,
      afterKeywordOffset: matched.afterWord,
      noArgCloseEnd: afterWs + 1
    };
  }
  if (matched.word === "else" || matched.word === "default" || matched.word === "empty") {
    return null;
  }
  const immediateChar = source.charCodeAt(matched.afterWord);
  if ((!isAsciiWhitespace(immediateChar) && immediateChar !== 40) || isNonArgumentStarter(nextChar)) {
    return null;
  }
  return {
    marker: matched.word,
    startOffset: pos,
    afterKeywordOffset: matched.afterWord,
    noArgCloseEnd: null
  };
}

export function matchInlineStatementAt(
  source: string,
  pos: number
): InlineStatementMatch | null {
  const matched = matchBracedWord(source, pos);
  if (!matched || (matched.word !== "continue" && matched.word !== "break")) {
    return null;
  }
  const afterFirstWs = skipSimpleWhitespace(source, matched.afterWord);
  if (!source.startsWith("if", afterFirstWs)) return null;
  const afterIfOffset = afterFirstWs + 2;
  if (afterIfOffset >= source.length) return null;
  const afterIfChar = source.charCodeAt(afterIfOffset);
  if (!isAsciiWhitespace(afterIfChar) && afterIfChar !== 40) return null;
  return {
    marker: matched.word,
    startOffset: pos,
    headerStartOffset: afterIfOffset
  };
}
