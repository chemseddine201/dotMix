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

/**
 * Lists all static import/export specifiers and string-literal dynamic `import("...")` specifiers
 * in source order using the TypeScript AST.
 */
export function listOrderedImportSpecifiers(sourceCode: string, isTypeScript = false): string[] {
  const sourceFile = ts.createSourceFile(
    isTypeScript ? "module.ts" : "module.js",
    sourceCode,
    ts.ScriptTarget.ES2023,
    true,
    isTypeScript ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
  const entries: Array<{ readonly pos: number; readonly specifier: string }> = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        entries.push({ pos: node.getStart(sourceFile), specifier: node.moduleSpecifier.text });
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      entries.push({
        pos: node.getStart(sourceFile),
        specifier: (node.arguments[0] as ts.StringLiteralLike).text
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  entries.sort((a, b) => a.pos - b.pos);
  return entries.map((e) => e.specifier);
}

function evalStaticConstant(expr: ts.Expression): string | boolean | null {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isParenthesizedExpression(expr)) return evalStaticConstant(expr.expression);
  return null;
}

function evalStaticBoolean(expr: ts.Expression): boolean | null {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(expr)) return evalStaticBoolean(expr.expression);
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = evalStaticBoolean(expr.operand);
    return inner === null ? null : !inner;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = evalStaticBoolean(expr.left);
      if (left === false) return false;
      if (left === true) return evalStaticBoolean(expr.right);
      return null;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const left = evalStaticBoolean(expr.left);
      if (left === true) return true;
      if (left === false) return evalStaticBoolean(expr.right);
      return null;
    }
    if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
      const left = evalStaticConstant(expr.left);
      const right = evalStaticConstant(expr.right);
      if (left !== null && right !== null) {
        return op === ts.SyntaxKind.EqualsEqualsEqualsToken ? left === right : left !== right;
      }
    }
  }
  return null;
}

/**
 * Computes TextEdits eliminating statically unreachable branches (`if (false)`, `if (true) ... else ...`,
 * `false && ...`, `true || ...`, `false ? ... : ...`) using the TypeScript AST so source maps stay valid.
 */
export function computePruneDeadBranchesEdits(sourceCode: string): TextEdit[] {
  if (!sourceCode.includes("false") && !sourceCode.includes("true")) {
    return [];
  }
  const sourceFile = parseJavaScriptModule(sourceCode);
  const edits: TextEdit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      const cond = evalStaticBoolean(node.expression);
      if (cond === false) {
        if (node.elseStatement) {
          edits.push({
            start: node.getStart(sourceFile),
            end: node.elseStatement.getStart(sourceFile),
            text: ""
          });
          visit(node.elseStatement);
        } else {
          const isBlockLike = ts.isSourceFile(node.parent) || ts.isBlock(node.parent) || ts.isCaseOrDefaultClause(node.parent);
          edits.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            text: isBlockLike ? "" : "{}"
          });
        }
        return;
      }
      if (cond === true) {
        edits.push({
          start: node.getStart(sourceFile),
          end: node.thenStatement.getStart(sourceFile),
          text: ""
        });
        visit(node.thenStatement);
        if (node.elseStatement) {
          edits.push({
            start: node.thenStatement.getEnd(),
            end: node.getEnd(),
            text: ""
          });
        }
        return;
      }
    }

    if (ts.isConditionalExpression(node)) {
      const cond = evalStaticBoolean(node.condition);
      if (cond === true) {
        edits.push({ start: node.getStart(sourceFile), end: node.whenTrue.getStart(sourceFile), text: "(" });
        visit(node.whenTrue);
        edits.push({ start: node.whenTrue.getEnd(), end: node.getEnd(), text: ")" });
        return;
      }
      if (cond === false) {
        edits.push({ start: node.getStart(sourceFile), end: node.whenFalse.getStart(sourceFile), text: "(" });
        visit(node.whenFalse);
        edits.push({ start: node.whenFalse.getEnd(), end: node.getEnd(), text: ")" });
        return;
      }
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken && evalStaticBoolean(node.left) === false) {
        edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: "false" });
        return;
      }
      if (op === ts.SyntaxKind.BarBarToken && evalStaticBoolean(node.left) === true) {
        edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: "true" });
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  edits.sort((a, b) => a.start - b.start);
  return edits;
}

/** Eliminates statically dead branches after constant replacement (`import.meta.env.DEV` -> `false`). */
export function pruneDeadBranches(sourceCode: string): string {
  const edits = computePruneDeadBranchesEdits(sourceCode);
  return applyTextEdits(sourceCode, edits);
}
