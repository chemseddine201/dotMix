/**
 * @dotmix/compiler-codegen/source-map-builder — Exact script & template SourceMapV3 construction (F1, G1).
 */

import * as ts from "typescript";
import { deepFreeze, LineMap } from "@dotmix/ast";
import type { ScriptBlockNode } from "@dotmix/ast";
import {
  encodeMappings,
  type DecodedMapping,
  type ScriptLineMapping,
  type SourceMapV3
} from "@dotmix/compiler-semantic";
import {
  EXPR_MARK_END,
  EXPR_MARK_MID,
  EXPR_MARK_START,
  type EmittedExprAnchor
} from "./context.js";

export interface ComponentSourceMapInput {
  readonly filename: string;
  readonly originalSource: string;
  readonly jsCode: string;
  readonly script: ScriptBlockNode | null;
  readonly bodyMappings?: readonly (readonly ScriptLineMapping[])[];
  readonly bodyStartLine: number;
  readonly bodyIndent: number;
  readonly postambleMappings?: readonly (readonly ScriptLineMapping[])[];
  readonly postambleStartLine: number;
  readonly exprAnchors?: readonly EmittedExprAnchor[];
}

interface ResolvedExprSpan {
  readonly genStart: number;
  readonly genEnd: number;
  readonly anchor: EmittedExprAnchor;
}

function stripExprAnchors(
  marked: string,
  anchors: readonly EmittedExprAnchor[]
): { readonly code: string; readonly spans: readonly ResolvedExprSpan[] } {
  if (anchors.length === 0 || !marked.includes(EXPR_MARK_START)) {
    return { code: marked, spans: [] };
  }
  const out: string[] = [];
  const spans: ResolvedExprSpan[] = [];
  const stack: Array<{ readonly anchor: EmittedExprAnchor; readonly genStart: number }> = [];
  let cleanLen = 0;
  let i = 0;

  while (i < marked.length) {
    const ch = marked[i]!;
    if (ch === EXPR_MARK_START) {
      const mid = marked.indexOf(EXPR_MARK_MID, i + 1);
      if (mid !== -1) {
        const id = Number.parseInt(marked.slice(i + 1, mid), 10);
        const anchor = anchors[id];
        if (anchor) {
          stack.push({ anchor, genStart: cleanLen });
          i = mid + 1;
          continue;
        }
      }
    } else if (ch === EXPR_MARK_END && stack.length > 0) {
      const top = stack.pop()!;
      spans.push({ genStart: top.genStart, genEnd: cleanLen, anchor: top.anchor });
      i++;
      continue;
    }
    let next = marked.length;
    const nextStart = marked.indexOf(EXPR_MARK_START, i + 1);
    const nextEnd = marked.indexOf(EXPR_MARK_END, i + 1);
    if (nextStart !== -1 && nextStart < next) next = nextStart;
    if (nextEnd !== -1 && nextEnd < next) next = nextEnd;
    const slice = marked.slice(i, next);
    out.push(slice);
    cleanLen += slice.length;
    i = next;
  }

  return { code: out.join(""), spans };
}

