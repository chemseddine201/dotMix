/**
 * @dotmix/compiler-semantic/directives/lower-components — Dual-mode directive component lowering and block pipeline normalization.
 */

import {
  createDirectiveNode,
  deepFreeze,
  type AuthBlockNode,
  type AwaitBlockNode,
  type CanAnyBlockNode,
  type CannotBlockNode,
  type ComponentCallNode,
  type ComponentNode,
  type ESTreeNode,
  type EachBlockNode,
  type EachExtNode,
  type EnvGateNode,
  type ForBlockNode,
  type GuestBlockNode,
  type IfBlockNode,
  type IsEmptyBlockNode,
  type IsSetBlockNode,
  type TemplateNode,
  type UnlessBlockNode
} from "@dotmix/ast";
import { DiagnosticCodes, type Diagnostic } from "@dotmix/diagnostics";
import { buildCanonicalSkipStopFromControls, extractEachKeyBody, rewriteEachIndexInTemplateTree } from "./expr-each-helpers.js";
import { normalizePredicateToCanonicalArrow } from "./expr-helpers.js";
import { lowerExtendedDirectiveComponent } from "./lower-components-extended.js";
import {
  buildImportedDirectiveLookup,
  extractAttrExpression,
  extractChildRenderOrNodes,
  extractPropAsTemplateNodes,
  findAttr,
  isNonWhitespaceText,
  lowerCanComponent,
  lowerSwitchComponent,
  matchBranchComponent,
  pushDirectiveError,
  splitPrimaryAndElseChildren,
  unpackArrayOrCommaExpressions,
  type ImportedDirectiveTarget
} from "./lower-components-shared.js";

function extractStaticStringArray(expr: ESTreeNode | undefined): string[] | null {
  if (!expr) return null;
  if (expr.type === "Literal" && typeof expr.value === "string") return [expr.value];
  if (expr.type === "ArrayExpression" && Array.isArray(expr.elements)) {
    const out: string[] = [];
    for (const elem of expr.elements) {
      if (!elem || typeof elem !== "object") return null;
      const astElem = elem as ESTreeNode;
      if (astElem.type === "Literal" && typeof astElem.value === "string") out.push(astElem.value);
      else return null;
    }
    return out.length > 0 ? out : null;
  }
  return null;
}

function lowerIfComponent(
  node: ComponentCallNode,
  lookup: ReadonlyMap<string, ImportedDirectiveTarget>,
  diagnostics: Diagnostic[],
  lowerList: (list: readonly TemplateNode[]) => readonly TemplateNode[]
): TemplateNode {
  const condSlice = extractAttrExpression(findAttr(node, "condition"), node.span);
  if (!condSlice) {
    pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<If>' requires a 'condition' prop.", node.span);
    return node;
  }
  const primaryNodes: TemplateNode[] = [];
  const elseIfBranches: Array<{ cond: ESTreeNode; raw: string; body: readonly TemplateNode[]; span: ComponentCallNode["span"] }> = [];
  let elseNodes: readonly TemplateNode[] | null = null;

  for (const child of node.children) {
    const elseIfComp = matchBranchComponent(child, lookup, "ElseIf");
    if (elseIfComp) {
      if (elseNodes !== null) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "'<ElseIf>' cannot appear after '<Else>'.", elseIfComp.span);
        continue;
      }
      const subCond = extractAttrExpression(findAttr(elseIfComp, "condition"), elseIfComp.span);
      if (!subCond) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<ElseIf>' requires a 'condition' prop.", elseIfComp.span);
        continue;
      }
      elseIfBranches.push({ cond: subCond.expression, raw: subCond.raw, body: lowerList(elseIfComp.children), span: elseIfComp.span });
      continue;
    }
    const elseComp = matchBranchComponent(child, lookup, "Else");
    if (elseComp) {
      if (elseNodes !== null) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "Duplicate '<Else>' inside '<If>'.", elseComp.span);
        continue;
      }
      elseNodes = lowerList(elseComp.children);
      continue;
    }
    if ((elseIfBranches.length > 0 || elseNodes !== null) && isNonWhitespaceText(child)) {
      pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "Content cannot appear after '<ElseIf>' or '<Else>' inside '<If>'.", child.span);
      continue;
    }
    primaryNodes.push(child);
  }

  let alternate: readonly TemplateNode[] | IfBlockNode | null = elseNodes;
  for (let i = elseIfBranches.length - 1; i >= 0; i--) {
    const branch = elseIfBranches[i]!;
    alternate = deepFreeze({
      type: "IfBlock",
      form: "component",
      condition: branch.cond,
      rawCondition: branch.raw,
      consequent: branch.body,
      alternate,
      span: branch.span
    });
  }

  return deepFreeze({
    type: "IfBlock",
    form: "component",
    condition: condSlice.expression,
    rawCondition: condSlice.raw,
    consequent: lowerList(primaryNodes),
    alternate,
    span: node.span
  });
}

