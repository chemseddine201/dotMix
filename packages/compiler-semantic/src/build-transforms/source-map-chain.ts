/**
 * @dotmix/compiler-semantic/build-transforms/source-map-chain — Base64 VLQ decoding,
 * mappings encoding/decoding, and source map shifting through sequential text edits.
 */

import { encodeVlq } from "../sourcemap.js";
import type { SourceMapV3 } from "../types.js";

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Int8Array(128).fill(-1);
for (let index = 0; index < BASE64_CHARS.length; index++) {
  BASE64_VALUES[BASE64_CHARS.charCodeAt(index)] = index;
}

export { encodeVlq };

export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface DecodedMapping {
  readonly genCol: number;
  readonly sourceIdx?: number | undefined;
  readonly srcLine?: number | undefined;
  readonly srcCol?: number | undefined;
  readonly nameIdx?: number | undefined;
}

export function decodeVlq(encoded: string, startIndex: number): [number, number] {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let continuation = true;

  while (continuation && index < encoded.length) {
    const charCode = encoded.charCodeAt(index++);
    const digit = charCode < 128 ? (BASE64_VALUES[charCode] ?? -1) : -1;
    if (digit === -1) {
      throw new Error(`Invalid Base64 character in VLQ at index ${index - 1}`);
    }
    continuation = (digit & 32) !== 0;
    const piece = digit & 31;
    result += piece << shift;
    shift += 5;
  }

  const isNegative = (result & 1) === 1;
  const value = isNegative ? -(result >>> 1) : result >>> 1;
  return [value, index];
}

export function decodeMappings(mappings: string): DecodedMapping[][] {
  const lines = mappings.split(";");
  const result: DecodedMapping[][] = [];

  let runningSourceIdx = 0;
  let runningSrcLine = 0;
  let runningSrcCol = 0;
  let runningNameIdx = 0;

  for (const lineText of lines) {
    if (lineText.length === 0) {
      result.push([]);
      continue;
    }

    const segments: DecodedMapping[] = [];
    const rawSegments = lineText.split(",");
    let runningGenCol = 0;

    for (const rawSegment of rawSegments) {
      if (rawSegment.length === 0) continue;

      let parseIndex = 0;
      let genColDelta = 0;
      [genColDelta, parseIndex] = decodeVlq(rawSegment, parseIndex);
      runningGenCol += genColDelta;

      if (parseIndex >= rawSegment.length) {
        segments.push({ genCol: runningGenCol });
        continue;
      }

      let sourceDelta = 0;
      [sourceDelta, parseIndex] = decodeVlq(rawSegment, parseIndex);
      runningSourceIdx += sourceDelta;

      let srcLineDelta = 0;
      [srcLineDelta, parseIndex] = decodeVlq(rawSegment, parseIndex);
      runningSrcLine += srcLineDelta;

      let srcColDelta = 0;
      [srcColDelta, parseIndex] = decodeVlq(rawSegment, parseIndex);
      runningSrcCol += srcColDelta;

      if (parseIndex < rawSegment.length) {
        let nameDelta = 0;
        [nameDelta, parseIndex] = decodeVlq(rawSegment, parseIndex);
        runningNameIdx += nameDelta;
        segments.push({
          genCol: runningGenCol,
          sourceIdx: runningSourceIdx,
          srcLine: runningSrcLine,
          srcCol: runningSrcCol,
          nameIdx: runningNameIdx
        });
      } else {
        segments.push({
          genCol: runningGenCol,
          sourceIdx: runningSourceIdx,
          srcLine: runningSrcLine,
          srcCol: runningSrcCol
        });
      }
    }

    result.push(segments);
  }

  return result;
}

export function encodeMappings(lines: readonly (readonly DecodedMapping[])[]): string {
  const lineStrings: string[] = [];

  let runningSourceIdx = 0;
  let runningSrcLine = 0;
  let runningSrcCol = 0;
  let runningNameIdx = 0;

  for (const segments of lines) {
    if (segments.length === 0) {
      lineStrings.push("");
      continue;
    }

    const segmentStrings: string[] = [];
    let runningGenCol = 0;

    for (const segment of segments) {
      let piece = encodeVlq(segment.genCol - runningGenCol);
      runningGenCol = segment.genCol;

      if (segment.sourceIdx !== undefined) {
        piece += encodeVlq(segment.sourceIdx - runningSourceIdx);
        runningSourceIdx = segment.sourceIdx;

        piece += encodeVlq(segment.srcLine! - runningSrcLine);
        runningSrcLine = segment.srcLine!;

        piece += encodeVlq(segment.srcCol! - runningSrcCol);
        runningSrcCol = segment.srcCol!;

        if (segment.nameIdx !== undefined) {
          piece += encodeVlq(segment.nameIdx - runningNameIdx);
          runningNameIdx = segment.nameIdx;
        }
      }

      segmentStrings.push(piece);
    }

    lineStrings.push(segmentStrings.join(","));
  }

  return lineStrings.join(";");
}

