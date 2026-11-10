/**
 * @mix/compiler-semantic/transpiler — Import extension rewriter and TS-to-JS script/module transpiler.
 */

import * as ts from "typescript";
import { STYLE_EXTENSION_REGEX } from "./constants.js";
import type { SeparatedScriptResult } from "./types.js";

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
 * Transpiles a standalone `.ts` or `.js` module to ES2023 JavaScript while normalizing
 * relative `.tix`, `.mix`, and `.ts` import/export specifiers to `.js`.
 */
export function transpileSourceModule(
  sourceCode: string,
  isTypeScript: boolean
): string {
  const sf = ts.createSourceFile(
    isTypeScript ? "module.ts" : "module.js",
    sourceCode,
    ts.ScriptTarget.ES2023,
    true,
    isTypeScript ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
  const replacements: Array<{ start: number; end: number; text: string }> = [];

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

  let rewritten = sourceCode;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]!;
    rewritten = rewritten.slice(0, r.start) + r.text + rewritten.slice(r.end);
  }

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
