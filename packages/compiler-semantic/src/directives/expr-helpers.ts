/**
 * @dotmix/compiler-semantic/directives/expr-helpers — ESTree expression normalization, bare-getter tracking, and directive import stripping.
 */

import * as ts from "typescript";
import {
  DIRECTIVES_IMPORT_PATH,
  PERMISSIONS_IMPORT_PATH,
  deepFreeze,
  isESTreeNode,
  type ComponentNode,
  type ESTreeNode,
  type EachBlockNode,
  type EachExtNode,
  type IfBlockNode
} from "@dotmix/ast";

export interface DirectiveScriptHints {
  readonly signalSetters: ReadonlySet<string>;
  readonly formFieldsByVar: ReadonlyMap<string, ReadonlySet<string>>;
}

export function collectScriptDirectiveHints(ast: ComponentNode): DirectiveScriptHints {
  const signalSetters = new Set<string>();
  const formFieldsByVar = new Map<string, ReadonlySet<string>>();
  if (!ast.script?.content) {
    return { signalSetters, formFieldsByVar };
  }
  const sf = ts.createSourceFile(ast.span.file ?? "script.ts", ast.script.content, ts.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue;
      const calleeText = ts.isIdentifier(decl.initializer.expression) ? decl.initializer.expression.text : "";
      if ((calleeText === "signal" || calleeText === "createSignal") && ts.isArrayBindingPattern(decl.name)) {
        const setterElem = decl.name.elements[1];
        if (setterElem && ts.isBindingElement(setterElem) && ts.isIdentifier(setterElem.name)) {
          signalSetters.add(setterElem.name.text);
        }
      } else if (calleeText === "createForm" && ts.isIdentifier(decl.name)) {
        const arg0 = decl.initializer.arguments[0];
        if (arg0 && ts.isObjectLiteralExpression(arg0)) {
          const fieldNames = new Set<string>();
          const readPropName = (name: ts.PropertyName): string | undefined =>
            ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
          const initialProp = arg0.properties.find((prop) => {
            if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) return false;
            const propName = readPropName(prop.name);
            return propName === "initialValues" || propName === "initial";
          });
          const sourceObj = initialProp
            ? (ts.isPropertyAssignment(initialProp) && ts.isObjectLiteralExpression(initialProp.initializer)
                ? initialProp.initializer
                : undefined)
            : arg0;
          if (sourceObj) {
            for (const prop of sourceObj.properties) {
              if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
              const fieldName = readPropName(prop.name);
              if (fieldName) fieldNames.add(fieldName);
            }
          }
          if (fieldNames.size > 0) formFieldsByVar.set(decl.name.text, fieldNames);
        }
      }
    }
  }
  return { signalSetters, formFieldsByVar };
}
import { collectPatternIdentifiers } from "../scope-analyzer.js";

const BARE_GETTER_AST_MAP = new WeakMap<ESTreeNode, ReadonlySet<string>>();

export function markBareGetterIdents(astNode: ESTreeNode, names: ReadonlySet<string>): void {
  if (names.size > 0) {
    BARE_GETTER_AST_MAP.set(astNode, names);
  }
}

export function hasBareGetterRef(astNode: ESTreeNode): boolean {
  return BARE_GETTER_AST_MAP.has(astNode);
}

export function getBareGetterIdents(astNode: ESTreeNode): ReadonlySet<string> | undefined {
  return BARE_GETTER_AST_MAP.get(astNode);
}

const DIRECTIVE_RUNTIME_EXPORTS = new Set(["createAuth", "AuthProvider", "useAuth", "createKeepAlive", "createErrorBoundary"]);

