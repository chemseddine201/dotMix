/**
 * @dotmix/compiler-frontend/ts-parser/convert-expressions — Converts TypeScript expression nodes
 * into Acorn-compatible ESTree plain objects.
 */

import ts from "typescript";
import {
  nodeStart,
  nodeEnd,
  makeOpaqueTypeNode,
  makeOpaqueTypeList,
  convertIdentifier,
  convertPrivateIdentifier,
  convertNumericLiteral,
  convertBigIntLiteral,
  convertStringLiteral,
  convertRegexLiteral,
  convertNoSubstitutionTemplate,
  convertTemplateSpanElement
} from "./ast-helpers.js";
import type { RawNode, ConvertContext } from "./ast-helpers.js";
import {
  isOptionalChainNode,
  convertChainInner,
  convertPropertyAccess,
  convertElementAccess,
  convertCallExpression,
  convertNewExpression
} from "./convert-chains.js";
import { convertAssignmentTarget } from "./convert-patterns.js";
import {
  convertArrowFunction,
  convertFunctionExpression,
  convertObjectLiteral,
  convertClassLike
} from "./convert-functions-classes.js";

const LOGICAL_OPERATORS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.AmpersandAmpersandToken, "&&"],
  [ts.SyntaxKind.BarBarToken, "||"],
  [ts.SyntaxKind.QuestionQuestionToken, "??"]
]);

const ASSIGNMENT_OPERATORS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.EqualsToken, "="],
  [ts.SyntaxKind.PlusEqualsToken, "+="],
  [ts.SyntaxKind.MinusEqualsToken, "-="],
  [ts.SyntaxKind.AsteriskEqualsToken, "*="],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, "**="],
  [ts.SyntaxKind.SlashEqualsToken, "/="],
  [ts.SyntaxKind.PercentEqualsToken, "%="],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, "<<="],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ">>="],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ">>>="],
  [ts.SyntaxKind.AmpersandEqualsToken, "&="],
  [ts.SyntaxKind.BarEqualsToken, "|="],
  [ts.SyntaxKind.CaretEqualsToken, "^="],
  [ts.SyntaxKind.AmpersandAmpersandEqualsToken, "&&="],
  [ts.SyntaxKind.BarBarEqualsToken, "||="],
  [ts.SyntaxKind.QuestionQuestionEqualsToken, "??="]
]);

const BINARY_OPERATORS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.PlusToken, "+"],
  [ts.SyntaxKind.MinusToken, "-"],
  [ts.SyntaxKind.AsteriskToken, "*"],
  [ts.SyntaxKind.AsteriskAsteriskToken, "**"],
  [ts.SyntaxKind.SlashToken, "/"],
  [ts.SyntaxKind.PercentToken, "%"],
  [ts.SyntaxKind.EqualsEqualsToken, "=="],
  [ts.SyntaxKind.ExclamationEqualsToken, "!="],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, "==="],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
  [ts.SyntaxKind.LessThanToken, "<"],
  [ts.SyntaxKind.LessThanEqualsToken, "<="],
  [ts.SyntaxKind.GreaterThanToken, ">"],
  [ts.SyntaxKind.GreaterThanEqualsToken, ">="],
  [ts.SyntaxKind.LessThanLessThanToken, "<<"],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, ">>"],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, ">>>"],
  [ts.SyntaxKind.AmpersandToken, "&"],
  [ts.SyntaxKind.BarToken, "|"],
  [ts.SyntaxKind.CaretToken, "^"],
  [ts.SyntaxKind.InKeyword, "in"],
  [ts.SyntaxKind.InstanceOfKeyword, "instanceof"]
]);

const PREFIX_OPERATORS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.PlusToken, "+"],
  [ts.SyntaxKind.MinusToken, "-"],
  [ts.SyntaxKind.TildeToken, "~"],
  [ts.SyntaxKind.ExclamationToken, "!"]
]);

function flattenSequence(node: ts.BinaryExpression, out: ts.Expression[]): void {
  if (ts.isBinaryExpression(node.left) && node.left.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    flattenSequence(node.left, out);
  } else {
    out.push(node.left);
  }
  if (ts.isBinaryExpression(node.right) && node.right.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    flattenSequence(node.right, out);
  } else {
    out.push(node.right);
  }
}

