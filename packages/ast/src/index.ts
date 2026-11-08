/**
 * @mix/ast — Comprehensive immutable AST node contracts for Mix & Tix.
 */

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface SourceSpan {
  readonly start: SourceLocation;
  readonly end: SourceLocation;
  readonly file?: string;
}

export interface BaseNode {
  readonly type: string;
  readonly span: SourceSpan;
}

export interface ExpressionNode extends BaseNode {
  readonly type: "Expression";
  readonly code: string;
}

export interface ScriptBlockNode extends BaseNode {
  readonly type: "ScriptBlock";
  readonly content: string;
  readonly lang?: "ts" | "js";
}

export interface StyleBlockNode extends BaseNode {
  readonly type: "StyleBlock";
  readonly content: string;
  readonly scoped: boolean;
}

export interface CommentNode extends BaseNode {
  readonly type: "Comment";
  readonly value: string;
}

export interface TextNode extends BaseNode {
  readonly type: "Text";
  readonly value: string;
}

export interface InterpolationNode extends BaseNode {
  readonly type: "Interpolation";
  readonly expression: ExpressionNode;
}

// --- Attribute Nodes ---

export interface StaticAttributeNode extends BaseNode {
  readonly type: "StaticAttribute";
  readonly name: string;
  readonly value: string;
}

export interface DynamicAttributeNode extends BaseNode {
  readonly type: "DynamicAttribute";
  readonly name: string;
  readonly expression: ExpressionNode;
}

export interface EventBindingNode extends BaseNode {
  readonly type: "EventBinding";
  readonly eventName: string;
  readonly handler: ExpressionNode;
  readonly modifiers?: readonly string[];
}

export interface RefBindingNode extends BaseNode {
  readonly type: "RefBinding";
  readonly target: ExpressionNode;
}

export interface DirectiveNode extends BaseNode {
  readonly type: "Directive";
  readonly name: string;
  readonly expression: ExpressionNode;
}

export type AttributeNode =
  | StaticAttributeNode
  | DynamicAttributeNode
  | EventBindingNode
  | RefBindingNode
  | DirectiveNode;

// --- Control Flow Nodes ---

export interface ElseIfBlockNode extends BaseNode {
  readonly type: "ElseIfBlock";
  readonly condition: ExpressionNode;
  readonly consequent: readonly TemplateChildNode[];
}

export interface IfBlockNode extends BaseNode {
  readonly type: "IfBlock";
  readonly condition: ExpressionNode;
  readonly consequent: readonly TemplateChildNode[];
  readonly elseIfs: readonly ElseIfBlockNode[];
  readonly alternate: readonly TemplateChildNode[] | null;
}

export interface EachBlockNode extends BaseNode {
  readonly type: "EachBlock";
  readonly items: ExpressionNode;
  readonly itemBinding: string;
  readonly indexBinding?: string;
  readonly keyExpression?: ExpressionNode;
  readonly body: readonly TemplateChildNode[];
}

export interface AwaitBlockNode extends BaseNode {
  readonly type: "AwaitBlock";
  readonly promise: ExpressionNode;
  readonly pending: readonly TemplateChildNode[];
  readonly thenBinding?: string;
  readonly thenBody: readonly TemplateChildNode[];
  readonly catchBinding?: string;
  readonly catchBody: readonly TemplateChildNode[];
}

export type ControlFlowBlockNode = IfBlockNode | EachBlockNode | AwaitBlockNode;

// --- Element & DynamicElement Nodes ---

export interface ElementNode extends BaseNode {
  readonly type: "Element";
  readonly tag: string;
  readonly attributes: readonly AttributeNode[];
  readonly children: readonly TemplateChildNode[];
  readonly isSelfClosing?: boolean;
}

export interface DynamicElementNode extends BaseNode {
  readonly type: "DynamicElement";
  readonly tagExpression: ExpressionNode; // <{~expr}> per D-105
  readonly attributes: readonly AttributeNode[];
  readonly children: readonly TemplateChildNode[];
}

