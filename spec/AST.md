# AST Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical AST Specification (Reconciled Phase Gate 1)  
**Package:** `@mix/ast`  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Source Location & Spans

Every AST node implements `SourceLocationSpan`:

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
 ├── TemplateNode (Base for template children)
 │    ├── ElementNode
 │    ├── DynamicElementNode (D-105)
 │    ├── TextNode
 │    ├── InterpolationNode
 │    ├── CommentNode
 │    └── ControlFlowBlockNode (If, Each, Await)
 ├── AttributeNode
 │    ├── StaticAttributeNode
 │    ├── DynamicAttributeNode
 │    ├── EventBindingNode
 │    └── RefBindingNode
 └── ESTreeExpressionNode (Self-contained structural ESTree expression node)
```

### 2.1 Self-Contained ESTree Expression Nodes (HAA-04)
To ensure `@mix/ast` produces clean, self-contained TypeScript declarations with **zero external `@types/*` leaks** in its `.d.ts` output, expression nodes within `@mix/ast` use structural ESTree-compatible interfaces:

```ts
export interface ESTreeNode {
  readonly type: string;
  readonly loc?: SourceSpan;
  readonly range?: [number, number];
  readonly [key: string]: unknown;
}
```

### 2.2 Component Node (Root)
```ts
export interface ComponentNode {
  readonly type: "Component";
  readonly span: SourceSpan;
  readonly script: ScriptBlockNode | null;
  readonly style: StyleBlockNode | null;
  readonly template: TemplateNode[];
}
```

### 2.3 DynamicElementNode (D-105)
```ts
export interface DynamicElementNode {
  readonly type: "DynamicElement";
  readonly span: SourceSpan;
  readonly tagExpression: ESTreeNode; // Embedded expression from <{~expr}>
  readonly attributes: AttributeNode[];
  readonly children: TemplateNode[];
}
```

### 2.4 InterpolationNode & TextNode
```ts
export interface InterpolationNode {
  readonly type: "Interpolation";
  readonly span: SourceSpan;
  readonly expression: ESTreeNode;
}

export interface TextNode {
  readonly type: "Text";
  readonly span: SourceSpan;
  readonly value: string;
}
```

---

## 3. AST Invariants

1. **Immutability:** Once parsed, AST nodes are deeply frozen and immutable (`Object.freeze`). Transformations produce new trees or metadata maps.
2. **Deterministic Spans:** `span.start.offset <= span.end.offset` for all nodes.
3. **Lossless Spanning:** The top-level `ComponentNode` span encompasses the entire source file. Child spans never extend beyond parent spans.
4. **Zero Type Leakage:** `@mix/ast` relies on internal structural interfaces without exporting third-party AST parser types in public declarations.
