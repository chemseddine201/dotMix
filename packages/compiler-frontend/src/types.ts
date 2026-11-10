/**
 * @mix/compiler-frontend/types — Shared parser interfaces, options, and character/diagnostic helpers.
 */

import type {
  ScriptBlockNode,
  StyleBlockNode,
  TemplateNode
} from "@mix/ast";
import { MixDiagnosticError, DiagnosticCodes } from "@mix/diagnostics";
import type { LineMap } from "./location.js";

export interface ParseOptions {
  filename?: string;
  readFile?: (path: string) => string;
}

export interface ExtractedSections {
  script: ScriptBlockNode | null;
  style: StyleBlockNode | null;
  templateBuffer: string;
}

export interface ParserContext {
  readonly source: string;
  readonly lineMap: LineMap;
  pos: number;
  skipWhitespace(): void;
  parseChildren(shouldStop: () => boolean): TemplateNode[];
  parseElementOrComponent(): TemplateNode;
  parseDollarDynamicElement(): TemplateNode;
}

export function failSyntax(
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

export function isAsciiWhitespace(ch: number): boolean {
  return ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 12;
}

export function isTagNameStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
}

export function isTagNameChar(ch: number): boolean {
  return (
    isTagNameStart(ch) ||
    (ch >= 48 && ch <= 57) ||
    ch === 45 /* - */ ||
    ch === 95 /* _ */ ||
    ch === 58 /* : */
  );
}

export function isPascalCaseComponent(tagName: string): boolean {
  const first = tagName.charCodeAt(0);
  return first >= 65 && first <= 90;
}

export function blankRangePreservingNewlines(buffer: string[], start: number, end: number): void {
  for (let i = start; i < end; i++) {
    if (buffer[i] !== "\n" && buffer[i] !== "\r") {
      buffer[i] = " ";
    }
  }
}
