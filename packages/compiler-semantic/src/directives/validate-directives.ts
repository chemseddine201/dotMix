/**
 * @dotmix/compiler-semantic/directives/validate-directives — Scope validation, static diagnostics, and projection for directives.
 */

import {
  DIRECTIVE_GRAMMAR,
  isESTreeNode,
  type AttributeNode,
  type ConditionalAttributeNode,
  type ConditionalEventNode,
  type ESTreeNode,
  type ElementNode,
  type SourceSpan,
  type TemplateNode
} from "@dotmix/ast";
import { DiagnosticCodes, type Diagnostic } from "@dotmix/diagnostics";
import type { Scope, SymbolBinding } from "../types.js";
import { verifyExpressionIdentifiers } from "../scope-analyzer.js";
import { collectScriptDirectiveHints, type DirectiveScriptHints } from "./expr-helpers.js";
export { collectScriptDirectiveHints, type DirectiveScriptHints };

const BOOLEAN_HTML_ATTR_SET = new Set<string>(DIRECTIVE_GRAMMAR.booleanHtmlAttributes);

function withBindingScope(parent: Scope, ident: string | null | undefined, span: SourceSpan): Scope {
  if (!ident) return parent;
  return {
    parent,
    bindings: new Map<string, SymbolBinding>([[ident, { name: ident, kind: "loop", span }]])
  };
}

function scanOnceWrites(
  nodes: readonly TemplateNode[],
  hints: DirectiveScriptHints,
  signalNames: ReadonlySet<string>,
  diagnostics: Diagnostic[]
): void {
  function checkExpr(expr: ESTreeNode | null | undefined, span: SourceSpan): void {
    if (!expr) return;
    function visitAst(node: unknown): void {
      if (!isESTreeNode(node)) return;
      if (node.type === "CallExpression" && isESTreeNode(node.callee)) {
        if (node.callee.type === "Identifier" && typeof node.callee.name === "string") {
          const name = node.callee.name;
          if (hints.signalSetters.has(name) || (name.startsWith("set") && name.length > 3 && signalNames.has(name.slice(3, 4).toLowerCase() + name.slice(4)))) {
            diagnostics.push({
              code: DiagnosticCodes.MIX_ERR_ONCE_WRITE,
              message: `Signal write '${name}(...)' is forbidden inside '{once}' / '<Once>'.`,
              severity: "error",
              span
            });
          }
        } else if (
          node.callee.type === "MemberExpression" &&
          node.callee.computed === false &&
          isESTreeNode(node.callee.object) &&
          node.callee.object.type === "Identifier" &&
          typeof node.callee.object.name === "string" &&
          signalNames.has(node.callee.object.name) &&
          isESTreeNode(node.callee.property) &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "set"
        ) {
          diagnostics.push({
            code: DiagnosticCodes.MIX_ERR_ONCE_WRITE,
            message: `Signal write '${node.callee.object.name}.set(...)' is forbidden inside '{once}' / '<Once>'.`,
            severity: "error",
            span
          });
        }
      }
      for (const propValue of Object.values(node)) {
        if (Array.isArray(propValue)) {
          for (const elem of propValue) visitAst(elem);
        } else if (isESTreeNode(propValue)) {
          visitAst(propValue);
        }
      }
    }
    visitAst(expr);
  }

  for (const child of nodes) {
    switch (child.type) {
      case "Interpolation":
        checkExpr(child.expression, child.span);
        break;
      case "Element":
      case "ComponentCall":
      case "DynamicElement":
        for (const attr of child.attributes) {
          if (attr.type === "DynamicAttribute") {
            if (attr.templateValue) scanOnceWrites(attr.templateValue, hints, signalNames, diagnostics);
            else checkExpr(attr.expression, attr.span);
          } else if (attr.type === "DirectiveAttribute") checkExpr(attr.expression, attr.span);
          else if (attr.type === "ConditionalAttribute" && attr.expression) checkExpr(attr.expression, attr.span);
          else if (attr.type === "ClassMap" || attr.type === "StyleMap") checkExpr(attr.expression, attr.span);
        }
        scanOnceWrites(child.children, hints, signalNames, diagnostics);
        break;
      case "IfBlock":
        checkExpr(child.condition, child.span);
        scanOnceWrites(child.consequent, hints, signalNames, diagnostics);
        if (child.alternate) {
          scanOnceWrites(Array.isArray(child.alternate) ? child.alternate : [child.alternate as TemplateNode], hints, signalNames, diagnostics);
        }
        break;
      case "Once":
        scanOnceWrites(child.children, hints, signalNames, diagnostics);
        break;
      default:
        break;
    }
  }
}

