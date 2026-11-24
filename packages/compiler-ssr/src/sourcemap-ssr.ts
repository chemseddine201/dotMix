/**
 * @dotmix/compiler-ssr/sourcemap-ssr — Exact script & template SourceMapV3 builder for SSR codegen (G1).
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

export interface SsrExprAnchor {
  readonly raw: string;
  readonly emitted: string;
  readonly srcOffset: number;
}

export const SSR_MARK_START = "\uE000";
export const SSR_MARK_MID = "\uE001";
export const SSR_MARK_END = "\uE002";

interface ResolvedSsrSpan {
  readonly genStart: number;
  readonly genEnd: number;
  readonly anchor: SsrExprAnchor;
}

function stripSsrAnchors(
  marked: string,
  anchors: readonly SsrExprAnchor[]
): { readonly code: string; readonly spans: readonly ResolvedSsrSpan[] } {
  if (anchors.length === 0 || !marked.includes(SSR_MARK_START)) {
    return { code: marked, spans: [] };
  }
  const out: string[] = [];
  const spans: ResolvedSsrSpan[] = [];
  const stack: Array<{ readonly anchor: SsrExprAnchor; readonly genStart: number }> = [];
  let cleanLen = 0;
  let i = 0;
  while (i < marked.length) {
    const ch = marked[i]!;
    if (ch === SSR_MARK_START) {
      const mid = marked.indexOf(SSR_MARK_MID, i + 1);
      if (mid !== -1) {
        const id = Number.parseInt(marked.slice(i + 1, mid), 10);
        const anchor = anchors[id];
        if (anchor) {
          stack.push({ anchor, genStart: cleanLen });
          i = mid + 1;
          continue;
        }
      }
    } else if (ch === SSR_MARK_END && stack.length > 0) {
      const top = stack.pop()!;
      spans.push({ genStart: top.genStart, genEnd: cleanLen, anchor: top.anchor });
      i++;
      continue;
    }
    let next = marked.length;
    const ns = marked.indexOf(SSR_MARK_START, i + 1);
    const ne = marked.indexOf(SSR_MARK_END, i + 1);
    if (ns !== -1 && ns < next) next = ns;
    if (ne !== -1 && ne < next) next = ne;
    const slice = marked.slice(i, next);
    out.push(slice);
    cleanLen += slice.length;
    i = next;
  }
  return { code: out.join(""), spans };
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function mapScriptOffset(script: ScriptBlockNode, offset: number): number {
  if (script.sourceSegments && script.sourceSegments.length > 0) {
    for (const seg of script.sourceSegments) {
      if (offset >= seg.contentStart && offset <= seg.contentEnd) {
        return seg.sourceOffset + (offset - seg.contentStart);
      }
    }
  }
  return script.contentSpan.start.offset + offset;
}

export function buildSsrSourceMap(input: {
  readonly filename: string;
  readonly originalSource: string;
  readonly markedCode: string;
  readonly script: ScriptBlockNode | null;
  readonly bodyMappings?: readonly (readonly ScriptLineMapping[])[];
  readonly bodyStartLine: number;
  readonly exprAnchors: readonly SsrExprAnchor[];
}): { readonly code: string; readonly map: SourceMapV3 } {
  const { filename, originalSource, script } = input;
  const stripped = stripSsrAnchors(input.markedCode, input.exprAnchors);
  const code = stripped.code;
  const genLines = code.split("\n");
  const lineSegments: DecodedMapping[][] = Array.from({ length: genLines.length }, () => []);

  if (originalSource) {
    const origMap = new LineMap(originalSource, filename);

    if (script && input.bodyMappings && input.bodyStartLine >= 0) {
      const contentStarts = computeLineStarts(script.content);
      for (let i = 0; i < input.bodyMappings.length; i++) {
        const gLine = input.bodyStartLine + i;
        if (gLine >= lineSegments.length) break;
        for (const seg of input.bodyMappings[i]!) {
          const ls = contentStarts[seg.srcLine];
          if (ls === undefined) continue;
          const fileOff = mapScriptOffset(script, Math.min(script.content.length, ls + seg.srcCol));
          const loc = origMap.locationAt(fileOff);
          lineSegments[gLine]!.push({ genCol: seg.genCol, sourceIdx: 0, srcLine: loc.line - 1, srcCol: loc.column - 1 });
        }
      }
    }

    if (stripped.spans.length > 0) {
      const genMap = new LineMap(code, `${filename}.ssr.js`);
      for (const span of stripped.spans) {
        const emitted = code.slice(span.genStart, span.genEnd);
        if (!emitted) continue;
        const gLoc = genMap.locationAt(span.genStart);
        const sLoc = origMap.locationAt(Math.min(originalSource.length, span.anchor.srcOffset));
        const gLineIdx = gLoc.line - 1;
        const baseGenCol = gLoc.column - 1;
        const segs = lineSegments[gLineIdx];
        if (!segs) continue;
        segs.push({ genCol: baseGenCol, sourceIdx: 0, srcLine: sLoc.line - 1, srcCol: sLoc.column - 1 });
        const scanner = ts.createScanner(ts.ScriptTarget.ES2023, true, ts.LanguageVariant.Standard, emitted);
        let tok = scanner.scan();
        while (tok !== ts.SyntaxKind.EndOfFileToken) {
          segs.push({ genCol: baseGenCol + scanner.getTokenPos(), sourceIdx: 0, srcLine: sLoc.line - 1, srcCol: sLoc.column - 1 });
          tok = scanner.scan();
        }
      }
    }

    for (let i = 0; i < lineSegments.length; i++) {
      const segs = lineSegments[i]!;
      if (segs.length <= 1) continue;
      segs.sort((a, b) => a.genCol - b.genCol);
      const unique: DecodedMapping[] = [];
      let prev = -1;
      for (const s of segs) {
        if (s.genCol !== prev) { unique.push(s); prev = s.genCol; }
      }
      lineSegments[i] = unique;
    }
  }

  const norm = filename.replace(/\\/g, "/");
  const relFile = norm.includes("/src/") ? "src/" + norm.split("/src/")[1] : (norm.split("/").pop() ?? norm);
  return {
    code,
    map: deepFreeze({
      version: 3,
      file: relFile.endsWith(".js") ? relFile : `${relFile}.js`,
      sources: [relFile],
      ...(originalSource ? { sourcesContent: [originalSource] } : {}),
      names: [],
      mappings: encodeMappings(lineSegments)
    })
  };
}

