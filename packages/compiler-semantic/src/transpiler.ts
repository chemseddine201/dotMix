/**
 * @dotmix/compiler-semantic/transpiler — Import extension rewriter and TS-to-JS script/module transpiler.
 */

import * as ts from "typescript";
import { STYLE_EXTENSION_REGEX } from "./constants.js";
import type { ScriptLineMapping, SeparatedScriptResult, SourceMapV3 } from "./types.js";
import { applyTextEdits, decodeMappings, shiftMapThroughEdits, type TextEdit } from "./build-transforms/source-map-chain.js";

/**
 * Rewrites `.tix` / `.mix` import specifiers to `.tix.js` / `.mix.js` in emitted JavaScript (R-RS-03, R-RS-04).
 */
export function rewriteModuleImportExtensions(scriptCode: string): string {
  const sf = ts.createSourceFile("script.ts", scriptCode, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const rawSpec = stmt.moduleSpecifier.text;
      if (rawSpec.endsWith(".tix") || rawSpec.endsWith(".mix")) {
        replacements.push({
          start: stmt.moduleSpecifier.getStart(sf),
          end: stmt.moduleSpecifier.getEnd(),
          text: JSON.stringify(`${rawSpec}.js`)
        });
      }
    }
  }

  let out = scriptCode;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]!;
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

function blankSpanPreservingNewlines(chars: string[], start: number, end: number): void {
  for (let i = start; i < end && i < chars.length; i++) {
    const c = chars[i];
    if (c !== "\n" && c !== "\r") chars[i] = " ";
  }
}

function scanJsLineMappings(lineText: string, srcLine: number, colOffset: number): ScriptLineMapping[] {
  const segs: ScriptLineMapping[] = [];
  if (lineText.trim().length === 0) return segs;
  const scanner = ts.createScanner(ts.ScriptTarget.ES2023, true, ts.LanguageVariant.Standard, lineText);
  let tok = scanner.scan();
  while (tok !== ts.SyntaxKind.EndOfFileToken) {
    const pos = scanner.getTokenPos();
    segs.push({ genCol: pos, srcLine, srcCol: pos + colOffset });
    tok = scanner.scan();
  }
  if (segs.length === 0) {
    const firstNonWs = lineText.search(/\S/);
    if (firstNonWs >= 0) segs.push({ genCol: firstNonWs, srcLine, srcCol: firstNonWs + colOffset });
  }
  return segs;
}

function trimBodyAndMappings(
  rawLines: readonly string[],
  rawMappings: readonly (readonly ScriptLineMapping[])[]
): { bodyCode: string; bodyMappings: ScriptLineMapping[][] } {
  let first = 0;
  while (first < rawLines.length && rawLines[first]!.trim().length === 0) first++;
  let last = rawLines.length - 1;
  while (last >= first && rawLines[last]!.trim().length === 0) last--;
  if (first > last) return { bodyCode: "", bodyMappings: [] };

  const outLines: string[] = [];
  const outMaps: ScriptLineMapping[][] = [];
  for (let i = first; i <= last; i++) {
    let line = rawLines[i]!;
    let segs = [...(rawMappings[i] ?? [])];
    if (i === first) {
      const leadMatch = /^[\t ]+/.exec(line);
      if (leadMatch) {
        const trimLen = leadMatch[0].length;
        line = line.slice(trimLen);
        segs = segs.map((s) => ({
          genCol: Math.max(0, s.genCol - trimLen),
          srcLine: s.srcLine,
          srcCol: s.srcCol
        }));
      }
    }
    if (i === last) {
      line = line.trimEnd();
    }
    outLines.push(line);
    outMaps.push(segs);
  }
  return { bodyCode: outLines.join("\n"), bodyMappings: outMaps };
}

/**
 * Uses the TypeScript 6.0.3 Compiler API to separate top-level `import` declarations
 * from component body statements, rewrite `.tix`/`.mix` module specifiers to `.js`,
 * and transpile TypeScript syntax (interfaces, type aliases, type annotations) to clean ES2023 JS
 * while preserving exact line/column source mappings for every body statement (F1).
 */
