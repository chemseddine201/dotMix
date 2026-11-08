# AST Specification — Mix & Tix

**Status:** Canonical AST Specification (Reconciled Phase 1)  
**Package:** `@mix/ast`

---

## 1. Source Location & Spans

Every AST node implements `SourceLocationSpan`:

```ts
export interface SourceLocation {
  line: number;      // 1-based line number
  column: number;    // 1-based column offset
  offset: number;    // 0-based character index in source string
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
  file?: string;
}
```

---

## 2. Core AST Nodes Hierarchy

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
 └── ExpressionNode
```

### 2.1 Component Node (Root)
```ts
export interface ComponentNode {
  readonly type: "Component";
  readonly span: SourceSpan;
  readonly script: ScriptBlockNode | null;
  readonly style: StyleBlockNode | null;
  readonly template: TemplateNode[];
}
```

### 2.2 DynamicElementNode (D-105)
```ts
export interface DynamicElementNode {
  readonly type: "DynamicElement";
  readonly span: SourceSpan;
  readonly tagExpression: ExpressionNode; // The embedded expression <{~expr}>
  readonly attributes: AttributeNode[];
  readonly children: TemplateNode[];
}
```

### 2.3 InterpolationNode & TextNode
```ts
export interface InterpolationNode {
  readonly type: "Interpolation";
  readonly span: SourceSpan;
  readonly expression: ExpressionNode;
}

export interface TextNode {
  readonly type: "Text";
  readonly span: SourceSpan;
  readonly value: string;
}
```

---

## 3. AST Invariants

1. **Immutability:** Once parsed, AST nodes are deeply frozen and immutable. Transformations produce new trees or decorator maps.
2. **Deterministic Spans:** `span.start.offset <= span.end.offset` for all nodes.
3. **Lossless Spanning:** The top-level `ComponentNode` span encompasses the entire source file. Child spans never extend beyond parent spans.