export type TemplateChildNode =
  | ElementNode
  | DynamicElementNode
  | TextNode
  | InterpolationNode
  | CommentNode
  | ControlFlowBlockNode;

export interface ComponentNode extends BaseNode {
  readonly type: "Component";
  readonly script: ScriptBlockNode | null;
  readonly style: StyleBlockNode | null;
  readonly template: readonly TemplateChildNode[];
  readonly mode?: "mix" | "tix";
}

// --- Factory Helpers ---

export function createSourceLocation(offset: number, line = 1, column = offset + 1): SourceLocation {
  return Object.freeze({ offset, line, column });
}

export function createSourceSpan(startOffset: number, endOffset: number, file?: string): SourceSpan {
  return Object.freeze({
    start: createSourceLocation(startOffset),
    end: createSourceLocation(endOffset),
    ...(file ? { file } : {})
  });
}

export function createExpressionNode(code: string, span: SourceSpan): ExpressionNode {
  return Object.freeze({ type: "Expression", code, span });
}

export function createScriptBlockNode(content: string, span: SourceSpan, lang?: "ts" | "js"): ScriptBlockNode {
  return Object.freeze({ type: "ScriptBlock", content, span, ...(lang ? { lang } : {}) });
}

export function createStyleBlockNode(content: string, span: SourceSpan, scoped = true): StyleBlockNode {
  return Object.freeze({ type: "StyleBlock", content, span, scoped });
}

export function createCommentNode(value: string, span: SourceSpan): CommentNode {
  return Object.freeze({ type: "Comment", value, span });
}

export function createTextNode(value: string, span: SourceSpan): TextNode {
  return Object.freeze({ type: "Text", value, span });
}

export function createInterpolationNode(expression: ExpressionNode, span: SourceSpan): InterpolationNode {
  return Object.freeze({ type: "Interpolation", expression, span });
}

export function createStaticAttributeNode(name: string, value: string, span: SourceSpan): StaticAttributeNode {
  return Object.freeze({ type: "StaticAttribute", name, value, span });
}

export function createDynamicAttributeNode(name: string, expression: ExpressionNode, span: SourceSpan): DynamicAttributeNode {
  return Object.freeze({ type: "DynamicAttribute", name, expression, span });
}

export function createEventBindingNode(
  eventName: string,
  handler: ExpressionNode,
  span: SourceSpan,
  modifiers?: readonly string[]
): EventBindingNode {
  return Object.freeze({
    type: "EventBinding",
    eventName,
    handler,
    span,
    ...(modifiers ? { modifiers: Object.freeze([...modifiers]) } : {})
  });
}

export function createRefBindingNode(target: ExpressionNode, span: SourceSpan): RefBindingNode {
  return Object.freeze({ type: "RefBinding", target, span });
}

export function createDirectiveNode(name: string, expression: ExpressionNode, span: SourceSpan): DirectiveNode {
  return Object.freeze({ type: "Directive", name, expression, span });
}

export function createElementNode(
  tag: string,
  attributes: readonly AttributeNode[],
  children: readonly TemplateChildNode[],
  span: SourceSpan,
  isSelfClosing = false
): ElementNode {
  return Object.freeze({
    type: "Element",
    tag,
    attributes: Object.freeze([...attributes]),
    children: Object.freeze([...children]),
    span,
    isSelfClosing
  });
}

export function createDynamicElementNode(
  tagExpression: ExpressionNode,
  attributes: readonly AttributeNode[],
  children: readonly TemplateChildNode[],
  span: SourceSpan
): DynamicElementNode {
  return Object.freeze({
    type: "DynamicElement",
    tagExpression,
    attributes: Object.freeze([...attributes]),
    children: Object.freeze([...children]),
    span
  });
}

