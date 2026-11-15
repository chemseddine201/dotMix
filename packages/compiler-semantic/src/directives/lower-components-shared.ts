/**
 * @dotmix/compiler-semantic/directives/lower-components-shared — Registry import resolver, attribute readers, and shared branch helpers.
 */

import * as ts from "typescript";
import {
  DIRECTIVE_GRAMMAR,
  createDirectiveNode,
  createDirectiveSubNode,
  deepFreeze,
  type AttributeNode,
  type CanBranch,
  type CanChainNode,
  type ComponentCallNode,
  type ComponentNode,
  type DirectiveBranchGrammar,
  type DirectiveGrammarEntry,
  type DynamicAttributeNode,
  type ESTreeNode,
  type StaticAttributeNode,
  type SwitchBlockNode,
  type SwitchCaseBranch,
  type TemplateNode,
  type TemplateRenderFunctionNode,
  type ParameterTypeAnnotation
} from "@dotmix/ast";
import { DiagnosticCodes, type Diagnostic, type SourceSpan } from "@dotmix/diagnostics";

export interface ImportedDirectiveTarget {
  readonly entry?: DirectiveGrammarEntry;
  readonly branch?: DirectiveBranchGrammar;
  readonly importedName: string;
  readonly importSource: string;
}

const COMP_ENTRY_BY_NAME = new Map<string, DirectiveGrammarEntry>();
const BRANCH_BY_NAME = new Map<string, DirectiveBranchGrammar[]>();

for (const entry of DIRECTIVE_GRAMMAR.directives) {
  COMP_ENTRY_BY_NAME.set(entry.componentName, entry);
  for (const branch of entry.branchComponents) {
    const list = BRANCH_BY_NAME.get(branch.name) ?? [];
    list.push(branch);
    BRANCH_BY_NAME.set(branch.name, list);
  }
}

export function buildImportedDirectiveLookup(
  ast: ComponentNode
): ReadonlyMap<string, ImportedDirectiveTarget> {
  const lookup = new Map<string, ImportedDirectiveTarget>();
  if (!ast.script?.content) return lookup;

  const sourceFile = ts.createSourceFile(
    ast.span.file ?? "script.ts",
    ast.script.content,
    ts.ScriptTarget.Latest,
    true
  );

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.importClause?.isTypeOnly) continue;
    const importSource = stmt.moduleSpecifier.text;
    const namedBindings = stmt.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = (element.propertyName ?? element.name).text;
      const localName = element.name.text;
      const compEntry = COMP_ENTRY_BY_NAME.get(importedName);
      if (compEntry && compEntry.importSources.includes(importSource)) {
        lookup.set(localName, { entry: compEntry, importedName, importSource });
        continue;
      }
      const branchMatches = BRANCH_BY_NAME.get(importedName);
      if (branchMatches && branchMatches.length > 0 && branchMatches[0]!.importSource === importSource) {
        lookup.set(localName, { branch: branchMatches[0]!, importedName, importSource });
      }
    }
  }
  return lookup;
}

export function pushDirectiveError(
  diagnostics: Diagnostic[],
  code: (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes],
  message: string,
  span: SourceSpan
): void {
  diagnostics.push({ code, message, severity: "error", span });
}

export function findAttr(node: ComponentCallNode, attrName: string): AttributeNode | undefined {
  return node.attributes.find(
    (attr) =>
      (attr.type === "StaticAttribute" || attr.type === "DynamicAttribute") &&
      attr.name === attrName
  );
}

export function extractAttrExpression(
  attr: AttributeNode | undefined,
  fallbackSpan: SourceSpan
): { expression: ESTreeNode; raw: string } | null {
  if (!attr) return null;
  if (attr.type === "StaticAttribute") {
    const literalJson = JSON.stringify(attr.value);
    const expr: ESTreeNode = deepFreeze({
      type: "Literal",
      value: attr.value,
      raw: literalJson,
      start: attr.span.start.offset,
      end: attr.span.end.offset,
      range: [attr.span.start.offset, attr.span.end.offset] as const,
      loc: attr.span
    });
    return { expression: expr, raw: literalJson };
  }
  if (attr.type === "DynamicAttribute") {
    return { expression: attr.expression, raw: attr.rawExpression };
  }
  void fallbackSpan;
  return null;
}

