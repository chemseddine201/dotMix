/**
 * @dotmix/compiler-frontend/ts-parser/ast-helpers — Shared helpers for converting TypeScript AST
 * nodes into Acorn-shaped plain objects (which `convertAcornNodeToESTree` freezes with spans).
 */

import ts from "typescript";

export interface RawNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface ConvertContext {
  readonly sourceFile: ts.SourceFile;
  readonly offsetDelta: number;
}

export function nodeStart(node: ts.Node, ctx: ConvertContext): number {
  const pos = node.pos;
  if (pos < node.end) {
    const ch = ctx.sourceFile.text.charCodeAt(pos);
    if (ch > 32 && ch !== 47 && ch < 127) {
      return pos + ctx.offsetDelta;
    }
  }
  return node.getStart(ctx.sourceFile) + ctx.offsetDelta;
}

export function nodeEnd(node: ts.Node, ctx: ConvertContext): number {
  return node.end + ctx.offsetDelta;
}

export function hasModifier(
  node: ts.HasModifiers,
  kind: ts.SyntaxKind
): boolean {
  const mods = ts.getModifiers(node);
  if (!mods) return false;
  for (const m of mods) {
    if (m.kind === kind) return true;
  }
  return false;
}

export function getAccessibility(
  node: ts.HasModifiers
): "public" | "private" | "protected" | undefined {
  const mods = ts.getModifiers(node);
  if (!mods) return undefined;
  for (const m of mods) {
    if (m.kind === ts.SyntaxKind.PublicKeyword) return "public";
    if (m.kind === ts.SyntaxKind.PrivateKeyword) return "private";
    if (m.kind === ts.SyntaxKind.ProtectedKeyword) return "protected";
  }
  return undefined;
}

/**
 * Maps a TypeScript TypeNode SyntaxKind to Acorn-TypeScript's `TS*` node type name.
 * Under R4, only the root's `type`, `start`, and `end` are significant for opaque type subtrees.
 */
export function getTsTypeNodeName(typeNode: ts.TypeNode): string {
  switch (typeNode.kind) {
    case ts.SyntaxKind.AnyKeyword: return "TSAnyKeyword";
    case ts.SyntaxKind.UnknownKeyword: return "TSUnknownKeyword";
    case ts.SyntaxKind.NumberKeyword: return "TSNumberKeyword";
    case ts.SyntaxKind.BigIntKeyword: return "TSBigIntKeyword";
    case ts.SyntaxKind.ObjectKeyword: return "TSObjectKeyword";
    case ts.SyntaxKind.BooleanKeyword: return "TSBooleanKeyword";
    case ts.SyntaxKind.StringKeyword: return "TSStringKeyword";
    case ts.SyntaxKind.SymbolKeyword: return "TSSymbolKeyword";
    case ts.SyntaxKind.VoidKeyword: return "TSVoidKeyword";
    case ts.SyntaxKind.UndefinedKeyword: return "TSUndefinedKeyword";
    case ts.SyntaxKind.NullKeyword: return "TSNullKeyword";
    case ts.SyntaxKind.NeverKeyword: return "TSNeverKeyword";
    case ts.SyntaxKind.IntrinsicKeyword: return "TSIntrinsicKeyword";
    case ts.SyntaxKind.ThisType: return "TSThisType";
    case ts.SyntaxKind.TypeReference: return "TSTypeReference";
    case ts.SyntaxKind.ArrayType: return "TSArrayType";
    case ts.SyntaxKind.TupleType: return "TSTupleType";
    case ts.SyntaxKind.UnionType: return "TSUnionType";
    case ts.SyntaxKind.IntersectionType: return "TSIntersectionType";
    case ts.SyntaxKind.TypeLiteral: return "TSTypeLiteral";
    case ts.SyntaxKind.FunctionType: return "TSFunctionType";
    case ts.SyntaxKind.ConstructorType: return "TSConstructorType";
    case ts.SyntaxKind.TypeQuery: return "TSTypeQuery";
    case ts.SyntaxKind.TypeOperator: return "TSTypeOperator";
    case ts.SyntaxKind.IndexedAccessType: return "TSIndexedAccessType";
    case ts.SyntaxKind.MappedType: return "TSMappedType";
    case ts.SyntaxKind.ConditionalType: return "TSConditionalType";
    case ts.SyntaxKind.InferType: return "TSInferType";
    case ts.SyntaxKind.LiteralType: return "TSLiteralType";
    case ts.SyntaxKind.TemplateLiteralType: return "TSTemplateLiteralType";
    case ts.SyntaxKind.ImportType: return "TSImportType";
    case ts.SyntaxKind.OptionalType: return "TSOptionalType";
    case ts.SyntaxKind.RestType: return "TSRestType";
    case ts.SyntaxKind.NamedTupleMember: return "TSNamedTupleMember";
    case ts.SyntaxKind.TypePredicate: return "TSTypePredicate";
    case ts.SyntaxKind.ExpressionWithTypeArguments: return "TSExpressionWithTypeArguments";
    case ts.SyntaxKind.ParenthesizedType: {
      const paren = typeNode as ts.ParenthesizedTypeNode;
      return getTsTypeNodeName(paren.type);
    }
    default: return "TSTypeReference";
  }
}