export function stripDirectiveImportsFromJs(jsCode: string, stripCanPermission: boolean, emptyFallback = ""): string {
  if (!jsCode.trim()) return jsCode;
  const sourceFile = ts.createSourceFile("strip.js", jsCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const removals: Array<{ start: number; end: number; replacement: string }> = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const specText = stmt.moduleSpecifier.text;
    const isDirectivesModule = specText === DIRECTIVES_IMPORT_PATH;
    const isPermissionsModule = stripCanPermission && specText === PERMISSIONS_IMPORT_PATH;
    if (!isDirectivesModule && !isPermissionsModule) continue;

    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      if (isDirectivesModule) removals.push({ start: stmt.getFullStart(), end: stmt.getEnd(), replacement: "" });
      continue;
    }

    const remaining = bindings.elements.filter((specifier) => {
      const importedName = (specifier.propertyName ?? specifier.name).text;
      return isDirectivesModule
        ? DIRECTIVE_RUNTIME_EXPORTS.has(importedName) || (!stripCanPermission && importedName === "Can")
        : importedName !== "Can";
    });
    if (remaining.length === 0) removals.push({ start: stmt.getFullStart(), end: stmt.getEnd(), replacement: "" });
    else if (remaining.length < bindings.elements.length) {
      const keptSpecifiers = remaining.map((specifier) => specifier.getText(sourceFile)).join(", ");
      removals.push({ start: bindings.getStart(sourceFile), end: bindings.getEnd(), replacement: `{ ${keptSpecifiers} }` });
    }
  }

  if (removals.length === 0) return jsCode;
  let output = jsCode;
  for (let i = removals.length - 1; i >= 0; i--) {
    const edit = removals[i]!;
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  const trimmed = output.trim();
  return trimmed.length === 0 ? emptyFallback : trimmed;
}

function collectShadowedForNode(node: ESTreeNode, shadowed: ReadonlySet<string>): ReadonlySet<string> {
  if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") {
    return shadowed;
  }
  const nextSet = new Set(shadowed);
  const params = Array.isArray(node.params) ? (node.params as ESTreeNode[]) : [];
  for (const paramNode of params) {
    collectPatternIdentifiers(paramNode, nextSet);
  }
  return nextSet;
}

export function cloneAndRewriteAst(
  node: ESTreeNode,
  renameMap: ReadonlyMap<string, string>,
  unwrapZeroArgCallee: ReadonlySet<string>,
  shadowed: ReadonlySet<string>
): { ast: ESTreeNode; hasBareIdent: boolean } {
  let hasBareIdent = false;
  const activeShadowed = collectShadowedForNode(node, shadowed);

  function visit(current: ESTreeNode, currentShadowed: ReadonlySet<string>): ESTreeNode {
    if (
      current.type === "CallExpression" &&
      current.callee &&
      isESTreeNode(current.callee) &&
      current.callee.type === "Identifier" &&
      typeof current.callee.name === "string" &&
      unwrapZeroArgCallee.has(current.callee.name) &&
      !currentShadowed.has(current.callee.name) &&
      Array.isArray(current.arguments) &&
      current.arguments.length === 0
    ) {
      const identName = renameMap.get(current.callee.name) ?? current.callee.name;
      const identNode: Record<string, unknown> = { type: "Identifier", name: identName };
      if (current.start !== undefined) identNode["start"] = current.start;
      if (current.callee.end !== undefined) identNode["end"] = current.callee.end;
      else if (current.end !== undefined) identNode["end"] = current.end;
      if (current.loc !== undefined) identNode["loc"] = current.loc;
      return deepFreeze(identNode as unknown as ESTreeNode);
    }

    if (current.type === "Identifier" && typeof current.name === "string") {
      if (!currentShadowed.has(current.name)) {
        if (unwrapZeroArgCallee.has(current.name)) {
          hasBareIdent = true;
        }
        const renamed = renameMap.get(current.name);
        if (renamed) {
          return deepFreeze({
            ...current,
            name: renamed
          });
        }
      }
      return current;
    }

    const nextShadowed = collectShadowedForNode(current, currentShadowed);
    const nextRecord: Record<string, unknown> = {};
    let mutated = false;

    for (const [propKey, propValue] of Object.entries(current)) {
      if (
        propKey === "type" ||
        propKey === "start" ||
        propKey === "end" ||
        propKey === "loc" ||
        propKey === "range"
      ) {
        nextRecord[propKey] = propValue;
        continue;
      }
      if (current.type === "MemberExpression" && propKey === "property" && current.computed === false) {
        nextRecord[propKey] = propValue;
        continue;
      }
      if (
        (current.type === "Property" || current.type === "ObjectProperty") &&
        propKey === "key" &&
        current.computed === false &&
        current.shorthand !== true
      ) {
        nextRecord[propKey] = propValue;
        continue;
      }

      if (Array.isArray(propValue)) {
        const mappedArray: unknown[] = [];
        let arrMutated = false;
        for (const elem of propValue) {
          if (isESTreeNode(elem)) {
            const rewrittenElem = visit(elem, nextShadowed);
            if (rewrittenElem !== elem) arrMutated = true;
            mappedArray.push(rewrittenElem);
          } else {
            mappedArray.push(elem);
          }
        }
        nextRecord[propKey] = arrMutated ? mappedArray : propValue;
        if (arrMutated) mutated = true;
      } else if (isESTreeNode(propValue)) {
        const rewrittenChild = visit(propValue, nextShadowed);
        if (rewrittenChild !== propValue) mutated = true;
        nextRecord[propKey] = rewrittenChild;
      } else {
        nextRecord[propKey] = propValue;
      }
    }

    return mutated ? deepFreeze(nextRecord as ESTreeNode) : current;
  }

  const rewritten = visit(node, activeShadowed);
  return { ast: rewritten, hasBareIdent };
}

