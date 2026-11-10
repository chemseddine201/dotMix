/**
 * @mix/compiler-semantic/expression-rewriter — AST-based expression transformer for code generation (Guardrail D).
 */

import { isESTreeNode } from "@mix/ast";
import type { ESTreeNode } from "@mix/ast";
import { collectPatternIdentifiers } from "./scope-analyzer.js";

function isRewritableAstNode(val: unknown): val is ESTreeNode {
  if (!isESTreeNode(val) || Array.isArray(val)) return false;
  return (
    (typeof val.start === "number" &&
      typeof val.end === "number" &&
      !val.type.startsWith("TS")) ||
    val.type === "TSAsExpression" ||
    val.type === "TSTypeAssertion" ||
    val.type === "TSNonNullExpression" ||
    val.type === "TSSatisfiesExpression"
  );
}

/**
 * AST-based expression transformer for code generation (Guardrail D: zero regexes).
 * Rewrites referenced `{#each}` loop variables to their signal getter calls (e.g. `item` -> `__get_item()`)
 * and strips TypeScript type assertions (`as T`, `!`, `satisfies T`) using exact AST offsets.
 */
export function transformExpressionAstToJs(
  rawExpression: string,
  expressionAst: ESTreeNode,
  loopGetterMap: ReadonlyMap<string, string>
): string {
  const baseOffset = expressionAst.start ?? 0;

  function walkExpr(node: ESTreeNode, shadowed: ReadonlySet<string>): string {
    const relStart = (node.start ?? baseOffset) - baseOffset;
    const relEnd = (node.end ?? baseOffset + rawExpression.length) - baseOffset;

    if (
      node.type === "TSAsExpression" ||
      node.type === "TSTypeAssertion" ||
      node.type === "TSNonNullExpression" ||
      node.type === "TSSatisfiesExpression"
    ) {
      const inner = node.expression as ESTreeNode | undefined;
      if (inner) {
        return walkExpr(inner, shadowed);
      }
    }

    if (node.type === "Identifier") {
      const name = typeof node.name === "string" ? node.name : "";
      if (!shadowed.has(name) && loopGetterMap.has(name)) {
        return `${loopGetterMap.get(name)!}()`;
      }
      return rawExpression.slice(relStart, relEnd);
    }

    // Collect direct child AST nodes and their replacements
    const childReplacements: Array<{ start: number; end: number; text: string }> = [];
    let nextShadowed = shadowed;

    if (
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression"
    ) {
      const copy = new Set(shadowed);
      const params = Array.isArray(node.params) ? (node.params as ESTreeNode[]) : [];
      for (const p of params) {
        collectPatternIdentifiers(p, copy);
      }
      nextShadowed = copy;
    }

    for (const [key, val] of Object.entries(node)) {
      if (
        key === "type" ||
        key === "start" ||
        key === "end" ||
        key === "loc" ||
        key === "range" ||
        key === "typeAnnotation" ||
        key === "typeParameters" ||
        key === "returnType"
      ) {
        continue;
      }
      if (node.type === "MemberExpression" && key === "property" && node.computed === false) {
        continue;
      }
      if (
        (node.type === "Property" || node.type === "ObjectProperty") &&
        key === "key" &&
        node.computed === false &&
        node.shorthand !== true
      ) {
        continue;
      }

      if (Array.isArray(val)) {
        for (const item of val) {
          if (isRewritableAstNode(item)) {
            const cStart = (item.start ?? baseOffset) - baseOffset;
            const cEnd = (item.end ?? baseOffset) - baseOffset;
            const cText = walkExpr(item, nextShadowed);
            if (cText !== rawExpression.slice(cStart, cEnd)) {
              childReplacements.push({ start: cStart, end: cEnd, text: cText });
            }
          }
        }
      } else if (isRewritableAstNode(val)) {
        const cStart = (val.start ?? baseOffset) - baseOffset;
        const cEnd = (val.end ?? baseOffset) - baseOffset;
        let cText = walkExpr(val, nextShadowed);
        if (
          (node.type === "Property" || node.type === "ObjectProperty") &&
          key === "value" &&
          node.shorthand === true &&
          cText !== rawExpression.slice(cStart, cEnd)
        ) {
          const origKey = rawExpression.slice(cStart, cEnd);
          cText = `${origKey}: ${cText}`;
        }
        if (cText !== rawExpression.slice(cStart, cEnd)) {
          childReplacements.push({ start: cStart, end: cEnd, text: cText });
        }
      }
    }

    // Also strip parameter type annotations inside arrow/function expressions
    if (
      (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") &&
      Array.isArray(node.params)
    ) {
      for (const p of node.params as ESTreeNode[]) {
        const typeAnn = p.typeAnnotation as ESTreeNode | undefined;
        if (typeAnn && typeof typeAnn.start === "number" && typeof typeAnn.end === "number") {
          childReplacements.push({
            start: typeAnn.start - baseOffset,
            end: typeAnn.end - baseOffset,
            text: ""
          });
        }
      }
      const retType = node.returnType as ESTreeNode | undefined;
      if (retType && typeof retType.start === "number" && typeof retType.end === "number") {
        childReplacements.push({
          start: retType.start - baseOffset,
          end: retType.end - baseOffset,
          text: ""
        });
      }
    }

    childReplacements.sort((a, b) => b.start - a.start);
    let slice = rawExpression.slice(relStart, relEnd);
    for (const rep of childReplacements) {
      const localStart = rep.start - relStart;
      const localEnd = rep.end - relStart;
      if (localStart >= 0 && localEnd <= slice.length) {
        slice = slice.slice(0, localStart) + rep.text + slice.slice(localEnd);
      }
    }
    return slice;
  }

  return walkExpr(expressionAst, new Set());
}
