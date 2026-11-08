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

export interface ComponentMethodDeclaration {
  readonly name: string;
  readonly code: string;
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
  readonly methods: readonly ComponentMethodDeclaration[];
  readonly bindings: readonly ReactiveBinding[];
  readonly diagnostics: readonly SemanticDiagnostic[];
  readonly ast: ComponentNode;
}

// --- Source Maps & Diagnostic Code Frame Formatting (D-106) ---

const VLQ_BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeVlq(value: number): string {
  let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    encoded += VLQ_BASE64_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

export interface SourceMapV3 {
  readonly version: 3;
  readonly file: string;
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

/**
 * Generates a standard SourceMap V3 mapping line deltas back to original source template.
 */
export function generateSourceMap(
  filename: string,
  source: string,
  generated: string
): SourceMapV3 {
  const genLines = generated.split(/\r?\n/);
  const srcLines = source.split(/\r?\n/);

  const lineMappings: string[] = [];
  let prevOrigLine = 0;

  for (let i = 0; i < genLines.length; i++) {
    if (i < srcLines.length) {
      const origLineDelta = i - prevOrigLine;
      prevOrigLine = i;
      // Segment: generated column 0, source index 0, original line delta, original column 0
      const segment = encodeVlq(0) + encodeVlq(0) + encodeVlq(origLineDelta) + encodeVlq(0);
      lineMappings.push(segment);
    } else {
      lineMappings.push("");
    }
  }

  return Object.freeze({
    version: 3,
    file: filename.replace(/\.(mix|tix)$/, ".js"),
    sources: Object.freeze([filename]),
    sourcesContent: Object.freeze([source]),
    names: Object.freeze([]),
    mappings: lineMappings.join(";")
  });
}

/**
 * Formats a diagnostic with a visual code frame and caret underline highlighting (D-106).
 */
export function formatDiagnostic(
  source: string,
  diag: SemanticDiagnostic,
  filename = "anonymous.mix",
  _options: { colors?: boolean } = {}
): string {
  const lineNum = diag.span.start.line;
  const colNum = diag.span.start.column;
  const severityTag = diag.severity === "error" ? "error" : "warning";

  const lines = source.split(/\r?\n/);
  const targetLine = lines[lineNum - 1] ?? "";

  const startCol = Math.max(1, colNum);
  const endCol = diag.span.end.line === lineNum
    ? Math.max(startCol, diag.span.end.column)
    : targetLine.length + 1;
  const underlineLen = Math.max(1, endCol - startCol);

  const pad = String(lineNum).length;
  const gutter = " ".repeat(pad);

  return [
    `${severityTag}[${diag.code}]: ${diag.message}`,
    `  --> ${filename}:${lineNum}:${colNum}`,
    `  ${gutter} |`,
    `  ${lineNum} | ${targetLine}`,
    `  ${gutter} | ${" ".repeat(startCol - 1)}${"^".repeat(underlineLen)}`,
    `  ${gutter} |`
  ].join("\n");
}

/**
 * Analyzes a ComponentNode AST, constructing scope trees, validating bindings,
 * checking keyed list requirements (D-110), and generating diagnostics with 1:1 spans (D-106).
 */
export function analyze(ast: ComponentNode): ComponentDescriptor {
  const diagnostics: SemanticDiagnostic[] = [];
  const signals: SignalDeclaration[] = [];
  const props: ComponentPropDeclaration[] = [];
  const methods: ComponentMethodDeclaration[] = [];
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

    // Extract function/method declarations for stable scope HMR (D-111)
    const funcRegex = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*\{([^}]*)\}/g;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1]!;
      methods.push({ name, code: match[0] });
      rootScope.symbols.set(name, {
        name,
        kind: "variable",
        scopeId: rootScope.id
      });
    }

    const arrowFuncRegex = /(?:let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>\s*\{[^}]*\}/g;
    while ((match = arrowFuncRegex.exec(content)) !== null) {
      const name = match[1]!;
      if (!signals.some((s) => s.name === name)) {
        methods.push({ name, code: match[0] });
        rootScope.symbols.set(name, {
          name,
          kind: "variable",
          scopeId: rootScope.id
        });
      }
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
    methods: Object.freeze(methods),
    bindings: Object.freeze(bindings),
    diagnostics: Object.freeze(diagnostics),
    ast
  });
}

export * from "./spans.js";
export * from "./resolver.js";
export * from "./projection.js";

