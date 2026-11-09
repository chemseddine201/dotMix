/**
 * @mix/compiler-css — Build-Time Stylesheet Preprocessor Stage (Gate 27 / T-27.3 / D-130)
 *
 * Compiles `.scss`, `.sass`, `.less`, and `.pcss` / `.postcss` stylesheets into standard,
 * flat CSS prior to `compileCss` scoping and security validation:
 * - Resolves build-time `@import` and `@use` partials and records resolved paths in `dependencies`.
 * - Evaluates SCSS (`$var`) and Less (`@var`) variables.
 * - Expands SCSS `@mixin` / `@include` and Less parametric mixins.
 * - Flattens nested rules and parent selector `&` concatenation (`&-primary`, `&:hover`, `&.active`).
 * - Fails with `MIX_ERR_PREPROCESSOR_MISSING` and an install hint when an unsupported external
 *   preprocessor is requested.
 * - Preserves D-108 strictly for plain `.css` and post-preprocessed output.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DiagnosticCodes, MixDiagnosticError, type SourceSpan } from "@mix/diagnostics";

export type PreprocessorLang =
  | "css"
  | "scss"
  | "sass"
  | "less"
  | "pcss"
  | "postcss"
  | "styl"
  | "stylus"
  | string;

export interface PreprocessCssOptions {
  readonly lang?: PreprocessorLang | undefined;
  readonly filename?: string | undefined;
  readonly loadPaths?: readonly string[] | undefined;
  readonly readFile?: ((resolvedPath: string, fromFile: string) => string | null | undefined) | undefined;
}

export interface PreprocessCssResult {
  readonly code: string;
  readonly dependencies: readonly string[];
  readonly map?: {
    readonly version: 3;
    readonly file: string;
    readonly sources: readonly string[];
    readonly mappings: string;
  } | undefined;
}

interface MixinDefinition {
  readonly params: ReadonlyArray<{ name: string; defaultValue: string }>;
  readonly body: string;
}

const RESERVED_CSS_ATRULES = new Set([
  "media",
  "keyframes",
  "-webkit-keyframes",
  "-moz-keyframes",
  "supports",
  "font-face",
  "layer",
  "container",
  "page",
  "namespace",
  "property",
  "counter-style",
  "import",
  "use",
  "forward",
  "charset",
  "mixin",
  "include"
]);

function makeDefaultSpan(filename?: string): SourceSpan {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 2, offset: 1 },
    ...(filename !== undefined ? { file: filename } : {})
  };
}

export function detectPreprocessorLang(filename?: string, explicitLang?: string): PreprocessorLang {
  if (explicitLang) {
    return explicitLang.toLowerCase().replace(/^\./, "");
  }
  if (!filename) return "css";
  const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
  if (ext === "scss" || ext === "sass" || ext === "less" || ext === "pcss" || ext === "postcss" || ext === "styl" || ext === "stylus") {
    return ext;
  }
  return "css";
}

function stripComments(source: string): string {
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
function convertIndentedSassToScss(source: string): string {
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

function tryReadPartial(
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

function inlinePartials(
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

function replaceVariablesInText(
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

function extractAndExpandScssVariablesAndMixins(source: string): string {
  const vars = new Map<string, string>();
  const mixins = new Map<string, MixinDefinition>();

  // 1. Extract `@mixin name($p: default, ...) { ... }`
  let current = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("@mixin", i) && (i === 0 || /\s|;|\}/.test(source[i - 1]!))) {
      let pos = i + 6;
      while (pos < source.length && /\s/.test(source[pos]!)) pos++;
      const nameMatch = /^([A-Za-z_-][A-Za-z0-9_-]*)/.exec(source.slice(pos));
      if (nameMatch) {
        const mixinName = nameMatch[1]!;
        pos += mixinName.length;
        while (pos < source.length && /\s/.test(source[pos]!)) pos++;
        const params: Array<{ name: string; defaultValue: string }> = [];
        if (source[pos] === "(") {
          const openParen = pos;
          let pDepth = 1;
          pos++;
          while (pos < source.length && pDepth > 0) {
            if (source[pos] === "(") pDepth++;
            else if (source[pos] === ")") pDepth--;
            pos++;
          }
          const rawParamList = source.slice(openParen + 1, pos - 1).trim();
          if (rawParamList.length > 0) {
            for (const part of rawParamList.split(",")) {
              const [rawName, rawDef] = part.split(":");
              const cleanName = (rawName ?? "").trim().replace(/^\$/, "");
              if (cleanName) {
                params.push({
                  name: cleanName,
                  defaultValue: (rawDef ?? "").trim()
                });
              }
            }
          }
        }
        while (pos < source.length && /\s/.test(source[pos]!)) pos++;
        if (source[pos] === "{") {
          const openBrace = pos;
          let bDepth = 1;
          pos++;
          while (pos < source.length && bDepth > 0) {
            if (source[pos] === "{") bDepth++;
            else if (source[pos] === "}") bDepth--;
            pos++;
          }
          const body = source.slice(openBrace + 1, pos - 1).trim();
          mixins.set(mixinName, { params, body });
          i = pos;
          continue;
        }
      }
    }
    current += source[i]!;
    i++;
  }

  // 2. Extract `$var: value;` declarations
  const varDeclRegex = /\$([A-Za-z_-][A-Za-z0-9_-]*)\s*:\s*([^;{}]+);/g;
  current = current.replace(varDeclRegex, (_m, name: string, rawVal: string) => {
    const cleanVal = replaceVariablesInText(rawVal.trim().replace(/\s*!default$/, ""), vars, "$");
    vars.set(name, cleanVal);
    return "";
  });

  // 3. Expand `@include name(args);`
  const includeRegex = /@include\s+([A-Za-z_-][A-Za-z0-9_-]*)\s*(?:\(([^)]*)\))?\s*;/g;
  current = current.replace(includeRegex, (_m, name: string, rawArgs?: string) => {
    const def = mixins.get(name);
    if (!def) return "";
    const localVars = new Map(vars);
    const argList = rawArgs && rawArgs.trim().length > 0
      ? rawArgs.split(",").map((a) => a.trim())
      : [];
    def.params.forEach((param, idx) => {
      const val = argList[idx] !== undefined && argList[idx] !== "" ? argList[idx]! : param.defaultValue;
      localVars.set(param.name, replaceVariablesInText(val, vars, "$"));
    });
    return replaceVariablesInText(def.body, localVars, "$");
  });

  // 4. Replace remaining `$var` references
  return replaceVariablesInText(current, vars, "$");
}

function extractAndExpandLessVariablesAndMixins(source: string): string {
  const vars = new Map<string, string>();
  const mixins = new Map<string, MixinDefinition>();

  // 1. Extract parametric mixins `.name(@p: default, ...) { ... }`
  let current = "";
  let i = 0;
  while (i < source.length) {
    const slice = source.slice(i);
    const mixinMatch = /^\.([A-Za-z_-][A-Za-z0-9_-]*)\s*\(([^)]*)\)\s*\{/.exec(slice);
    if (mixinMatch) {
      const mixinName = mixinMatch[1]!;
      const rawParamList = mixinMatch[2]!.trim();
      const params: Array<{ name: string; defaultValue: string }> = [];
      if (rawParamList.length > 0) {
        for (const part of rawParamList.split(",")) {
          const [rawName, rawDef] = part.split(":");
          const cleanName = (rawName ?? "").trim().replace(/^@/, "");
          if (cleanName) {
            params.push({
              name: cleanName,
              defaultValue: (rawDef ?? "").trim()
            });
          }
        }
      }
      let pos = i + mixinMatch[0].length;
      const openBraceEnd = pos;
      let bDepth = 1;
      while (pos < source.length && bDepth > 0) {
        if (source[pos] === "{") bDepth++;
        else if (source[pos] === "}") bDepth--;
        pos++;
      }
      const body = source.slice(openBraceEnd, pos - 1).trim();
      mixins.set(mixinName, { params, body });
      i = pos;
      continue;
    }
    current += source[i]!;
    i++;
  }

  // 2. Extract `@var: value;` declarations (ignoring reserved CSS at-rules)
  const varDeclRegex = /@([A-Za-z_-][A-Za-z0-9_-]*)\s*:\s*([^;{}]+);/g;
  current = current.replace(varDeclRegex, (fullMatch, name: string, rawVal: string) => {
    if (RESERVED_CSS_ATRULES.has(name.toLowerCase())) {
      return fullMatch;
    }
    const cleanVal = replaceVariablesInText(rawVal.trim(), vars, "@");
    vars.set(name, cleanVal);
    return "";
  });

  // 3. Expand `.mixinName(args);` calls
  const callRegex = /\.([A-Za-z_-][A-Za-z0-9_-]*)\s*\(([^)]*)\)\s*;/g;
  current = current.replace(callRegex, (fullMatch, name: string, rawArgs: string) => {
    const def = mixins.get(name);
    if (!def) return fullMatch;
    const localVars = new Map(vars);
    const argList = rawArgs.trim().length > 0
      ? rawArgs.split(",").map((a) => a.trim())
      : [];
    def.params.forEach((param, idx) => {
      const val = argList[idx] !== undefined && argList[idx] !== "" ? argList[idx]! : param.defaultValue;
      localVars.set(param.name, replaceVariablesInText(val, vars, "@"));
    });
    return replaceVariablesInText(def.body, localVars, "@");
  });

  // 4. Replace remaining `@var` references
  return replaceVariablesInText(current, vars, "@");
}

function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i]!;
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function combineSelectors(parentSelectors: readonly string[], childSelectorText: string): string[] {
  const childList = splitSelectorList(childSelectorText);
  if (parentSelectors.length === 0) {
    return childList.map((c) => c.replace(/&/g, "").trim()).filter(Boolean);
  }
  const combined: string[] = [];
  for (const parent of parentSelectors) {
    for (const child of childList) {
      if (child.includes("&")) {
        combined.push(child.replace(/&/g, parent));
      } else {
        combined.push(`${parent} ${child}`);
      }
    }
  }
  return combined;
}

interface ParsedBlockItem {
  readonly kind: "declaration" | "block";
  readonly text: string;
  readonly header?: string;
  readonly body?: string;
}

function parseBlockItems(source: string): ParsedBlockItem[] {
  const items: ParsedBlockItem[] = [];
  let pos = 0;
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let parenDepth = 0;

  while (pos < source.length) {
    const ch = source[pos]!;
    if (ch === "'" && !inDouble && source[pos - 1] !== "\\") {
      inSingle = !inSingle;
      pos++;
      continue;
    }
    if (ch === '"' && !inSingle && source[pos - 1] !== "\\") {
      inDouble = !inDouble;
      pos++;
      continue;
    }
    if (inSingle || inDouble) {
      pos++;
      continue;
    }

    if (ch === "(") {
      parenDepth++;
      pos++;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      pos++;
      continue;
    }

    if (ch === ";" && parenDepth === 0) {
      const decl = source.slice(start, pos).trim();
      if (decl.length > 0) {
        items.push({ kind: "declaration", text: decl });
      }
      pos++;
      start = pos;
      continue;
    }

    if (ch === "{" && parenDepth === 0) {
      const header = source.slice(start, pos).trim();
      const bodyStart = pos + 1;
      let braceDepth = 1;
      pos++;
      while (pos < source.length && braceDepth > 0) {
        const c = source[pos]!;
        if (c === "'" && !inDouble && source[pos - 1] !== "\\") inSingle = !inSingle;
        else if (c === '"' && !inSingle && source[pos - 1] !== "\\") inDouble = !inDouble;
        else if (!inSingle && !inDouble) {
          if (c === "{") braceDepth++;
          else if (c === "}") braceDepth--;
        }
        pos++;
      }
      const body = source.slice(bodyStart, pos - 1);
      items.push({
        kind: "block",
        text: `${header} { ${body} }`,
        header,
        body
      });
      start = pos;
      continue;
    }

    pos++;
  }

  const trailing = source.slice(start).trim();
  if (trailing.length > 0) {
    items.push({ kind: "declaration", text: trailing });
  }

  return items;
}

function flattenNestedCss(
  source: string,
  parentSelectors: readonly string[] = [],
  parentAtRules: readonly string[] = []
): string {
  const items = parseBlockItems(source);
  const declarations: string[] = [];
  const childRules: string[] = [];

  for (const item of items) {
    if (item.kind === "declaration") {
      if (item.text.startsWith("@")) {
        childRules.push(`${item.text};`);
      } else {
        declarations.push(`${item.text};`);
      }
    } else if (item.kind === "block" && item.header !== undefined && item.body !== undefined) {
      const header = item.header.trim();
      if (header.startsWith("@")) {
        const lower = header.toLowerCase();
        if (lower.startsWith("@keyframes") || lower.startsWith("@-webkit-keyframes") || lower.startsWith("@font-face")) {
          childRules.push(`${header} {\n${item.body.trim()}\n}`);
        } else {
          // @media, @supports, @layer, @container
          const inner = flattenNestedCss(item.body, parentSelectors, [...parentAtRules, header]);
          childRules.push(inner);
        }
      } else {
        const nextSelectors = combineSelectors(parentSelectors, header);
        const nestedCss = flattenNestedCss(item.body, nextSelectors, parentAtRules);
        childRules.push(nestedCss);
      }
    }
  }

  const emitted: string[] = [];
  if (declarations.length > 0 && parentSelectors.length > 0) {
    let ruleBlock = `${parentSelectors.join(", ")} {\n  ${declarations.join("\n  ")}\n}`;
    for (let i = parentAtRules.length - 1; i >= 0; i--) {
      ruleBlock = `${parentAtRules[i]!} {\n${ruleBlock}\n}`;
    }
    emitted.push(ruleBlock);
  } else if (declarations.length > 0 && parentAtRules.length > 0) {
    let ruleBlock = declarations.join("\n");
    for (let i = parentAtRules.length - 1; i >= 0; i--) {
      ruleBlock = `${parentAtRules[i]!} {\n${ruleBlock}\n}`;
    }
    emitted.push(ruleBlock);
  }

  emitted.push(...childRules.filter((r) => r.trim().length > 0));
  return emitted.join("\n");
}

export function preprocessCss(
  source: string,
  options?: PreprocessCssOptions
): PreprocessCssResult {
  const filename = options?.filename ?? "style.css";
  const lang = detectPreprocessorLang(filename, options?.lang);

  if (lang === "css") {
    return Object.freeze({
      code: source,
      dependencies: Object.freeze([])
    });
  }

  if (lang !== "scss" && lang !== "sass" && lang !== "less" && lang !== "pcss" && lang !== "postcss") {
    const pkgMap: Record<string, string> = {
      styl: "stylus",
      stylus: "stylus"
    };
    const pkgName = pkgMap[lang] ?? lang;
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_PREPROCESSOR_MISSING,
      message: `CSS preprocessor for '${lang}' is not installed. Run 'npm install -D ${pkgName}' to compile '${filename}' (D-130).`,
      severity: "error",
      span: makeDefaultSpan(filename)
    });
  }

  const dependencies: string[] = [];
  const visited = new Set<string>([filename]);

  let working = lang === "sass" ? convertIndentedSassToScss(source) : source;
  working = stripComments(working);
  working = inlinePartials(working, filename, lang, dependencies, visited, options);

  if (lang === "scss" || lang === "sass") {
    working = extractAndExpandScssVariablesAndMixins(working);
  } else if (lang === "less") {
    working = extractAndExpandLessVariablesAndMixins(working);
  }

  const flattened = flattenNestedCss(working);

  return Object.freeze({
    code: flattened,
    dependencies: Object.freeze(dependencies),
    map: Object.freeze({
      version: 3 as const,
      file: `${filename}.css`,
      sources: Object.freeze([filename, ...dependencies]),
      mappings: "AAAA"
    })
  });
}
