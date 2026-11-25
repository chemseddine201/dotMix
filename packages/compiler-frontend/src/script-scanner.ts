/**
 * @dotmix/compiler-frontend/script-scanner — TypeScript-accurate lexical scanner for
 * `.mix` / `.tix` script sections without regex heuristics (D-190 B3 & B4).
 *
 * Distinguishes regex literals from division by the previous significant token,
 * handles nested template literal `${...}` expressions, strings, and comments
 * (including comments containing quotes or brackets).
 */

import { isAsciiWhitespace } from "./types.js";

export type ScriptTokenKind =
  | "ident"
  | "number"
  | "string"
  | "template"
  | "regex"
  | "punct"
  | "eof";

export interface ScriptToken {
  readonly kind: ScriptTokenKind;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "return",
  "throw",
  "case",
  "delete",
  "void",
  "typeof",
  "yield",
  "await",
  "in",
  "instanceof",
  "of",
  "new",
  "else",
  "do",
  "export",
  "default"
]);

const PAREN_HEADER_KEYWORDS = new Set(["if", "while", "for", "with"]);

function isIdentStart(ch: number): boolean {
  return (
    (ch >= 65 && ch <= 90) ||
    (ch >= 97 && ch <= 122) ||
    ch === 95 ||
    ch === 36 ||
    ch >= 0x80
  );
}

function isIdentPart(ch: number): boolean {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57);
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57;
}

export class ScriptLexicalScanner {
  readonly source: string;
  pos: number;
  braceDepth: number = 0;
  parenDepth: number = 0;
  bracketDepth: number = 0;
  private regexAllowed: boolean = true;
  private readonly templateBraceStack: number[] = [];
  private readonly parenIsHeaderStack: boolean[] = [];
  private lastKeyword: string = "";

  constructor(source: string, startPos = 0, initialBraceDepth = 0) {
    this.source = source;
    this.pos = startPos;
    this.braceDepth = initialBraceDepth;
  }

  private skipWhitespaceAndComments(): void {
    const src = this.source;
    const len = src.length;
    while (this.pos < len) {
      const ch = src.charCodeAt(this.pos);
      if (isAsciiWhitespace(ch)) {
        this.pos++;
        continue;
      }
      if (ch === 47 /* / */ && this.pos + 1 < len) {
        const next = src.charCodeAt(this.pos + 1);
        if (next === 47 /* / */) {
          this.pos += 2;
          while (this.pos < len && src.charCodeAt(this.pos) !== 10 /* \n */) {
            this.pos++;
          }
          continue;
        }
        if (next === 42 /* * */) {
          this.pos += 2;
          while (this.pos + 1 < len) {
            if (src.charCodeAt(this.pos) === 42 && src.charCodeAt(this.pos + 1) === 47) {
              this.pos += 2;
              break;
            }
            this.pos++;
          }
          if (this.pos + 1 === len) this.pos = len;
          continue;
        }
      }
      break;
    }
  }

  private scanString(quoteCode: number): ScriptToken {
    const start = this.pos;
    const src = this.source;
    const len = src.length;
    this.pos++;
    while (this.pos < len) {
      const ch = src.charCodeAt(this.pos);
      if (ch === 92 /* \ */) {
        this.pos = Math.min(len, this.pos + 2);
        continue;
      }
      if (ch === quoteCode) {
        this.pos++;
        break;
      }
      this.pos++;
    }
    this.regexAllowed = false;
    this.lastKeyword = "";
    return { kind: "string", value: src.slice(start, this.pos), start, end: this.pos };
  }

  private scanTemplateChunk(): ScriptToken {
    const start = this.pos;
    const src = this.source;
    const len = src.length;
    this.pos++; // skip '`' or '}'
    while (this.pos < len) {
      const ch = src.charCodeAt(this.pos);
      if (ch === 92 /* \ */) {
        this.pos = Math.min(len, this.pos + 2);
        continue;
      }
      if (ch === 96 /* ` */) {
        this.pos++;
        this.regexAllowed = false;
        this.lastKeyword = "";
        return { kind: "template", value: src.slice(start, this.pos), start, end: this.pos };
      }
      if (ch === 36 /* $ */ && this.pos + 1 < len && src.charCodeAt(this.pos + 1) === 123 /* { */) {
        this.templateBraceStack.push(this.braceDepth);
        this.braceDepth++;
        this.pos += 2;
        this.regexAllowed = true;
        this.lastKeyword = "";
        return { kind: "template", value: src.slice(start, this.pos), start, end: this.pos };
      }
      this.pos++;
    }
    this.regexAllowed = false;
    this.lastKeyword = "";
    return { kind: "template", value: src.slice(start, this.pos), start, end: this.pos };
  }

  private scanRegex(): ScriptToken {
    const start = this.pos;
    const src = this.source;
    const len = src.length;
    this.pos++; // skip opening '/'
    let inCharClass = false;
    while (this.pos < len) {
      const ch = src.charCodeAt(this.pos);
      if (ch === 92 /* \ */) {
        this.pos = Math.min(len, this.pos + 2);
        continue;
      }
      if (ch === 91 /* [ */) {
        inCharClass = true;
        this.pos++;
        continue;
      }
      if (ch === 93 /* ] */) {
        inCharClass = false;
        this.pos++;
        continue;
      }
      if (ch === 47 /* / */ && !inCharClass) {
        this.pos++;
        while (this.pos < len && isIdentPart(src.charCodeAt(this.pos))) {
          this.pos++;
        }
        break;
      }
      if (ch === 10 || ch === 13) {
        break;
      }
      this.pos++;
    }
    this.regexAllowed = false;
    this.lastKeyword = "";
    return { kind: "regex", value: src.slice(start, this.pos), start, end: this.pos };
  }

