/**
 * @mix/compiler-css/import-resolver — Build-time `@import` / `@use` partial resolution, comment stripping, and variable substitution helpers.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceSpan } from "@mix/diagnostics";
import type { PreprocessorLang, PreprocessCssOptions } from "./preprocess.js";

export interface MixinDefinition {
  readonly params: ReadonlyArray<{ name: string; defaultValue: string }>;
  readonly body: string;
}

export function makeDefaultSpan(filename?: string): SourceSpan {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 2, offset: 1 },
    ...(filename !== undefined ? { file: filename } : {})
  };
}

export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (!inSingle && !inDouble && ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }

    if (!inSingle && !inDouble && ch === "/" && next === "/") {
      // Avoid stripping protocol `://`
      const prev = i > 0 ? source[i - 1] : "";
      if (prev !== ":") {
        while (i < source.length && source[i] !== "\n") {
          i++;
        }
        continue;
      }
    }

    if (ch === "'" && !inDouble && source[i - 1] !== "\\") {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && source[i - 1] !== "\\") {
      inDouble = !inDouble;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Converts indented `.sass` syntax (when no braces are present) into brace-delimited SCSS.
 */
export function convertIndentedSassToScss(source: string): string {
  if (source.includes("{") || source.includes("}")) {
    return source;
  }
  const lines = source.split(/\r?\n/);
  const nonEmpty: Array<{ indent: number; text: string }> = [];

  for (const rawLine of lines) {
    const trimmedRight = rawLine.replace(/\s+$/, "");
    const trimmed = trimmedRight.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    nonEmpty.push({ indent, text: trimmed });
  }

  if (nonEmpty.length === 0) return "";

  const out: string[] = [];
  const indentStack: number[] = [nonEmpty[0]!.indent];

  for (let i = 0; i < nonEmpty.length; i++) {
    const cur = nonEmpty[i]!;
    const next = nonEmpty[i + 1];

    while (indentStack.length > 1 && cur.indent <= indentStack[indentStack.length - 1]!) {
      indentStack.pop();
      out.push("}");
    }

    if (next && next.indent > cur.indent) {
      out.push(`${cur.text} {`);
      indentStack.push(next.indent);
    } else {
      const semi = cur.text.endsWith(";") ? "" : ";";
      out.push(`${cur.text}${semi}`);
    }
  }

  while (indentStack.length > 1) {
    indentStack.pop();
    out.push("}");
  }

  return out.join("\n");
}

export function tryReadPartial(
  specifier: string,
  fromFile: string,
  lang: PreprocessorLang,
  options?: PreprocessCssOptions
): { resolvedPath: string; content: string } | null {
  const posixFromDir = path.posix.dirname(fromFile.replace(/\\/g, "/"));
  const nativeFromDir = path.dirname(fromFile);
  const ext = `.${lang === "postcss" ? "pcss" : lang}`;
  const baseName = path.posix.basename(specifier);
  const dirName = path.posix.dirname(specifier);

  const relCandidates = [
    specifier,
    specifier.endsWith(ext) ? specifier : `${specifier}${ext}`,
    `${dirName}/_${baseName}`,
    `${dirName}/_${baseName.endsWith(ext) ? baseName : `${baseName}${ext}`}`
  ];

  for (const rel of relCandidates) {
    const posixResolved = path.posix.resolve(posixFromDir, rel);
    if (options?.readFile) {
      const customContent = options.readFile(posixResolved, fromFile) ?? options.readFile(rel, fromFile);
      if (typeof customContent === "string") {
        return { resolvedPath: posixResolved, content: customContent };
      }
    }

    const searchDirs = [nativeFromDir, ...(options?.loadPaths ?? [])];
    for (const dir of searchDirs) {
      const absCandidate = path.resolve(dir, rel);
      if (fs.existsSync(absCandidate) && fs.statSync(absCandidate).isFile()) {
        return {
          resolvedPath: absCandidate,
          content: fs.readFileSync(absCandidate, "utf-8")
        };
      }
    }
  }

  return null;
}

export function inlinePartials(
  source: string,
  fromFile: string,
  lang: PreprocessorLang,
  dependencies: string[],
  visited: Set<string>,
  options?: PreprocessCssOptions
): string {
  const importRegex = /@(?:import|use)\s+["']([^"']+)["'](?:\s+as\s+[^;]+)?\s*;/g;
  return source.replace(importRegex, (fullMatch, rawSpec: string) => {
    if (/^(?:https?:|url\()/i.test(rawSpec.trim())) {
      // Leave external URL @imports untouched so compileCss enforces D-108
      return fullMatch;
    }
    const found = tryReadPartial(rawSpec.trim(), fromFile, lang, options);
    if (!found) {
      return "";
    }
    if (!dependencies.includes(found.resolvedPath)) {
      dependencies.push(found.resolvedPath);
    }
    if (visited.has(found.resolvedPath)) {
      return "";
    }
    visited.add(found.resolvedPath);
    const partialSource =
      lang === "sass" ? convertIndentedSassToScss(found.content) : found.content;
    return inlinePartials(
      stripComments(partialSource),
      found.resolvedPath,
      lang,
      dependencies,
      visited,
      options
    );
  });
}

export function replaceVariablesInText(
  text: string,
  vars: ReadonlyMap<string, string>,
  prefix: "$" | "@"
): string {
  let current = text;
  // Sort keys longest-first to avoid partial prefix replacements
  const entries = [...vars.entries()].sort((a, b) => b[0].length - a[0].length);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [name, val] of entries) {
      const escaped = `${prefix === "$" ? "\\$" : "@"}${name}(?![A-Za-z0-9_-])`;
      const re = new RegExp(escaped, "g");
      const next = current.replace(re, val);
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return current;
}