function lowerEachComponent(
  node: ComponentCallNode,
  lookup: ReadonlyMap<string, ImportedDirectiveTarget>,
  diagnostics: Diagnostic[],
  lowerList: (list: readonly TemplateNode[]) => readonly TemplateNode[]
): TemplateNode {
  const dataSlice = extractAttrExpression(findAttr(node, "data"), node.span);
  if (!dataSlice) {
    pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Each>' requires a 'data' prop.", node.span);
    return node;
  }
  const renderSlice = extractAttrExpression(findAttr(node, "render"), node.span);
  const asAttr = findAttr(node, "as");
  const asPropName = asAttr?.type === "StaticAttribute" ? asAttr.value : null;
  const fallbackProp = extractPropAsTemplateNodes(findAttr(node, "fallback"));
  const skipSlice = extractAttrExpression(findAttr(node, "skip"), node.span);
  const stopSlice = extractAttrExpression(findAttr(node, "stop"), node.span);
  const keyPropSlice = extractAttrExpression(findAttr(node, "key"), node.span);

  const primaryChildren: TemplateNode[] = [];
  let emptyNodes: readonly TemplateNode[] = fallbackProp ? lowerList(fallbackProp.nodes) : deepFreeze([]);
  let hasEmptyChild = false;

  for (const child of node.children) {
    const emptyComp = matchBranchComponent(child, lookup, "Empty");
    if (emptyComp) {
      if (hasEmptyChild) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "Duplicate '<Empty>' inside '<Each>'.", emptyComp.span);
        continue;
      }
      if (fallbackProp) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT, "Cannot specify both 'fallback' prop and '<Empty>' child on '<Each>'.", emptyComp.span);
      }
      hasEmptyChild = true;
      emptyNodes = lowerList(emptyComp.children);
      continue;
    }
    primaryChildren.push(child);
  }

  const { params, nodes } = extractChildRenderOrNodes(primaryChildren, lowerList);
  const itemIdentifier = params[0] ?? asPropName ?? "item";
  const indexIdentifier = params[1] ?? null;
  const normalizedChildren = rewriteEachIndexInTemplateTree(nodes, indexIdentifier);

  const normalizedKey = keyPropSlice
    ? extractEachKeyBody(keyPropSlice.expression, keyPropSlice.raw, itemIdentifier, indexIdentifier)
    : null;
  const keyExpr = normalizedKey
    ? normalizedKey.expression
    : deepFreeze({ type: "Identifier", name: itemIdentifier, start: node.span.start.offset, end: node.span.end.offset, range: [node.span.start.offset, node.span.end.offset] as const, loc: node.span });
  const rawKeyExpr = normalizedKey ? normalizedKey.raw : itemIdentifier;
  const explicitKey = keyPropSlice !== null;

  if (!renderSlice && !skipSlice && !stopSlice && !hasEmptyChild && !fallbackProp) {
    return deepFreeze({
      type: "EachBlock",
      form: "component",
      collection: dataSlice.expression,
      rawCollection: dataSlice.raw,
      itemIdentifier,
      indexIdentifier,
      keyExpression: keyExpr,
      rawKeyExpression: rawKeyExpr,
      explicitKey,
      children: normalizedChildren,
      span: node.span
    }) as EachBlockNode;
  }

  return createDirectiveNode<EachExtNode>({
    type: "EachExtBlock",
    form: "component",
    collection: dataSlice.expression,
    rawCollection: dataSlice.raw,
    itemIdentifier,
    indexIdentifier,
    keyExpression: keyExpr,
    rawKeyExpression: rawKeyExpr,
    explicitKey,
    controls: deepFreeze([]),
    skipExpression: skipSlice ? skipSlice.expression : null,
    rawSkipExpression: skipSlice ? normalizePredicateToCanonicalArrow(skipSlice.expression, skipSlice.raw) : null,
    stopExpression: stopSlice ? stopSlice.expression : null,
    rawStopExpression: stopSlice ? normalizePredicateToCanonicalArrow(stopSlice.expression, stopSlice.raw) : null,
    renderComponent: renderSlice ? renderSlice.expression : null,
    rawRenderComponent: renderSlice ? renderSlice.raw : null,
    renderPropName: asPropName ?? (renderSlice ? "item" : null),
    children: normalizedChildren,
    empty: emptyNodes,
    span: node.span
  });
}