  nextToken(): ScriptToken {
    this.skipWhitespaceAndComments();
    const src = this.source;
    const len = src.length;
    if (this.pos >= len) {
      return { kind: "eof", value: "", start: len, end: len };
    }

    const start = this.pos;
    const ch = src.charCodeAt(start);

    if (ch === 39 /* ' */ || ch === 34 /* " */) {
      return this.scanString(ch);
    }
    if (ch === 96 /* ` */) {
      return this.scanTemplateChunk();
    }

    if (ch === 47 /* / */) {
      if (this.regexAllowed) {
        return this.scanRegex();
      }
      if (start + 1 < len && src.charCodeAt(start + 1) === 61 /* = */) {
        this.pos += 2;
        this.regexAllowed = true;
        this.lastKeyword = "";
        return { kind: "punct", value: "/=", start, end: this.pos };
      }
      this.pos++;
      this.regexAllowed = true;
      this.lastKeyword = "";
      return { kind: "punct", value: "/", start, end: this.pos };
    }

    if (isIdentStart(ch)) {
      this.pos++;
      while (this.pos < len && isIdentPart(src.charCodeAt(this.pos))) {
        this.pos++;
      }
      const value = src.slice(start, this.pos);
      this.regexAllowed = REGEX_PREFIX_KEYWORDS.has(value);
      this.lastKeyword = value;
      return { kind: "ident", value, start, end: this.pos };
    }

    if (isDigit(ch) || (ch === 46 /* . */ && start + 1 < len && isDigit(src.charCodeAt(start + 1)))) {
      this.pos++;
      while (this.pos < len) {
        const c = src.charCodeAt(this.pos);
        if (isIdentPart(c) || c === 46 /* . */) {
          this.pos++;
        } else if (
          (c === 43 || c === 45) &&
          (src.charCodeAt(this.pos - 1) === 101 || src.charCodeAt(this.pos - 1) === 69)
        ) {
          this.pos++;
        } else {
          break;
        }
      }
      this.regexAllowed = false;
      this.lastKeyword = "";
      return { kind: "number", value: src.slice(start, this.pos), start, end: this.pos };
    }

    if (
      ch === 125 /* } */ &&
      this.templateBraceStack.length > 0 &&
      this.templateBraceStack[this.templateBraceStack.length - 1] === this.braceDepth - 1
    ) {
      this.templateBraceStack.pop();
      this.braceDepth--;
      return this.scanTemplateChunk();
    }

    const two = src.slice(start, start + 2);
    const three = src.slice(start, start + 3);
    if (
      three === "===" || three === "!==" || three === ">>>" || three === "..." ||
      three === "&&=" || three === "||=" || three === "??=" || three === "**="
    ) {
      this.pos += 3;
      this.regexAllowed = true;
      this.lastKeyword = "";
      return { kind: "punct", value: three, start, end: this.pos };
    }
    if (two === "++" || two === "--") {
      this.pos += 2;
      this.lastKeyword = "";
      return { kind: "punct", value: two, start, end: this.pos };
    }
    if (
      two === "=>" || two === "==" || two === "!=" || two === "<=" || two === ">=" ||
      two === "&&" || two === "||" || two === "??" || two === "+=" || two === "-=" ||
      two === "*=" || two === "%=" || two === "&=" || two === "|=" || two === "^=" ||
      two === "<<" || two === ">>" || two === "**" || two === "?."
    ) {
      this.pos += 2;
      this.regexAllowed = two !== "?.";
      this.lastKeyword = "";
      return { kind: "punct", value: two, start, end: this.pos };
    }

    this.pos++;
    const value = src[start]!;
    if (value === "{") {
      this.braceDepth++;
      this.regexAllowed = true;
    } else if (value === "}") {
      this.braceDepth = Math.max(0, this.braceDepth - 1);
      this.regexAllowed = true;
    } else if (value === "(") {
      this.parenDepth++;
      this.parenIsHeaderStack.push(PAREN_HEADER_KEYWORDS.has(this.lastKeyword));
      this.regexAllowed = true;
    } else if (value === ")") {
      this.parenDepth = Math.max(0, this.parenDepth - 1);
      const closedHeader = this.parenIsHeaderStack.pop() ?? false;
      this.regexAllowed = closedHeader;
    } else if (value === "[") {
      this.bracketDepth++;
      this.regexAllowed = true;
    } else if (value === "]") {
      this.bracketDepth = Math.max(0, this.bracketDepth - 1);
      this.regexAllowed = false;
    } else {
      this.regexAllowed = value !== ".";
    }
    this.lastKeyword = "";
    return { kind: "punct", value, start, end: this.pos };
  }
}

/**
 * Removes JS comments from a parameter list slice without altering string, template, or regex literals.
 */
export function stripCommentsPreservingLiterals(slice: string): string {
  const scanner = new ScriptLexicalScanner(slice, 0, 0);
  const parts: string[] = [];
  let prevEnd = 0;
  let tok = scanner.nextToken();
  while (tok.kind !== "eof") {
    if (tok.start > prevEnd && parts.length > 0) {
      parts.push(" ");
    }
    parts.push(slice.slice(tok.start, tok.end));
    prevEnd = tok.end;
    tok = scanner.nextToken();
  }
  return parts.join("").trim();
}
