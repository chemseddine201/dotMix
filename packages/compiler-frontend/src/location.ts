/**
 * @mix/compiler-frontend/location — 1-based line/column and 0-based offset tracking.
 */

import { createSpan } from "@mix/ast";
import type { SourceLocation, SourceSpan } from "@mix/ast";

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
