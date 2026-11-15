/**
 * @dotmix/compiler-semantic/directives/expr-each-helpers — Recursive Each index-getter normalization and canonical skip/stop builders.
 */

import {
  deepFreeze,
  isESTreeNode,
  type AttributeNode,
  type ConditionalAttributeNode,
  type ConditionalEventNode,
  type ConditionalSpreadNode,
  type ESTreeNode,
  type TemplateNode
} from "@dotmix/ast";
import {
  cloneAndRewriteAst,
  normalizeBlockConditionToCanonicalArrow,
  normalizeEachBodyExpression,
  rewriteIdentifiersToString
} from "./expr-helpers.js";

function rewriteAttributeForEachIndex(
  attr: AttributeNode,
  indexIdentifier: string
): AttributeNode {
  switch (attr.type) {
    case "DynamicAttribute": {
      if (attr.templateValue) {
        return deepFreeze({
          ...attr,
          templateValue: rewriteEachIndexInTemplateTree(attr.templateValue, indexIdentifier)
        });
      }
      const next = normalizeEachBodyExpression(attr.rawExpression, attr.expression, indexIdentifier);
      return deepFreeze({ ...attr, rawExpression: next.rawExpression, expression: next.expression });
    }
    case "DirectiveAttribute": {
      const next = normalizeEachBodyExpression(attr.rawExpression, attr.expression, indexIdentifier);
      return deepFreeze({ ...attr, rawExpression: next.rawExpression, expression: next.expression });
    }
    case "EventBinding": {
      const next = normalizeEachBodyExpression(attr.rawHandler, attr.handler, indexIdentifier);
      return deepFreeze({ ...attr, rawHandler: next.rawExpression, handler: next.expression });
    }
    case "RefBinding":
    case "BindBinding": {
      const next = normalizeEachBodyExpression(attr.rawTarget, attr.target, indexIdentifier);
      return deepFreeze({ ...attr, rawTarget: next.rawExpression, target: next.expression });
    }
    case "ConditionalAttribute": {
      if (!attr.expression) return attr;
      const next = normalizeEachBodyExpression(attr.rawExpression, attr.expression, indexIdentifier);
      return deepFreeze<ConditionalAttributeNode>({ ...attr, rawExpression: next.rawExpression, expression: next.expression });
    }
    case "ConditionalEvent": {
      const next = normalizeEachBodyExpression(attr.rawExpression, attr.expression, indexIdentifier);
      return deepFreeze<ConditionalEventNode>({ ...attr, rawExpression: next.rawExpression, expression: next.expression });
    }
    case "ClassMap":
    case "StyleMap": {
      const next = normalizeEachBodyExpression(attr.rawExpression, attr.expression, indexIdentifier);
      return deepFreeze({ ...attr, rawExpression: next.rawExpression, expression: next.expression });
    }
    case "ConditionalSpread": {
      const nextSpread = normalizeEachBodyExpression(attr.rawSpreadExpression, attr.spreadExpression, indexIdentifier);
      const nextCond =
        attr.condition && attr.rawCondition !== null
          ? normalizeEachBodyExpression(attr.rawCondition, attr.condition, indexIdentifier)
          : null;
      return deepFreeze<ConditionalSpreadNode>({
        ...attr,
        spreadExpression: nextSpread.expression,
        rawSpreadExpression: nextSpread.rawExpression,
        condition: nextCond ? nextCond.expression : null,
        rawCondition: nextCond ? nextCond.rawExpression : null
      });
    }
    default:
      return attr;
  }
}

