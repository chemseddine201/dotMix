/**
 * @mix/compiler-semantic — Semantic analysis, scope hierarchy, type projection, and diagnostics for Mix & Tix.
 */

import type {
  ComponentNode,
  SourceSpan,
  TemplateChildNode,
  EachBlockNode,
  IfBlockNode,
  DynamicElementNode,
  ElementNode
} from "@mix/ast";

export interface SemanticDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly span: SourceSpan;
  readonly severity: "error" | "warning";
}

export interface SignalDeclaration {
  readonly name: string;
  readonly initialValueCode: string;
  readonly span: SourceSpan;
}

export interface ComponentPropDeclaration {
  readonly name: string;
  readonly typeAnnotation?: string | undefined;
  readonly defaultValueCode?: string | undefined;
}

export interface ScopeSymbol {
  readonly name: string;
  readonly kind: "signal" | "variable" | "prop" | "iteration-item" | "iteration-index";
  readonly scopeId: number;
}

export interface ScopeTree {
  readonly id: number;
  readonly parentId: number | null;
  readonly symbols: Map<string, ScopeSymbol>;
}

export interface ReactiveBinding {
  readonly expressionCode: string;
  readonly dependencies: readonly string[];
  readonly span: SourceSpan;
}

export interface ComponentDescriptor {
  readonly signals: readonly SignalDeclaration[];
  readonly props: readonly ComponentPropDeclaration[];
  readonly bindings: readonly ReactiveBinding[];
  readonly diagnostics: readonly SemanticDiagnostic[];
  readonly ast: ComponentNode;
}

/**
 * Analyzes a ComponentNode AST, constructing scope trees, validating bindings,
 * checking keyed list requirements (D-110), and generating diagnostics with 1:1 spans (D-106).
 */
export function analyze(ast: ComponentNode): ComponentDescriptor {
  const diagnostics: SemanticDiagnostic[] = [];
  const signals: SignalDeclaration[] = [];
  const props: ComponentPropDeclaration[] = [];
  const bindings: ReactiveBinding[] = [];

  let nextScopeId = 0;
  const rootScope: ScopeTree = {
    id: nextScopeId++,
    parentId: null,
    symbols: new Map()
  };

  // 1. Analyze script block: Extract signals and declared identifiers
  if (ast.script) {
    const content = ast.script.content;

    // Extract signals: let <name> = signal(<init>);
    const signalRegex = /(?:let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*signal\(([^)]*)\)/g;
    let match: RegExpExecArray | null;

    while ((match = signalRegex.exec(content)) !== null) {
      const name = match[1]!;
      const initCode = match[2]?.trim() ?? "undefined";
      signals.push({
        name,
        initialValueCode: initCode,
        span: ast.script.span
      });
      rootScope.symbols.set(name, {
        name,
        kind: "signal",
        scopeId: rootScope.id
      });
    }

    // Extract props declarations in .tix or .mix: props: { ... } or export let <name>
    const propRegex = /export\s+let\s+([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s*:\s*([^=;]+))?(?:\s*=\s*([^;]+))?/g;
    while ((match = propRegex.exec(content)) !== null) {
      const name = match[1]!;
      const typeAnnotation = match[2]?.trim();
      const defaultValueCode = match[3]?.trim();
      props.push({ name, typeAnnotation, defaultValueCode });
      rootScope.symbols.set(name, {
        name,
        kind: "prop",
        scopeId: rootScope.id
      });
    }
  }

  // Strict .tix mode verification
  if (ast.mode === "tix") {
    if (!ast.script || ast.script.lang !== "ts") {
      diagnostics.push({
        code: "MIX_ERR_TIX_STRICT_LANG",
        message: ".tix components require strict TypeScript script blocks: <script lang=\"ts\">",
        span: ast.script?.span ?? ast.span,
        severity: "warning"
      });
    }
  }

  // 2. Traverse template nodes with scope hierarchy
  function visitNode(node: TemplateChildNode, currentScope: ScopeTree) {
    if (node.type === "Interpolation") {
      const exprCode = node.expression.code;
      const deps: string[] = [];

      // Check referenced symbols
      for (const [name, sym] of currentScope.symbols) {
        if (sym.kind === "signal") {
          const refPattern = new RegExp(`\\b${name}\\b`);
          if (refPattern.test(exprCode)) {
            deps.push(name);
          }
        }
      }

      bindings.push({
        expressionCode: exprCode,
        dependencies: Object.freeze(deps),
        span: node.span
      });
    } else if (node.type === "Element") {
      const el = node as ElementNode;
      for (const attr of el.attributes) {
        if (attr.type === "DynamicAttribute") {
          const deps: string[] = [];
          for (const [name, sym] of currentScope.symbols) {
            if (sym.kind === "signal" && new RegExp(`\\b${name}\\b`).test(attr.expression.code)) {
              deps.push(name);
            }
          }
          bindings.push({
            expressionCode: attr.expression.code,
            dependencies: Object.freeze(deps),
            span: attr.span
          });
        }
      }
      for (const child of el.children) {
        visitNode(child, currentScope);
      }
    } else if (node.type === "DynamicElement") {
      const dyn = node as DynamicElementNode;
      // D-105: DynamicElement expression is evaluated once
      const deps: string[] = [];
      for (const [name, sym] of currentScope.symbols) {
        if (sym.kind === "signal" && new RegExp(`\\b${name}\\b`).test(dyn.tagExpression.code)) {
          deps.push(name);
        }
      }
      bindings.push({
        expressionCode: dyn.tagExpression.code,
        dependencies: Object.freeze(deps),
        span: dyn.tagExpression.span
      });
      for (const child of dyn.children) {
        visitNode(child, currentScope);
      }
    } else if (node.type === "IfBlock") {
      const ifNode = node as IfBlockNode;
      for (const child of ifNode.consequent) visitNode(child, currentScope);
      if (ifNode.alternate) {
        for (const child of ifNode.alternate) visitNode(child, currentScope);
      }
    } else if (node.type === "EachBlock") {
      const eachNode = node as EachBlockNode;

      // D-110: Check keyed list requirement
      if (!eachNode.keyExpression) {
        diagnostics.push({
          code: "MIX_WARN_UNKEYED_EACH",
          message: "Keyed reconciliation requires an explicit key expression: (item.id). Fallback surrogate keys are disabled (D-110).",
          span: eachNode.span,
          severity: "warning"
        });
      }

      // Create iteration child scope
      const eachScope: ScopeTree = {
        id: nextScopeId++,
        parentId: currentScope.id,
        symbols: new Map(currentScope.symbols)
      };

      eachScope.symbols.set(eachNode.itemBinding, {
        name: eachNode.itemBinding,
        kind: "iteration-item",
        scopeId: eachScope.id
      });

      if (eachNode.indexBinding) {
        eachScope.symbols.set(eachNode.indexBinding, {
          name: eachNode.indexBinding,
          kind: "iteration-index",
          scopeId: eachScope.id
        });
      }

      for (const child of eachNode.body) {
        visitNode(child, eachScope);
      }
    }
  }

  for (const tNode of ast.template) {
    visitNode(tNode, rootScope);
  }

  return Object.freeze({
    signals: Object.freeze(signals),
    props: Object.freeze(props),
    bindings: Object.freeze(bindings),
    diagnostics: Object.freeze(diagnostics),
    ast
  });
}