export function extractPropAsTemplateNodes(
  attr: AttributeNode | undefined
): { nodes: readonly TemplateNode[]; params: readonly string[] } | null {
  if (!attr) return null;
  if (attr.type === "DynamicAttribute") {
    const dyn = attr as DynamicAttributeNode;
    if (dyn.templateValue) {
      return { nodes: dyn.templateValue, params: dyn.templateParams ?? [] };
    }
    return {
      nodes: deepFreeze([
        {
          type: "Interpolation",
          expression: dyn.expression,
          rawExpression: dyn.rawExpression,
          span: dyn.span
        }
      ]),
      params: []
    };
  }
  if (attr.type === "StaticAttribute") {
    const stat = attr as StaticAttributeNode;
    return {
      nodes: deepFreeze([{ type: "Text", value: stat.value, span: stat.span }]),
      params: []
    };
  }
  return null;
}

export function extractChildRenderOrNodes(
  children: readonly TemplateNode[],
  transformList: (list: readonly TemplateNode[]) => readonly TemplateNode[]
): {
  params: readonly string[];
  paramTypes: readonly (ParameterTypeAnnotation | null)[];
  nodes: readonly TemplateNode[];
} {
  const nonWs = children.filter((child) => !(child.type === "Text" && child.value.trim() === ""));
  if (nonWs.length === 1 && nonWs[0]!.type === "TemplateRenderFunction") {
    const renderFn = nonWs[0] as TemplateRenderFunctionNode;
    return {
      params: renderFn.params,
      paramTypes: renderFn.paramTypes ?? [],
      nodes: transformList(renderFn.body)
    };
  }
  return { params: [], paramTypes: [], nodes: transformList(children) };
}

export function isNonWhitespaceText(node: TemplateNode): boolean {
  return !(node.type === "Text" && node.value.trim() === "");
}

export function matchBranchComponent(
  node: TemplateNode,
  lookup: ReadonlyMap<string, ImportedDirectiveTarget>,
  expectedBranchName?: string
): ComponentCallNode | null {
  if (node.type !== "ComponentCall") return null;
  const resolved = lookup.get(node.name);
  if (!resolved || !resolved.branch) return null;
  if (expectedBranchName && resolved.importedName !== expectedBranchName) return null;
  return node;
}

export function isImportedBranchComponent(
  node: TemplateNode,
  lookup: ReadonlyMap<string, ImportedDirectiveTarget>,
  expectedBranchName?: string
): boolean {
  return matchBranchComponent(node, lookup, expectedBranchName) !== null;
}

export function splitPrimaryAndElseChildren(
  node: ComponentCallNode,
  lookup: ReadonlyMap<string, ImportedDirectiveTarget>,
  diagnostics: Diagnostic[],
  transformList: (list: readonly TemplateNode[]) => readonly TemplateNode[],
  elsePropName: string = "else"
): {
  primaryChildren: readonly TemplateNode[];
  elseNodes: readonly TemplateNode[] | null;
} {
  const elseProp = findAttr(node, elsePropName);
  const primary: TemplateNode[] = [];
  let elseBranchNodes: TemplateNode[] | null = null;

  for (const child of node.children) {
    const elseComp = matchBranchComponent(child, lookup, "Else");
    if (elseComp) {
      if (elseBranchNodes !== null) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "Duplicate '<Else>' child inside directive.", elseComp.span);
        continue;
      }
      if (elseProp) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT, `Cannot specify both '${elsePropName}' prop and '<Else>' child.`, elseComp.span);
      }
      elseBranchNodes = [...transformList(elseComp.children)];
      continue;
    }
    if (elseBranchNodes !== null && isNonWhitespaceText(child)) {
      pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "Content or branches cannot follow '<Else>'.", child.span);
      continue;
    }
    primary.push(child);
  }

  let resolvedAlternate: readonly TemplateNode[] | null = elseBranchNodes;
  if (resolvedAlternate === null && elseProp) {
    const propTemplate = extractPropAsTemplateNodes(elseProp);
    resolvedAlternate = propTemplate ? transformList(propTemplate.nodes) : null;
  }

  return { primaryChildren: primary, elseNodes: resolvedAlternate };
}

