/**
 * @dotmix/cli/dev-errors — Dev server endpoints for source-mapped code frames (`/__mix/frame`)
 * and editor launching (`/__mix/open-in-editor`) per D-189 E1.
 */

import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import { spawn } from "node:child_process";
import type { URL } from "node:url";
import type { SourceMapV3 } from "@dotmix/compiler-semantic";
import { normalizeDriveLetter } from "./normalize-path.js";

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let idx = 0;
  while (idx < segment.length) {
    let result = 0;
    let shift = 0;
    let cont = true;
    while (cont && idx < segment.length) {
      const code = segment.charCodeAt(idx++);
      const digit = code < 128 ? B64_LOOKUP[code]! : -1;
      if (digit === -1) return values;
      cont = (digit & 32) !== 0;
      result += (digit & 31) << shift;
      shift += 5;
    }
    const isNeg = (result & 1) === 1;
    const magnitude = result >> 1;
    values.push(isNeg ? -magnitude : magnitude);
  }
  return values;
}

/**
 * Decodes a SourceMapV3 `mappings` string to locate the closest original (1-based) line & column
 * on the EXACT generated (1-based) line. Returns `null` if the exact generated line has no mapped segments.
 */
export function decodeSourceMapPosition(
  map: SourceMapV3,
  genLine: number,
  genCol: number
): { line: number; column: number } | null {
  if (!map.mappings || genLine < 1) return null;
  const groups = map.mappings.split(";");
  const targetLineIdx = genLine - 1;
  if (targetLineIdx >= groups.length) return null;
  const targetColIdx = Math.max(0, genCol - 1);

  let origSource = 0;
  let origLine = 0;
  let origCol = 0;
  let bestMatch: { line: number; column: number; dist: number; genCol: number } | null = null;

  for (let lineIdx = 0; lineIdx <= targetLineIdx; lineIdx++) {
    const group = groups[lineIdx]!;
    if (!group) continue;
    let currentGenCol = 0;
    const segments = group.split(",");
    for (const seg of segments) {
      if (!seg) continue;
      const fields = decodeVlqSegment(seg);
      if (fields.length < 1) continue;
      currentGenCol += fields[0]!;
      if (fields.length >= 4) {
        origSource += fields[1]!;
        origLine += fields[2]!;
        origCol += fields[3]!;
        void origSource;
        if (lineIdx === targetLineIdx) {
          const dist = Math.abs(currentGenCol - targetColIdx);
          const candidate = { line: origLine + 1, column: origCol + 1, dist, genCol: currentGenCol };
          if (
            !bestMatch ||
            dist < bestMatch.dist ||
            (dist === bestMatch.dist && currentGenCol <= targetColIdx && bestMatch.genCol > targetColIdx)
          ) {
            bestMatch = candidate;
          }
        }
      }
    }
  }

  return bestMatch ? { line: bestMatch.line, column: bestMatch.column } : null;
}

type SafeFileResult =
  | { readonly status: "ok"; readonly absPath: string; readonly relPath: string }
  | { readonly status: "forbidden" }
  | { readonly status: "not_found" };

function resolveSafeProjectFile(rootDir: string, rawFile: string): SafeFileResult {
  if (!rawFile) return { status: "not_found" };
  let cleaned = rawFile.split("?")[0]!.replace(/\\/g, "/");
  cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
  cleaned = cleaned.replace(/^\/+/, "");
  const normRoot = normalizeDriveLetter(path.resolve(rootDir));
  const candidate = normalizeDriveLetter(path.resolve(normRoot, cleaned));
  const rel = path.relative(normRoot, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { status: "forbidden" };
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return { status: "not_found" };
  }
  return { status: "ok", absPath: candidate, relPath: rel.split(path.sep).join("/") };
}

export interface CodeFrameLine {
  readonly num: number;
  readonly text: string;
  readonly active: boolean;
}

export interface CodeFrameResponse {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly lines: readonly CodeFrameLine[];
}

export function buildSourceCodeFrame(
  filePath: string,
  relPath: string,
  line: number,
  column: number,
  totalWindow: number = 7
): CodeFrameResponse {
  const raw = fs.readFileSync(filePath, "utf-8");
  const allLines = raw.split(/\r?\n/);
  const clampedLine = Math.max(1, Math.min(allLines.length, line));
  const half = Math.floor(totalWindow / 2);
  let start = Math.max(1, clampedLine - half);
  const end = Math.min(allLines.length, start + totalWindow - 1);
  if (end - start + 1 < totalWindow) {
    start = Math.max(1, end - totalWindow + 1);
  }
  const lines: CodeFrameLine[] = [];
  for (let ln = start; ln <= end; ln++) {
    lines.push({
      num: ln,
      text: allLines[ln - 1] ?? "",
      active: ln === clampedLine
    });
  }
  return { file: relPath, line: clampedLine, column: Math.max(1, column), lines };
}