export function createIfBlockNode(
  condition: ExpressionNode,
  consequent: readonly TemplateChildNode[],
  elseIfs: readonly ElseIfBlockNode[],
  alternate: readonly TemplateChildNode[] | null,
  span: SourceSpan
): IfBlockNode {
  return Object.freeze({
    type: "IfBlock",
    condition,
    consequent: Object.freeze([...consequent]),
    elseIfs: Object.freeze([...elseIfs]),
    alternate: alternate ? Object.freeze([...alternate]) : null,
    span
  });
}

export function createElseIfBlockNode(
  condition: ExpressionNode,
  consequent: readonly TemplateChildNode[],
  span: SourceSpan
): ElseIfBlockNode {
  return Object.freeze({
    type: "ElseIfBlock",
    condition,
    consequent: Object.freeze([...consequent]),
    span
  });
}

export function createEachBlockNode(
  items: ExpressionNode,
  itemBinding: string,
  body: readonly TemplateChildNode[],
  span: SourceSpan,
  indexBinding?: string,
  keyExpression?: ExpressionNode
): EachBlockNode {
  return Object.freeze({
    type: "EachBlock",
    items,
    itemBinding,
    body: Object.freeze([...body]),
    span,
    ...(indexBinding ? { indexBinding } : {}),
    ...(keyExpression ? { keyExpression } : {})
  });
}

export function createAwaitBlockNode(
  promise: ExpressionNode,
  pending: readonly TemplateChildNode[],
  thenBody: readonly TemplateChildNode[],
  catchBody: readonly TemplateChildNode[],
  span: SourceSpan,
  thenBinding?: string,
  catchBinding?: string
): AwaitBlockNode {
  return Object.freeze({
    type: "AwaitBlock",
    promise,
    pending: Object.freeze([...pending]),
    thenBody: Object.freeze([...thenBody]),
    catchBody: Object.freeze([...catchBody]),
    span,
    ...(thenBinding ? { thenBinding } : {}),
    ...(catchBinding ? { catchBinding } : {})
  });
}

export function createComponentNode(
  script: ScriptBlockNode | null,
  template: readonly TemplateChildNode[],
  span: SourceSpan,
  style: StyleBlockNode | null = null,
  mode: "mix" | "tix" = "mix"
): ComponentNode {
  return Object.freeze({
    type: "Component",
    script,
    style,
    template: Object.freeze([...template]),
    span,
    mode
  });
}

// --- AST Visitor Pattern ---

export type AstVisitor = {
  enter?: (node: BaseNode, parent: BaseNode | null) => void;
  leave?: (node: BaseNode, parent: BaseNode | null) => void;
};

export function walk(node: BaseNode, visitor: AstVisitor, parent: BaseNode | null = null): void {
  visitor.enter?.(node, parent);

  const n = node as unknown as Record<string, unknown>;

  // Visit child nodes based on properties
  if (Array.isArray(n.template)) {
    for (const child of n.template) walk(child as BaseNode, visitor, node);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) walk(child as BaseNode, visitor, node);
  }
  if (Array.isArray(n.attributes)) {
    for (const attr of n.attributes) walk(attr as BaseNode, visitor, node);
  }
  if (Array.isArray(n.consequent)) {
    for (const child of n.consequent) walk(child as BaseNode, visitor, node);
  }
  if (Array.isArray(n.elseIfs)) {
    for (const child of n.elseIfs) walk(child as BaseNode, visitor, node);
  }
  if (Array.isArray(n.alternate)) {
    for (const child of n.alternate) walk(child as BaseNode, visitor, node);
  }
  if (Array.isArray(n.body)) {
    for (const child of n.body) walk(child as BaseNode, visitor, node);
  }
  if (Array.isArray(n.pending)) {
    for (const child of n.pending) walk(child as BaseNode, visitor, node);
  }
  if (Array.isArray(n.thenBody)) {
    for (const child of n.thenBody) walk(child as BaseNode, visitor, node);
  }
  if (Array.isArray(n.catchBody)) {
    for (const child of n.catchBody) walk(child as BaseNode, visitor, node);
  }

  visitor.leave?.(node, parent);
}
