/**
 * @mix/language-server/indexer — Document offset/position/span converters, URI normalization, and workspace file reader.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { SourceSpan } from "@mix/ast";
import type { Position, Range } from "./types.js";

export function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

export function positionToOffset(text: string, position: Position): number {
  let line = 0;
  let character = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === position.line && character === position.character) {
      return i;
    }
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return text.length;
}

export function spanToRange(span: SourceSpan): Range {
  return {
    start: {
      line: Math.max(0, span.start.line - 1),
      character: Math.max(0, span.start.column - 1),
    },
    end: {
      line: Math.max(0, span.end.line - 1),
      character: Math.max(0, span.end.column - 1),
    },
  };
}

export function getWordAtOffset(
  text: string,
  offset: number
): { word: string; start: number; end: number } | null {
  if (offset < 0 || offset > text.length) return null;
  let start = offset;
  while (start > 0 && /[a-zA-Z0-9_$]/.test(text[start - 1]!)) {
    start--;
  }
  let end = offset;
  while (end < text.length && /[a-zA-Z0-9_$]/.test(text[end]!)) {
    end++;
  }
  if (start === end) return null;
  return {
    word: text.slice(start, end),
    start,
    end,
  };
}

export function normalizeUri(uri: string): string {
  return uri.replace(/\\/g, "/");
}

export function resolveRelativeUri(baseUri: string, relativePath: string): string {
  const normBase = baseUri.replace(/\\/g, "/");
  const normRel = relativePath.replace(/\\/g, "/");

  const lastSlash = normBase.lastIndexOf("/");
  const baseDir = lastSlash >= 0 ? normBase.slice(0, lastSlash + 1) : "";

  const combined = baseDir + normRel;
  const isFileUri = combined.startsWith("file:///");
  const isSlash = combined.startsWith("/");

  const clean = isFileUri
    ? combined.slice(8)
    : isSlash
    ? combined.slice(1)
    : combined;

  const segments = clean.split("/");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  if (isFileUri) {
    return "file:///" + resolved.join("/");
  }
  if (isSlash) {
    return "/" + resolved.join("/");
  }
  return resolved.join("/");
}

export function readWorkspaceFileContent(
  workspaceFiles: ReadonlyMap<string, string>,
  uri: string
): string | null {
  const norm = normalizeUri(uri);
  if (workspaceFiles.has(norm)) {
    return workspaceFiles.get(norm)!;
  }
  const pathOnly = norm.replace(/^file:\/\/\/?/, "");
  if (workspaceFiles.has(pathOnly)) {
    return workspaceFiles.get(pathOnly)!;
  }
  try {
    const fsPath = norm.startsWith("file://") ? fileURLToPath(norm) : norm;
    if (fs.existsSync(fsPath)) {
      return fs.readFileSync(fsPath, "utf-8");
    }
  } catch {
    // Ignore if not a valid fs path
  }
  return null;
}
