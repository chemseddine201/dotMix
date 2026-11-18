/**
 * @dotmix/compiler-semantic/build-transforms/module-transforms — TypeScript AST transforms applied
 * to compiled JavaScript modules by the production build.
 */

import * as ts from "typescript";
import { applyTextEdits, type TextEdit } from "./source-map-chain.js";

function parseJavaScriptModule(sourceCode: string): ts.SourceFile {
  return ts.createSourceFile("module.js", sourceCode, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
}

function readStringSpecifier(node: ts.Node): string | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
  }
  return null;
}

/** Computes TextEdits removing `import "<spec>";` declarations whose specifier matches. */
export function computeRemoveSideEffectImportsEdits(
  sourceCode: string,
  shouldRemove: (specifier: string) => boolean
): TextEdit[] {
  const sourceFile = parseJavaScriptModule(sourceCode);
  const edits: TextEdit[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause) continue;
    const specifier = readStringSpecifier(statement);
    if (specifier !== null && shouldRemove(specifier)) {
      edits.push({ start: statement.getStart(sourceFile), end: statement.getEnd(), text: "" });
    }
  }
  edits.sort((left, right) => left.start - right.start);
  return edits;
}

/** Removes `import "<spec>";` declarations (no import clause) whose specifier matches. */
export function removeSideEffectImports(
  sourceCode: string,
  shouldRemove: (specifier: string) => boolean
): string {
  const edits = computeRemoveSideEffectImportsEdits(sourceCode, shouldRemove);
  return applyTextEdits(sourceCode, edits);
}

/** Computes TextEdits removing single-line and multi-line comments using the TypeScript scanner. */
export function computeRemoveCommentsEdits(sourceCode: string): TextEdit[] {
  // Parse first so the parser classifies every token: comment ranges are then collected only from the
  // trivia between tokens, never from inside a string, template, or regular-expression literal. A raw
  // scanner cannot tell `//` inside `/end\/ /` from a line comment, so it must not drive this.
  const sourceFile = parseJavaScriptModule(sourceCode);
  const seenStarts = new Set<number>();
  const edits: TextEdit[] = [];
  const addRanges = (ranges: readonly ts.CommentRange[] | undefined): void => {
    if (!ranges) return;
    for (const range of ranges) {
      if (seenStarts.has(range.pos)) continue;
      seenStarts.add(range.pos);
      edits.push({ start: range.pos, end: range.end, text: "" });
    }
  };
  addRanges(ts.getLeadingCommentRanges(sourceCode, 0));
  const visit = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(sourceCode, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(sourceCode, node.getEnd()));
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  edits.sort((a, b) => a.start - b.start);
  return edits;
}

/** Prints the module without comments using scanner-based deletion so positions survive. */
export function removeJavaScriptComments(sourceCode: string): string {
  const edits = computeRemoveCommentsEdits(sourceCode);
  return applyTextEdits(sourceCode, edits);
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
