/**
 * @mix/ast/spans — Source locations, spans, deepFreeze, and canonical LineMap.
 */

import { MixError, DiagnosticCodes } from "@mix/diagnostics";
import type { SourceLocation, SourceSpan } from "@mix/diagnostics";

export type { SourceLocation, SourceSpan } from "@mix/diagnostics";

export function validateSpan(span: SourceSpan): SourceSpan {
  if (
    span.start.offset < 0 ||
    span.end.offset < span.start.offset ||
    span.start.line < 1 ||
    span.start.column < 1 ||
    span.end.line < span.start.line ||
    (span.end.line === span.start.line && span.end.column < span.start.column)
  ) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      `Invalid SourceSpan [${span.start.line}:${span.start.column} (${span.start.offset}) -> ${span.end.line}:${span.end.column} (${span.end.offset})]`
    );
  }
  return span;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      deepFreeze(value[i]);
    }
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function createSpan(
  start: SourceLocation,
  end: SourceLocation,
  file?: string
): SourceSpan {
  const span: SourceSpan =
    file !== undefined
      ? { start: { ...start }, end: { ...end }, file }
      : { start: { ...start }, end: { ...end } };
  validateSpan(span);
  return deepFreeze(span);
}

/**
 * Canonical 1-based line/column and 0-based byte offset lookup table.
 * Shared across @mix/compiler-frontend, @mix/compiler-semantic, and @mix/language-server.
 */
export class LineMap {
  private readonly lineStarts: number[];
  readonly source: string;
  readonly filename: string | undefined;

  constructor(source: string, filename?: string) {
    this.source = source;
    this.filename = filename;
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10 /* \n */) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  locationAt(offset: number): SourceLocation {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const lineStart = this.lineStarts[mid]!;
      if (lineStart <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const lineIndex = Math.max(0, high);
    const lineStartOffset = this.lineStarts[lineIndex]!;
    return Object.freeze({
      line: lineIndex + 1,
      column: clamped - lineStartOffset + 1,
      offset: clamped
    });
  }

  span(startOffset: number, endOffset: number): SourceSpan {
    return createSpan(
      this.locationAt(startOffset),
      this.locationAt(Math.max(startOffset, endOffset)),
      this.filename
    );
  }
}