export function unpackArrayOrCommaExpressions(
  attr: AttributeNode | undefined,
  fallbackSpan: SourceSpan
): { list: readonly ESTreeNode[]; rawList: readonly string[] } {
  const extracted = extractAttrExpression(attr, fallbackSpan);
  if (!extracted) return { list: [], rawList: [] };
  if (extracted.expression.type === "ArrayExpression" && Array.isArray(extracted.expression.elements)) {
    const list: ESTreeNode[] = [];
    const rawList: string[] = [];
    const baseOffset = extracted.expression.start ?? 0;
    for (const elem of extracted.expression.elements) {
      if (!elem || typeof elem !== "object") continue;
      const astElem = elem as ESTreeNode;
      list.push(astElem);
      if (typeof astElem.start === "number" && typeof astElem.end === "number") {
        rawList.push(extracted.raw.slice(astElem.start - baseOffset, astElem.end - baseOffset));
      } else {
        rawList.push(extracted.raw);
      }
    }
    return { list, rawList };
  }
  return { list: [extracted.expression], rawList: [extracted.raw] };
}

export { createDirectiveNode };

export function lowerSwitchComponent(
  node: ComponentCallNode,
  lookup: ReadonlyMap<string, ImportedDirectiveTarget>,
  diagnostics: Diagnostic[],
  lowerList: (list: readonly TemplateNode[]) => readonly TemplateNode[]
): TemplateNode {
  const onSlice = extractAttrExpression(findAttr(node, "on"), node.span);
  const cases: SwitchCaseBranch[] = [];
  let defaultBranch: readonly TemplateNode[] | null = null;
  let seenBranch = false;

  for (const child of node.children) {
    const caseComp = matchBranchComponent(child, lookup, "Case");
    if (caseComp) {
      seenBranch = true;
      if (defaultBranch !== null) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_SWITCH_DEFAULT_ORDER, "'<Default>' must be the last branch inside '<Switch>'.", caseComp.span);
        continue;
      }
      const isAttr = findAttr(caseComp, "is");
      const condAttr = findAttr(caseComp, "condition");
      if ((isAttr && condAttr) || (!isAttr && !condAttr) || (isAttr && !onSlice)) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_SWITCH_CASE_FORM, "'<Case>' requires exactly one of 'is' (with Switch 'on') or 'condition'.", caseComp.span);
        continue;
      }
      if (condAttr) {
        const condSlice = extractAttrExpression(condAttr, caseComp.span)!;
        cases.push(createDirectiveSubNode<SwitchCaseBranch>({ kind: "condition", values: deepFreeze([]), rawValues: deepFreeze([]), condition: condSlice.expression, rawCondition: condSlice.raw, body: lowerList(caseComp.children), span: caseComp.span }));
      } else {
        const unpacked = unpackArrayOrCommaExpressions(isAttr, caseComp.span);
        cases.push(createDirectiveSubNode<SwitchCaseBranch>({ kind: "values", values: deepFreeze(unpacked.list), rawValues: deepFreeze(unpacked.rawList), condition: null, rawCondition: null, body: lowerList(caseComp.children), span: caseComp.span }));
      }
      continue;
    }
    const defaultComp = matchBranchComponent(child, lookup, "Default");
    if (defaultComp) {
      seenBranch = true;
      if (defaultBranch !== null) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "Duplicate '<Default>' inside '<Switch>'.", defaultComp.span);
        continue;
      }
      defaultBranch = lowerList(defaultComp.children);
      continue;
    }
    if (isNonWhitespaceText(child)) {
      pushDirectiveError(diagnostics, seenBranch ? DiagnosticCodes.MIX_ERR_PARSE_SYNTAX : DiagnosticCodes.MIX_ERR_SWITCH_STRAY_CONTENT, "Unexpected content outside '<Case>' / '<Default>' inside '<Switch>'.", child.span);
    }
  }

  return createDirectiveNode<SwitchBlockNode>({
    type: "SwitchBlock",
    form: "component",
    subject: onSlice ? onSlice.expression : null,
    rawSubject: onSlice ? onSlice.raw : null,
    cases: deepFreeze(cases),
    defaultBranch,
    span: node.span
  });
}