export function validateElementDirectiveAttributes(
  node: TemplateNode & { readonly attributes: readonly AttributeNode[]; readonly tag?: string },
  currentScope: Scope,
  diagnostics: Diagnostic[],
  warnings: Diagnostic[]
): void {
  const baseAttrNames = new Set<string>();
  const baseEventNames = new Set<string>();
  const condAttrs = new Map<string, ConditionalAttributeNode[]>();
  const condEvents = new Map<string, ConditionalEventNode[]>();
  let hasDisabledAttr = false;
  let hasAriaDisabled = false;
  let hasHrefAttr = false;

  for (const attr of node.attributes) {
    switch (attr.type) {
      case "StaticAttribute":
      case "DynamicAttribute":
      case "DirectiveAttribute":
        baseAttrNames.add(attr.name);
        if (attr.name === "disabled") hasDisabledAttr = true;
        if (attr.name === "aria-disabled") hasAriaDisabled = true;
        if (attr.name === "href") hasHrefAttr = true;
        break;
      case "EventBinding":
        baseEventNames.add(attr.name);
        break;
      case "ConditionalAttribute": {
        if (attr.expression) verifyExpressionIdentifiers(attr.expression, currentScope, diagnostics, attr.span);
        if (attr.name === "disabled") hasDisabledAttr = true;
        if (attr.name === "aria-disabled" && (attr.modifier === "unless" || attr.modifier === "if")) hasAriaDisabled = true;
        const list = condAttrs.get(attr.name) ?? [];
        list.push(attr);
        condAttrs.set(attr.name, list);
        break;
      }
      case "ConditionalEvent": {
        verifyExpressionIdentifiers(attr.expression, currentScope, diagnostics, attr.span);
        const list = condEvents.get(attr.eventName) ?? [];
        list.push(attr);
        condEvents.set(attr.eventName, list);
        break;
      }
      case "ClassMap":
      case "StyleMap":
        verifyExpressionIdentifiers(attr.expression, currentScope, diagnostics, attr.span);
        break;
      case "ConditionalSpread":
        verifyExpressionIdentifiers(attr.spreadExpression, currentScope, diagnostics, attr.span);
        if (attr.condition) verifyExpressionIdentifiers(attr.condition, currentScope, diagnostics, attr.span);
        break;
      default:
        break;
    }
  }

  for (const [attrName, list] of condAttrs.entries()) {
    const hasIf = list.some((entry) => entry.modifier === "if");
    const hasUnless = list.some((entry) => entry.modifier === "unless");
    const hasMatch = list.some((entry) => entry.modifier === "match");
    const elseEntries = list.filter((entry) => entry.modifier === "else");
    if (hasIf && hasUnless) {
      diagnostics.push({ code: DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT, message: `Cannot combine ':if' and ':unless' on attribute '${attrName}'.`, severity: "error", span: list[0]!.span });
    }
    if (elseEntries.length > 0 && !hasIf && !hasUnless && !hasMatch) {
      diagnostics.push({ code: DiagnosticCodes.MIX_ERR_CONDITIONAL_ELSE_ALONE, message: `'${attrName}:else' requires '${attrName}:if', '${attrName}:unless', or '${attrName}:match'.`, severity: "error", span: elseEntries[0]!.span });
    }
    if ((hasIf || hasUnless) && !baseAttrNames.has(attrName) && !BOOLEAN_HTML_ATTR_SET.has(attrName)) {
      const targetMod = list.find((entry) => entry.modifier === "if" || entry.modifier === "unless")!;
      diagnostics.push({ code: DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE, message: `'${attrName}:${targetMod.modifier}' requires a base '${attrName}' attribute.`, severity: "error", span: targetMod.span });
    }
  }

  for (const [eventName, list] of condEvents.entries()) {
    const hasIf = list.some((entry) => entry.modifier === "if");
    const hasUnless = list.some((entry) => entry.modifier === "unless");
    const elseEntries = list.filter((entry) => entry.modifier === "else");
    if (hasIf && hasUnless) {
      diagnostics.push({ code: DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT, message: `Cannot combine ':if' and ':unless' on event '${eventName}'.`, severity: "error", span: list[0]!.span });
    }
    if (elseEntries.length > 0 && !hasIf && !hasUnless) {
      diagnostics.push({ code: DiagnosticCodes.MIX_ERR_CONDITIONAL_ELSE_ALONE, message: `':else' on event '${eventName}' requires ':if' or ':unless'.`, severity: "error", span: elseEntries[0]!.span });
    }
    if ((hasIf || hasUnless) && !baseEventNames.has(eventName)) {
      const targetMod = list.find((entry) => entry.modifier === "if" || entry.modifier === "unless")!;
      diagnostics.push({ code: DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE, message: `Conditional event '${targetMod.rawName}:${targetMod.modifier}' requires a base handler for '${eventName}'.`, severity: "error", span: targetMod.span });
    }
  }

  if (node.type === "Element") {
    const tagLower = (node as ElementNode).tag.toLowerCase();
    const hasConditionalClick = condEvents.has("click");
    if (hasConditionalClick && (tagLower === "button" || (tagLower === "a" && hasHrefAttr)) && !hasDisabledAttr && !hasAriaDisabled) {
      warnings.push({
        code: DiagnosticCodes.MIX_WARN_INERT_INTERACTIVE,
        message: `Conditional click handler on <${tagLower}> without 'disabled' or 'aria-disabled:unless' may confuse assistive technology.`,
        severity: "warning",
        span: condEvents.get("click")![0]!.span
      });
    }
  }
}