function mapScriptOffsetToFileOffset(
  script: ScriptBlockNode,
  offsetInContent: number
): number {
  if (script.sourceSegments && script.sourceSegments.length > 0) {
    for (const seg of script.sourceSegments) {
      if (offsetInContent >= seg.contentStart && offsetInContent <= seg.contentEnd) {
        return seg.sourceOffset + (offsetInContent - seg.contentStart);
      }
    }
  }
  return script.contentSpan.start.offset + offsetInContent;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function toRelativeFileLabel(filename: string): string {
  const norm = filename.replace(/\\/g, "/");
  if (norm.includes("/src/")) return "src/" + norm.split("/src/")[1];
  const base = norm.split("/").pop() ?? norm;
  return base;
}

export function buildComponentSourceMap(
  input: ComponentSourceMapInput
): { readonly code: string; readonly map: SourceMapV3 } {
  const { filename, originalSource, script } = input;
  const stripped = stripExprAnchors(input.jsCode, input.exprAnchors ?? []);
  const jsCode = stripped.code;
  const genLines = jsCode.split("\n");
  const lineSegments: DecodedMapping[][] = Array.from({ length: genLines.length }, () => []);

  if (originalSource) {
    const origMap = new LineMap(originalSource, filename);

    // 1. Exact line & column mappings for script body (TS and JS)
    if (script && input.bodyMappings && input.bodyStartLine >= 0) {
      const contentLineStarts = computeLineStarts(script.content);
      for (let i = 0; i < input.bodyMappings.length; i++) {
        const genLineIdx = input.bodyStartLine + i;
        if (genLineIdx >= lineSegments.length) break;
        const genLineText = genLines[genLineIdx] ?? "";
        const indentPad = genLineText.trim().length > 0 ? input.bodyIndent : 0;
        for (const seg of input.bodyMappings[i]!) {
          const lineStart = contentLineStarts[seg.srcLine];
          if (lineStart === undefined) continue;
          const offsetInContent = Math.min(script.content.length, lineStart + seg.srcCol);
          const fileOffset = mapScriptOffsetToFileOffset(script, offsetInContent);
          const origLoc = origMap.locationAt(fileOffset);
          lineSegments[genLineIdx]!.push({
            genCol: seg.genCol + indentPad,
            sourceIdx: 0,
            srcLine: origLoc.line - 1,
            srcCol: origLoc.column - 1
          });
        }
      }
    }

    // 2. Exact line & column mappings for script postamble (if present)
    if (script && script.postamble && input.postambleMappings && input.postambleStartLine >= 0) {
      const postLineStarts = computeLineStarts(script.postamble);
      const baseOffset = script.postambleStartOffset ?? script.span.end.offset;
      for (let i = 0; i < input.postambleMappings.length; i++) {
        const genLineIdx = input.postambleStartLine + i;
        if (genLineIdx >= lineSegments.length) break;
        for (const seg of input.postambleMappings[i]!) {
          const lineStart = postLineStarts[seg.srcLine];
          if (lineStart === undefined) continue;
          const fileOffset = Math.min(originalSource.length, baseOffset + lineStart + seg.srcCol);
          const origLoc = origMap.locationAt(fileOffset);
          lineSegments[genLineIdx]!.push({
            genCol: seg.genCol,
            sourceIdx: 0,
            srcLine: origLoc.line - 1,
            srcCol: origLoc.column - 1
          });
        }
      }
    }

    // 3. Exact anchored mappings for every emitted template expression (G1)
    if (stripped.spans.length > 0) {
      const genMap = new LineMap(jsCode, `${filename}.js`);
      for (const span of stripped.spans) {
        const emittedSlice = jsCode.slice(span.genStart, span.genEnd);
        if (!emittedSlice) continue;
        const startGenLoc = genMap.locationAt(span.genStart);
        const origStartLoc = origMap.locationAt(Math.min(originalSource.length, span.anchor.srcOffset));
        const rawLines = span.anchor.raw.split(/\r?\n/);
        const genSliceLines = emittedSlice.split("\n");

        if (genSliceLines.length === 1) {
          const gLineIdx = startGenLoc.line - 1;
          const baseGenCol = startGenLoc.column - 1;
          const lineSegs = lineSegments[gLineIdx];
          if (!lineSegs) continue;
          // Map start of generated expression and every token within it
          lineSegs.push({
            genCol: baseGenCol,
            sourceIdx: 0,
            srcLine: origStartLoc.line - 1,
            srcCol: origStartLoc.column - 1
          });
          const scanner = ts.createScanner(ts.ScriptTarget.ES2023, true, ts.LanguageVariant.Standard, emittedSlice);
          let tok = scanner.scan();
          while (tok !== ts.SyntaxKind.EndOfFileToken) {
            const tokPos = scanner.getTokenPos();
            lineSegs.push({
              genCol: baseGenCol + tokPos,
              sourceIdx: 0,
              srcLine: origStartLoc.line - 1,
              srcCol: origStartLoc.column - 1
            });
            tok = scanner.scan();
          }
        } else {
          // Multi-line template expression (e.g., multi-line inline arrow handler)
          for (let k = 0; k < genSliceLines.length; k++) {
            const gLineIdx = startGenLoc.line - 1 + k;
            const gText = genSliceLines[k] ?? "";
            const lineSegs = lineSegments[gLineIdx];
            if (!lineSegs || gText.trim().length === 0) continue;
            const genCol = k === 0 ? startGenLoc.column - 1 : Math.max(0, gText.search(/\S/));
            const rawLineIdx = Math.min(k, rawLines.length - 1);
            const rawLineText = rawLines[rawLineIdx] ?? "";
            const origLine = origStartLoc.line - 1 + rawLineIdx;
            const origCol = rawLineIdx === 0 ? origStartLoc.column - 1 : Math.max(0, rawLineText.search(/\S/));
            lineSegs.push({ genCol, sourceIdx: 0, srcLine: origLine, srcCol: origCol });
          }
        }
      }
    }

    // Sort & deduplicate segments per generated line
    for (let i = 0; i < lineSegments.length; i++) {
      const segs = lineSegments[i]!;
      if (segs.length <= 1) continue;
      segs.sort((a, b) => a.genCol - b.genCol);
      const unique: DecodedMapping[] = [];
      let prevCol = -1;
      for (const s of segs) {
        if (s.genCol !== prevCol) {
          unique.push(s);
          prevCol = s.genCol;
        }
      }
      lineSegments[i] = unique;
    }
  }

  const relFile = toRelativeFileLabel(filename);
  const emittedFile = relFile.endsWith(".js") ? relFile : `${relFile}.js`;
  return {
    code: jsCode,
    map: deepFreeze({
      version: 3,
      file: emittedFile,
      sources: [relFile],
      ...(originalSource ? { sourcesContent: [originalSource] } : {}),
      names: [],
      mappings: encodeMappings(lineSegments)
    })
  };
}
