/**
 * @dotmix/compiler-frontend/ts-parser/convert-functions-classes — Converts TypeScript functions,
 * arrow functions, object literals, and classes to Acorn-compatible ESTree.
 */

import ts from "typescript";
import {
  nodeStart,
  nodeEnd,
  hasModifier,
  getAccessibility,
  makeOpaqueTypeAnnotation,
  makeOpaqueTypeList,
  convertIdentifier
} from "./ast-helpers.js";
import type { RawNode, ConvertContext } from "./ast-helpers.js";
import { convertExpression } from "./convert-expressions.js";
import {
  convertPropertyName,
  findOpenParenAfter,
  convertParameter
} from "./convert-patterns.js";
import { convertBlockStatement } from "./convert-statements.js";

function attachFunctionTypeMetadata(
  node: ts.SignatureDeclarationBase,
  result: RawNode,
  ctx: ConvertContext
): void {
  if (node.typeParameters && node.typeParameters.length > 0) {
    const openSearchStart = node.getStart(ctx.sourceFile);
    const openSearchEnd = node.parameters.pos;
    result.typeParameters = makeOpaqueTypeList(
      "TSTypeParameterDeclaration",
      node.typeParameters,
      openSearchStart,
      openSearchEnd,
      ctx
    );
  }
  if (node.type) {
    result.returnType = makeOpaqueTypeAnnotation(node.parameters.end, node.type, ctx);
  }
}

function arrowHasParenthesizedParams(node: ts.ArrowFunction, ctx: ConvertContext): boolean {
  if (node.parameters.length !== 1 || node.typeParameters !== undefined || node.type !== undefined) {
    return true;
  }
  const paramStart = node.parameters[0]!.getStart(ctx.sourceFile);
  const fnStart = node.getStart(ctx.sourceFile);
  const text = ctx.sourceFile.text;
  let i = paramStart - 1;
  while (i >= fnStart) {
    const ch = text.charCodeAt(i);
    if (ch === 40 /* ( */) return true;
    if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) return false;
    i--;
  }
  return false;
}

export function convertArrowFunction(node: ts.ArrowFunction, ctx: ConvertContext): RawNode {
  const isExprBody = !ts.isBlock(node.body);
  const body = ts.isBlock(node.body)
    ? convertBlockStatement(node.body, ctx)
    : convertExpression(node.body, ctx);

  const result: RawNode = {
    type: "ArrowFunctionExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    id: null,
    expression: isExprBody,
    generator: false,
    async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
    params: node.parameters.map((p) => convertParameter(p, ctx)),
    body
  };
  if (arrowHasParenthesizedParams(node, ctx) && !node.type) {
    result.returnType = undefined;
  }
  attachFunctionTypeMetadata(node, result, ctx);
  return result;
}

export function convertFunctionExpression(node: ts.FunctionExpression, ctx: ConvertContext): RawNode {
  const result: RawNode = {
    type: "FunctionExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    id: node.name ? convertIdentifier(node.name, ctx) : null,
    expression: false,
    generator: node.asteriskToken !== undefined,
    async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
    params: node.parameters.map((p) => convertParameter(p, ctx)),
    body: convertBlockStatement(node.body, ctx)
  };
  attachFunctionTypeMetadata(node, result, ctx);
  return result;
}

function convertMethodBodyAsFunction(
  node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration,
  fnStart: number,
  ctx: ConvertContext
): RawNode {
  const isGenerator = ts.isMethodDeclaration(node) && node.asteriskToken !== undefined;
  const isAsync = ts.isMethodDeclaration(node) && hasModifier(node, ts.SyntaxKind.AsyncKeyword);
  const body = node.body
    ? convertBlockStatement(node.body, ctx)
    : { type: "BlockStatement", start: nodeEnd(node, ctx), end: nodeEnd(node, ctx), body: [] };

  const fn: RawNode = {
    type: "FunctionExpression",
    start: fnStart,
    end: nodeEnd(node, ctx),
    id: null,
    expression: false,
    generator: isGenerator,
    async: isAsync,
    params: node.parameters.map((p) => convertParameter(p, ctx)),
    body
  };
  attachFunctionTypeMetadata(node, fn, ctx);
  return fn;
}

