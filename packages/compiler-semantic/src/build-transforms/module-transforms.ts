/**
 * @dotmix/compiler-semantic/build-transforms/module-transforms — TypeScript AST transforms applied
 * to compiled JavaScript modules by the production build.
 */

import * as ts from "typescript";

function parseJavaScriptModule(sourceCode: string): ts.SourceFile {
  return ts.createSourceFile("module.js", sourceCode, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
}

function readStringSpecifier(node: ts.Node): string | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
  }
  return null;
}

/** Removes `import "<spec>";` declarations (no import clause) whose specifier matches. */
export function removeSideEffectImports(
  sourceCode: string,
  shouldRemove: (specifier: string) => boolean
): string {
  const sourceFile = parseJavaScriptModule(sourceCode);
  const removedRanges: Array<{ readonly start: number; readonly end: number }> = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause) continue;
    const specifier = readStringSpecifier(statement);
    if (specifier !== null && shouldRemove(specifier)) {
      removedRanges.push({ start: statement.getStart(sourceFile), end: statement.getEnd() });
    }
  }
  let rewrittenCode = sourceCode;
  for (let rangeIndex = removedRanges.length - 1; rangeIndex >= 0; rangeIndex--) {
    const range = removedRanges[rangeIndex]!;
    rewrittenCode = rewrittenCode.slice(0, range.start) + rewrittenCode.slice(range.end);
  }
  return rewrittenCode;
}

/** Prints the module without comments; strings, template literals and regexes stay byte-exact. */
export function removeJavaScriptComments(sourceCode: string): string {
  const sourceFile = parseJavaScriptModule(sourceCode);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return printer.printFile(sourceFile);
}

/** The static import/export specifiers of a module (for modulepreload). */
export function listStaticImportSpecifiers(sourceCode: string): string[] {
  const sourceFile = parseJavaScriptModule(sourceCode);
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    const specifier = readStringSpecifier(statement);
    if (specifier !== null) specifiers.push(specifier);
  }
  return specifiers;
}

/** The string-literal specifiers of the dynamic `import("...")` calls of a module. */
export function listDynamicImportSpecifiers(sourceCode: string): string[] {
  const sourceFile = parseJavaScriptModule(sourceCode);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      specifiers.push((node.arguments[0] as ts.StringLiteralLike).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}
