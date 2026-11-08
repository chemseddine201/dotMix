/**
 * @mix/ast — Unified Abstract Syntax Tree interfaces, source spans, and visitor utilities.
 */

import type { SourceSpan } from "@mix/diagnostics";

export type { SourceLocation, SourceSpan } from "@mix/diagnostics";

/**
 * Structural, self-contained ESTree-compatible expression interface (HAA-04).
 * Prevents third-party AST parser types from leaking into public .d.ts declarations.
 */
export interface ESTreeNode {
  readonly type: string;
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
}

export interface StyleBlockNode extends ASTNodeBase {
  readonly type: "StyleBlock";
  readonly scoped: boolean;
  readonly content: string;
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
}

export interface EventBindingNode extends ASTNodeBase {
  readonly type: "EventBinding";
  readonly name: string;
  readonly handler: ESTreeNode;
}

export interface RefBindingNode extends ASTNodeBase {
  readonly type: "RefBinding";
  readonly target: ESTreeNode;
}

export type AttributeNode =
  | StaticAttributeNode
  | DynamicAttributeNode
  | EventBindingNode
  | RefBindingNode;

export interface ElementNode extends ASTNodeBase {
  readonly type: "Element";
  readonly tag: string;
  readonly attributes: readonly AttributeNode[];
  readonly children: readonly TemplateNode[];
}

export interface DynamicElementNode extends ASTNodeBase {
  readonly type: "DynamicElement";
  readonly tagExpression: ESTreeNode;
  readonly attributes: readonly AttributeNode[];
  readonly children: readonly TemplateNode[];
}

export interface TextNode extends ASTNodeBase {
  readonly type: "Text";
  readonly value: string;
}

export interface InterpolationNode extends ASTNodeBase {
  readonly type: "Interpolation";
  readonly expression: ESTreeNode;
}

export interface CommentNode extends ASTNodeBase {
  readonly type: "Comment";
  readonly value: string;
}

export interface EachBlockNode extends ASTNodeBase {
  readonly type: "EachBlock";
  readonly collection: ESTreeNode;
  readonly itemIdentifier: string;
  readonly indexIdentifier?: string;
  readonly keyExpression: ESTreeNode;
  readonly children: readonly TemplateNode[];
}

export interface IfBlockNode extends ASTNodeBase {
  readonly type: "IfBlock";
  readonly condition: ESTreeNode;
  readonly consequent: readonly TemplateNode[];
  readonly alternate?: readonly TemplateNode[];
}

export type TemplateNode =
  | ElementNode
  | DynamicElementNode
  | TextNode
  | InterpolationNode
  | CommentNode
  | EachBlockNode
  | IfBlockNode;

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
    } else if (node.type === "Element" || node.type === "DynamicElement") {
      for (const attr of node.attributes) visit(attr, node);
      for (const child of node.children) visit(child, node);
    } else if (node.type === "EachBlock") {
      for (const child of node.children) visit(child, node);
    } else if (node.type === "IfBlock") {
      for (const child of node.consequent) visit(child, node);
      if (node.alternate) {
        for (const child of node.alternate) visit(child, node);
      }
    }
    visitor.leave?.(node, parent);
  }
  visit(root, null);
}