export function normalizeEachBodyExpression(
  rawExpression: string,
  expressionAst: ESTreeNode,
  indexIdentifier: string | null
): { rawExpression: string; expression: ESTreeNode } {
  if (!indexIdentifier) {
    return { rawExpression, expression: expressionAst };
  }
  const targetIndexName = indexIdentifier;
  const baseOffset = expressionAst.start ?? 0;
  const slicesToReplace: Array<{ start: number; end: number; origCallEnd: number; removedLen: number; text: string }> = [];

  function findCalls(current: ESTreeNode, currentShadowed: ReadonlySet<string>): void {
    if (
      current.type === "CallExpression" &&
      current.callee &&
      isESTreeNode(current.callee) &&
      current.callee.type === "Identifier" &&
      typeof current.callee.name === "string" &&
      current.callee.name === targetIndexName &&
      !currentShadowed.has(targetIndexName) &&
      Array.isArray(current.arguments) &&
      current.arguments.length === 0 &&
      typeof current.start === "number" &&
      typeof current.end === "number"
    ) {
      const calleeEnd = typeof current.callee.end === "number" ? current.callee.end : current.start + targetIndexName.length;
      slicesToReplace.push({
        start: current.start - baseOffset,
        end: current.end - baseOffset,
        origCallEnd: current.end,
        removedLen: Math.max(0, current.end - calleeEnd),
        text: targetIndexName
      });
      return;
    }

    const nextShadowed = collectShadowedForNode(current, currentShadowed);
    for (const [propKey, propValue] of Object.entries(current)) {
      if (propKey === "type" || propKey === "start" || propKey === "end" || propKey === "loc" || propKey === "range") continue;
      if (current.type === "MemberExpression" && propKey === "property" && current.computed === false) continue;
      if (Array.isArray(propValue)) {
        for (const elem of propValue) {
          if (isESTreeNode(elem)) findCalls(elem, nextShadowed);
        }
      } else if (isESTreeNode(propValue)) {
        findCalls(propValue, nextShadowed);
      }
    }
  }

  findCalls(expressionAst, new Set());
  let nextRaw = rawExpression;
  if (slicesToReplace.length > 0) {
    const sorted = [...slicesToReplace].sort((left, right) => right.start - left.start);
    for (const spliceEdit of sorted) {
      nextRaw = nextRaw.slice(0, spliceEdit.start) + spliceEdit.text + nextRaw.slice(spliceEdit.end);
    }
  }

  const unwrapNames = new Set<string>([targetIndexName]);
  const rewritten = cloneAndRewriteAst(expressionAst, new Map(), unwrapNames, new Set());
  const shiftedAst = slicesToReplace.length > 0 ? shiftAstNodeOffsets(rewritten.ast, slicesToReplace) : rewritten.ast;
  if (rewritten.hasBareIdent) {
    markBareGetterIdents(shiftedAst, unwrapNames);
  }
  return { rawExpression: nextRaw, expression: shiftedAst };
}