export function makeOpaqueTypeNode(typeNode: ts.TypeNode, ctx: ConvertContext): RawNode {
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return makeOpaqueTypeNode(typeNode.type, ctx);
  }
  return {
    type: getTsTypeNodeName(typeNode),
    start: nodeStart(typeNode, ctx),
    end: nodeEnd(typeNode, ctx)
  };
}

/**
 * Finds the exact offset of the `:` token immediately preceding a type node.
 */
export function findColonBeforeType(
  searchFrom: number,
  typeNode: ts.TypeNode,
  ctx: ConvertContext
): number {
  const typeStart = typeNode.getStart(ctx.sourceFile);
  const text = ctx.sourceFile.text;
  let i = typeStart - 1;
  while (i >= searchFrom) {
    if (text.charCodeAt(i) === 58 /* : */) {
      return i + ctx.offsetDelta;
    }
    i--;
  }
  return typeStart + ctx.offsetDelta;
}

export function makeOpaqueTypeAnnotation(
  searchFrom: number,
  typeNode: ts.TypeNode,
  ctx: ConvertContext
): RawNode {
  const start = findColonBeforeType(searchFrom, typeNode, ctx);
  const end = nodeEnd(typeNode, ctx);
  return {
    type: "TSTypeAnnotation",
    start,
    end,
    typeAnnotation: makeOpaqueTypeNode(typeNode, ctx)
  };
}

/**
 * Builds an opaque `TSTypeParameterInstantiation` (`<A, B>`) or `TSTypeParameterDeclaration` (`<T, U>`).
 * Scans backward from the first type arg/param for `<` and forward from the last for `>`.
 */
export function makeOpaqueTypeList(
  typeName: "TSTypeParameterInstantiation" | "TSTypeParameterDeclaration",
  nodes: ts.NodeArray<ts.Node>,
  searchStartLimit: number,
  searchEndLimit: number,
  ctx: ConvertContext
): RawNode {
  const text = ctx.sourceFile.text;
  const firstStart = nodes[0]!.getStart(ctx.sourceFile);
  const lastEnd = nodes[nodes.length - 1]!.getEnd();

  let openPos = firstStart - 1;
  while (openPos >= searchStartLimit && text.charCodeAt(openPos) !== 60 /* < */) {
    openPos--;
  }
  if (openPos < searchStartLimit) {
    openPos = firstStart;
  }

  let closePos = lastEnd;
  while (closePos < searchEndLimit && text.charCodeAt(closePos) !== 62 /* > */) {
    closePos++;
  }
  const endPos = closePos < searchEndLimit ? closePos + 1 : lastEnd;

  return {
    type: typeName,
    start: openPos + ctx.offsetDelta,
    end: endPos + ctx.offsetDelta
  };
}

export function convertIdentifier(node: ts.Identifier, ctx: ConvertContext): RawNode {
  return {
    type: "Identifier",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    name: node.text
  };
}

export function convertPrivateIdentifier(node: ts.PrivateIdentifier, ctx: ConvertContext): RawNode {
  return {
    type: "PrivateIdentifier",
    start: nodeStart(node, ctx),
    end: nodeEnd(node, ctx),
    name: node.text.startsWith("#") ? node.text.slice(1) : node.text
  };
}

