/**
 * @mix/ast — Unified Abstract Syntax Tree interfaces, builders, source spans, and visitor utilities.
 *
 * Implements Phase Gate 2 AST invariants:
 * - Self-contained structural ESTreeNode interfaces (zero external @types/* leakage in .d.ts)
 * - Deeply frozen immutable AST nodes (`Object.freeze`)
 * - Deterministic 1-based line/column and 0-based offset SourceSpans (`start.offset <= end.offset`)
 * - Explicit `ComponentCallNode` (TECH-07) and `DynamicElementNode` with preserved attributes (D-105, TECH-06)
 */

import { MixError, DiagnosticCodes } from "@mix/diagnostics";
import type { SourceLocation, SourceSpan } from "@mix/diagnostics";

export type { SourceLocation, SourceSpan } from "@mix/diagnostics";

/**
 * Structural, self-contained ESTree-compatible expression interface (HAA-04).
 * Prevents third-party AST parser types from leaking into public .d.ts declarations.
 */
export interface ESTreeNode {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly loc?: SourceSpan;
  readonly range?: readonly [number, number];
  readonly [key: string]: unknown;
}

export interface ASTNodeBase {
  readonly span: SourceSpan;
}

export interface ScriptBlockNode extends ASTNodeBase {
  readonly type: "ScriptBlock";
  readonly lang: "js" | "ts";
  readonly content: string;
  readonly contentSpan: SourceSpan;
}

export interface StyleBlockNode extends ASTNodeBase {
  readonly type: "StyleBlock";
  readonly scoped: boolean;
  readonly content: string;
  readonly contentSpan: SourceSpan;
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
}

export interface IfBlockNode extends ASTNodeBase {
  readonly type: "IfBlock";
  readonly condition: ESTreeNode;
  readonly rawCondition: string;
  readonly consequent: readonly TemplateNode[];
  readonly alternate: readonly TemplateNode[] | IfBlockNode | null;
}

export interface SlotOutletNode extends ASTNodeBase {
  readonly type: "SlotOutlet";
  readonly name: string | null;
  readonly fallback: readonly TemplateNode[];
  readonly selfClosing: boolean;
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
  | SlotOutletNode;

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

export function validateSpan(span: SourceSpan): SourceSpan {
  if (
    span.start.offset < 0 ||
    span.end.offset < span.start.offset ||
    span.start.line < 1 ||
    span.start.column < 1 ||
    span.end.line < span.start.line ||
    (span.end.line === span.start.line && span.end.column < span.start.column)
  ) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      `Invalid SourceSpan [${span.start.line}:${span.start.column} (${span.start.offset}) -> ${span.end.line}:${span.end.column} (${span.end.offset})]`
    );
  }
  return span;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      deepFreeze(value[i]);
    }
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function createSpan(
  start: SourceLocation,
  end: SourceLocation,
  file?: string
): SourceSpan {
  const span: SourceSpan =
    file !== undefined
      ? { start: { ...start }, end: { ...end }, file }
      : { start: { ...start }, end: { ...end } };
  validateSpan(span);
  return deepFreeze(span);
}

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
      for (const attr of node.attributes) visit(attr, node);
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
    }
    visitor.leave?.(node, parent);
  }
  visit(root, null);
}