export function lowerDirectiveComponents(
  ast: ComponentNode,
  diagnostics: Diagnostic[]
): { ast: ComponentNode; hasPlainCanComponent: boolean } {
  const lookup = buildImportedDirectiveLookup(ast);
  let hasPlainCanComponent = false;

  function lowerList(nodes: readonly TemplateNode[]): readonly TemplateNode[] {
    return deepFreeze(nodes.map((child) => lowerNode(child)));
  }

  function lowerNode(node: TemplateNode): TemplateNode {
    if (node.type === "Element" || node.type === "DynamicElement") {
      return deepFreeze({ ...node, children: lowerList(node.children) });
    }
    if (node.type === "IfBlock") {
      return deepFreeze({
        ...node,
        consequent: lowerList(node.consequent),
        alternate: node.alternate === null ? null : Array.isArray(node.alternate) ? lowerList(node.alternate) : (lowerNode(node.alternate as TemplateNode) as IfBlockNode)
      });
    }
    if (node.type === "EachBlock") {
      return deepFreeze({ ...node, children: lowerList(node.children) });
    }
    if (node.type === "EachExtBlock") {
      const skipNorm = node.skipExpression ? { expression: node.skipExpression, raw: node.rawSkipExpression! } : buildCanonicalSkipStopFromControls(node.controls, "continue", node.itemIdentifier, node.indexIdentifier);
      const stopNorm = node.stopExpression ? { expression: node.stopExpression, raw: node.rawStopExpression! } : buildCanonicalSkipStopFromControls(node.controls, "break", node.itemIdentifier, node.indexIdentifier);
      return deepFreeze({
        ...node,
        skipExpression: skipNorm ? skipNorm.expression : null,
        rawSkipExpression: skipNorm ? skipNorm.raw : null,
        stopExpression: stopNorm ? stopNorm.expression : null,
        rawStopExpression: stopNorm ? stopNorm.raw : null,
        children: lowerList(node.children),
        empty: lowerList(node.empty)
      });
    }
    if (node.type === "AwaitBlock") {
      return deepFreeze({ ...node, pending: lowerList(node.pending), thenBranch: lowerList(node.thenBranch), catchBranch: lowerList(node.catchBranch) });
    }
    if (node.type !== "ComponentCall") return node;

    const target = lookup.get(node.name);
    if (!target) {
      return deepFreeze({ ...node, children: lowerList(node.children) });
    }
    if (target.branch) {
      pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH, `Orphan directive branch '<${node.name}>' outside its parent directive.`, node.span);
      return node;
    }

    const importedName = target.importedName;
    if (importedName === "Can") {
      const loweredCan = lowerCanComponent(node, lookup, diagnostics, lowerList);
      if (loweredCan.type === "ComponentCall") hasPlainCanComponent = true;
      return loweredCan;
    }
    if (importedName === "If") return lowerIfComponent(node, lookup, diagnostics, lowerList);
    if (importedName === "Switch") return lowerSwitchComponent(node, lookup, diagnostics, lowerList);
    if (importedName === "Each") return lowerEachComponent(node, lookup, diagnostics, lowerList);

    if (importedName === "Unless" || importedName === "IsSet" || importedName === "IsEmpty") {
      const propName = importedName === "Unless" ? "condition" : "value";
      const exprSlice = extractAttrExpression(findAttr(node, propName), node.span);
      if (!exprSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, `'<${importedName}>' requires a '${propName}' prop.`, node.span);
        return node;
      }
      const { primaryChildren, elseNodes } = splitPrimaryAndElseChildren(node, lookup, diagnostics, lowerList);
      if (importedName === "Unless") {
        return createDirectiveNode<UnlessBlockNode>({ type: "UnlessBlock", form: "component", condition: exprSlice.expression, rawCondition: exprSlice.raw, consequent: lowerList(primaryChildren), alternate: elseNodes, span: node.span });
      }
      if (importedName === "IsEmpty") {
        return createDirectiveNode<IsEmptyBlockNode>({ type: "IsEmptyBlock", form: "component", value: exprSlice.expression, rawValue: exprSlice.raw, consequent: lowerList(primaryChildren), alternate: elseNodes, span: node.span });
      }
      const { params, nodes } = extractChildRenderOrNodes(primaryChildren, lowerList);
      const boundIdent = params[0] ?? null;
      return createDirectiveNode<IsSetBlockNode>({ type: "IsSetBlock", form: "component", value: exprSlice.expression, rawValue: exprSlice.raw, asIdentifier: boundIdent, consequent: rewriteEachIndexInTemplateTree(nodes, boundIdent), alternate: elseNodes, span: node.span });
    }

    if (importedName === "For") {
      const fromSlice = extractAttrExpression(findAttr(node, "from"), node.span);
      const toSlice = extractAttrExpression(findAttr(node, "to"), node.span);
      const stepSlice = extractAttrExpression(findAttr(node, "step"), node.span);
      const timesSlice = extractAttrExpression(findAttr(node, "times"), node.span);
      const { params, nodes } = extractChildRenderOrNodes(node.children, lowerList);
      const boundIdent = params[0] ?? null;
      if ((timesSlice && (fromSlice || toSlice)) || (!timesSlice && (!fromSlice || !toSlice))) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<For>' requires either ('from' and 'to') or 'times'.", node.span);
        return node;
      }
      return createDirectiveNode<ForBlockNode>({
        type: "ForBlock",
        form: "component",
        variant: timesSlice ? "times" : "range",
        itemIdentifier: boundIdent,
        from: fromSlice ? fromSlice.expression : null,
        rawFrom: fromSlice ? fromSlice.raw : null,
        to: toSlice ? toSlice.expression : null,
        rawTo: toSlice ? toSlice.raw : null,
        step: stepSlice ? stepSlice.expression : null,
        rawStep: stepSlice ? stepSlice.raw : null,
        times: timesSlice ? timesSlice.expression : null,
        rawTimes: timesSlice ? timesSlice.raw : null,
        children: rewriteEachIndexInTemplateTree(nodes, boundIdent),
        span: node.span
      });
    }

    if (importedName === "Await") {
      const promiseSlice = extractAttrExpression(findAttr(node, "promise"), node.span);
      if (!promiseSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Await>' requires a 'promise' prop.", node.span);
        return node;
      }
      const pendingProp = extractPropAsTemplateNodes(findAttr(node, "pending"));
      const catchProp = extractPropAsTemplateNodes(findAttr(node, "catch"));
      const { params, nodes } = extractChildRenderOrNodes(node.children, lowerList);
      const thenIdent = params[0] ?? null;
      const catchIdent = catchProp?.params[0] ?? null;
      const rawCatchNodes = catchProp ? lowerList(catchProp.nodes) : deepFreeze([]);
      return deepFreeze({
        type: "AwaitBlock",
        form: "component",
        expression: promiseSlice.expression,
        rawExpression: promiseSlice.raw,
        pending: pendingProp ? lowerList(pendingProp.nodes) : deepFreeze([]),
        thenIdentifier: thenIdent,
        thenBranch: rewriteEachIndexInTemplateTree(nodes, thenIdent),
        catchIdentifier: catchIdent,
        catchBranch: rewriteEachIndexInTemplateTree(rawCatchNodes, catchIdent),
        span: node.span
      }) as AwaitBlockNode;
    }

    if (importedName === "Auth" || importedName === "Guest") {
      const guardSlice = extractAttrExpression(findAttr(node, "guard"), node.span);
      const { primaryChildren, elseNodes } = splitPrimaryAndElseChildren(node, lookup, diagnostics, lowerList);
      if (importedName === "Guest") {
        return createDirectiveNode<GuestBlockNode>({ type: "GuestBlock", form: "component", guard: guardSlice ? guardSlice.expression : null, rawGuard: guardSlice ? guardSlice.raw : null, consequent: lowerList(primaryChildren), alternate: elseNodes, span: node.span });
      }
      const roleAttr = findAttr(node, "role");
      const unpackedRoles = unpackArrayOrCommaExpressions(roleAttr, node.span);
      const { params, paramTypes, nodes } = extractChildRenderOrNodes(primaryChildren, lowerList);
      const boundIdent = params[0] ?? null;
      return createDirectiveNode<AuthBlockNode>({ type: "AuthBlock", form: "component", guard: guardSlice ? guardSlice.expression : null, rawGuard: guardSlice ? guardSlice.raw : null, roles: deepFreeze(unpackedRoles.list), rawRoles: deepFreeze(unpackedRoles.rawList), roleExpression: null, rawRoleExpression: null, asIdentifier: boundIdent, asTypeAnnotation: paramTypes[0] ?? null, consequent: rewriteEachIndexInTemplateTree(nodes, boundIdent), alternate: elseNodes, span: node.span });
    }

    if (importedName === "Cannot" || importedName === "CanAny") {
      const actionSlice = extractAttrExpression(findAttr(node, "I"), node.span);
      if (!actionSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, `'<${importedName}>' requires an 'I' prop.`, node.span);
        return node;
      }
      const thisSlice = extractAttrExpression(findAttr(node, "this"), node.span);
      const typeSlice = extractAttrExpression(findAttr(node, "a") ?? findAttr(node, "an"), node.span);
      const fieldSlice = extractAttrExpression(findAttr(node, "field"), node.span);
      const { primaryChildren, elseNodes } = splitPrimaryAndElseChildren(node, lookup, diagnostics, lowerList);
      if (importedName === "Cannot") {
        return createDirectiveNode<CannotBlockNode>({ type: "CannotBlock", form: "component", action: actionSlice.expression, rawAction: actionSlice.raw, subject: thisSlice ? thisSlice.expression : null, rawSubject: thisSlice ? thisSlice.raw : null, subjectType: typeSlice ? typeSlice.expression : null, rawSubjectType: typeSlice ? typeSlice.raw : null, field: fieldSlice ? fieldSlice.expression : null, rawField: fieldSlice ? fieldSlice.raw : null, consequent: lowerList(primaryChildren), alternate: elseNodes, span: node.span });
      }
      return createDirectiveNode<CanAnyBlockNode>({ type: "CanAnyBlock", form: "component", actions: actionSlice.expression, rawActions: actionSlice.raw, subject: thisSlice ? thisSlice.expression : null, rawSubject: thisSlice ? thisSlice.raw : null, subjectType: typeSlice ? typeSlice.expression : null, rawSubjectType: typeSlice ? typeSlice.raw : null, consequent: lowerList(primaryChildren), alternate: elseNodes, span: node.span });
    }

    if (importedName === "Dev" || importedName === "Production" || importedName === "Env") {
      let environments: string[] = [];
      let rawExpr: ESTreeNode | null = null;
      let rawExprText: string | null = null;
      if (importedName === "Env") {
        const isSlice = extractAttrExpression(findAttr(node, "is"), node.span);
        rawExpr = isSlice ? isSlice.expression : null;
        rawExprText = isSlice ? isSlice.raw : null;
        const parsedEnvs = extractStaticStringArray(isSlice?.expression);
        if (!parsedEnvs) {
          pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_ENV_NOT_STATIC, "'<Env>' 'is' prop must be a static string or array of static strings.", node.span);
          return node;
        }
        environments = parsedEnvs;
      }
      const { primaryChildren, elseNodes } = splitPrimaryAndElseChildren(node, lookup, diagnostics, lowerList);
      return createDirectiveNode<EnvGateNode>({ type: "EnvGate", form: "component", mode: importedName === "Dev" ? "dev" : importedName === "Production" ? "production" : "env", environments: deepFreeze(environments), rawExpression: rawExpr, rawExpressionText: rawExprText, consequent: lowerList(primaryChildren), alternate: elseNodes, span: node.span });
    }

    return lowerExtendedDirectiveComponent(node, importedName, lookup, diagnostics, lowerList) ?? node;
  }

  return { ast: deepFreeze({ ...ast, template: lowerList(ast.template) }), hasPlainCanComponent };
}
