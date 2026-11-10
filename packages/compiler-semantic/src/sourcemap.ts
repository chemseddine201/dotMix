/**
 * @mix/compiler-semantic/sourcemap — Base64 VLQ SourceMapV3 generation and projected span mapping (R-SP-01..05).
 */

import { deepFreeze, LineMap } from "@mix/ast";
import type { SourceSpan } from "@mix/ast";
import type { SpanEntry, SourceMapV3 } from "./types.js";

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeVlq(value: number): string {
  let vlq = value < 0 ? ((-value) << 1) + 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    encoded += BASE64_CHARS[digit]!;
  } while (vlq > 0);
  return encoded;
}

export function generateSourceMap(
  filename: string,
  originalSource: string,
  generatedSource: string,
  spanTable: readonly SpanEntry[]
): SourceMapV3 {
  const origMap = new LineMap(originalSource, filename);
  const genLines = generatedSource.split("\n");

  let prevGenLine = 0;
  let prevGenCol = 0;
  let prevSrcLine = 0;
  let prevSrcCol = 0;

  const lineSegments: string[][] = Array.from({ length: genLines.length }, () => []);
  const genMap = new LineMap(generatedSource, `${filename}.ts`);

  for (const entry of spanTable) {
    if (entry.kind === "internal" || entry.genStart >= entry.genEnd) {
      continue;
    }
    const genLoc = genMap.locationAt(entry.genStart);
    const srcLoc = origMap.locationAt(entry.srcStart);

    const genLineIdx = genLoc.line - 1;
    const genColIdx = genLoc.column - 1;
    const srcLineIdx = srcLoc.line - 1;
    const srcColIdx = srcLoc.column - 1;

    if (genLineIdx !== prevGenLine) {
      prevGenCol = 0;
      prevGenLine = genLineIdx;
    }

    const seg =
      encodeVlq(genColIdx - prevGenCol) +
      encodeVlq(0) + // source index 0
      encodeVlq(srcLineIdx - prevSrcLine) +
      encodeVlq(srcColIdx - prevSrcCol);

    lineSegments[genLineIdx]?.push(seg);

    prevGenCol = genColIdx;
    prevSrcLine = srcLineIdx;
    prevSrcCol = srcColIdx;
  }

  return deepFreeze({
    version: 3,
    file: `${filename}.ts`,
    sources: [filename],
    names: [],
    mappings: lineSegments.map((segs) => segs.join(",")).join(";")
  });
}

/**
 * R-SP-04: Maps a diagnostic offset and length in the projected `.tix.ts` file back to the original
 * `.tix` source span using `SourceMapSpanTable`.
 */
export function mapProjectedSpanToSource(
  spanTable: readonly SpanEntry[],
  genStart: number,
  genLength: number,
  originalSource: string,
  filename?: string
): { span: SourceSpan; isInternal: boolean } {
  const lineMap = new LineMap(originalSource, filename);
  const genEnd = genStart + Math.max(1, genLength);

  // Find smallest containing or overlapping verbatim/origin entry first
  let bestEntry: SpanEntry | null = null;
  for (const entry of spanTable) {
    if (genStart >= entry.genStart && genStart < entry.genEnd) {
      bestEntry = entry;
      break;
    }
  }

  if (!bestEntry && spanTable.length > 0) {
    bestEntry = spanTable[spanTable.length - 1]!;
  }

  if (!bestEntry || bestEntry.kind === "internal") {
    // Check if the range overlaps a verbatim or origin entry nearby (e.g., object literal span)
    for (const entry of spanTable) {
      if (entry.kind !== "internal" && entry.genStart < genEnd && entry.genEnd > genStart) {
        bestEntry = entry;
        break;
      }
    }
  }

  if (!bestEntry || bestEntry.kind === "internal") {
    return {
      span: lineMap.span(0, Math.min(originalSource.length, 1)),
      isInternal: true
    };
  }

  if (bestEntry.kind === "verbatim") {
    const delta = Math.max(0, genStart - bestEntry.genStart);
    const srcStart = Math.min(bestEntry.srcEnd, bestEntry.srcStart + delta);
    const srcEnd = Math.min(bestEntry.srcEnd, srcStart + Math.max(1, genLength));
    return {
      span: lineMap.span(srcStart, srcEnd),
      isInternal: false
    };
  }

  return {
    span: lineMap.span(bestEntry.srcStart, bestEntry.srcEnd),
    isInternal: false
  };
}
