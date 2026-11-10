/**
 * @mix/ast/template-nodes — Component, template, attribute, and block AST node definitions, builders, and walker.
 */

import type { SourceSpan } from "@mix/diagnostics";
import type { ESTreeNode } from "./estree.js";
import { validateSpan, deepFreeze } from "./spans.js";

export interface ASTNodeBase {
  readonly span: SourceSpan;
}

export interface ScriptBlockNode extends ASTNodeBase {
  readonly type: "ScriptBlock";
  readonly lang: "js" | "ts";
  readonly content: string;
  readonly contentSpan: SourceSpan;
  readonly postamble?: string | undefined;
}

export interface StyleBlockNode extends ASTNodeBase {
  readonly type: "StyleBlock";
  readonly scoped: boolean;
  readonly content: string;
  readonly contentSpan: SourceSpan;
  readonly src?: string;
}

export interface StaticAttributeNode extends ASTNodeBase {
  readonly type: "StaticAttribute";
  readonly name: string;
  readonly value: string;
}

export interface DynamicAttributeNode extends ASTNodeBase {
  readonly type: "DynamicAttribute";
  readonly name: string;
  readonly expression: ESTreeNode;
  readonly rawExpression: string;
  readonly templateValue?: readonly TemplateNode[] | undefined;
}

export interface EventBindingNode extends ASTNodeBase {
  readonly type: "EventBinding";
  readonly name: string;
  readonly handler: ESTreeNode;
  readonly rawHandler: string;
}

export interface RefBindingNode extends ASTNodeBase {
  readonly type: "RefBinding";
  readonly target: ESTreeNode;
  readonly rawTarget: string;
}

export interface BindBindingNode extends ASTNodeBase {
  readonly type: "BindBinding";
  readonly name: string;
  readonly target: ESTreeNode;
  readonly rawTarget: string;
}

export interface DirectiveAttributeNode extends ASTNodeBase {
  readonly type: "DirectiveAttribute";
  readonly name: "mix-html";
  readonly expression: ESTreeNode;
  readonly rawExpression: string;
}

export type AttributeNode =
  | StaticAttributeNode
  | DynamicAttributeNode
  | EventBindingNode
  | RefBindingNode
  | BindBindingNode
  | DirectiveAttributeNode;

export interface ElementNode extends ASTNodeBase {
  readonly type: "Element";
  readonly tag: string;
  readonly attributes: readonly AttributeNode[];
  readonly children: readonly TemplateNode[];
  readonly selfClosing: boolean;
}

export interface ComponentCallNode extends ASTNodeBase {
  readonly type: "ComponentCall";
  readonly name: string;
  readonly attributes: readonly AttributeNode[];
  readonly children: readonly TemplateNode[];
  readonly selfClosing: boolean;
}

export interface DynamicElementNode extends ASTNodeBase {
  readonly type: "DynamicElement";
  readonly tagExpression: ESTreeNode;
  readonly rawTagExpression: string;
  readonly attributes: readonly AttributeNode[];
  readonly children: readonly TemplateNode[];
  readonly selfClosing: boolean;
}

export interface TextNode extends ASTNodeBase {
  readonly type: "Text";
  readonly value: string;
}

export interface InterpolationNode extends ASTNodeBase {
  readonly type: "Interpolation";
  readonly expression: ESTreeNode;
  readonly rawExpression: string;
}

export interface CommentNode extends ASTNodeBase {
  readonly type: "Comment";
  readonly value: string;
}

export interface EachBlockNode extends ASTNodeBase {
  readonly type: "EachBlock";
  readonly collection: ESTreeNode;
  readonly rawCollection: string;
  readonly itemIdentifier: string;
  readonly indexIdentifier: string | null;
  readonly keyExpression: ESTreeNode;
  readonly rawKeyExpression: string;
  readonly children: readonly TemplateNode[];
  readonly legacySyntax?: boolean | undefined;
}

export interface IfBlockNode extends ASTNodeBase {
  readonly type: "IfBlock";
  readonly condition: ESTreeNode;
  readonly rawCondition: string;
  readonly consequent: readonly TemplateNode[];
  readonly alternate: readonly TemplateNode[] | IfBlockNode | null;
  readonly legacySyntax?: boolean | undefined;
}

export interface SlotOutletNode extends ASTNodeBase {
  readonly type: "SlotOutlet";
  readonly name: string | null;
  readonly fallback: readonly TemplateNode[];
  readonly selfClosing: boolean;
}

export interface AwaitBlockNode extends ASTNodeBase {
  readonly type: "AwaitBlock";
  readonly expression: ESTreeNode;
  readonly rawExpression: string;
  readonly pending: readonly TemplateNode[];
  readonly thenIdentifier: string | null;
  readonly thenBranch: readonly TemplateNode[];
  readonly catchIdentifier: string | null;
  readonly catchBranch: readonly TemplateNode[];
  readonly legacySyntax?: boolean | undefined;
}

export type TemplateNode =
  | ElementNode
  | ComponentCallNode
  | DynamicElementNode
  | TextNode
  | InterpolationNode
  | CommentNode
  | EachBlockNode
  | IfBlockNode
  | SlotOutletNode
  | AwaitBlockNode;

export interface ComponentNode extends ASTNodeBase {
  readonly type: "Component";
  readonly script: ScriptBlockNode | null;
  readonly style: StyleBlockNode | null;
  readonly template: readonly TemplateNode[];
}

