/**
 * @dotmix/compiler-semantic/directives/lower-components-extended — Context, forms, layouts, stacks, composition, render-control, server, and debug component lowering.
 */

import {
  createDirectiveNode,
  createDirectiveSubNode,
  deepFreeze,
  parseHydrateWhenSpec,
  type ComponentCallNode,
  type ContextBlockNode,
  type CsrfNode,
  type DumpNode,
  type FieldErrorNode,
  type FieldValidNode,
  type FormErrorsNode,
  type HasSectionNode,
  type HeadChildEntry,
  type HeadGroupNode,
  type HydrateNode,
  type IncludeFirstNode,
  type IncludeNode,
  type JsonNode,
  type KeepAliveBlockNode,
  type LazyNode,
  type MemoNode,
  type MethodNode,
  type OnceNode,
  type PartialNode,
  type SectionMissingNode,
  type SectionNode,
  type SessionBlockNode,
  type StackNode,
  type StackPushNode,
  type TemplateNode,
  type VerbatimNode,
  type YieldNode
} from "@dotmix/ast";
import { DiagnosticCodes, type Diagnostic } from "@dotmix/diagnostics";
import { rewriteEachIndexInTemplateTree } from "./expr-each-helpers.js";
import {
  extractAttrExpression,
  extractChildRenderOrNodes,
  extractPropAsTemplateNodes,
  findAttr,
  isNonWhitespaceText,
  pushDirectiveError,
  splitPrimaryAndElseChildren,
  type ImportedDirectiveTarget
} from "./lower-components-shared.js";