function checkFormFieldKnown(
  formExpr: ESTreeNode,
  fieldNameExpr: ESTreeNode,
  span: SourceSpan,
  hints: DirectiveScriptHints,
  diagnostics: Diagnostic[]
): void {
  if (formExpr.type !== "Identifier" || typeof formExpr.name !== "string") return;
  const knownFields = hints.formFieldsByVar.get(formExpr.name);
  if (!knownFields) return;
  if (fieldNameExpr.type === "Literal" && typeof fieldNameExpr.value === "string") {
    if (!knownFields.has(fieldNameExpr.value)) {
      diagnostics.push({
        code: DiagnosticCodes.MIX_ERR_FORM_FIELD_UNKNOWN,
        message: `Unknown form field '${fieldNameExpr.value}' on form '${formExpr.name}'.`,
        severity: "error",
        span
      });
    }
  }
}

export function validateDirectiveTemplateNode(
  node: TemplateNode,
  currentScope: Scope,
  diagnostics: Diagnostic[],
  warnings: Diagnostic[],
  hints: DirectiveScriptHints,
  signalNames: ReadonlySet<string>,
  recurse: (nodes: readonly TemplateNode[], scope: Scope) => void
): boolean {
  switch (node.type) {
    case "UnlessBlock":
      verifyExpressionIdentifiers(node.condition, currentScope, diagnostics, node.span);
      recurse(node.consequent, currentScope);
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "IsSetBlock": {
      verifyExpressionIdentifiers(node.value, currentScope, diagnostics, node.span);
      recurse(node.consequent, withBindingScope(currentScope, node.asIdentifier, node.span));
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    }
    case "IsEmptyBlock":
      verifyExpressionIdentifiers(node.value, currentScope, diagnostics, node.span);
      recurse(node.consequent, currentScope);
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "SwitchBlock":
      if (node.subject) verifyExpressionIdentifiers(node.subject, currentScope, diagnostics, node.span);
      for (const caseBranch of node.cases) {
        if (caseBranch.condition) verifyExpressionIdentifiers(caseBranch.condition, currentScope, diagnostics, caseBranch.span);
        for (const candidate of caseBranch.values) verifyExpressionIdentifiers(candidate, currentScope, diagnostics, caseBranch.span);
        recurse(caseBranch.body, currentScope);
      }
      if (node.defaultBranch) recurse(node.defaultBranch, currentScope);
      return true;
    case "EachExtBlock": {
      verifyExpressionIdentifiers(node.collection, currentScope, diagnostics, node.span);
      const loopScope = withBindingScope(withBindingScope(currentScope, node.itemIdentifier, node.span), node.indexIdentifier, node.span);
      if (node.keyExpression) verifyExpressionIdentifiers(node.keyExpression, loopScope, diagnostics, node.span);
      for (const ctrl of node.controls) verifyExpressionIdentifiers(ctrl.condition, loopScope, diagnostics, ctrl.span);
      if (node.renderComponent) {
        if (node.controls.length > 0) {
          diagnostics.push({ code: DiagnosticCodes.MIX_ERR_LOOP_CONTROL_POSITION, message: "Loop controls '{continue if}' / '{break if}' cannot be used with 'each ... render'.", severity: "error", span: node.controls[0]!.span });
        }
        verifyExpressionIdentifiers(node.renderComponent, currentScope, diagnostics, node.span);
      }
      recurse(node.children, loopScope);
      recurse(node.empty, currentScope);
      return true;
    }
    case "ForBlock": {
      if (node.from) verifyExpressionIdentifiers(node.from, currentScope, diagnostics, node.span);
      if (node.to) verifyExpressionIdentifiers(node.to, currentScope, diagnostics, node.span);
      if (node.step) {
        verifyExpressionIdentifiers(node.step, currentScope, diagnostics, node.span);
        if (node.step.type === "Literal" && node.step.value === 0) {
          diagnostics.push({ code: DiagnosticCodes.MIX_ERR_FOR_STEP_ZERO, message: "'{for}' / '<For>' step cannot be 0.", severity: "error", span: node.span });
        }
      }
      if (node.times) {
        verifyExpressionIdentifiers(node.times, currentScope, diagnostics, node.span);
        if (node.times.type === "Literal" && typeof node.times.value === "number" && node.times.value > 100_000) {
          diagnostics.push({ code: DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE, message: "'{for}' / '<For>' times count exceeds 100,000 iterations.", severity: "error", span: node.span });
        }
      } else if (node.from?.type === "Literal" && typeof node.from.value === "number" && node.to?.type === "Literal" && typeof node.to.value === "number") {
        const stepNum = node.step?.type === "Literal" && typeof node.step.value === "number" && node.step.value !== 0 ? Math.abs(node.step.value) : 1;
        if (Math.abs(node.to.value - node.from.value) / stepNum + 1 > 100_000) {
          diagnostics.push({ code: DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE, message: "'{for}' / '<For>' range exceeds 100,000 iterations.", severity: "error", span: node.span });
        }
      }
      recurse(node.children, withBindingScope(currentScope, node.itemIdentifier, node.span));
      return true;
    }
    case "AuthBlock": {
      if (node.guard) verifyExpressionIdentifiers(node.guard, currentScope, diagnostics, node.span);
      for (const roleExpr of node.roles) verifyExpressionIdentifiers(roleExpr, currentScope, diagnostics, node.span);
      if (node.roleExpression) verifyExpressionIdentifiers(node.roleExpression, currentScope, diagnostics, node.span);
      recurse(node.consequent, withBindingScope(currentScope, node.asIdentifier, node.span));
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    }
    case "GuestBlock":
      if (node.guard) verifyExpressionIdentifiers(node.guard, currentScope, diagnostics, node.span);
      recurse(node.consequent, currentScope);
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "CanChain":
      for (const branch of node.branches) {
        verifyExpressionIdentifiers(branch.action, currentScope, diagnostics, branch.span);
        if (branch.subject) verifyExpressionIdentifiers(branch.subject, currentScope, diagnostics, branch.span);
        if (branch.field) verifyExpressionIdentifiers(branch.field, currentScope, diagnostics, branch.span);
        recurse(branch.body, currentScope);
      }
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "CannotBlock":
      verifyExpressionIdentifiers(node.action, currentScope, diagnostics, node.span);
      if (node.subject) verifyExpressionIdentifiers(node.subject, currentScope, diagnostics, node.span);
      if (node.field) verifyExpressionIdentifiers(node.field, currentScope, diagnostics, node.span);
      recurse(node.consequent, currentScope);
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "CanAnyBlock":
      verifyExpressionIdentifiers(node.actions, currentScope, diagnostics, node.span);
      if (node.subject) verifyExpressionIdentifiers(node.subject, currentScope, diagnostics, node.span);
      recurse(node.consequent, currentScope);
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "EnvGate":
      recurse(node.consequent, currentScope);
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "ContextBlock":
      verifyExpressionIdentifiers(node.contextExpr, currentScope, diagnostics, node.span);
      recurse(node.consequent, withBindingScope(currentScope, node.asIdentifier, node.span));
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "FieldError":
      verifyExpressionIdentifiers(node.formExpr, currentScope, diagnostics, node.span);
      verifyExpressionIdentifiers(node.fieldName, currentScope, diagnostics, node.span);
      checkFormFieldKnown(node.formExpr, node.fieldName, node.span, hints, diagnostics);
      recurse(node.children, withBindingScope(currentScope, node.asIdentifier, node.span));
      return true;
    case "FormErrors":
      verifyExpressionIdentifiers(node.formExpr, currentScope, diagnostics, node.span);
      recurse(node.children, withBindingScope(currentScope, node.asIdentifier, node.span));
      return true;
    case "FieldValid":
      verifyExpressionIdentifiers(node.formExpr, currentScope, diagnostics, node.span);
      verifyExpressionIdentifiers(node.fieldName, currentScope, diagnostics, node.span);
      checkFormFieldKnown(node.formExpr, node.fieldName, node.span, hints, diagnostics);
      recurse(node.children, currentScope);
      return true;
    case "Csrf":
    case "Verbatim":
      return true;
    case "Method":
      verifyExpressionIdentifiers(node.value, currentScope, diagnostics, node.span);
      return true;
    case "Section":
    case "HasSection":
    case "SectionMissing":
    case "Partial":
      verifyExpressionIdentifiers(node.name, currentScope, diagnostics, node.span);
      recurse(node.children, currentScope);
      return true;
    case "Yield":
      verifyExpressionIdentifiers(node.name, currentScope, diagnostics, node.span);
      recurse(node.fallback, currentScope);
      return true;
    case "StackPush":
      verifyExpressionIdentifiers(node.target, currentScope, diagnostics, node.span);
      if (node.onceId) verifyExpressionIdentifiers(node.onceId, currentScope, diagnostics, node.span);
      recurse(node.children, currentScope);
      return true;
    case "Stack":
      verifyExpressionIdentifiers(node.name, currentScope, diagnostics, node.span);
      return true;
    case "HeadGroup":
      for (const entry of node.entries) {
        validateElementDirectiveAttributes({ ...entry, type: "Element", tag: entry.tag, selfClosing: false } as ElementNode, currentScope, diagnostics, warnings);
        recurse(entry.children, currentScope);
      }
      return true;
    case "Include":
      verifyExpressionIdentifiers(node.component, currentScope, diagnostics, node.span);
      if (node.props) verifyExpressionIdentifiers(node.props, currentScope, diagnostics, node.span);
      if (node.condition) verifyExpressionIdentifiers(node.condition, currentScope, diagnostics, node.span);
      if (node.unless) verifyExpressionIdentifiers(node.unless, currentScope, diagnostics, node.span);
      recurse(node.pending, currentScope);
      recurse(node.fallback, currentScope);
      return true;
    case "IncludeFirst":
      verifyExpressionIdentifiers(node.candidates, currentScope, diagnostics, node.span);
      if (node.props) verifyExpressionIdentifiers(node.props, currentScope, diagnostics, node.span);
      recurse(node.pending, currentScope);
      recurse(node.fallback, currentScope);
      return true;
    case "Once":
      scanOnceWrites(node.children, hints, signalNames, diagnostics);
      recurse(node.children, currentScope);
      return true;
    case "Memo":
      verifyExpressionIdentifiers(node.deps, currentScope, diagnostics, node.span);
      if (node.equals) verifyExpressionIdentifiers(node.equals, currentScope, diagnostics, node.span);
      if (node.deps.type === "ArrayExpression" && Array.isArray(node.deps.elements) && node.deps.elements.length === 0) {
        warnings.push({
          code: DiagnosticCodes.MIX_WARN_MEMO_EMPTY_DEPS,
          message: "'{memo}' / '<Memo>' with empty dependency array should use '{once}' / '<Once>'.",
          severity: "warning",
          span: node.span
        });
      }
      recurse(node.children, currentScope);
      return true;
    case "Lazy":
      if (node.triggerExpr) verifyExpressionIdentifiers(node.triggerExpr, currentScope, diagnostics, node.span);
      recurse(node.children, currentScope);
      recurse(node.fallback, currentScope);
      return true;
    case "Hydrate":
      recurse(node.children, currentScope);
      return true;
    case "KeepAliveBlock":
      verifyExpressionIdentifiers(node.activeKey, currentScope, diagnostics, node.span);
      if (node.max) verifyExpressionIdentifiers(node.max, currentScope, diagnostics, node.span);
      recurse(node.children, withBindingScope(currentScope, node.asIdentifier, node.span));
      return true;
    case "SessionBlock":
      verifyExpressionIdentifiers(node.key, currentScope, diagnostics, node.span);
      recurse(node.consequent, withBindingScope(currentScope, node.asIdentifier, node.span));
      if (node.alternate) recurse(node.alternate, currentScope);
      return true;
    case "Json":
      verifyExpressionIdentifiers(node.id, currentScope, diagnostics, node.span);
      verifyExpressionIdentifiers(node.data, currentScope, diagnostics, node.span);
      return true;
    case "Dump":
      verifyExpressionIdentifiers(node.value, currentScope, diagnostics, node.span);
      return true;
    case "TemplateRenderFunction": {
      let innerScope = currentScope;
      for (const paramName of node.params) innerScope = withBindingScope(innerScope, paramName, node.span);
      recurse(node.body, innerScope);
      return true;
    }
    default:
      return false;
  }
}
