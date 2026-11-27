/**
 * @dotmix/compiler-frontend/ts-parser/convert-chains — Converts optional chains, member accesses,
 * call expressions, new expressions, and non-null assertions into Acorn-compatible ESTree.
 */

import ts from "typescript";
import {
  nodeStart,
  nodeEnd,
  makeOpaqueTypeList,
  convertIdentifier,
  convertPrivateIdentifier
} from "./ast-helpers.js";
import type { RawNode, ConvertContext } from "./ast-helpers.js";
import { convertExpression } from "./convert-expressions.js";

export function isOptionalChainNode(node: ts.Expression): boolean {
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node)
  ) {
    if (node.questionDotToken !== undefined) {
      return true;
    }
    return isOptionalChainNode(node.expression);
  }
  if (ts.isNonNullExpression(node)) {
    return isOptionalChainNode(node.expression);
  }
  return false;
}

export function convertChainInner(node: ts.Expression, ctx: ConvertContext): RawNode {
  if (ts.isPropertyAccessExpression(node)) {
    return convertPropertyAccess(node, ctx, true);
  }
  if (ts.isElementAccessExpression(node)) {
    return convertElementAccess(node, ctx, true);
  }
  if (ts.isCallExpression(node)) {
    return convertCallExpression(node, ctx, true);
  }
  if (ts.isNonNullExpression(node)) {
    return {
      type: "TSNonNullExpression",
      start: nodeStart(node, ctx),
      end: nodeEnd(node, ctx),
      expression: convertChainInner(node.expression, ctx)
    };
  }
  return convertExpression(node, ctx);
}

export function convertPropertyAccess(
  node: ts.PropertyAccessExpression,
  ctx: ConvertContext,
  insideChain: boolean
): RawNode {
  if (!insideChain && isOptionalChainNode(node)) {
    const inner = convertPropertyAccess(node, ctx, true);
    return {
      type: "ChainExpression",
      start: inner.start,
      end: inner.end,
      expression: inner
    };
  }
  const object = insideChain
    ? convertChainInner(node.expression, ctx)
    : convertExpression(node.expression, ctx);
  const property = ts.isPrivateIdentifier(node.name)
    ? convertPrivateIdentifier(node.name, ctx)
    : convertIdentifier(node.name, ctx);
  return {
    type: "MemberExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    object,
    property,
    computed: false,
    optional: node.questionDotToken !== undefined
  };
}

export function convertElementAccess(
  node: ts.ElementAccessExpression,
  ctx: ConvertContext,
  insideChain: boolean
): RawNode {
  if (!insideChain && isOptionalChainNode(node)) {
    const inner = convertElementAccess(node, ctx, true);
    return {
      type: "ChainExpression",
      start: inner.start,
      end: inner.end,
      expression: inner
    };
  }
  const object = insideChain
    ? convertChainInner(node.expression, ctx)
    : convertExpression(node.expression, ctx);
  const property = convertExpression(node.argumentExpression, ctx);
  return {
    type: "MemberExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    object,
    property,
    computed: true,
    optional: node.questionDotToken !== undefined
  };
}

export function convertCallExpression(
  node: ts.CallExpression,
  ctx: ConvertContext,
  insideChain: boolean
): RawNode {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const args = node.arguments;
    const source = args[0] ? convertExpression(args[0], ctx) : null;
    const result: RawNode = {
      type: "ImportExpression",
      start: nodeStart(node, ctx),
      end: nodeEnd(node, ctx),
      source
    };
    if (args.length > 1) {
      result.arguments = args.slice(1).map((a) => convertExpression(a, ctx));
    }
    return result;
  }

  if (!insideChain && isOptionalChainNode(node)) {
    const inner = convertCallExpression(node, ctx, true);
    return {
      type: "ChainExpression",
      start: inner.start,
      end: inner.end,
      expression: inner
    };
  }

  const callee = insideChain
    ? convertChainInner(node.expression, ctx)
    : convertExpression(node.expression, ctx);
  const args = node.arguments.map((a) => convertExpression(a, ctx));
  const hasTypeArgs = node.typeArguments !== undefined && node.typeArguments.length > 0;
  const isOptional = node.questionDotToken !== undefined;
  const result: RawNode = {
    type: "CallExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    callee,
    arguments: args
  };
  if (insideChain || !hasTypeArgs || isOptional) {
    result.optional = isOptional;
  }

  if (hasTypeArgs && node.typeArguments) {
    const searchStart = node.questionDotToken ? node.questionDotToken.end : node.expression.end;
    const searchEnd = node.arguments.pos;
    result.typeArguments = makeOpaqueTypeList(
      "TSTypeParameterInstantiation",
      node.typeArguments,
      searchStart,
      searchEnd,
      ctx
    );
  }
  return result;
}

export function convertNewExpression(node: ts.NewExpression, ctx: ConvertContext): RawNode {
  const callee = convertExpression(node.expression, ctx);
  const args = node.arguments ? node.arguments.map((a) => convertExpression(a, ctx)) : [];
  const result: RawNode = {
    type: "NewExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    callee,
    arguments: args
  };
  if (node.typeArguments && node.typeArguments.length > 0) {
    const searchEnd = node.arguments ? node.arguments.pos : node.end;
    result.typeArguments = makeOpaqueTypeList(
      "TSTypeParameterInstantiation",
      node.typeArguments,
      node.expression.end,
      searchEnd,
      ctx
    );
  }
  return result;
}

