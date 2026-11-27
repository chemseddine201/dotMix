/**
 * @dotmix/compiler-frontend/ts-parser/convert-statements — Converts TypeScript statements,
 * declarations, and Program nodes into Acorn-compatible ESTree plain objects.
 */

import ts from "typescript";
import {
  nodeStart,
  nodeEnd,
  hasModifier,
  makeOpaqueTypeAnnotation,
  makeOpaqueTypeList,
  convertIdentifier
} from "./ast-helpers.js";
import type { RawNode, ConvertContext } from "./ast-helpers.js";
import { convertExpression } from "./convert-expressions.js";
import { convertBindingName, convertParameter } from "./convert-patterns.js";
import { convertClassLike } from "./convert-functions-classes.js";
import {
  convertImportDeclaration,
  convertExportDeclaration,
  wrapIfExported
} from "./convert-modules.js";

export function convertBlockStatement(block: ts.Block, ctx: ConvertContext): RawNode {
  return {
    type: "BlockStatement",
    start: nodeStart(block, ctx),
    end: nodeEnd(block, ctx),
    body: block.statements.map((s) => convertStatement(s, ctx))
  };
}

function getVarKind(list: ts.VariableDeclarationList): "var" | "let" | "const" {
  if ((list.flags & ts.NodeFlags.Const) !== 0) return "const";
  if ((list.flags & ts.NodeFlags.Let) !== 0) return "let";
  return "var";
}

function convertVariableDeclarationList(
  list: ts.VariableDeclarationList,
  stmtStart: number,
  stmtEnd: number,
  isDeclare: boolean,
  ctx: ConvertContext
): RawNode {
  const result: RawNode = {
    type: "VariableDeclaration",
    start: stmtStart,
    end: stmtEnd,
    declarations: list.declarations.map((d) => {
      const id = convertBindingName(d.name, ctx);
      if (d.type) {
        id.typeAnnotation = makeOpaqueTypeAnnotation(d.name.end, d.type, ctx);
        id.end = nodeEnd(d.type, ctx);
      }
      const decl: RawNode = {
        type: "VariableDeclarator",
        start: nodeStart(d, ctx),
        end: nodeEnd(d, ctx),
        id,
        init: d.initializer ? convertExpression(d.initializer, ctx) : null
      };
      if (d.exclamationToken) {
        decl.definite = true;
      }
      return decl;
    }),
    kind: getVarKind(list)
  };
  if (isDeclare) {
    result.declare = true;
  }
  return result;
}

function convertFunctionDeclaration(node: ts.FunctionDeclaration, ctx: ConvertContext): RawNode {
  const start = nodeStart(node, ctx);
  const end = nodeEnd(node, ctx);
  const isDeclare = hasModifier(node, ts.SyntaxKind.DeclareKeyword);
  if (isDeclare || !node.body) {
    return {
      type: "TSDeclareFunction",
      start,
      end,
      ...(isDeclare ? { declare: true } : {})
    };
  }
  const result: RawNode = {
    type: "FunctionDeclaration",
    start,
    end,
    id: node.name ? convertIdentifier(node.name, ctx) : null,
    expression: false,
    generator: node.asteriskToken !== undefined,
    async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
    params: node.parameters.map((p) => convertParameter(p, ctx)),
    body: convertBlockStatement(node.body, ctx)
  };
  if (node.typeParameters && node.typeParameters.length > 0) {
    result.typeParameters = makeOpaqueTypeList(
      "TSTypeParameterDeclaration",
      node.typeParameters,
      node.name ? node.name.end : node.getStart(ctx.sourceFile),
      node.parameters.pos,
      ctx
    );
  }
  if (node.type) {
    result.returnType = makeOpaqueTypeAnnotation(node.parameters.end, node.type, ctx);
  }
  return result;
}