export function rewriteEachIndexInTemplateTree(
  nodes: readonly TemplateNode[],
  indexIdentifier: string | null
): readonly TemplateNode[] {
  if (!indexIdentifier) return nodes;

  function transformNode(node: TemplateNode): TemplateNode {
    switch (node.type) {
      case "Interpolation": {
        const next = normalizeEachBodyExpression(node.rawExpression, node.expression, indexIdentifier);
        return deepFreeze({ ...node, rawExpression: next.rawExpression, expression: next.expression });
      }
      case "Element":
      case "ComponentCall":
        return deepFreeze({
          ...node,
          attributes: deepFreeze(node.attributes.map((attr) => rewriteAttributeForEachIndex(attr, indexIdentifier!))),
          children: rewriteEachIndexInTemplateTree(node.children, indexIdentifier)
        });
      case "DynamicElement": {
        const tagNext = normalizeEachBodyExpression(node.rawTagExpression, node.tagExpression, indexIdentifier);
        return deepFreeze({
          ...node,
          tagExpression: tagNext.expression,
          rawTagExpression: tagNext.rawExpression,
          attributes: deepFreeze(node.attributes.map((attr) => rewriteAttributeForEachIndex(attr, indexIdentifier!))),
          children: rewriteEachIndexInTemplateTree(node.children, indexIdentifier)
        });
      }
      case "IfBlock": {
        const condNext = normalizeEachBodyExpression(node.rawCondition, node.condition, indexIdentifier);
        const nextAlt =
          node.alternate === null
            ? null
            : Array.isArray(node.alternate)
              ? rewriteEachIndexInTemplateTree(node.alternate, indexIdentifier)
              : transformNode(node.alternate as TemplateNode);
        return deepFreeze({
          ...node,
          condition: condNext.expression,
          rawCondition: condNext.rawExpression,
          consequent: rewriteEachIndexInTemplateTree(node.consequent, indexIdentifier),
          alternate: nextAlt as typeof node.alternate
        });
      }
      case "EachBlock":
      case "EachExtBlock": {
        const collNext = normalizeEachBodyExpression(node.rawCollection, node.collection, indexIdentifier);
        const isShadowed = node.itemIdentifier === indexIdentifier || node.indexIdentifier === indexIdentifier;
        if (isShadowed) {
          return deepFreeze({ ...node, collection: collNext.expression, rawCollection: collNext.rawExpression });
        }
        return deepFreeze({
          ...node,
          collection: collNext.expression,
          rawCollection: collNext.rawExpression,
          children: rewriteEachIndexInTemplateTree(node.children, indexIdentifier),
          ...("empty" in node && node.empty ? { empty: rewriteEachIndexInTemplateTree(node.empty, indexIdentifier) } : {})
        });
      }
      case "UnlessBlock":
      case "IsEmptyBlock":
      case "ContextBlock":
      case "EnvGate":
      case "GuestBlock":
      case "IsSetBlock":
      case "AuthBlock":
      case "SessionBlock":
      case "CannotBlock":
      case "CanAnyBlock":
        return deepFreeze({
          ...node,
          consequent: rewriteEachIndexInTemplateTree(node.consequent, indexIdentifier),
          alternate: node.alternate ? rewriteEachIndexInTemplateTree(node.alternate, indexIdentifier) : null
        });
      case "Once":
      case "Memo":
      case "KeepAliveBlock":
      case "Section":
      case "HasSection":
      case "SectionMissing":
      case "StackPush":
      case "Partial":
      case "FieldError":
      case "FormErrors":
      case "FieldValid":
      case "ForBlock":
        return deepFreeze({
          ...node,
          children: rewriteEachIndexInTemplateTree(node.children, indexIdentifier)
        });
      case "SwitchBlock":
        return deepFreeze({
          ...node,
          cases: deepFreeze(
            node.cases.map((caseBranch) =>
              deepFreeze({ ...caseBranch, body: rewriteEachIndexInTemplateTree(caseBranch.body, indexIdentifier) })
            )
          ),
          defaultBranch: node.defaultBranch ? rewriteEachIndexInTemplateTree(node.defaultBranch, indexIdentifier) : null
        });
      case "Lazy":
        return deepFreeze({
          ...node,
          children: rewriteEachIndexInTemplateTree(node.children, indexIdentifier),
          fallback: rewriteEachIndexInTemplateTree(node.fallback, indexIdentifier)
        });
      case "AwaitBlock": {
        const expNext = normalizeEachBodyExpression(node.rawExpression, node.expression, indexIdentifier);
        return deepFreeze({
          ...node,
          expression: expNext.expression,
          rawExpression: expNext.rawExpression,
          pending: rewriteEachIndexInTemplateTree(node.pending, indexIdentifier),
          thenBranch: node.thenIdentifier === indexIdentifier ? node.thenBranch : rewriteEachIndexInTemplateTree(node.thenBranch, indexIdentifier),
          catchBranch: node.catchIdentifier === indexIdentifier ? node.catchBranch : rewriteEachIndexInTemplateTree(node.catchBranch, indexIdentifier)
        });
      }
      case "CanChain":
        return deepFreeze({
          ...node,
          branches: deepFreeze(
            node.branches.map((branch) =>
              deepFreeze({ ...branch, body: rewriteEachIndexInTemplateTree(branch.body, indexIdentifier) })
            )
          ),
          alternate: node.alternate ? rewriteEachIndexInTemplateTree(node.alternate, indexIdentifier) : null
        });
      case "Yield":
        return deepFreeze({
          ...node,
          fallback: rewriteEachIndexInTemplateTree(node.fallback, indexIdentifier)
        });
      case "Include":
        return deepFreeze({
          ...node,
          pending: rewriteEachIndexInTemplateTree(node.pending, indexIdentifier),
          fallback: rewriteEachIndexInTemplateTree(node.fallback, indexIdentifier)
        });
      case "IncludeFirst":
        return deepFreeze({
          ...node,
          pending: rewriteEachIndexInTemplateTree(node.pending, indexIdentifier),
          fallback: rewriteEachIndexInTemplateTree(node.fallback, indexIdentifier)
        });
      default:
        return node;
    }
  }

  return deepFreeze(nodes.map((child) => transformNode(child)));
}