export function extractAndTranspileScript(
  scriptContent: string,
  isTypeScript: boolean
): SeparatedScriptResult {
  const rewritten = rewriteModuleImportExtensions(scriptContent);
  const sf = ts.createSourceFile(
    isTypeScript ? "component.ts" : "component.js",
    rewritten,
    ts.ScriptTarget.ES2023,
    true,
    isTypeScript ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );

  // Build masked body with exact same line & column layout as `scriptContent`
  const origSf = ts.createSourceFile(
    isTypeScript ? "orig.ts" : "orig.js",
    scriptContent,
    ts.ScriptTarget.ES2023,
    true,
    isTypeScript ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
  const maskedChars = scriptContent.split("");
  const importSlices: string[] = [];

  for (let idx = 0; idx < sf.statements.length; idx++) {
    const stmt = sf.statements[idx]!;
    const origStmt = origSf.statements[idx];
    const text = rewritten.slice(stmt.getFullStart(), stmt.getEnd());
    if (ts.isImportDeclaration(stmt)) {
      if (origStmt) blankSpanPreservingNewlines(maskedChars, origStmt.getFullStart(), origStmt.getEnd());
      if (stmt.importClause?.isTypeOnly) continue;
      if (ts.isStringLiteral(stmt.moduleSpecifier) && STYLE_EXTENSION_REGEX.test(stmt.moduleSpecifier.text)) {
        continue;
      }
      importSlices.push(text.trim());
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      if (origStmt) blankSpanPreservingNewlines(maskedChars, origStmt.getFullStart(), origStmt.getEnd());
    }
  }

  const rawImports = importSlices.join("\n");
  const maskedBody = maskedChars.join("");

  if (!isTypeScript) {
    const rawLines = maskedBody.split(/\r?\n/);
    const rawMaps = rawLines.map((ln, lineIdx) => scanJsLineMappings(ln, lineIdx, 0));
    const trimmed = trimBodyAndMappings(rawLines, rawMaps);
    return {
      importsCode: rawImports,
      bodyCode: trimmed.bodyCode,
      bodyMappings: trimmed.bodyMappings
    };
  }

  const transpiledImports = ts.transpileModule(rawImports, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true
    }
  }).outputText.trim();

  const transpiled = ts.transpileModule(maskedBody, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      sourceMap: true
    }
  });

  const cleanOutput = transpiled.outputText.replace(/\r?\n\/\/# sourceMappingURL=[^\r\n]*\s*$/, "");
  const outLines = cleanOutput.split(/\r?\n/);
  const decoded = transpiled.sourceMapText
    ? decodeMappings((JSON.parse(transpiled.sourceMapText) as SourceMapV3).mappings)
    : [];
  const rawMaps: ScriptLineMapping[][] = outLines.map((_, idx) => {
    const segs = decoded[idx] ?? [];
    const mapped: ScriptLineMapping[] = [];
    for (const seg of segs) {
      if (seg.srcLine !== undefined && seg.srcCol !== undefined) {
        mapped.push({ genCol: seg.genCol, srcLine: seg.srcLine, srcCol: seg.srcCol });
      }
    }
    return mapped;
  });

  const trimmed = trimBodyAndMappings(outLines, rawMaps);
  return {
    importsCode: transpiledImports,
    bodyCode: trimmed.bodyCode,
    bodyMappings: trimmed.bodyMappings
  };
}

/**
 * Computes TextEdits for static import/export specifiers and dynamic `import("...")` string literals
 * in JavaScript/TypeScript source using TypeScript's AST parser so prose/strings are never touched.
 */