function launchEditor(editorSetting: string | undefined, absPath: string, line: number, col: number): { editor: string; target: string } {
  const editorCmd = (
    editorSetting ||
    process.env.MIX_EDITOR ||
    process.env.VISUAL ||
    process.env.EDITOR ||
    "code"
  ).trim();
  const parts = editorCmd.split(/\s+/).filter(Boolean);
  const bin = parts[0] || "code";
  const extraArgs = parts.slice(1);
  const baseName = path.basename(bin).toLowerCase().replace(/\.(cmd|exe|bat)$/i, "");
  const target = `${absPath}:${line}:${col}`;

  let args: string[];
  if (baseName === "code" || baseName === "code-insiders" || baseName === "cursor" || baseName === "codium") {
    args = [...extraArgs, "-g", target];
  } else if (baseName === "vim" || baseName === "nvim" || baseName === "nano") {
    args = [...extraArgs, `+${line}`, absPath];
  } else {
    args = [...extraArgs, target];
  }

  try {
    const child = spawn(bin, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: process.platform === "win32" && (baseName === "code" || baseName === "code-insiders" || baseName === "cursor")
    });
    child.on("error", () => { /* Ignore missing editor binary */ });
    child.unref();
  } catch {
    // Ignore spawn failure when editor is unavailable
  }
  return { editor: bin, target };
}

export function appendInlineDevSourceMap(
  code: string,
  map: SourceMapV3 | undefined,
  relSourcePath: string,
  sourceText: string
): { readonly code: string; readonly map?: SourceMapV3 | undefined } {
  if (!map) return { code };
  const relOutFile = relSourcePath.endsWith(".js") ? relSourcePath : `${relSourcePath}.js`;
  const enriched: SourceMapV3 = {
    ...map,
    file: relOutFile,
    sources: [relSourcePath],
    sourcesContent: [sourceText]
  };
  const b64 = Buffer.from(JSON.stringify(enriched), "utf-8").toString("base64");
  const cleanCode = code.replace(/\r?\n\/\/# sourceMappingURL=[^\r\n]*\s*$/, "");
  return {
    code: `${cleanCode}\n//# sourceMappingURL=data:application/json;base64,${b64}\n`,
    map: enriched
  };
}

export function handleDevErrorEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlObj: URL,
  rootDir: string,
  sourceMapCache: ReadonlyMap<string, SourceMapV3>,
  editorSetting?: string
): boolean {
  const pathname = decodeURIComponent(urlObj.pathname);

  if (pathname === "/__mix/frame" && req.method === "GET") {
    const fileParam = urlObj.searchParams.get("file") ?? "";
    const lineParam = parseInt(urlObj.searchParams.get("line") ?? "1", 10) || 1;
    const colParam = parseInt(urlObj.searchParams.get("col") ?? "1", 10) || 1;
    const isGenerated = urlObj.searchParams.get("generated") === "1";

    const resolved = resolveSafeProjectFile(rootDir, fileParam);
    if (resolved.status !== "ok") {
      const code = resolved.status === "forbidden" ? 403 : 404;
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: code === 403 ? "Path outside project root" : "File not found in project root" }));
      return true;
    }

    let finalLine = lineParam;
    let finalCol = colParam;
    if (isGenerated) {
      const map = sourceMapCache.get(resolved.absPath);
      const mapped = map ? decodeSourceMapPosition(map, lineParam, colParam) : null;
      if (!mapped) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ unavailable: true, file: resolved.relPath, line: lineParam, column: colParam, lines: [] }));
        return true;
      }
      finalLine = mapped.line;
      finalCol = mapped.column;
    }

    const frame = buildSourceCodeFrame(resolved.absPath, resolved.relPath, finalLine, finalCol, 7);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(frame));
    return true;
  }

  if (pathname === "/__mix/open-in-editor") {
    const respond = (fileParam: string, lineParam: number, colParam: number): void => {
      const resolved = resolveSafeProjectFile(rootDir, fileParam);
      if (resolved.status !== "ok") {
        const code = resolved.status === "forbidden" ? 403 : 404;
        res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: code === 403 ? "Path outside project root" : "File not found in project root" }));
        return;
      }
      const launched = launchEditor(editorSetting, resolved.absPath, lineParam, colParam);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, ...launched }));
    };

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { file?: string; line?: number; column?: number };
          respond(parsed.file ?? "", parsed.line ?? 1, parsed.column ?? 1);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Invalid JSON payload" }));
        }
      });
      return true;
    }

    respond(
      urlObj.searchParams.get("file") ?? "",
      parseInt(urlObj.searchParams.get("line") ?? "1", 10) || 1,
      parseInt(urlObj.searchParams.get("col") ?? "1", 10) || 1
    );
    return true;
  }

  return false;
}

