# AST Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical AST Specification (Reconciled Phase Gate 1 & Gate 2)  
**Package:** `@mix/ast`  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Source Location & Spans

Every AST node carries an exact `SourceSpan` with 1-based `line` and `column` numbers and 0-based character `offset`:

```ts
export interface SourceLocation {
  readonly line: number;      // 1-based line number
  readonly column: number;    // 1-based column offset
  readonly offset: number;    // 0-based character index in source string
}

export interface SourceSpan {
  readonly start: SourceLocation;
  readonly end: SourceLocation;
  readonly file?: string;
}
```

---

## 2. Core AST Node Hierarchy

```text
ASTNode (Base)
 ├── ComponentNode (Root)
 ├── ScriptBlockNode
 ├── StyleBlockNode
 ├── TemplateNode
 │    ├── ElementNode
 │    ├── ComponentCallNode (TECH-07)
 │    ├── DynamicElementNode (D-105)
 │    ├── TextNode
 │    ├── InterpolationNode
 │    ├── CommentNode
 │    ├── IfBlockNode
 │    └── EachBlockNode (D-110)
 ├── AttributeNode
 │    ├── StaticAttributeNode
 │    ├── DynamicAttributeNode
 │    ├── EventBindingNode
 │    ├── RefBindingNode
 │    └── DirectiveAttributeNode (mix-html)
 └── ESTreeNode (Self-contained structural ESTree expression node)
```

### 2.1 Self-Contained ESTree Expression Nodes (`HAA-04`)
To ensure `@mix/ast` produces clean TypeScript declarations with **zero external `@types/*` leaks** in `.d.ts` output, embedded expressions use structural ESTree-compatible interfaces:

```ts
export interface ESTreeNode {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly loc?: SourceSpan;
  readonly range?: readonly [number, number];
  readonly [key: string]: unknown;
}
```

### 2.2 Root & Section Nodes
```ts
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

export interface ComponentNode extends ASTNodeBase {
  readonly type: "Component";
  readonly script: ScriptBlockNode | null;
  readonly style: StyleBlockNode | null;
  readonly template: readonly TemplateNode[];
}
```

### 2.3 Element, ComponentCall, and DynamicElement Nodes
```ts
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
```

### 2.4 Control Flow, Text, and Attribute Nodes
```ts
export interface IfBlockNode extends ASTNodeBase {
  readonly type: "IfBlock";
  readonly condition: ESTreeNode;
  readonly consequent: readonly TemplateNode[];
  readonly alternate: readonly TemplateNode[] | IfBlockNode | null;
}

export interface EachBlockNode extends ASTNodeBase {
  readonly type: "EachBlock";
  readonly collection: ESTreeNode;
  readonly itemIdentifier: string;
  readonly indexIdentifier: string | null;
  readonly keyExpression: ESTreeNode;
  readonly children: readonly TemplateNode[];
}
```

---

## 3. AST Invariants

1. **Deep Immutability:** Every AST node, child array, attribute array, and embedded `ESTreeNode` is recursively frozen via `Object.freeze`.
2. **Deterministic Spans:** `span.start.offset <= span.end.offset` for all nodes, and child spans are strictly enclosed within parent spans.
3. **Zero Type Leakage:** `@mix/ast` exports zero third-party parser types in its `.d.ts` declarations.