export type ASTNode =
  | ComponentNode
  | ScriptBlockNode
  | StyleBlockNode
  | AttributeNode
  | TemplateNode;

export function createComponentNode(params: {
  span: SourceSpan;
  script: ScriptBlockNode | null;
  style: StyleBlockNode | null;
  template: readonly TemplateNode[];
}): ComponentNode {
  validateSpan(params.span);
  return deepFreeze({
    type: "Component",
    span: params.span,
    script: params.script,
    style: params.style,
    template: [...params.template]
  });
}

export function createElementNode(params: {
  span: SourceSpan;
  tag: string;
  attributes: readonly AttributeNode[];
  children: readonly TemplateNode[];
  selfClosing?: boolean;
}): ElementNode {
  validateSpan(params.span);
  return deepFreeze({
    type: "Element",
    span: params.span,
    tag: params.tag,
    attributes: [...params.attributes],
    children: [...params.children],
    selfClosing: params.selfClosing ?? false
  });
}

export function createComponentCallNode(params: {
  span: SourceSpan;
  name: string;
  attributes: readonly AttributeNode[];
  children: readonly TemplateNode[];
  selfClosing?: boolean;
}): ComponentCallNode {
  validateSpan(params.span);
  return deepFreeze({
    type: "ComponentCall",
    span: params.span,
    name: params.name,
    attributes: [...params.attributes],
    children: [...params.children],
    selfClosing: params.selfClosing ?? false
  });
}

export function createDynamicElementNode(params: {
  span: SourceSpan;
  tagExpression: ESTreeNode;
  rawTagExpression: string;
  attributes: readonly AttributeNode[];
  children: readonly TemplateNode[];
  selfClosing?: boolean;
}): DynamicElementNode {
  validateSpan(params.span);
  return deepFreeze({
    type: "DynamicElement",
    span: params.span,
    tagExpression: params.tagExpression,
    rawTagExpression: params.rawTagExpression,
    attributes: [...params.attributes],
    children: [...params.children],
    selfClosing: params.selfClosing ?? false
  });
}

export function createSlotOutletNode(params: {
  span: SourceSpan;
  name?: string | null;
  fallback?: readonly TemplateNode[];
  selfClosing?: boolean;
}): SlotOutletNode {
  validateSpan(params.span);
  return deepFreeze({
    type: "SlotOutlet",
    span: params.span,
    name: params.name ?? null,
    fallback: params.fallback ? [...params.fallback] : [],
    selfClosing: params.selfClosing ?? false
  });
}

export function createAwaitBlockNode(params: {
  span: SourceSpan;
  expression: ESTreeNode;
  rawExpression: string;
  pending?: readonly TemplateNode[];
  thenIdentifier?: string | null;
  thenBranch?: readonly TemplateNode[];
  catchIdentifier?: string | null;
  catchBranch?: readonly TemplateNode[];
  legacySyntax?: boolean;
}): AwaitBlockNode {
  validateSpan(params.span);
  return deepFreeze({
    type: "AwaitBlock",
    span: params.span,
    expression: params.expression,
    rawExpression: params.rawExpression,
    pending: params.pending ? [...params.pending] : [],
    thenIdentifier: params.thenIdentifier ?? null,
    thenBranch: params.thenBranch ? [...params.thenBranch] : [],
    catchIdentifier: params.catchIdentifier ?? null,
    catchBranch: params.catchBranch ? [...params.catchBranch] : [],
    ...(params.legacySyntax ? { legacySyntax: true } : {})
  });
}

export type ASTVisitor = {
  enter?: (node: ASTNode, parent: ASTNode | null) => void;
  leave?: (node: ASTNode, parent: ASTNode | null) => void;
};

export function walk(root: ASTNode, visitor: ASTVisitor): void {
  function visit(node: ASTNode, parent: ASTNode | null): void {
    visitor.enter?.(node, parent);
    if (node.type === "Component") {
      if (node.script) visit(node.script, node);
      if (node.style) visit(node.style, node);
      for (const child of node.template) visit(child, node);
    } else if (
      node.type === "Element" ||
      node.type === "ComponentCall" ||
      node.type === "DynamicElement"
    ) {
      for (const attr of node.attributes) {
        visit(attr, node);
        if (attr.type === "DynamicAttribute" && attr.templateValue) {
          for (const tmplChild of attr.templateValue) {
            visit(tmplChild, attr);
          }
        }
      }
      for (const child of node.children) visit(child, node);
    } else if (node.type === "EachBlock") {
      for (const child of node.children) visit(child, node);
    } else if (node.type === "IfBlock") {
      for (const child of node.consequent) visit(child, node);
      if (node.alternate) {
        if (Array.isArray(node.alternate)) {
          for (const child of node.alternate) visit(child, node);
        } else {
          visit(node.alternate as IfBlockNode, node);
        }
      }
    } else if (node.type === "SlotOutlet") {
      for (const child of node.fallback) visit(child, node);
    } else if (node.type === "AwaitBlock") {
      for (const child of node.pending) visit(child, node);
      for (const child of node.thenBranch) visit(child, node);
      for (const child of node.catchBranch) visit(child, node);
    }
    visitor.leave?.(node, parent);
  }
  visit(root, null);
}