function convertBinaryExpression(node: ts.BinaryExpression, ctx: ConvertContext): RawNode {
  const opKind = node.operatorToken.kind;

  if (opKind === ts.SyntaxKind.CommaToken) {
    const items: ts.Expression[] = [];
    flattenSequence(node, items);
    return {
      type: "SequenceExpression",
      start: nodeStart(node, ctx),
      end: nodeEnd(node, ctx),
      expressions: items.map((e) => convertExpression(e, ctx))
    };
  }

  const logicalOp = LOGICAL_OPERATORS.get(opKind);
  if (logicalOp !== undefined) {
    return {
      type: "LogicalExpression",
      start: nodeStart(node, ctx),
      end: nodeEnd(node, ctx),
      left: convertExpression(node.left, ctx),
      operator: logicalOp,
      right: convertExpression(node.right, ctx)
    };
  }

  const assignOp = ASSIGNMENT_OPERATORS.get(opKind);
  if (assignOp !== undefined) {
    return {
      type: "AssignmentExpression",
      start: nodeStart(node, ctx),
      end: nodeEnd(node, ctx),
      operator: assignOp,
      left: convertAssignmentTarget(node.left, ctx),
      right: convertExpression(node.right, ctx)
    };
  }

  const binOp = BINARY_OPERATORS.get(opKind) ?? node.operatorToken.getText(ctx.sourceFile);
  return {
    type: "BinaryExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    left: convertExpression(node.left, ctx),
    operator: binOp,
    right: convertExpression(node.right, ctx)
  };
}

function convertTemplateExpression(node: ts.TemplateExpression, ctx: ConvertContext): RawNode {
  const quasis: RawNode[] = [convertTemplateSpanElement(node.head, ctx)];
  const expressions: RawNode[] = [];
  for (const span of node.templateSpans) {
    expressions.push(convertExpression(span.expression, ctx));
    quasis.push(convertTemplateSpanElement(span.literal, ctx));
  }
  return {
    type: "TemplateLiteral",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    expressions,
    quasis
  };
}

function convertTaggedTemplate(node: ts.TaggedTemplateExpression, ctx: ConvertContext): RawNode {
  const tag = convertExpression(node.tag, ctx);
  const quasi = ts.isNoSubstitutionTemplateLiteral(node.template)
    ? convertNoSubstitutionTemplate(node.template, ctx)
    : convertTemplateExpression(node.template, ctx);
  const result: RawNode = {
    type: "TaggedTemplateExpression",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    tag,
    quasi
  };
  if (node.typeArguments && node.typeArguments.length > 0) {
    result.typeArguments = makeOpaqueTypeList(
      "TSTypeParameterInstantiation",
      node.typeArguments,
      node.tag.end,
      node.template.getStart(ctx.sourceFile),
      ctx
    );
  }
  return result;
}

function convertMetaProperty(node: ts.MetaProperty, ctx: ConvertContext): RawNode {
  const start = nodeStart(node, ctx);
  const end = nodeEnd(node, ctx);
  const metaName = node.keywordToken === ts.SyntaxKind.ImportKeyword ? "import" : "new";
  return {
    type: "MetaProperty",
    start,
    end,
    meta: {
      type: "Identifier",
      start,
      end: start + metaName.length,
      name: metaName
    },
    property: convertIdentifier(node.name, ctx)
  };
}