export function convertObjectProperty(
  prop: ts.ObjectLiteralElementLike,
  ctx: ConvertContext
): RawNode {
  const start = nodeStart(prop, ctx);
  const end = nodeEnd(prop, ctx);

  if (ts.isSpreadAssignment(prop)) {
    return {
      type: "SpreadElement",
      start,
      end,
      argument: convertExpression(prop.expression, ctx)
    };
  }

  if (ts.isShorthandPropertyAssignment(prop)) {
    const key = convertIdentifier(prop.name, ctx);
    const value = convertIdentifier(prop.name, ctx);
    return {
      type: "Property",
      start,
      end,
      method: false,
      shorthand: true,
      computed: false,
      key,
      kind: "init",
      value
    };
  }

  if (ts.isPropertyAssignment(prop)) {
    const { key, computed } = convertPropertyName(prop.name, ctx);
    return {
      type: "Property",
      start,
      end,
      method: false,
      shorthand: false,
      computed,
      key,
      value: convertExpression(prop.initializer, ctx),
      kind: "init"
    };
  }

  if (ts.isMethodDeclaration(prop)) {
    const { key, computed } = convertPropertyName(prop.name, ctx);
    const fnStart =
      prop.typeParameters && prop.typeParameters.length > 0
        ? makeOpaqueTypeList("TSTypeParameterDeclaration", prop.typeParameters, prop.name.end, prop.parameters.pos, ctx).start
        : findOpenParenAfter(prop.name.end, prop.end, ctx);
    return {
      type: "Property",
      start,
      end,
      method: true,
      shorthand: false,
      computed,
      key,
      kind: "init",
      value: convertMethodBodyAsFunction(prop, fnStart, ctx)
    };
  }

  const accessor = prop as ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
  const { key, computed } = convertPropertyName(accessor.name, ctx);
  const fnStart = findOpenParenAfter(accessor.name.end, accessor.end, ctx);
  return {
    type: "Property",
    start,
    end,
    method: false,
    shorthand: false,
    computed,
    key,
    kind: ts.isGetAccessorDeclaration(accessor) ? "get" : "set",
    value: convertMethodBodyAsFunction(accessor, fnStart, ctx)
  };
}

export function convertObjectLiteral(node: ts.ObjectLiteralExpression, ctx: ConvertContext): RawNode {
  return {
    type: "ObjectExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    properties: node.properties.map((p) => convertObjectProperty(p, ctx))
  };
}

function findClassBodyStart(node: ts.ClassLikeDeclaration, ctx: ConvertContext): number {
  const text = ctx.sourceFile.text;
  let searchFrom = node.getStart(ctx.sourceFile);
  if (node.heritageClauses && node.heritageClauses.length > 0) {
    searchFrom = node.heritageClauses[node.heritageClauses.length - 1]!.end;
  } else if (node.typeParameters && node.typeParameters.length > 0) {
    searchFrom = node.typeParameters.end;
  } else if (node.name) {
    searchFrom = node.name.end;
  }
  const end = node.end;
  let i = searchFrom;
  while (i < end) {
    if (text.charCodeAt(i) === 123 /* { */) {
      return i + ctx.offsetDelta;
    }
    i++;
  }
  return searchFrom + ctx.offsetDelta;
}