function shiftAstNodeOffsets(
  node: ESTreeNode,
  removals: readonly { origCallEnd: number; removedLen: number }[]
): ESTreeNode {
  function adjustOffset(offset: number): number {
    let shift = 0;
    for (const removal of removals) {
      if (offset >= removal.origCallEnd) shift += removal.removedLen;
    }
    return offset - shift;
  }
  function visitShift(current: ESTreeNode): ESTreeNode {
    const nextRecord: Record<string, unknown> = {};
    for (const [propKey, propValue] of Object.entries(current)) {
      if ((propKey === "start" || propKey === "end") && typeof propValue === "number") {
        nextRecord[propKey] = adjustOffset(propValue);
      } else if (Array.isArray(propValue)) {
        nextRecord[propKey] = propValue.map((elem) => (isESTreeNode(elem) ? visitShift(elem) : elem));
      } else if (isESTreeNode(propValue)) {
        nextRecord[propKey] = visitShift(propValue);
      } else {
        nextRecord[propKey] = propValue;
      }
    }
    return deepFreeze(nextRecord as unknown as ESTreeNode);
  }
  return visitShift(node);
}

export function transformWithBareGetters(
  rawExpression: string,
  expressionAst: ESTreeNode,
  loopGetterMap: ReadonlyMap<string, string>
): string {
  const bareIdents = BARE_GETTER_AST_MAP.get(expressionAst);
  if (!bareIdents || bareIdents.size === 0) {
    return rawExpression;
  }
  const baseOffset = expressionAst.start ?? 0;

  function emitWithBare(node: ESTreeNode, shadowed: ReadonlySet<string>): string {
    const relStart = (node.start ?? baseOffset) - baseOffset;
    const relEnd = (node.end ?? baseOffset + rawExpression.length) - baseOffset;
    if (
      node.type === "TSAsExpression" ||
      node.type === "TSTypeAssertion" ||
      node.type === "TSNonNullExpression" ||
      node.type === "TSSatisfiesExpression"
    ) {
      const inner = node.expression as ESTreeNode | undefined;
      if (inner) return emitWithBare(inner, shadowed);
    }
    if (node.type === "Identifier" && typeof node.name === "string") {
      if (!shadowed.has(node.name) && loopGetterMap.has(node.name)) {
        const getterName = loopGetterMap.get(node.name)!;
        return bareIdents!.has(node.name) ? getterName : `${getterName}()`;
      }
      return rawExpression.slice(relStart, relEnd);
    }
    const nextShadowed = collectShadowedForNode(node, shadowed);
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    for (const [propKey, propValue] of Object.entries(node)) {
      if (propKey === "type" || propKey === "start" || propKey === "end" || propKey === "loc" || propKey === "range" || propKey === "typeAnnotation" || propKey === "typeParameters" || propKey === "returnType") continue;
      if (node.type === "MemberExpression" && propKey === "property" && node.computed === false) continue;
      if ((node.type === "Property" || node.type === "ObjectProperty") && propKey === "key" && node.computed === false && node.shorthand !== true) continue;
      if (Array.isArray(propValue)) {
        for (const elem of propValue) {
          if (isESTreeNode(elem) && typeof elem.start === "number" && typeof elem.end === "number" && !elem.type.startsWith("TS")) {
            replacements.push({ start: elem.start - baseOffset, end: elem.end - baseOffset, text: emitWithBare(elem, nextShadowed) });
          }
        }
      } else if (isESTreeNode(propValue) && typeof propValue.start === "number" && typeof propValue.end === "number" && !propValue.type.startsWith("TS")) {
        replacements.push({ start: propValue.start - baseOffset, end: propValue.end - baseOffset, text: emitWithBare(propValue, nextShadowed) });
      }
    }
    if (replacements.length === 0) return rawExpression.slice(relStart, relEnd);
    replacements.sort((left, right) => left.start - right.start);
    let out = "";
    let cursor = relStart;
    for (const rep of replacements) {
      if (rep.start < cursor || rep.end > relEnd) continue;
      out += rawExpression.slice(cursor, rep.start) + rep.text;
      cursor = rep.end;
    }
    return out + rawExpression.slice(cursor, relEnd);
  }

  return emitWithBare(expressionAst, new Set());
}