export function convertExpression(node: ts.Expression, ctx: ConvertContext): RawNode {
  switch (node.kind) {
    case ts.SyntaxKind.Identifier:
      return convertIdentifier(node as ts.Identifier, ctx);
    case ts.SyntaxKind.PrivateIdentifier:
      return convertPrivateIdentifier(node as ts.PrivateIdentifier, ctx);
    case ts.SyntaxKind.ThisKeyword:
      return { type: "ThisExpression", start: nodeStart(node, ctx), end: nodeEnd(node, ctx) };
    case ts.SyntaxKind.SuperKeyword:
      return { type: "Super", start: nodeStart(node, ctx), end: nodeEnd(node, ctx) };
    case ts.SyntaxKind.NullKeyword:
      return { type: "Literal", start: nodeStart(node, ctx), end: nodeEnd(node, ctx), value: null, raw: "null" };
    case ts.SyntaxKind.TrueKeyword:
      return { type: "Literal", start: nodeStart(node, ctx), end: nodeEnd(node, ctx), value: true, raw: "true" };
    case ts.SyntaxKind.FalseKeyword:
      return { type: "Literal", start: nodeStart(node, ctx), end: nodeEnd(node, ctx), value: false, raw: "false" };
    case ts.SyntaxKind.NumericLiteral:
      return convertNumericLiteral(node as ts.NumericLiteral, ctx);
    case ts.SyntaxKind.BigIntLiteral:
      return convertBigIntLiteral(node as ts.BigIntLiteral, ctx);
    case ts.SyntaxKind.StringLiteral:
      return convertStringLiteral(node as ts.StringLiteral, ctx);
    case ts.SyntaxKind.RegularExpressionLiteral:
      return convertRegexLiteral(node as ts.RegularExpressionLiteral, ctx);
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return convertNoSubstitutionTemplate(node as ts.NoSubstitutionTemplateLiteral, ctx);
    case ts.SyntaxKind.TemplateExpression:
      return convertTemplateExpression(node as ts.TemplateExpression, ctx);
    case ts.SyntaxKind.TaggedTemplateExpression:
      return convertTaggedTemplate(node as ts.TaggedTemplateExpression, ctx);
    case ts.SyntaxKind.ParenthesizedExpression: {
      const paren = node as ts.ParenthesizedExpression;
      return {
        type: "ParenthesizedExpression",
        start: nodeStart(paren, ctx),
        end: nodeEnd(paren, ctx),
        expression: convertExpression(paren.expression, ctx)
      };
    }
    case ts.SyntaxKind.PropertyAccessExpression:
      return convertPropertyAccess(node as ts.PropertyAccessExpression, ctx, false);
    case ts.SyntaxKind.ElementAccessExpression:
      return convertElementAccess(node as ts.ElementAccessExpression, ctx, false);
    case ts.SyntaxKind.CallExpression:
      return convertCallExpression(node as ts.CallExpression, ctx, false);
    case ts.SyntaxKind.NewExpression:
      return convertNewExpression(node as ts.NewExpression, ctx);
    case ts.SyntaxKind.BinaryExpression:
      return convertBinaryExpression(node as ts.BinaryExpression, ctx);
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const unary = node as ts.PrefixUnaryExpression;
      if (unary.operator === ts.SyntaxKind.PlusPlusToken || unary.operator === ts.SyntaxKind.MinusMinusToken) {
        return {
          type: "UpdateExpression",
          start: nodeStart(unary, ctx),
          end: nodeEnd(unary, ctx),
          operator: unary.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
          prefix: true,
          argument: convertExpression(unary.operand, ctx)
        };
      }
      return {
        type: "UnaryExpression",
        start: nodeStart(unary, ctx),
        end: nodeEnd(unary, ctx),
        operator: PREFIX_OPERATORS.get(unary.operator) ?? "+",
        prefix: true,
        argument: convertExpression(unary.operand, ctx)
      };
    }
    case ts.SyntaxKind.PostfixUnaryExpression: {
      const post = node as ts.PostfixUnaryExpression;
      return {
        type: "UpdateExpression",
        start: nodeStart(post, ctx),
        end: nodeEnd(post, ctx),
        operator: post.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
        argument: convertExpression(post.operand, ctx)
      };
    }
    case ts.SyntaxKind.TypeOfExpression: {
      const n = node as ts.TypeOfExpression;
      return {
        type: "UnaryExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        operator: "typeof",
        prefix: true,
        argument: convertExpression(n.expression, ctx)
      };
    }
    case ts.SyntaxKind.VoidExpression: {
      const n = node as ts.VoidExpression;
      return {
        type: "UnaryExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        operator: "void",
        prefix: true,
        argument: convertExpression(n.expression, ctx)
      };
    }
    case ts.SyntaxKind.DeleteExpression: {
      const n = node as ts.DeleteExpression;
      return {
        type: "UnaryExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        operator: "delete",
        prefix: true,
        argument: convertExpression(n.expression, ctx)
      };
    }
    case ts.SyntaxKind.AwaitExpression: {
      const n = node as ts.AwaitExpression;
      return {
        type: "AwaitExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        argument: convertExpression(n.expression, ctx)
      };
    }
    case ts.SyntaxKind.YieldExpression: {
      const n = node as ts.YieldExpression;
      return {
        type: "YieldExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        delegate: n.asteriskToken !== undefined,
        argument: n.expression ? convertExpression(n.expression, ctx) : null
      };
    }
    case ts.SyntaxKind.ConditionalExpression: {
      const n = node as ts.ConditionalExpression;
      return {
        type: "ConditionalExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        test: convertExpression(n.condition, ctx),
        consequent: convertExpression(n.whenTrue, ctx),
        alternate: convertExpression(n.whenFalse, ctx)
      };
    }
    case ts.SyntaxKind.SpreadElement: {
      const n = node as ts.SpreadElement;
      return {
        type: "SpreadElement",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        argument: convertExpression(n.expression, ctx)
      };
    }
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const arr = node as ts.ArrayLiteralExpression;
      return {
        type: "ArrayExpression",
        start: nodeStart(arr, ctx),
        end: nodeEnd(arr, ctx),
        elements: arr.elements.map((el) =>
          el.kind === ts.SyntaxKind.OmittedExpression ? null : convertExpression(el, ctx)
        )
      };
    }
    case ts.SyntaxKind.ObjectLiteralExpression:
      return convertObjectLiteral(node as ts.ObjectLiteralExpression, ctx);
    case ts.SyntaxKind.ArrowFunction:
      return convertArrowFunction(node as ts.ArrowFunction, ctx);
    case ts.SyntaxKind.FunctionExpression:
      return convertFunctionExpression(node as ts.FunctionExpression, ctx);
    case ts.SyntaxKind.ClassExpression:
      return convertClassLike(node as ts.ClassExpression, "ClassExpression", ctx);
    case ts.SyntaxKind.MetaProperty:
      return convertMetaProperty(node as ts.MetaProperty, ctx);
    case ts.SyntaxKind.AsExpression: {
      const n = node as ts.AsExpression;
      return {
        type: "TSAsExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        expression: convertExpression(n.expression, ctx),
        typeAnnotation: makeOpaqueTypeNode(n.type, ctx)
      };
    }
    case ts.SyntaxKind.SatisfiesExpression: {
      const n = node as ts.SatisfiesExpression;
      return {
        type: "TSSatisfiesExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        expression: convertExpression(n.expression, ctx),
        typeAnnotation: makeOpaqueTypeNode(n.type, ctx)
      };
    }
    case ts.SyntaxKind.NonNullExpression: {
      const n = node as ts.NonNullExpression;
      if (isOptionalChainNode(n.expression)) {
        const inner: RawNode = {
          type: "TSNonNullExpression",
          start: nodeStart(n, ctx),
          end: nodeEnd(n, ctx),
          expression: convertChainInner(n.expression, ctx)
        };
        return {
          type: "ChainExpression",
          start: inner.start,
          end: inner.end,
          expression: inner
        };
      }
      return {
        type: "TSNonNullExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        expression: convertExpression(n.expression, ctx)
      };
    }
    case ts.SyntaxKind.TypeAssertionExpression: {
      const n = node as ts.TypeAssertion;
      return {
        type: "TSTypeAssertion",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        typeAnnotation: makeOpaqueTypeNode(n.type, ctx),
        expression: convertExpression(n.expression, ctx)
      };
    }
    case ts.SyntaxKind.ExpressionWithTypeArguments: {
      const n = node as ts.ExpressionWithTypeArguments;
      const result: RawNode = {
        type: "TSInstantiationExpression",
        start: nodeStart(n, ctx),
        end: nodeEnd(n, ctx),
        expression: convertExpression(n.expression, ctx)
      };
      if (n.typeArguments && n.typeArguments.length > 0) {
        result.typeArguments = makeOpaqueTypeList(
          "TSTypeParameterInstantiation",
          n.typeArguments,
          n.expression.end,
          n.end,
          ctx
        );
      }
      return result;
    }
    default:
      return {
        type: "Identifier",
        start: nodeStart(node, ctx),
        end: nodeEnd(node, ctx),
        name: node.getText(ctx.sourceFile)
      };
  }
}
