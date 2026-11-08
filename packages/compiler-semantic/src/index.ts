/**
 * @mix/compiler-semantic — Semantic analysis and reactive dependency extraction for Phase 1.
 */

import type { ComponentNode, InterpolationNode } from "@mix/ast";

export interface SignalDeclaration {
  readonly name: string;
  readonly initialValueCode: string;
}

export interface ReactiveBinding {
  readonly expressionCode: string;
  readonly dependencies: readonly string[];
}

export interface SemanticDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface ComponentDescriptor {
  readonly signals: readonly SignalDeclaration[];
  readonly bindings: readonly ReactiveBinding[];
  readonly diagnostics: readonly SemanticDiagnostic[];
  readonly ast: ComponentNode;
}

/**
 * Analyzes a ComponentNode AST, resolves signal declarations and binds reactive dependencies.
 */
export function analyze(ast: ComponentNode): ComponentDescriptor {
  const signals: SignalDeclaration[] = [];
  const bindings: ReactiveBinding[] = [];
  const diagnostics: SemanticDiagnostic[] = [];

  // 1. Analyze script block
  if (ast.script) {
    const content = ast.script.content;
    // Extract `let <name> = signal(<init>);`
    const signalRegex = /(?:let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*signal\(([^)]*)\)/g;
    let match: RegExpExecArray | null;

    while ((match = signalRegex.exec(content)) !== null) {
      if (match[1] && match[2] !== undefined) {
        signals.push({
          name: match[1],
          initialValueCode: match[2].trim()
        });
      }
    }
  }

  const signalNames = new Set(signals.map((s) => s.name));

  // 2. Traverse template nodes and extract reactive bindings
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;

    const n = node as { type?: string; children?: unknown[]; expression?: { code: string } };

    if (n.type === "Interpolation" && n.expression) {
      const exprCode = n.expression.code;
      const deps: string[] = [];

      // Check which declared signals are referenced
      for (const sig of signalNames) {
        // e.g. `count()` or `count`
        const refPattern = new RegExp(`\\b${sig}\\b`);
        if (refPattern.test(exprCode)) {
          deps.push(sig);
        }
      }

      bindings.push({
        expressionCode: exprCode,
        dependencies: Object.freeze(deps)
      });
    }

    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        visit(child);
      }
    }
  }

  for (const child of ast.template) {
    visit(child);
  }

  return Object.freeze({
    signals: Object.freeze(signals),
    bindings: Object.freeze(bindings),
    diagnostics: Object.freeze(diagnostics),
    ast
  });
}