export function buildCanonicalSkipStopFromControls(
  controls: readonly { kind: "continue" | "break"; condition: ESTreeNode; rawCondition: string }[],
  kind: "continue" | "break",
  itemIdent: string,
  indexIdent: string | null
): { expression: ESTreeNode; raw: string } | null {
  const matching = controls.filter((ctrl) => ctrl.kind === kind);
  if (matching.length === 0) return null;

  if (matching.length === 1) {
    const single = matching[0]!;
    const rawArrow = normalizeBlockConditionToCanonicalArrow(
      single.condition,
      single.rawCondition,
      itemIdent,
      indexIdent
    );
    const arrowAst = deepFreeze({
      type: "ArrowFunctionExpression",
      params: [
        { type: "Identifier", name: "__mix_item" },
        { type: "Identifier", name: "__mix_index" }
      ],
      body: single.condition,
      expression: true,
      async: false,
      start: single.condition.start,
      end: single.condition.end,
      range: single.condition.range,
      loc: single.condition.loc
    }) as ESTreeNode;
    return { expression: arrowAst, raw: rawArrow };
  }

  const arrowBodies = matching.map((item) =>
    normalizeBlockConditionToCanonicalArrow(item.condition, item.rawCondition, itemIdent, indexIdent)
  );
  const combinedRaw = `(__mix_item, __mix_index) => (${arrowBodies.map((fnText) => `((${fnText})(__mix_item, __mix_index))`).join(" || ")})`;
  const combinedAst = deepFreeze({
    type: "ArrowFunctionExpression",
    params: [
      { type: "Identifier", name: "__mix_item" },
      { type: "Identifier", name: "__mix_index" }
    ],
    body: matching[0]!.condition,
    expression: true,
    async: false,
    start: matching[0]!.condition.start,
    end: matching[0]!.condition.end,
    range: matching[0]!.condition.range,
    loc: matching[0]!.condition.loc
  }) as ESTreeNode;
  return { expression: combinedAst, raw: combinedRaw };
}

export function extractEachKeyBody(
  keyExpr: ESTreeNode,
  rawKey: string,
  targetItemIdent: string,
  targetIndexIdent: string | null
): { expression: ESTreeNode; raw: string } {
  if (keyExpr.type !== "ArrowFunctionExpression" || keyExpr.expression !== true || !isESTreeNode(keyExpr.body)) {
    return { expression: keyExpr, raw: rawKey };
  }
  const params = Array.isArray(keyExpr.params) ? (keyExpr.params as ESTreeNode[]) : [];
  if (params.length === 0 || params.length > 2) {
    return { expression: keyExpr, raw: rawKey };
  }
  const renameMap = new Map<string, string>();
  const p0 = params[0];
  if (p0?.type !== "Identifier" || typeof p0.name !== "string") return { expression: keyExpr, raw: rawKey };
  if (p0.name !== targetItemIdent) renameMap.set(p0.name, targetItemIdent);
  if (params[1]) {
    const p1 = params[1];
    if (p1.type !== "Identifier" || typeof p1.name !== "string" || !targetIndexIdent) {
      return { expression: keyExpr, raw: rawKey };
    }
    if (p1.name !== targetIndexIdent) renameMap.set(p1.name, targetIndexIdent);
  }
  const bodyNode = keyExpr.body as ESTreeNode;
  const baseOffset = keyExpr.start ?? 0;
  const rawBody = rawKey.slice((bodyNode.start ?? baseOffset) - baseOffset, (bodyNode.end ?? baseOffset + rawKey.length) - baseOffset);
  if (renameMap.size === 0) return { expression: bodyNode, raw: rawBody };
  return {
    expression: cloneAndRewriteAst(bodyNode, renameMap, new Set(), new Set()).ast,
    raw: rewriteIdentifiersToString(rawBody, bodyNode, renameMap, new Set())
  };
}