export function lowerCanComponent(
  node: ComponentCallNode,
  lookup: ReadonlyMap<string, ImportedDirectiveTarget>,
  diagnostics: Diagnostic[],
  lowerList: (list: readonly TemplateNode[]) => readonly TemplateNode[]
): TemplateNode {
  const hasElseCanOrElse = node.children.some(
    (child) => isImportedBranchComponent(child, lookup, "ElseCan") || isImportedBranchComponent(child, lookup, "Else")
  );
  if (!hasElseCanOrElse) {
    return deepFreeze({ ...node, children: lowerList(node.children) });
  }
  const fallbackAttr = findAttr(node, "fallback");
  if (fallbackAttr) {
    pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT, "Cannot specify both 'fallback' prop and '<ElseCan>'/'<Else>' children on '<Can>'.", fallbackAttr.span);
  }
  const makeBranch = (comp: ComponentCallNode, body: readonly TemplateNode[]): CanBranch | null => {
    const actionSlice = extractAttrExpression(findAttr(comp, "I"), comp.span);
    if (!actionSlice) {
      pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, `'<${comp.name}>' requires an 'I' action prop.`, comp.span);
      return null;
    }
    const thisSlice = extractAttrExpression(findAttr(comp, "this"), comp.span);
    const typeSlice = extractAttrExpression(findAttr(comp, "a") ?? findAttr(comp, "an"), comp.span);
    const fieldSlice = extractAttrExpression(findAttr(comp, "field"), comp.span);
    return createDirectiveSubNode<CanBranch>({
      action: actionSlice.expression,
      rawAction: actionSlice.raw,
      subject: thisSlice ? thisSlice.expression : null,
      rawSubject: thisSlice ? thisSlice.raw : null,
      subjectType: typeSlice ? typeSlice.expression : null,
      rawSubjectType: typeSlice ? typeSlice.raw : null,
      field: fieldSlice ? fieldSlice.expression : null,
      rawField: fieldSlice ? fieldSlice.raw : null,
      body,
      span: comp.span
    });
  };

  const firstBody: TemplateNode[] = [];
  const branches: CanBranch[] = [];
  let alternate: readonly TemplateNode[] | null = null;

  for (const child of node.children) {
    const elseCanComp = matchBranchComponent(child, lookup, "ElseCan");
    if (elseCanComp) {
      if (alternate !== null) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "'<ElseCan>' cannot appear after '<Else>'.", elseCanComp.span);
        continue;
      }
      const branchObj = makeBranch(elseCanComp, lowerList(elseCanComp.children));
      if (branchObj) branches.push(branchObj);
      continue;
    }
    const elseComp = matchBranchComponent(child, lookup, "Else");
    if (elseComp) {
      if (alternate !== null) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "Duplicate '<Else>' inside '<Can>'.", elseComp.span);
        continue;
      }
      alternate = lowerList(elseComp.children);
      continue;
    }
    firstBody.push(child);
  }

  const headBranch = makeBranch(node, lowerList(firstBody));
  if (!headBranch) return node;
  return createDirectiveNode<CanChainNode>({
    type: "CanChain",
    form: "component",
    branches: deepFreeze([headBranch, ...branches]),
    alternate,
    span: node.span
  });
}
