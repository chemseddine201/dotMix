/**
 * @dotmix/compiler-frontend/ts-parser/convert-patterns — Converts property names, binding patterns,
 * assignment destructuring targets, and function parameters to Acorn-compatible ESTree.
 */

import ts from "typescript";
import {
  nodeStart,
  nodeEnd,
  hasModifier,
  getAccessibility,
  makeOpaqueTypeAnnotation,
  convertIdentifier,
  convertPrivateIdentifier,
  convertStringLiteral,
  convertNumericLiteral,
  convertBigIntLiteral
} from "./ast-helpers.js";
import type { RawNode, ConvertContext } from "./ast-helpers.js";
import { convertExpression } from "./convert-expressions.js";
import { convertObjectProperty } from "./convert-functions-classes.js";

export function convertPropertyName(
  name: ts.PropertyName,
  ctx: ConvertContext
): { key: RawNode; computed: boolean } {
  if (ts.isIdentifier(name)) {
    return { key: convertIdentifier(name, ctx), computed: false };
  }
  if (ts.isPrivateIdentifier(name)) {
    return { key: convertPrivateIdentifier(name, ctx), computed: false };
  }
  if (ts.isStringLiteral(name)) {
    return { key: convertStringLiteral(name, ctx), computed: false };
  }
  if (ts.isNumericLiteral(name)) {
    return { key: convertNumericLiteral(name, ctx), computed: false };
  }
  if (ts.isBigIntLiteral(name)) {
    return { key: convertBigIntLiteral(name, ctx), computed: false };
  }
  if (ts.isComputedPropertyName(name)) {
    return { key: convertExpression(name.expression, ctx), computed: true };
  }
  return { key: convertExpression(name as unknown as ts.Expression, ctx), computed: false };
}

export function findOpenParenAfter(
  searchStart: number,
  limitEnd: number,
  ctx: ConvertContext
): number {
  const text = ctx.sourceFile.text;
  let i = searchStart;
  while (i < limitEnd) {
    if (text.charCodeAt(i) === 40 /* ( */) {
      return i + ctx.offsetDelta;
    }
    i++;
  }
  return searchStart + ctx.offsetDelta;
}

export function convertBindingName(name: ts.BindingName, ctx: ConvertContext): RawNode {
  if (ts.isIdentifier(name)) {
    return convertIdentifier(name, ctx);
  }
  if (ts.isObjectBindingPattern(name)) {
    return {
      type: "ObjectPattern",
      start: nodeStart(name, ctx),
      end: nodeEnd(name, ctx),
      properties: name.elements.map((el) => convertObjectBindingElement(el, ctx))
    };
  }
  return {
    type: "ArrayPattern",
    start: nodeStart(name, ctx),
    end: nodeEnd(name, ctx),
    elements: name.elements.map((el) => {
      if (ts.isOmittedExpression(el)) return null;
      return convertArrayBindingElement(el, ctx);
    })
  };
}

function convertObjectBindingElement(el: ts.BindingElement, ctx: ConvertContext): RawNode {
  const start = nodeStart(el, ctx);
  const end = nodeEnd(el, ctx);
  if (el.dotDotDotToken) {
    return {
      type: "RestElement",
      start,
      end,
      argument: convertBindingName(el.name, ctx)
    };
  }
  const hasExplicitKey = el.propertyName !== undefined;
  let key: RawNode;
  let computed = false;
  if (el.propertyName) {
    const prop = convertPropertyName(el.propertyName, ctx);
    key = prop.key;
    computed = prop.computed;
  } else {
    key = convertBindingName(el.name, ctx);
  }

  let value: RawNode = convertBindingName(el.name, ctx);
  if (el.initializer) {
    value = {
      type: "AssignmentPattern",
      start: value.start,
      end: nodeEnd(el.initializer, ctx),
      left: value,
      right: convertExpression(el.initializer, ctx)
    };
  }

  return {
    type: "Property",
    start,
    end,
    method: false,
    shorthand: !hasExplicitKey,
    computed,
    key,
    kind: "init",
    value
  };
}

function convertArrayBindingElement(el: ts.BindingElement, ctx: ConvertContext): RawNode {
  const start = nodeStart(el, ctx);
  const end = nodeEnd(el, ctx);
  if (el.dotDotDotToken) {
    return {
      type: "RestElement",
      start,
      end,
      argument: convertBindingName(el.name, ctx)
    };
  }
  const target = convertBindingName(el.name, ctx);
  if (el.initializer) {
    return {
      type: "AssignmentPattern",
      start,
      end,
      left: target,
      right: convertExpression(el.initializer, ctx)
    };
  }
  return target;
}

