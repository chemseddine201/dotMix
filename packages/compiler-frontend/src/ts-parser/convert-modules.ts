/**
 * @dotmix/compiler-frontend/ts-parser/convert-modules — Converts ES/TS import & export
 * declarations into Acorn-compatible ESTree plain objects.
 */

import ts from "typescript";
import {
  nodeStart,
  nodeEnd,
  hasModifier,
  convertIdentifier,
  convertStringLiteral
} from "./ast-helpers.js";
import type { RawNode, ConvertContext } from "./ast-helpers.js";
import { convertExpression } from "./convert-expressions.js";

function convertModuleExportName(name: ts.ModuleExportName, ctx: ConvertContext): RawNode {
  return ts.isIdentifier(name) ? convertIdentifier(name, ctx) : convertStringLiteral(name, ctx);
}

export function convertImportDeclaration(
  node: ts.ImportDeclaration,
  ctx: ConvertContext
): RawNode {
  const start = nodeStart(node, ctx);
  const end = nodeEnd(node, ctx);
  const isTypeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;

  if (isTypeOnly) {
    return {
      type: "ImportDeclaration",
      start,
      end,
      importKind: "type"
    };
  }

  const specifiers: RawNode[] = [];
  if (node.importClause) {
    if (node.importClause.name) {
      specifiers.push({
        type: "ImportDefaultSpecifier",
        start: nodeStart(node.importClause.name, ctx),
        end: nodeEnd(node.importClause.name, ctx),
        local: convertIdentifier(node.importClause.name, ctx)
      });
    }
    const bindings = node.importClause.namedBindings;
    if (bindings) {
      if (ts.isNamespaceImport(bindings)) {
        specifiers.push({
          type: "ImportNamespaceSpecifier",
          start: nodeStart(bindings, ctx),
          end: nodeEnd(bindings, ctx),
          local: convertIdentifier(bindings.name, ctx)
        });
      } else {
        for (const el of bindings.elements) {
          const imported = el.propertyName
            ? convertModuleExportName(el.propertyName, ctx)
            : convertIdentifier(el.name, ctx);
          specifiers.push({
            type: "ImportSpecifier",
            start: nodeStart(el, ctx),
            end: nodeEnd(el, ctx),
            importKind: el.isTypeOnly ? "type" : "value",
            imported,
            local: convertIdentifier(el.name, ctx)
          });
        }
      }
    }
  }

  const result: RawNode = {
    type: "ImportDeclaration",
    start,
    end,
    importKind: "value",
    specifiers,
    source: convertExpression(node.moduleSpecifier, ctx)
  };
  if (node.attributes) {
    result.attributes = node.attributes.elements.map((el) => ({
      type: "ImportAttribute",
      start: nodeStart(el, ctx),
      end: nodeEnd(el, ctx),
      key: ts.isIdentifier(el.name) ? convertIdentifier(el.name, ctx) : convertStringLiteral(el.name, ctx),
      value: convertExpression(el.value, ctx)
    }));
  }
  return result;
}

export function convertExportDeclaration(
  node: ts.ExportDeclaration,
  ctx: ConvertContext
): RawNode {
  const start = nodeStart(node, ctx);
  const end = nodeEnd(node, ctx);

  if (node.isTypeOnly) {
    return {
      type: node.exportClause ? "ExportNamedDeclaration" : "ExportAllDeclaration",
      start,
      end,
      exportKind: "type"
    };
  }

  if (!node.exportClause) {
    const result: RawNode = {
      type: "ExportAllDeclaration",
      start,
      end,
      source: node.moduleSpecifier ? convertExpression(node.moduleSpecifier, ctx) : null,
      exported: null
    };
    if (node.attributes) {
      result.attributes = [];
    }
    return result;
  }

  if (ts.isNamespaceExport(node.exportClause)) {
    return {
      type: "ExportAllDeclaration",
      start,
      end,
      source: node.moduleSpecifier ? convertExpression(node.moduleSpecifier, ctx) : null,
      exported: convertModuleExportName(node.exportClause.name, ctx)
    };
  }

  const specifiers: RawNode[] = node.exportClause.elements.map((el) => {
    const local = el.propertyName
      ? convertModuleExportName(el.propertyName, ctx)
      : convertModuleExportName(el.name, ctx);
    const exported = convertModuleExportName(el.name, ctx);
    const spec: RawNode = {
      type: "ExportSpecifier",
      start: nodeStart(el, ctx),
      end: nodeEnd(el, ctx),
      local,
      exported
    };
    if (el.isTypeOnly) {
      spec.exportKind = "type";
    }
    return spec;
  });

  return {
    type: "ExportNamedDeclaration",
    start,
    end,
    exportKind: "value",
    declaration: null,
    specifiers,
    source: node.moduleSpecifier ? convertExpression(node.moduleSpecifier, ctx) : null
  };
}

function findDeclStartAfterExport(node: ts.HasModifiers & ts.Node, ctx: ConvertContext): number {
  const mods = ts.getModifiers(node);
  if (!mods || mods.length === 0) {
    return nodeStart(node, ctx);
  }
  let lastExportEnd = -1;
  for (const m of mods) {
    if (m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword) {
      lastExportEnd = m.end;
    } else if (lastExportEnd >= 0) {
      return m.getStart(ctx.sourceFile) + ctx.offsetDelta;
    }
  }
  if (lastExportEnd >= 0) {
    const text = ctx.sourceFile.text;
    let i = lastExportEnd;
    while (i < node.end) {
      const ch = text.charCodeAt(i);
      if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) {
        return i + ctx.offsetDelta;
      }
      i++;
    }
  }
  return nodeStart(node, ctx);
}

export function wrapIfExported(
  node: ts.HasModifiers & ts.Node,
  inner: RawNode,
  ctx: ConvertContext
): RawNode {
  if (!hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
    return inner;
  }
  const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
  const fullStart = nodeStart(node, ctx);
  const fullEnd = nodeEnd(node, ctx);
  inner.start = findDeclStartAfterExport(node, ctx);

  if (isDefault) {
    return {
      type: "ExportDefaultDeclaration",
      start: fullStart,
      end: fullEnd,
      declaration: inner
    };
  }
  return {
    type: "ExportNamedDeclaration",
    start: fullStart,
    end: fullEnd,
    exportKind:
      inner.type.startsWith("TS") || inner.declare === true
        ? inner.type === "TSEnumDeclaration"
          ? "value"
          : "type"
        : "value",
    declaration: inner,
    specifiers: [],
    source: null
  };
}