export function normalizePredicateToCanonicalArrow(
  predicateExpr: ESTreeNode,
  rawPredicate: string
): string {
  if (predicateExpr.type === "ArrowFunctionExpression" || predicateExpr.type === "FunctionExpression") {
    const params = Array.isArray(predicateExpr.params) ? (predicateExpr.params as ESTreeNode[]) : [];
    const paramNames: string[] = [];
    for (const paramNode of params) {
      if (paramNode.type === "Identifier" && typeof paramNode.name === "string") {
        paramNames.push(paramNode.name);
      } else {
        paramNames.push("");
      }
    }
    const renameMap = new Map<string, string>();
    if (paramNames[0]) renameMap.set(paramNames[0], "__mix_item");
    if (paramNames[1]) renameMap.set(paramNames[1], "__mix_index");

    const bodyNode = predicateExpr.body as ESTreeNode;
    const baseOffset = predicateExpr.start ?? 0;
    const bodyStart = (bodyNode.start ?? baseOffset) - baseOffset;
    const bodyEnd = (bodyNode.end ?? baseOffset + rawPredicate.length) - baseOffset;
    const rawBody = rawPredicate.slice(bodyStart, bodyEnd);
    const bodyRewritten = rewriteIdentifiersToString(rawBody, bodyNode, renameMap, new Set());
    if (bodyNode.type === "BlockStatement") {
      return `(__mix_item, __mix_index) => ${bodyRewritten}`;
    }
    return `(__mix_item, __mix_index) => (${bodyRewritten})`;
  }
  return `(__mix_item, __mix_index) => ((${rawPredicate})(__mix_item, __mix_index))`;
}

export function normalizeBlockConditionToCanonicalArrow(
  conditionExpr: ESTreeNode,
  rawCondition: string,
  itemIdent: string,
  indexIdent: string | null
): string {
  const renameMap = new Map<string, string>([[itemIdent, "__mix_item"]]);
  if (indexIdent) renameMap.set(indexIdent, "__mix_index");
  const bodyRewritten = rewriteIdentifiersToString(rawCondition, conditionExpr, renameMap, new Set());
  return `(__mix_item, __mix_index) => (${bodyRewritten})`;
}

export function rewriteIdentifiersToString(
  rawExpression: string,
  expressionAst: ESTreeNode,
  renameMap: ReadonlyMap<string, string>,
  shadowed: ReadonlySet<string>
): string {
  const baseOffset = expressionAst.start ?? 0;
  function visit(node: ESTreeNode, activeShadowed: ReadonlySet<string>): string {
    const relStart = (node.start ?? baseOffset) - baseOffset;
    const relEnd = (node.end ?? baseOffset + rawExpression.length) - baseOffset;
    if (node.type === "Identifier" && typeof node.name === "string") {
      if (!activeShadowed.has(node.name) && renameMap.has(node.name)) {
        return renameMap.get(node.name)!;
      }
      return rawExpression.slice(relStart, relEnd);
    }
    const nextShadowed = collectShadowedForNode(node, activeShadowed);
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    for (const [propKey, propValue] of Object.entries(node)) {
      if (propKey === "type" || propKey === "start" || propKey === "end" || propKey === "loc" || propKey === "range" || propKey === "typeAnnotation" || propKey === "typeParameters" || propKey === "returnType") continue;
      if (node.type === "MemberExpression" && propKey === "property" && node.computed === false) continue;
      if ((node.type === "Property" || node.type === "ObjectProperty") && propKey === "key" && node.computed === false && node.shorthand !== true) continue;
      if (Array.isArray(propValue)) {
        for (const elem of propValue) {
          if (isESTreeNode(elem) && typeof elem.start === "number" && typeof elem.end === "number") {
            replacements.push({ start: elem.start - baseOffset, end: elem.end - baseOffset, text: visit(elem, nextShadowed) });
          }
        }
      } else if (isESTreeNode(propValue) && typeof propValue.start === "number" && typeof propValue.end === "number") {
        replacements.push({ start: propValue.start - baseOffset, end: propValue.end - baseOffset, text: visit(propValue, nextShadowed) });
      }
    }
    if (replacements.length === 0) return rawExpression.slice(relStart, relEnd);
    replacements.sort((left, right) => left.start - right.start);
    let out = "";
    let cursor = relStart;
    for (const rep of replacements) {
      if (rep.start < cursor || rep.end > relEnd) continue;
      out += rawExpression.slice(cursor, rep.start) + rep.text;
      cursor = rep.end;
    }
    return out + rawExpression.slice(cursor, relEnd);
  }
  return visit(expressionAst, shadowed);
}

export type { EachBlockNode, EachExtNode, IfBlockNode };