export function convertStatement(stmt: ts.Statement, ctx: ConvertContext): RawNode {
  const start = nodeStart(stmt, ctx);
  const end = nodeEnd(stmt, ctx);

  switch (stmt.kind) {
    case ts.SyntaxKind.Block:
      return convertBlockStatement(stmt as ts.Block, ctx);
    case ts.SyntaxKind.EmptyStatement:
      return { type: "EmptyStatement", start, end };
    case ts.SyntaxKind.DebuggerStatement:
      return { type: "DebuggerStatement", start, end };
    case ts.SyntaxKind.ExpressionStatement: {
      const s = stmt as ts.ExpressionStatement;
      return {
        type: "ExpressionStatement",
        start,
        end,
        expression: convertExpression(s.expression, ctx)
      };
    }
    case ts.SyntaxKind.VariableStatement: {
      const s = stmt as ts.VariableStatement;
      const isDeclare = hasModifier(s, ts.SyntaxKind.DeclareKeyword);
      const decl = convertVariableDeclarationList(s.declarationList, start, end, isDeclare, ctx);
      return wrapIfExported(s, decl, ctx);
    }
    case ts.SyntaxKind.ReturnStatement: {
      const s = stmt as ts.ReturnStatement;
      return {
        type: "ReturnStatement",
        start,
        end,
        argument: s.expression ? convertExpression(s.expression, ctx) : null
      };
    }
    case ts.SyntaxKind.ThrowStatement: {
      const s = stmt as ts.ThrowStatement;
      return {
        type: "ThrowStatement",
        start,
        end,
        argument: convertExpression(s.expression, ctx)
      };
    }
    case ts.SyntaxKind.IfStatement: {
      const s = stmt as ts.IfStatement;
      return {
        type: "IfStatement",
        start,
        end,
        test: convertExpression(s.expression, ctx),
        consequent: convertStatement(s.thenStatement, ctx),
        alternate: s.elseStatement ? convertStatement(s.elseStatement, ctx) : null
      };
    }
    case ts.SyntaxKind.ForStatement: {
      const s = stmt as ts.ForStatement;
      let init: RawNode | null = null;
      if (s.initializer) {
        init = ts.isVariableDeclarationList(s.initializer)
          ? convertVariableDeclarationList(
              s.initializer,
              nodeStart(s.initializer, ctx),
              nodeEnd(s.initializer, ctx),
              false,
              ctx
            )
          : convertExpression(s.initializer, ctx);
      }
      return {
        type: "ForStatement",
        start,
        end,
        init,
        test: s.condition ? convertExpression(s.condition, ctx) : null,
        update: s.incrementor ? convertExpression(s.incrementor, ctx) : null,
        body: convertStatement(s.statement, ctx)
      };
    }
    case ts.SyntaxKind.ForInStatement: {
      const s = stmt as ts.ForInStatement;
      const left = ts.isVariableDeclarationList(s.initializer)
        ? convertVariableDeclarationList(
            s.initializer,
            nodeStart(s.initializer, ctx),
            nodeEnd(s.initializer, ctx),
            false,
            ctx
          )
        : convertExpression(s.initializer, ctx);
      return {
        type: "ForInStatement",
        start,
        end,
        left,
        right: convertExpression(s.expression, ctx),
        body: convertStatement(s.statement, ctx)
      };
    }
    case ts.SyntaxKind.ForOfStatement: {
      const s = stmt as ts.ForOfStatement;
      const left = ts.isVariableDeclarationList(s.initializer)
        ? convertVariableDeclarationList(
            s.initializer,
            nodeStart(s.initializer, ctx),
            nodeEnd(s.initializer, ctx),
            false,
            ctx
          )
        : convertExpression(s.initializer, ctx);
      return {
        type: "ForOfStatement",
        start,
        end,
        await: s.awaitModifier !== undefined,
        left,
        right: convertExpression(s.expression, ctx),
        body: convertStatement(s.statement, ctx)
      };
    }
    case ts.SyntaxKind.WhileStatement: {
      const s = stmt as ts.WhileStatement;
      return {
        type: "WhileStatement",
        start,
        end,
        test: convertExpression(s.expression, ctx),
        body: convertStatement(s.statement, ctx)
      };
    }
    case ts.SyntaxKind.DoStatement: {
      const s = stmt as ts.DoStatement;
      return {
        type: "DoWhileStatement",
        start,
        end,
        body: convertStatement(s.statement, ctx),
        test: convertExpression(s.expression, ctx)
      };
    }
    case ts.SyntaxKind.SwitchStatement: {
      const s = stmt as ts.SwitchStatement;
      return {
        type: "SwitchStatement",
        start,
        end,
        discriminant: convertExpression(s.expression, ctx),
        cases: s.caseBlock.clauses.map((c) => ({
          type: "SwitchCase",
          start: nodeStart(c, ctx),
          end: nodeEnd(c, ctx),
          consequent: c.statements.map((st) => convertStatement(st, ctx)),
          test: ts.isCaseClause(c) ? convertExpression(c.expression, ctx) : null
        }))
      };
    }
    case ts.SyntaxKind.TryStatement: {
      const s = stmt as ts.TryStatement;
      let handler: RawNode | null = null;
      if (s.catchClause) {
        let param: RawNode | null = null;
        if (s.catchClause.variableDeclaration) {
          const vd = s.catchClause.variableDeclaration;
          param = convertBindingName(vd.name, ctx);
          if (vd.type) {
            param.typeAnnotation = makeOpaqueTypeAnnotation(vd.name.end, vd.type, ctx);
            param.end = nodeEnd(vd.type, ctx);
          }
        }
        handler = {
          type: "CatchClause",
          start: nodeStart(s.catchClause, ctx),
          end: nodeEnd(s.catchClause, ctx),
          param,
          body: convertBlockStatement(s.catchClause.block, ctx)
        };
      }
      return {
        type: "TryStatement",
        start,
        end,
        block: convertBlockStatement(s.tryBlock, ctx),
        handler,
        finalizer: s.finallyBlock ? convertBlockStatement(s.finallyBlock, ctx) : null
      };
    }
    case ts.SyntaxKind.BreakStatement: {
      const s = stmt as ts.BreakStatement;
      return {
        type: "BreakStatement",
        start,
        end,
        label: s.label ? convertIdentifier(s.label, ctx) : null
      };
    }
    case ts.SyntaxKind.ContinueStatement: {
      const s = stmt as ts.ContinueStatement;
      return {
        type: "ContinueStatement",
        start,
        end,
        label: s.label ? convertIdentifier(s.label, ctx) : null
      };
    }
    case ts.SyntaxKind.LabeledStatement: {
      const s = stmt as ts.LabeledStatement;
      return {
        type: "LabeledStatement",
        start,
        end,
        body: convertStatement(s.statement, ctx),
        label: convertIdentifier(s.label, ctx)
      };
    }
    case ts.SyntaxKind.WithStatement: {
      const s = stmt as ts.WithStatement;
      return {
        type: "WithStatement",
        start,
        end,
        object: convertExpression(s.expression, ctx),
        body: convertStatement(s.statement, ctx)
      };
    }
    case ts.SyntaxKind.FunctionDeclaration: {
      const s = stmt as ts.FunctionDeclaration;
      return wrapIfExported(s, convertFunctionDeclaration(s, ctx), ctx);
    }
    case ts.SyntaxKind.ClassDeclaration: {
      const s = stmt as ts.ClassDeclaration;
      const decl = convertClassLike(s, "ClassDeclaration", ctx);
      if (hasModifier(s, ts.SyntaxKind.DeclareKeyword)) {
        decl.declare = true;
      }
      return wrapIfExported(s, decl, ctx);
    }
    case ts.SyntaxKind.ImportDeclaration:
      return convertImportDeclaration(stmt as ts.ImportDeclaration, ctx);
    case ts.SyntaxKind.ExportDeclaration:
      return convertExportDeclaration(stmt as ts.ExportDeclaration, ctx);
    case ts.SyntaxKind.ExportAssignment: {
      const s = stmt as ts.ExportAssignment;
      if (s.isExportEquals) {
        return { type: "TSExportAssignment", start, end };
      }
      return {
        type: "ExportDefaultDeclaration",
        start,
        end,
        declaration: convertExpression(s.expression, ctx)
      };
    }
    case ts.SyntaxKind.InterfaceDeclaration:
      return wrapIfExported(stmt as ts.InterfaceDeclaration, { type: "TSInterfaceDeclaration", start, end }, ctx);
    case ts.SyntaxKind.TypeAliasDeclaration:
      return wrapIfExported(stmt as ts.TypeAliasDeclaration, { type: "TSTypeAliasDeclaration", start, end }, ctx);
    case ts.SyntaxKind.EnumDeclaration:
      return wrapIfExported(stmt as ts.EnumDeclaration, { type: "TSEnumDeclaration", start, end }, ctx);
    case ts.SyntaxKind.ModuleDeclaration:
      return wrapIfExported(stmt as ts.ModuleDeclaration, { type: "TSModuleDeclaration", start, end }, ctx);
    case ts.SyntaxKind.ImportEqualsDeclaration:
      return { type: "TSImportEqualsDeclaration", start, end };
    default:
      return { type: "EmptyStatement", start, end };
  }
}

export function convertProgram(sourceFile: ts.SourceFile): RawNode {
  const ctx: ConvertContext = { sourceFile, offsetDelta: 0 };
  return {
    type: "Program",
    start: 0,
    end: sourceFile.text.length,
    body: sourceFile.statements.map((s) => convertStatement(s, ctx)),
    sourceType: "module"
  };
}
