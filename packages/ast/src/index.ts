/**
 * @mix/ast — Minimal immutable AST node contracts for Phase 1 vertical slice.
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
}

export interface TextNode extends BaseNode {
  readonly type: "Text";
  readonly value: string;
}

export interface InterpolationNode extends BaseNode {
  readonly type: "Interpolation";
  readonly expression: ExpressionNode;
}

export type TemplateChildNode = ElementNode | TextNode | InterpolationNode;

export interface ElementNode extends BaseNode {
  readonly type: "Element";
  readonly tag: string;
  readonly children: readonly TemplateChildNode[];
}

export interface ComponentNode extends BaseNode {
  readonly type: "Component";
  readonly script: ScriptBlockNode | null;
  readonly template: readonly TemplateChildNode[];
}

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
  return Object.freeze({
    type: "Expression",
    code,
    span
  });
}

export function createScriptBlockNode(content: string, span: SourceSpan): ScriptBlockNode {
  return Object.freeze({
    type: "ScriptBlock",
    content,
    span
  });
}

export function createTextNode(value: string, span: SourceSpan): TextNode {
  return Object.freeze({
    type: "Text",
    value,
    span
  });
}

export function createInterpolationNode(expression: ExpressionNode, span: SourceSpan): InterpolationNode {
  return Object.freeze({
    type: "Interpolation",
    expression,
    span
  });
}

export function createElementNode(tag: string, children: readonly TemplateChildNode[], span: SourceSpan): ElementNode {
  return Object.freeze({
    type: "Element",
    tag,
    children: Object.freeze([...children]),
    span
  });
}

export function createComponentNode(
  script: ScriptBlockNode | null,
  template: readonly TemplateChildNode[],
  span: SourceSpan
): ComponentNode {
  return Object.freeze({
    type: "Component",
    script,
    template: Object.freeze([...template]),
    span
  });
}