export function lowerExtendedDirectiveComponent(
  node: ComponentCallNode,
  importedName: string,
  lookup: ReadonlyMap<string, ImportedDirectiveTarget>,
  diagnostics: Diagnostic[],
  lowerList: (list: readonly TemplateNode[]) => readonly TemplateNode[]
): TemplateNode | null {
  switch (importedName) {
    case "Context": {
      const ofSlice = extractAttrExpression(findAttr(node, "of"), node.span);
      if (!ofSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Context>' requires an 'of' prop.", node.span);
        return node;
      }
      const { primaryChildren, elseNodes } = splitPrimaryAndElseChildren(node, lookup, diagnostics, lowerList);
      const { params, nodes } = extractChildRenderOrNodes(primaryChildren, lowerList);
      const boundIdent = params[0] ?? null;
      return createDirectiveNode<ContextBlockNode>({
        type: "ContextBlock",
        form: "component",
        contextExpr: ofSlice.expression,
        rawContextExpr: ofSlice.raw,
        asIdentifier: boundIdent,
        consequent: rewriteEachIndexInTemplateTree(nodes, boundIdent),
        alternate: elseNodes,
        span: node.span
      });
    }

    case "FieldError": {
      const formSlice = extractAttrExpression(findAttr(node, "form"), node.span);
      const nameSlice = extractAttrExpression(findAttr(node, "name"), node.span);
      if (!formSlice || !nameSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<FieldError>' requires 'form' and 'name' props.", node.span);
        return node;
      }
      const { params, nodes } = extractChildRenderOrNodes(node.children, lowerList);
      const boundIdent = params[0] ?? null;
      return createDirectiveNode<FieldErrorNode>({
        type: "FieldError",
        form: "component",
        formExpr: formSlice.expression,
        rawFormExpr: formSlice.raw,
        fieldName: nameSlice.expression,
        rawFieldName: nameSlice.raw,
        asIdentifier: boundIdent,
        children: rewriteEachIndexInTemplateTree(nodes, boundIdent),
        span: node.span
      });
    }

    case "FormErrors": {
      const formSlice = extractAttrExpression(findAttr(node, "form"), node.span);
      if (!formSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<FormErrors>' requires a 'form' prop.", node.span);
        return node;
      }
      const { params, nodes } = extractChildRenderOrNodes(node.children, lowerList);
      const boundIdent = params[0] ?? null;
      return createDirectiveNode<FormErrorsNode>({
        type: "FormErrors",
        form: "component",
        formExpr: formSlice.expression,
        rawFormExpr: formSlice.raw,
        asIdentifier: boundIdent,
        children: rewriteEachIndexInTemplateTree(nodes, boundIdent),
        span: node.span
      });
    }

    case "FieldValid": {
      const formSlice = extractAttrExpression(findAttr(node, "form"), node.span);
      const nameSlice = extractAttrExpression(findAttr(node, "name"), node.span);
      if (!formSlice || !nameSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<FieldValid>' requires 'form' and 'name' props.", node.span);
        return node;
      }
      return createDirectiveNode<FieldValidNode>({
        type: "FieldValid",
        form: "component",
        formExpr: formSlice.expression,
        rawFormExpr: formSlice.raw,
        fieldName: nameSlice.expression,
        rawFieldName: nameSlice.raw,
        children: lowerList(node.children),
        span: node.span
      });
    }

    case "Csrf":
      return createDirectiveNode<CsrfNode>({ type: "Csrf", form: "component", span: node.span });

    case "Method": {
      const valSlice = extractAttrExpression(findAttr(node, "value"), node.span);
      if (!valSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Method>' requires a 'value' prop.", node.span);
        return node;
      }
      return createDirectiveNode<MethodNode>({
        type: "Method",
        form: "component",
        value: valSlice.expression,
        rawValue: valSlice.raw,
        span: node.span
      });
    }

    case "Section":
    case "HasSection":
    case "SectionMissing":
    case "Partial": {
      const nameSlice = extractAttrExpression(findAttr(node, "name"), node.span);
      if (!nameSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, `'<${importedName}>' requires a 'name' prop.`, node.span);
        return node;
      }
      const nodeType =
        importedName === "Section"
          ? "Section"
          : importedName === "HasSection"
            ? "HasSection"
            : importedName === "SectionMissing"
              ? "SectionMissing"
              : "Partial";
      return createDirectiveNode<SectionNode | HasSectionNode | SectionMissingNode | PartialNode>({
        type: nodeType,
        form: "component",
        name: nameSlice.expression,
        rawName: nameSlice.raw,
        children: lowerList(node.children),
        span: node.span
      });
    }

    case "Yield": {
      const nameSlice = extractAttrExpression(findAttr(node, "name"), node.span);
      if (!nameSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Yield>' requires a 'name' prop.", node.span);
        return node;
      }
      const fallbackProp = extractPropAsTemplateNodes(findAttr(node, "fallback"));
      const fallbackNodes = fallbackProp ? lowerList(fallbackProp.nodes) : lowerList(node.children);
      return createDirectiveNode<YieldNode>({
        type: "Yield",
        form: "component",
        name: nameSlice.expression,
        rawName: nameSlice.raw,
        fallback: fallbackNodes,
        span: node.span
      });
    }

    case "Push":
    case "Prepend": {
      const toSlice = extractAttrExpression(findAttr(node, "to"), node.span);
      if (!toSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, `'<${importedName}>' requires a 'to' prop.`, node.span);
        return node;
      }
      const onceSlice = extractAttrExpression(findAttr(node, "once"), node.span);
      return createDirectiveNode<StackPushNode>({
        type: "StackPush",
        form: "component",
        operation: importedName === "Prepend" ? "prepend" : "push",
        target: toSlice.expression,
        rawTarget: toSlice.raw,
        onceId: onceSlice ? onceSlice.expression : null,
        rawOnceId: onceSlice ? onceSlice.raw : null,
        children: lowerList(node.children),
        span: node.span
      });
    }

    case "Stack": {
      const nameSlice = extractAttrExpression(findAttr(node, "name"), node.span);
      if (!nameSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Stack>' requires a 'name' prop.", node.span);
        return node;
      }
      return createDirectiveNode<StackNode>({
        type: "Stack",
        form: "component",
        name: nameSlice.expression,
        rawName: nameSlice.raw,
        span: node.span
      });
    }

    case "Head": {
      const entries: HeadChildEntry[] = [];
      for (const child of node.children) {
        if (!isNonWhitespaceText(child)) continue;
        if (child.type !== "ComponentCall") {
          pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Head>' may only contain <Title>, <Meta>, and <Link> children.", child.span);
          continue;
        }
        const resolved = lookup.get(child.name);
        if (!resolved?.branch || resolved.branch.parentId !== "head") {
          pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, `Unexpected child '<${child.name}>' inside '<Head>'.`, child.span);
          continue;
        }
        const tagName = resolved.importedName.toLowerCase() as "title" | "meta" | "link";
        entries.push(
          createDirectiveSubNode<HeadChildEntry>({
            tag: tagName,
            attributes: child.attributes,
            children: lowerList(child.children),
            span: child.span
          })
        );
      }
      return createDirectiveNode<HeadGroupNode>({
        type: "HeadGroup",
        form: "component",
        entries: deepFreeze(entries),
        children: deepFreeze(
          entries.map((entry) =>
            deepFreeze({
              type: "Element" as const,
              tag: entry.tag,
              attributes: entry.attributes,
              children: entry.children,
              selfClosing: entry.tag !== "title",
              span: entry.span
            })
          )
        ),
        span: node.span
      });
    }

    case "Include": {
      const compSlice = extractAttrExpression(findAttr(node, "component"), node.span);
      if (!compSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Include>' requires a 'component' prop.", node.span);
        return node;
      }
      const propsSlice = extractAttrExpression(findAttr(node, "props"), node.span);
      const condSlice = extractAttrExpression(findAttr(node, "condition"), node.span);
      const unlessSlice = extractAttrExpression(findAttr(node, "unless"), node.span);
      const pendingProp = extractPropAsTemplateNodes(findAttr(node, "pending"));
      const fallbackProp = extractPropAsTemplateNodes(findAttr(node, "fallback"));
      return createDirectiveNode<IncludeNode>({
        type: "Include",
        form: "component",
        component: compSlice.expression,
        rawComponent: compSlice.raw,
        props: propsSlice ? propsSlice.expression : null,
        rawProps: propsSlice ? propsSlice.raw : null,
        condition: condSlice ? condSlice.expression : null,
        rawCondition: condSlice ? condSlice.raw : null,
        unless: unlessSlice ? unlessSlice.expression : null,
        rawUnless: unlessSlice ? unlessSlice.raw : null,
        pending: pendingProp ? lowerList(pendingProp.nodes) : deepFreeze([]),
        fallback: fallbackProp ? lowerList(fallbackProp.nodes) : deepFreeze([]),
        span: node.span
      });
    }

    case "IncludeFirst": {
      const candSlice = extractAttrExpression(findAttr(node, "candidates"), node.span);
      if (!candSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<IncludeFirst>' requires a 'candidates' prop.", node.span);
        return node;
      }
      const propsSlice = extractAttrExpression(findAttr(node, "props"), node.span);
      const pendingProp = extractPropAsTemplateNodes(findAttr(node, "pending"));
      const { primaryChildren, elseNodes } = splitPrimaryAndElseChildren(node, lookup, diagnostics, lowerList, "fallback");
      const pendingNodes = pendingProp ? lowerList(pendingProp.nodes) : lowerList(primaryChildren);
      return createDirectiveNode<IncludeFirstNode>({
        type: "IncludeFirst",
        form: "component",
        candidates: candSlice.expression,
        rawCandidates: candSlice.raw,
        props: propsSlice ? propsSlice.expression : null,
        rawProps: propsSlice ? propsSlice.raw : null,
        pending: pendingNodes,
        fallback: elseNodes ?? deepFreeze([]),
        span: node.span
      });
    }

    case "Once":
      return createDirectiveNode<OnceNode>({ type: "Once", form: "component", children: lowerList(node.children), span: node.span });

    case "Memo": {
      const depsSlice = extractAttrExpression(findAttr(node, "on"), node.span);
      if (!depsSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Memo>' requires an 'on' dependency array prop.", node.span);
        return node;
      }
      const eqSlice = extractAttrExpression(findAttr(node, "equals"), node.span);
      return createDirectiveNode<MemoNode>({
        type: "Memo",
        form: "component",
        deps: depsSlice.expression,
        rawDeps: depsSlice.raw,
        equals: eqSlice ? eqSlice.expression : null,
        rawEquals: eqSlice ? eqSlice.raw : null,
        children: lowerList(node.children),
        span: node.span
      });
    }

    case "Lazy": {
      const triggerSlice = extractAttrExpression(findAttr(node, "trigger"), node.span);
      const isIdle =
        triggerSlice &&
        triggerSlice.expression.type === "Literal" &&
        triggerSlice.expression.value === "idle";
      const { primaryChildren, elseNodes } = splitPrimaryAndElseChildren(node, lookup, diagnostics, lowerList, "fallback");
      return createDirectiveNode<LazyNode>({
        type: "Lazy",
        form: "component",
        trigger: isIdle ? "idle" : "visible",
        triggerExpr: triggerSlice ? triggerSlice.expression : null,
        rawTriggerExpr: triggerSlice ? triggerSlice.raw : null,
        children: lowerList(primaryChildren),
        fallback: elseNodes ?? deepFreeze([]),
        span: node.span
      });
    }

    case "Hydrate": {
      const whenExpr = extractAttrExpression(findAttr(node, "when"), node.span)?.expression;
      const mediaExpr = extractAttrExpression(findAttr(node, "media"), node.span)?.expression;
      const rawWhen = whenExpr?.type === "Literal" && typeof whenExpr.value === "string" ? whenExpr.value : "";
      const rawMedia = mediaExpr?.type === "Literal" && typeof mediaExpr.value === "string" ? mediaExpr.value : null;
      const parsed = rawWhen ? parseHydrateWhenSpec(rawWhen, rawMedia) : null;
      if (!parsed) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Hydrate>' requires a valid 'when' prop: load | idle | visible | media \"<query>\" | never.", node.span);
        return node;
      }
      return createDirectiveNode<HydrateNode>({ type: "Hydrate", form: "component", when: parsed.when, media: parsed.media, children: lowerList(node.children), span: node.span });
    }

    case "KeepAlive": {
      const keySlice = extractAttrExpression(findAttr(node, "activeKey"), node.span);
      if (!keySlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<KeepAlive>' requires an 'activeKey' prop.", node.span);
        return node;
      }
      const maxSlice = extractAttrExpression(findAttr(node, "max"), node.span);
      const { params, nodes } = extractChildRenderOrNodes(node.children, lowerList);
      const boundIdent = params[0] ?? null;
      return createDirectiveNode<KeepAliveBlockNode>({
        type: "KeepAliveBlock",
        form: "component",
        activeKey: keySlice.expression,
        rawActiveKey: keySlice.raw,
        max: maxSlice ? maxSlice.expression : null,
        rawMax: maxSlice ? maxSlice.raw : null,
        asIdentifier: boundIdent,
        children: rewriteEachIndexInTemplateTree(nodes, boundIdent),
        span: node.span
      });
    }

    case "Session": {
      const keySlice = extractAttrExpression(findAttr(node, "key"), node.span);
      if (!keySlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Session>' requires a 'key' prop.", node.span);
        return node;
      }
      const { primaryChildren, elseNodes } = splitPrimaryAndElseChildren(node, lookup, diagnostics, lowerList);
      const { params, nodes } = extractChildRenderOrNodes(primaryChildren, lowerList);
      const boundIdent = params[0] ?? null;
      return createDirectiveNode<SessionBlockNode>({
        type: "SessionBlock",
        form: "component",
        key: keySlice.expression,
        rawKey: keySlice.raw,
        asIdentifier: boundIdent,
        consequent: rewriteEachIndexInTemplateTree(nodes, boundIdent),
        alternate: elseNodes,
        span: node.span
      });
    }

    case "Json": {
      const idSlice = extractAttrExpression(findAttr(node, "id"), node.span);
      const dataSlice = extractAttrExpression(findAttr(node, "data"), node.span);
      if (!idSlice || !dataSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Json>' requires 'id' and 'data' props.", node.span);
        return node;
      }
      return createDirectiveNode<JsonNode>({
        type: "Json",
        form: "component",
        id: idSlice.expression,
        rawId: idSlice.raw,
        data: dataSlice.expression,
        rawData: dataSlice.raw,
        span: node.span
      });
    }

    case "Dump": {
      const valSlice = extractAttrExpression(findAttr(node, "value"), node.span);
      if (!valSlice) {
        pushDirectiveError(diagnostics, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'<Dump>' requires a 'value' prop.", node.span);
        return node;
      }
      return createDirectiveNode<DumpNode>({
        type: "Dump",
        form: "component",
        value: valSlice.expression,
        rawValue: valSlice.raw,
        span: node.span
      });
    }

    case "Verbatim": {
      const textContent = node.children
        .map((child) => (child.type === "Text" ? child.value : ""))
        .join("");
      return createDirectiveNode<VerbatimNode>({
        type: "Verbatim",
        form: "component",
        content: textContent,
        span: node.span
      });
    }

    default:
      return null;
  }
}