export function applyTextEdits(sourceCode: string, edits: readonly TextEdit[]): string {
  if (edits.length === 0) return sourceCode;
  const sorted = [...edits].sort((left, right) => right.start - left.start);
  let rewritten = sourceCode;
  for (const edit of sorted) {
    rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  }
  return rewritten;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function findLineIndexForOffset(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lineStarts[mid]! <= offset) {
      if (mid === lineStarts.length - 1 || lineStarts[mid + 1]! > offset) {
        return mid;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return 0;
}

export function shiftMapThroughEdits(
  map: SourceMapV3,
  codeBefore: string,
  edits: readonly TextEdit[]
): SourceMapV3 {
  if (edits.length === 0) return map;

  const sortedEdits = [...edits].sort((left, right) => left.start - right.start);
  const codeAfter = applyTextEdits(codeBefore, sortedEdits);

  const lineStartsBefore = computeLineStarts(codeBefore);
  const lineStartsAfter = computeLineStarts(codeAfter);

  const decoded = decodeMappings(map.mappings);
  const keptAtReplacementStart = new Set<number>();

  interface FlatPosition {
    readonly originalGenLine: number;
    readonly genCol: number;
    readonly sourceIdx?: number | undefined;
    readonly srcLine?: number | undefined;
    readonly srcCol?: number | undefined;
    readonly nameIdx?: number | undefined;
    readonly offsetInBefore: number;
  }

  const flatPositions: FlatPosition[] = [];
  for (let lineIndex = 0; lineIndex < decoded.length; lineIndex++) {
    const lineSegments = decoded[lineIndex] ?? [];
    const lineStartOffset = lineStartsBefore[lineIndex] ?? 0;
    for (const segment of lineSegments) {
      flatPositions.push({
        originalGenLine: lineIndex,
        genCol: segment.genCol,
        sourceIdx: segment.sourceIdx,
        srcLine: segment.srcLine,
        srcCol: segment.srcCol,
        nameIdx: segment.nameIdx,
        offsetInBefore: lineStartOffset + segment.genCol
      });
    }
  }

  flatPositions.sort((left, right) => left.offsetInBefore - right.offsetInBefore);

  const shiftedByLine: DecodedMapping[][] = Array.from({ length: lineStartsAfter.length }, () => []);

  for (const pos of flatPositions) {
    let shiftedOffset = pos.offsetInBefore;
    let dropped = false;
    let netDelta = 0;
    let isInside = false;

    for (let editIndex = 0; editIndex < sortedEdits.length; editIndex++) {
      const edit = sortedEdits[editIndex]!;
      const editDelta = edit.text.length - (edit.end - edit.start);

      if (pos.offsetInBefore < edit.start) {
        break;
      }

      if (pos.offsetInBefore >= edit.start && pos.offsetInBefore < edit.end) {
        isInside = true;
        if (!keptAtReplacementStart.has(editIndex)) {
          keptAtReplacementStart.add(editIndex);
          shiftedOffset = edit.start + netDelta;
        } else {
          dropped = true;
        }
        break;
      }

      netDelta += editDelta;
    }

    if (dropped) continue;

    if (!isInside) {
      shiftedOffset = pos.offsetInBefore + netDelta;
    }

    const clampedOffset = Math.max(0, Math.min(codeAfter.length, shiftedOffset));
    const newLineIndex = findLineIndexForOffset(lineStartsAfter, clampedOffset);
    const newColIndex = clampedOffset - lineStartsAfter[newLineIndex]!;

    const shiftedSegment: DecodedMapping = {
      genCol: newColIndex,
      ...(pos.sourceIdx !== undefined ? { sourceIdx: pos.sourceIdx } : {}),
      ...(pos.srcLine !== undefined ? { srcLine: pos.srcLine } : {}),
      ...(pos.srcCol !== undefined ? { srcCol: pos.srcCol } : {}),
      ...(pos.nameIdx !== undefined ? { nameIdx: pos.nameIdx } : {})
    };

    shiftedByLine[newLineIndex]?.push(shiftedSegment);
  }

  for (let lineIdx = 0; lineIdx < shiftedByLine.length; lineIdx++) {
    const segments = shiftedByLine[lineIdx]!;
    segments.sort((left, right) => left.genCol - right.genCol);
    const uniqueSegments: DecodedMapping[] = [];
    let previousCol = -1;
    for (const seg of segments) {
      if (seg.genCol !== previousCol) {
        uniqueSegments.push(seg);
        previousCol = seg.genCol;
      }
    }
    shiftedByLine[lineIdx] = uniqueSegments;
  }

  const newMappings = encodeMappings(shiftedByLine);

  return {
    ...map,
    mappings: newMappings
  };
}