export function computeJsModuleSpecifierEdits(
  sourceCode: string,
  transformSpecifier: (specifier: string) => string
): TextEdit[] {
  const sf = ts.createSourceFile("module.js", sourceCode, ts.ScriptTarget.ES2023, false, ts.ScriptKind.JS);
  const replacements: TextEdit[] = [];

  function recordSpecifier(literal: ts.StringLiteral): void {
    const rewritten = transformSpecifier(literal.text);
    if (rewritten !== literal.text) {
      replacements.push({
        start: literal.getStart(sf),
        end: literal.getEnd(),
        text: JSON.stringify(rewritten)
      });
    }
  }

  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        recordSpecifier(node.moduleSpecifier);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1
    ) {
      const firstArg = node.arguments[0]!;
      if (ts.isStringLiteral(firstArg)) {
        recordSpecifier(firstArg);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  replacements.sort((a, b) => a.start - b.start);
  return replacements;
}

/**
 * Rewrites static import/export specifiers and dynamic `import("...")` string literals
 * in JavaScript/TypeScript source using TypeScript's AST parser so prose/strings are never touched.
 */
export function rewriteJsModuleSpecifiers(
  sourceCode: string,
  transformSpecifier: (specifier: string) => string
): string {
  const edits = computeJsModuleSpecifierEdits(sourceCode, transformSpecifier);
  return applyTextEdits(sourceCode, edits);
}

/**
 * Computes TextEdits normalizing relative `.tix`, `.mix`, and `.ts` import/export specifiers to `.js`.
 */
export function computeModuleImportExtensionEdits(sourceCode: string): TextEdit[] {
  const sf = ts.createSourceFile("module.ts", sourceCode, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const replacements: TextEdit[] = [];

  for (const stmt of sf.statements) {
    if (
      (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const rawSpec = stmt.moduleSpecifier.text;
      if (/\.(tix|mix|ts)$/i.test(rawSpec)) {
        const normalized = rawSpec.replace(/\.(tix|mix|ts)$/i, ".js");
        replacements.push({
          start: stmt.moduleSpecifier.getStart(sf),
          end: stmt.moduleSpecifier.getEnd(),
          text: JSON.stringify(normalized)
        });
      }
    }
  }

  replacements.sort((a, b) => a.start - b.start);
  return replacements;
}

export interface TranspileSourceModuleOptions {
  readonly sourceMap?: boolean;
  readonly filename?: string;
}

export function transpileSourceModule(
  sourceCode: string,
  isTypeScript: boolean,
  options: { readonly sourceMap: true; readonly filename?: string }
): { code: string; map?: SourceMapV3 | undefined };
export function transpileSourceModule(
  sourceCode: string,
  isTypeScript: boolean,
  options?: { readonly sourceMap?: false; readonly filename?: string }
): string;
export function transpileSourceModule(
  sourceCode: string,
  isTypeScript: boolean,
  options?: TranspileSourceModuleOptions
): string | { code: string; map?: SourceMapV3 | undefined };
export function transpileSourceModule(
  sourceCode: string,
  isTypeScript: boolean,
  options?: TranspileSourceModuleOptions
): string | { code: string; map?: SourceMapV3 | undefined } {
  const wantsSourceMap = Boolean(options?.sourceMap);
  const filename = options?.filename ?? (isTypeScript ? "module.ts" : "module.js");

  if (wantsSourceMap) {
    const transpiled = ts.transpileModule(sourceCode, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        sourceMap: true
      },
      fileName: filename
    });

    let code = transpiled.outputText;
    let map: SourceMapV3 | undefined = transpiled.sourceMapText
      ? (JSON.parse(transpiled.sourceMapText) as SourceMapV3)
      : undefined;

    if (map) {
      map = {
        ...map,
        sources: [filename],
        sourcesContent: [sourceCode]
      };
    }

    const extensionEdits = computeModuleImportExtensionEdits(code);
    if (extensionEdits.length > 0) {
      if (map) {
        map = shiftMapThroughEdits(map, code, extensionEdits);
      }
      code = applyTextEdits(code, extensionEdits);
    }

    return { code, map };
  }

  const extensionEdits = computeModuleImportExtensionEdits(sourceCode);
  const rewritten = applyTextEdits(sourceCode, extensionEdits);

  if (!isTypeScript) {
    return rewritten;
  }

  return ts.transpileModule(rewritten, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext
    }
  }).outputText;
}