export function convertAssignmentTarget(node: ts.Expression, ctx: ConvertContext): RawNode {
  if (ts.isObjectLiteralExpression(node)) {
    return {
      type: "ObjectPattern",
      start: nodeStart(node, ctx),
      end: nodeEnd(node, ctx),
      properties: node.properties.map((prop) => {
        if (ts.isSpreadAssignment(prop)) {
          return {
            type: "RestElement",
            start: nodeStart(prop, ctx),
            end: nodeEnd(prop, ctx),
            argument: convertAssignmentTarget(prop.expression, ctx)
          };
        }
        if (ts.isShorthandPropertyAssignment(prop)) {
          const key = convertIdentifier(prop.name, ctx);
          let value: RawNode = convertIdentifier(prop.name, ctx);
          if (prop.objectAssignmentInitializer) {
            value = {
              type: "AssignmentPattern",
              start: nodeStart(prop, ctx),
              end: nodeEnd(prop, ctx),
              left: value,
              right: convertExpression(prop.objectAssignmentInitializer, ctx)
            };
          }
          return {
            type: "Property",
            start: nodeStart(prop, ctx),
            end: nodeEnd(prop, ctx),
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
            start: nodeStart(prop, ctx),
            end: nodeEnd(prop, ctx),
            method: false,
            shorthand: false,
            computed,
            key,
            value: convertAssignmentTarget(prop.initializer, ctx),
            kind: "init"
          };
        }
        return convertObjectProperty(prop, ctx);
      })
    };
  }

  if (ts.isArrayLiteralExpression(node)) {
    return {
      type: "ArrayPattern",
      start: nodeStart(node, ctx),
      end: nodeEnd(node, ctx),
      elements: node.elements.map((el) => {
        if (el.kind === ts.SyntaxKind.OmittedExpression) return null;
        if (ts.isSpreadElement(el)) {
          return {
            type: "RestElement",
            start: nodeStart(el, ctx),
            end: nodeEnd(el, ctx),
            argument: convertAssignmentTarget(el.expression, ctx)
          };
        }
        return convertAssignmentTarget(el, ctx);
      })
    };
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return {
      type: "AssignmentPattern",
      start: nodeStart(node, ctx),
      end: nodeEnd(node, ctx),
      left: convertAssignmentTarget(node.left, ctx),
      right: convertExpression(node.right, ctx)
    };
  }

  return convertExpression(node, ctx);
}

export function convertParameter(param: ts.ParameterDeclaration, ctx: ConvertContext): RawNode {
  const paramStart = nodeStart(param, ctx);
  const paramEnd = nodeEnd(param, ctx);

  let core: RawNode;
  if (param.dotDotDotToken) {
    const restEnd = param.type ? nodeEnd(param.type, ctx) : nodeEnd(param.name, ctx);
    core = {
      type: "RestElement",
      start: paramStart,
      end: restEnd,
      argument: convertBindingName(param.name, ctx)
    };
    if (param.type) {
      core.typeAnnotation = makeOpaqueTypeAnnotation(param.name.end, param.type, ctx);
    }
  } else {
    core = convertBindingName(param.name, ctx);
    if (param.questionToken) {
      core.optional = true;
    }
    if (param.type) {
      core.typeAnnotation = makeOpaqueTypeAnnotation(param.name.end, param.type, ctx);
      core.end = nodeEnd(param.type, ctx);
    } else if (param.questionToken) {
      core.end = nodeEnd(param.questionToken, ctx);
    }
  }

  if (param.initializer) {
    const assigned: RawNode = {
      type: "AssignmentPattern",
      start: paramStart,
      end: paramEnd,
      left: core,
      right: convertExpression(param.initializer, ctx)
    };
    return wrapParameterProperty(param, assigned, paramStart, paramEnd);
  }

  return wrapParameterProperty(param, core, paramStart, paramEnd);
}

function wrapParameterProperty(
  param: ts.ParameterDeclaration,
  inner: RawNode,
  start: number,
  end: number
): RawNode {
  const accessibility = getAccessibility(param);
  const isReadonly = hasModifier(param, ts.SyntaxKind.ReadonlyKeyword);
  const isOverride = hasModifier(param, ts.SyntaxKind.OverrideKeyword);
  if (!accessibility && !isReadonly && !isOverride) {
    return inner;
  }
  const prop: RawNode = {
    type: "TSParameterProperty",
    start,
    end,
    parameter: inner
  };
  if (accessibility) prop.accessibility = accessibility;
  if (isReadonly) prop.readonly = true;
  if (isOverride) prop.override = true;
  return prop;
}

