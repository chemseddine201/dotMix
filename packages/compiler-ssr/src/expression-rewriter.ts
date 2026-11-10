/**
 * @mix/compiler-ssr/expression-rewriter — AST-based SSR reactive expression rewriter.
 */

import { isESTreeNode, type ESTreeNode } from "@mix/ast";

/**
 * Transforms template expressions for SSR by auto-invoking bare signal identifiers
 * (e.g. `count` -> `count()`) when they match reactive variables in the component's scope.
 */
export function transformSsrExpression(
  rawExpression: string,
  expressionAst: ESTreeNode | undefined,
  signalNames: ReadonlySet<string>,
  outerShadowed: ReadonlySet<string> = new Set()
): string {
  if (!rawExpression || signalNames.size === 0) {
    return rawExpression;
  }
  if (!expressionAst) {
    const trimmed = rawExpression.trim();
    if (signalNames.has(trimmed) && !outerShadowed.has(trimmed)) {
      return `${trimmed}()`;
    }
    return rawExpression;
  }

  const baseOffset = expressionAst.start ?? 0;

  function walk(
    node: ESTreeNode,
    parent: ESTreeNode | null,
    parentKey: string | null,
    shadowed: ReadonlySet<string>
  ): string {
    const relStart = (node.start ?? baseOffset) - baseOffset;
    const relEnd = (node.end ?? baseOffset + rawExpression.length) - baseOffset;

    if (
      node.type === "TSAsExpression" ||
      node.type === "TSTypeAssertion" ||
      node.type === "TSNonNullExpression" ||
      node.type === "TSSatisfiesExpression"
    ) {
      const inner = node.expression;
      if (isESTreeNode(inner)) {
        return walk(inner, parent, parentKey, shadowed);
      }
    }

    if (node.type === "Identifier") {
      const name = typeof node.name === "string" ? node.name : "";
      if (signalNames.has(name) && !shadowed.has(name)) {
        // Do not auto-invoke if it is already the callee of a CallExpression: count()
        if (parent && parent.type === "CallExpression" && parentKey === "callee") {
          return rawExpression.slice(relStart, relEnd);
        }
        // Do not auto-invoke if it is the non-computed property of a MemberExpression: obj.count
        if (
          parent &&
          parent.type === "MemberExpression" &&
          parentKey === "property" &&
          parent.computed !== true
        ) {
          return rawExpression.slice(relStart, relEnd);
        }
        // Do not auto-invoke if it is the non-computed key of an Object property: { count: 123 }
        if (
          parent &&
          (parent.type === "Property" || parent.type === "ObjectProperty") &&
          parentKey === "key" &&
          parent.computed !== true
        ) {
          return rawExpression.slice(relStart, relEnd);
        }
        return `${name}()`;
      }
      return rawExpression.slice(relStart, relEnd);
    }

    const childReplacements: Array<{ start: number; end: number; text: string }> = [];
    let nextShadowed = shadowed;

    if (
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression"
    ) {
      const copy = new Set(shadowed);
      const params = Array.isArray(node.params) ? node.params : [];
      for (const p of params) {
        if (isESTreeNode(p) && p.type === "Identifier" && typeof p.name === "string" && p.name.length > 0) {
          copy.add(p.name);
        }
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
      if (node.type === "MemberExpression" && key === "property" && node.computed !== true) {
        continue;
      }
      if (
        (node.type === "Property" || node.type === "ObjectProperty") &&
        key === "key" &&
        node.computed !== true
      ) {
        continue;
      }

      if (Array.isArray(val)) {
        for (const item of val) {
          if (isESTreeNode(item)) {
            const cStart = (item.start ?? baseOffset) - baseOffset;
            const cEnd = (item.end ?? baseOffset) - baseOffset;
            const cText = walk(item, node, key, nextShadowed);
            if (cText !== rawExpression.slice(cStart, cEnd)) {
              childReplacements.push({ start: cStart, end: cEnd, text: cText });
            }
          }
        }
      } else if (isESTreeNode(val)) {
        const cStart = (val.start ?? baseOffset) - baseOffset;
        const cEnd = (val.end ?? baseOffset) - baseOffset;
        let cText = walk(val, node, key, nextShadowed);
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

  return walk(expressionAst, null, null, outerShadowed);
}
