/**
 * @dotmix/compiler-semantic/transpiler — Import extension rewriter and TS-to-JS script/module transpiler.
 */

import * as ts from "typescript";
import { STYLE_EXTENSION_REGEX } from "./constants.js";
import type { SeparatedScriptResult, SourceMapV3 } from "./types.js";
import { applyTextEdits, shiftMapThroughEdits, type TextEdit } from "./build-transforms/source-map-chain.js";

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

/**
 * Uses the TypeScript 6.0.3 Compiler API to separate top-level `import` declarations
 * from component body statements, rewrite `.tix`/`.mix` module specifiers to `.js`,
 * and transpile TypeScript syntax (interfaces, type aliases, type annotations) to clean ES2023 JS.
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

  const importSlices: string[] = [];
  const bodySlices: string[] = [];

  for (const stmt of sf.statements) {
    const text = rewritten.slice(stmt.getFullStart(), stmt.getEnd());
    if (ts.isImportDeclaration(stmt)) {
      // Skip type-only imports (`import type ...`)
      if (stmt.importClause?.isTypeOnly) {
        continue;
      }
      // Skip pure stylesheet imports (`import "./foo.css"`, `.scss`, `.less`, etc.) because styles are compiled into __injectStylesheet
      if (ts.isStringLiteral(stmt.moduleSpecifier) && STYLE_EXTENSION_REGEX.test(stmt.moduleSpecifier.text)) {
        continue;
      }
      importSlices.push(text.trim());
    } else if (
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt)
    ) {
      // Erase pure TypeScript type declarations
      continue;
    } else {
      bodySlices.push(text);
    }
  }

  const rawImports = importSlices.join("\n");
  const rawBody = bodySlices.join("\n");

  if (!isTypeScript) {
    return {
      importsCode: rawImports,
      bodyCode: rawBody.trim()
    };
  }

  const transpiledImports = ts.transpileModule(rawImports, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true
    }
  }).outputText.trim();

  const transpiledBody = ts.transpileModule(rawBody, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext
    }
  }).outputText.trim();

  return {
    importsCode: transpiledImports,
    bodyCode: transpiledBody
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