function convertClassElement(member: ts.ClassElement, ctx: ConvertContext): RawNode | null {
  const start = nodeStart(member, ctx);
  const end = nodeEnd(member, ctx);

  if (ts.isSemicolonClassElement(member)) {
    return null;
  }

  if (ts.isClassStaticBlockDeclaration(member)) {
    return {
      type: "StaticBlock",
      start,
      end,
      body: convertBlockStatement(member.body, ctx).body
    };
  }

  if (ts.isPropertyDeclaration(member)) {
    const { key, computed } = convertPropertyName(member.name, ctx);
    const accessibility = getAccessibility(member);
    const isReadonly = hasModifier(member, ts.SyntaxKind.ReadonlyKeyword);
    const isOverride = hasModifier(member, ts.SyntaxKind.OverrideKeyword);
    const isAbstract = hasModifier(member, ts.SyntaxKind.AbstractKeyword);
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);

    const result: RawNode = {
      type: isAbstract ? "TSAbstractPropertyDefinition" : "PropertyDefinition",
      start,
      end
    };
    if (accessibility) result.accessibility = accessibility;
    if (isReadonly) result.readonly = true;
    if (isOverride) result.override = true;
    result.static = isStatic;
    result.computed = computed;
    result.key = key;
    if (member.questionToken) result.optional = true;
    if (member.exclamationToken) result.definite = true;
    if (member.type) {
      result.typeAnnotation = makeOpaqueTypeAnnotation(member.name.end, member.type, ctx);
    }
    result.value = member.initializer ? convertExpression(member.initializer, ctx) : null;
    return result;
  }

  if (ts.isConstructorDeclaration(member)) {
    const accessibility = getAccessibility(member);
    const keyStart = ctx.sourceFile.text.indexOf("constructor", member.getStart(ctx.sourceFile));
    const ctorKeyStart = keyStart >= 0 ? keyStart + ctx.offsetDelta : start;
    const fnStart = findOpenParenAfter(
      keyStart >= 0 ? keyStart + "constructor".length : member.getStart(ctx.sourceFile),
      member.end,
      ctx
    );
    const result: RawNode = {
      type: "MethodDefinition",
      start,
      end,
      static: false,
      computed: false,
      key: {
        type: "Identifier",
        start: ctorKeyStart,
        end: ctorKeyStart + "constructor".length,
        name: "constructor"
      },
      kind: "constructor",
      value: convertMethodBodyAsFunction(member, fnStart, ctx)
    };
    if (accessibility) result.accessibility = accessibility;
    return result;
  }

  if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
    const { key, computed } = convertPropertyName(member.name, ctx);
    const accessibility = getAccessibility(member);
    const isOverride = hasModifier(member, ts.SyntaxKind.OverrideKeyword);
    const isAbstract = hasModifier(member, ts.SyntaxKind.AbstractKeyword);
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
    const kind = ts.isGetAccessorDeclaration(member)
      ? "get"
      : ts.isSetAccessorDeclaration(member)
        ? "set"
        : "method";
    const fnStart =
      ts.isMethodDeclaration(member) && member.typeParameters && member.typeParameters.length > 0
        ? makeOpaqueTypeList("TSTypeParameterDeclaration", member.typeParameters, member.name.end, member.parameters.pos, ctx).start
        : findOpenParenAfter(member.name.end, member.end, ctx);

    const result: RawNode = {
      type: isAbstract ? "TSAbstractMethodDefinition" : "MethodDefinition",
      start,
      end
    };
    if (accessibility) result.accessibility = accessibility;
    if (isOverride) result.override = true;
    result.static = isStatic;
    result.computed = computed;
    result.key = key;
    if (member.questionToken) result.optional = true;
    result.kind = kind;
    result.value = convertMethodBodyAsFunction(member, fnStart, ctx);
    return result;
  }

  if (ts.isIndexSignatureDeclaration(member)) {
    return {
      type: "TSIndexSignature",
      start,
      end
    };
  }

  return null;
}

export function convertClassLike(
  node: ts.ClassLikeDeclaration,
  type: "ClassExpression" | "ClassDeclaration",
  ctx: ConvertContext
): RawNode {
  let superClass: RawNode | null = null;
  let superTypeArguments: RawNode | undefined;
  let implementsList: RawNode[] | undefined;

  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types[0]) {
        const ext = clause.types[0];
        superClass = convertExpression(ext.expression, ctx);
        if (ext.typeArguments && ext.typeArguments.length > 0) {
          superTypeArguments = makeOpaqueTypeList(
            "TSTypeParameterInstantiation",
            ext.typeArguments,
            ext.expression.end,
            ext.end,
            ctx
          );
        }
      } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
        implementsList = clause.types.map((t) => ({
          type: "TSClassImplements",
          start: nodeStart(t, ctx),
          end: nodeEnd(t, ctx)
        }));
      }
    }
  }

  const bodyStart = findClassBodyStart(node, ctx);
  const bodyEnd = nodeEnd(node, ctx);
  const members: RawNode[] = [];
  for (const m of node.members) {
    const converted = convertClassElement(m, ctx);
    if (converted !== null) {
      members.push(converted);
    }
  }

  const result: RawNode = {
    type,
    start: nodeStart(node, ctx),
    end: bodyEnd,
    id: node.name ? convertIdentifier(node.name, ctx) : null,
    superClass,
    body: {
      type: "ClassBody",
      start: bodyStart,
      end: bodyEnd,
      body: members
    }
  };
  if (node.typeParameters && node.typeParameters.length > 0) {
    result.typeParameters = makeOpaqueTypeList(
      "TSTypeParameterDeclaration",
      node.typeParameters,
      node.name ? node.name.end : node.getStart(ctx.sourceFile),
      bodyStart - ctx.offsetDelta,
      ctx
    );
  }
  if (superTypeArguments) {
    result.superTypeArguments = superTypeArguments;
  }
  if (implementsList) {
    result.implements = implementsList;
  }
  return result;
}
