/**
 * @mix/compiler-frontend/control-flow-scanner — Control-flow keyword lookahead helpers.
 */

import { isAsciiWhitespace } from "./types.js";

export function isIfOpenAt(source: string, pos: number): number {
  if (source.startsWith("{if", pos)) {
    const next = source.charCodeAt(pos + 3);
    if (isAsciiWhitespace(next) || next === 40 /* ( */) return 3;
  }
  if (source.startsWith("{#if", pos)) {
    const next = source.charCodeAt(pos + 4);
    if (isAsciiWhitespace(next) || next === 40 /* ( */) return 4;
  }
  return 0;
}

export function isEachOpenAt(source: string, pos: number): number {
  if (source.startsWith("{each", pos)) {
    const next = source.charCodeAt(pos + 5);
    if (isAsciiWhitespace(next) || next === 40 /* ( */) return 5;
  }
  if (source.startsWith("{#each", pos)) {
    const next = source.charCodeAt(pos + 6);
    if (isAsciiWhitespace(next) || next === 40 /* ( */) return 6;
  }
  return 0;
}

export function matchElseOrElseIf(
  source: string,
  pos: number
): { kind: "else" | "elseif"; afterKeywordOffset: number } | null {
  if (source.charCodeAt(pos) !== 123 /* { */) return null;
  const slice = source.slice(pos, pos + 24);
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

export function isElseOrElseIfAt(source: string, pos: number): boolean {
  return matchElseOrElseIf(source, pos) !== null;
}

export function isEndIfAt(source: string, pos: number): number {
  if (source.charCodeAt(pos) !== 123 /* { */) return 0;
  const m = /^\{\s*(?:endif|#endif|\/if)\s*\}/.exec(source.slice(pos, pos + 20));
  return m ? m[0].length : 0;
}

export function isEndEachAt(source: string, pos: number): number {
  if (source.charCodeAt(pos) !== 123 /* { */) return 0;
  const m = /^\{\s*(?:endeach|#endeach|\/each)\s*\}/.exec(source.slice(pos, pos + 20));
  return m ? m[0].length : 0;
}

export function isAwaitOpenAt(source: string, pos: number): number {
  if (source.startsWith("{await", pos)) {
    const next = source.charCodeAt(pos + 6);
    if (isAsciiWhitespace(next) || next === 40 /* ( */) return 6;
  }
  if (source.startsWith("{#await", pos)) {
    const next = source.charCodeAt(pos + 7);
    if (isAsciiWhitespace(next) || next === 40 /* ( */) return 7;
  }
  return 0;
}

export function isThenAt(
  source: string,
  pos: number
): { len: number; ident: string | null } | null {
  if (source.charCodeAt(pos) !== 123 /* { */) return null;
  const slice = source.slice(pos, pos + 40);
  const m = /^\{\s*(?:[:#]?then)\b(?:\s+([A-Za-z_$][A-Za-z0-9_$]*))?\s*\}/.exec(slice);
  if (m) {
    return { len: m[0].length, ident: m[1] ?? null };
  }
  return null;
}

export function isCatchAt(
  source: string,
  pos: number
): { len: number; ident: string | null } | null {
  if (source.charCodeAt(pos) !== 123 /* { */) return null;
  const slice = source.slice(pos, pos + 40);
  const m = /^\{\s*(?:[:#]?catch)\b(?:\s+([A-Za-z_$][A-Za-z0-9_$]*))?\s*\}/.exec(slice);
  if (m) {
    return { len: m[0].length, ident: m[1] ?? null };
  }
  return null;
}

export function isEndAwaitAt(source: string, pos: number): number {
  if (source.charCodeAt(pos) !== 123 /* { */) return 0;
  const m = /^\{\s*(?:endawait|#endawait|\/await)\s*\}/.exec(source.slice(pos, pos + 20));
  return m ? m[0].length : 0;
}