export function convertNumericLiteral(node: ts.NumericLiteral, ctx: ConvertContext): RawNode {
  const start = nodeStart(node, ctx);
  const end = nodeEnd(node, ctx);
  const raw = ctx.sourceFile.text.slice(start - ctx.offsetDelta, node.end);
  return {
    type: "Literal",
    start,
    end,
    value: Number(node.text),
    raw
  };
}

export function convertBigIntLiteral(node: ts.BigIntLiteral, ctx: ConvertContext): RawNode {
  const start = nodeStart(node, ctx);
  const end = nodeEnd(node, ctx);
  const raw = ctx.sourceFile.text.slice(start - ctx.offsetDelta, node.end);
  const cleaned = raw.slice(0, -1).replaceAll("_", "");
  const bigVal = BigInt(cleaned);
  return {
    type: "Literal",
    start,
    end,
    value: bigVal,
    raw,
    bigint: cleaned
  };
}

export function convertStringLiteral(node: ts.StringLiteral, ctx: ConvertContext): RawNode {
  const start = nodeStart(node, ctx);
  const end = nodeEnd(node, ctx);
  const raw = ctx.sourceFile.text.slice(start - ctx.offsetDelta, node.end);
  return {
    type: "Literal",
    start,
    end,
    value: node.text,
    raw
  };
}

export function convertRegexLiteral(node: ts.RegularExpressionLiteral, ctx: ConvertContext): RawNode {
  const start = nodeStart(node, ctx);
  const end = nodeEnd(node, ctx);
  const raw = ctx.sourceFile.text.slice(start - ctx.offsetDelta, node.end);
  const lastSlash = raw.lastIndexOf("/");
  const pattern = raw.slice(1, lastSlash);
  const flags = raw.slice(lastSlash + 1);
  let value: RegExp | null = null;
  try {
    value = new RegExp(pattern, flags);
  } catch {
    value = null;
  }
  return {
    type: "Literal",
    start,
    end,
    value,
    raw,
    regex: { pattern, flags }
  };
}

export function convertNoSubstitutionTemplate(
  node: ts.NoSubstitutionTemplateLiteral,
  ctx: ConvertContext
): RawNode {
  const rawStart = node.getStart(ctx.sourceFile);
  const rawEnd = node.getEnd();
  const start = rawStart + ctx.offsetDelta;
  const end = rawEnd + ctx.offsetDelta;
  const rawText = ctx.sourceFile.text.slice(rawStart + 1, rawEnd - 1);
  const cooked: string | null = typeof node.text === "string" ? node.text : null;
  const normalizedRaw = rawText.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  return {
    type: "TemplateLiteral",
    start,
    end,
    expressions: [],
    quasis: [
      {
        type: "TemplateElement",
        start: start + 1,
        end: end - 1,
        value: {
          raw: normalizedRaw,
          cooked
        },
        tail: true
      }
    ]
  };
}

export function convertTemplateSpanElement(
  headOrMiddleOrTail: ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail,
  ctx: ConvertContext
): RawNode {
  const rawStart = headOrMiddleOrTail.getStart(ctx.sourceFile);
  const rawEnd = headOrMiddleOrTail.getEnd();
  const isTail = ts.isTemplateTail(headOrMiddleOrTail);
  // Head starts with ` (1 char), ends with ${ (2 chars)
  // Middle starts with } (1 char), ends with ${ (2 chars)
  // Tail starts with } (1 char), ends with ` (1 char)
  const contentStart = rawStart + 1;
  const contentEnd = isTail ? rawEnd - 1 : rawEnd - 2;
  const rawText = ctx.sourceFile.text.slice(contentStart, contentEnd);
  const normalizedRaw = rawText.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const cooked: string | null = typeof headOrMiddleOrTail.text === "string" ? headOrMiddleOrTail.text : null;

  return {
    type: "TemplateElement",
    start: contentStart + ctx.offsetDelta,
    end: contentEnd + ctx.offsetDelta,
    value: {
      raw: normalizedRaw,
      cooked
    },
    tail: isTail
  };
}
