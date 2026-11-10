/**
 * @mix/compiler-semantic/scope-analyzer — Lexical scope resolution, script AST binding extraction, and template analysis.
 */

import * as ts from "typescript";
import { deepFreeze, LineMap } from "@mix/ast";
import type { ComponentNode, TemplateNode, ESTreeNode, SourceSpan } from "@mix/ast";
import { MixDiagnosticError, DiagnosticCodes } from "@mix/diagnostics";
import type { Diagnostic } from "@mix/diagnostics";
import { STYLE_EXTENSION_REGEX, ALLOWED_RELATIVE_IMPORT_REGEX, ALLOWED_GLOBALS } from "./constants.js";
import type { BindingKind, SymbolBinding, Scope, ComponentDescriptor, AnalyzeOptions } from "./types.js";

export function lookupInScope(scope: Scope, name: string): SymbolBinding | undefined {
  let current: Scope | null = scope;
  while (current !== null) {
    const found = current.bindings.get(name);
    if (found) return found;
    current = current.parent;
  }
  return undefined;
}

export function collectPatternIdentifiers(patternNode: unknown, out: Set<string>): void {
  if (!patternNode || typeof patternNode !== "object") return;
  const node = patternNode as Record<string, unknown>;
  switch (node.type) {
    case "Identifier":
      if (typeof node.name === "string") out.add(node.name);
      break;
    case "AssignmentPattern":
      collectPatternIdentifiers(node.left, out);
      break;
    case "RestElement":
      collectPatternIdentifiers(node.argument, out);
      break;
    case "ArrayPattern":
      if (Array.isArray(node.elements)) {
        for (const el of node.elements) collectPatternIdentifiers(el, out);
      }
      break;
    case "ObjectPattern":
      if (Array.isArray(node.properties)) {
        for (const prop of node.properties) {
          if (prop && typeof prop === "object") {
            const p = prop as Record<string, unknown>;
            collectPatternIdentifiers(p.type === "RestElement" ? p.argument : p.value, out);
          }
        }
      }
      break;
  }
}

const TS_EXPR_WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"]);
const SKIPPED_ESTREE_KEYS = new Set(["type", "loc", "range", "start", "end", "typeAnnotation", "typeParameters"]);

/**
 * Walks an ESTree expression node to verify that all referenced identifiers are declared in `scope`
 * or in `ALLOWED_GLOBALS`, without using regular expressions.
 */
export function verifyExpressionIdentifiers(
  expr: ESTreeNode,
  scope: Scope,
  diagnostics: Diagnostic[],
  defaultSpan: SourceSpan
): void {
  function walkExpr(node: unknown, activeScope: Scope): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walkExpr(item, activeScope);
      return;
    }

    const n = node as Record<string, unknown>;
    const type = n.type;
    if (typeof type !== "string") return;

    if (type.startsWith("TS")) {
      if (TS_EXPR_WRAPPERS.has(type)) walkExpr(n.expression, activeScope);
      return;
    }

    if (type === "Identifier") {
      const name = n.name;
      if (typeof name === "string" && !lookupInScope(activeScope, name) && !ALLOWED_GLOBALS.has(name)) {
        diagnostics.push({
          code: DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER,
          message: `Unresolved identifier '${name}' in template expression.`,
          severity: "error",
          span: (n.loc as SourceSpan | undefined) ?? defaultSpan
        });
      }
      return;
    }

    if (type === "ChainExpression") {
      walkExpr(n.expression, activeScope);
      return;
    }
    if (type === "MemberExpression") {
      walkExpr(n.object, activeScope);
      if (n.computed === true) walkExpr(n.property, activeScope);
      return;
    }
    if (type === "Property" || type === "ObjectProperty") {
      if (n.computed === true) walkExpr(n.key, activeScope);
      walkExpr(n.value, activeScope);
      return;
    }

    if (type === "ArrowFunctionExpression" || type === "FunctionExpression") {
      const paramNames = new Set<string>();
      if (Array.isArray(n.params)) {
        for (const p of n.params) collectPatternIdentifiers(p, paramNames);
      }
      if (typeof n.id === "object" && n.id !== null && "name" in n.id && typeof (n.id as { name: unknown }).name === "string") {
        paramNames.add((n.id as { name: string }).name);
      }
      const childBindings = new Map<string, SymbolBinding>();
      const fnSpan = (n.loc as SourceSpan | undefined) ?? defaultSpan;
      for (const pName of paramNames) {
        childBindings.set(pName, { name: pName, kind: "param", span: fnSpan });
      }
      walkExpr(n.body, { parent: activeScope, bindings: childBindings });
      return;
    }

    if (type === "BlockStatement") {
      const blockBindings = new Map<string, SymbolBinding>();
      if (Array.isArray(n.body)) {
        for (const stmt of n.body) {
          if (stmt && typeof stmt === "object" && (stmt as { type?: unknown }).type === "VariableDeclaration") {
            const decls = (stmt as { declarations?: unknown[] }).declarations ?? [];
            for (const d of decls) {
              if (d && typeof d === "object") {
                const names = new Set<string>();
                collectPatternIdentifiers((d as { id?: unknown }).id, names);
                for (const nm of names) {
                  blockBindings.set(nm, { name: nm, kind: "const", span: defaultSpan });
                }
              }
            }
          }
        }
        const blockScope: Scope = { parent: activeScope, bindings: blockBindings };
        for (const stmt of n.body) walkExpr(stmt, blockScope);
      }
      return;
    }

    if (type === "VariableDeclarator") {
      walkExpr(n.init, activeScope);
      return;
    }

    for (const key of Object.keys(n)) {
      if (!SKIPPED_ESTREE_KEYS.has(key)) walkExpr(n[key], activeScope);
    }
  }

  walkExpr(expr, scope);
}

/**
 * Analyzes `<script>` using the official TypeScript 6.0.3 AST parser (`ts.createSourceFile`)
 * to extract top-level bindings and classify signals, computeds, props, refs, functions, and imports.
 */
export function analyzeScriptBlock(
  ast: ComponentNode,
  lineMap: LineMap | null,
  diagnostics: Diagnostic[]
) {
  const bindings = new Map<string, SymbolBinding>();
  const signals: string[] = [];
  const computeds: string[] = [];
  const props: string[] = [];
  const refs: string[] = [];
  const functions: string[] = [];
  const imports = new Map<string, string>();
  const cssImports: string[] = [];
  if (!ast.script) return { bindings, signals, computeds, props, refs, functions, imports, cssImports };

  const scriptContent = ast.script.content;
  const baseOffset = ast.script.contentSpan.start.offset;
  const sf = ts.createSourceFile(
    ast.span.file ?? "component.ts",
    scriptContent,
    ts.ScriptTarget.ES2023,
    true,
    ast.script.lang === "ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );

  function spanForNode(node: ts.Node): SourceSpan {
    const startOff = baseOffset + node.getStart(sf);
    const endOff = baseOffset + node.getEnd();
    return lineMap ? lineMap.span(startOff, endOff) : ast.script!.contentSpan;
  }

  function recordBinding(name: string, kind: BindingKind, node: ts.Node, importSource?: string): void {
    const span = spanForNode(node);
    bindings.set(name, importSource !== undefined ? { name, kind, span, importSource } : { name, kind, span });
    if (kind === "signal") signals.push(name);
    else if (kind === "computed") computeds.push(name);
    else if (kind === "prop") props.push(name);
    else if (kind === "ref") refs.push(name);
    else if (kind === "function") functions.push(name);
  }

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      if (STYLE_EXTENSION_REGEX.test(spec)) cssImports.push(spec);
      if ((spec.startsWith("./") || spec.startsWith("../")) && !ALLOWED_RELATIVE_IMPORT_REGEX.test(spec)) {
        diagnostics.push({
          code: DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE,
          message: `Relative import '${spec}' is missing an explicit file extension (e.g. '.tix', '.js', or '.scss') (R-RS-01).`,
          severity: "error",
          span: spanForNode(stmt.moduleSpecifier)
        });
      }

      const clause = stmt.importClause;
      if (clause && !clause.isTypeOnly) {
        if (clause.name) {
          imports.set(clause.name.text, spec);
          recordBinding(clause.name.text, "import", clause.name, spec);
        }
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            const localName = clause.namedBindings.name.text;
            imports.set(localName, spec);
            recordBinding(localName, "import", clause.namedBindings.name, spec);
          } else if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              if (!el.isTypeOnly) {
                imports.set(el.name.text, spec);
                recordBinding(el.name.text, "import", el.name, spec);
              }
            }
          }
        }
      }
    } else if (ts.isVariableStatement(stmt)) {
      const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const decl of stmt.declarationList.declarations) {
        let inferredKind: BindingKind = isConst ? "const" : "let";
        if (decl.initializer && ts.isCallExpression(decl.initializer)) {
          const callee = decl.initializer.expression;
          if (ts.isIdentifier(callee)) {
            if (callee.text === "signal") inferredKind = "signal";
            else if (callee.text === "computed") inferredKind = "computed";
            else if (callee.text === "defineProps") inferredKind = "prop";
            else if (callee.text === "createRef") inferredKind = "ref";
          }
        } else if (
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          inferredKind = "function";
        }

        if (ts.isIdentifier(decl.name)) {
          recordBinding(decl.name.text, inferredKind, decl);
        } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
          const collectBindingElements = (pattern: ts.BindingPattern): void => {
            for (const element of pattern.elements) {
              if (ts.isBindingElement(element)) {
                if (ts.isIdentifier(element.name)) {
                  recordBinding(element.name.text, inferredKind === "prop" ? "prop" : isConst ? "const" : "let", element);
                } else {
                  collectBindingElements(element.name);
                }
              }
            }
          };
          collectBindingElements(decl.name);
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      recordBinding(stmt.name.text, "function", stmt);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      recordBinding(stmt.name.text, "const", stmt);
    }
  }

  return { bindings, signals, computeds, props, refs, functions, imports, cssImports };
}

export function analyze(ast: ComponentNode, options?: AnalyzeOptions): ComponentDescriptor {
  const filename = options?.filename ?? ast.span.file ?? "Component.mix";
  const lineMap = options?.source !== undefined ? new LineMap(options.source, filename) : null;
  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  const { bindings, signals, computeds, props, refs, functions, imports, cssImports } =
    analyzeScriptBlock(ast, lineMap, diagnostics);

  const rootScope: Scope = { parent: null, bindings };

  function emitLegacyWarning(message: string, span: SourceSpan): void {
    const warnDiag: Diagnostic = {
      code: DiagnosticCodes.MIX_WARN_LEGACY_CONTROL_FLOW,
      message,
      severity: "warning",
      span
    };
    warnings.push(warnDiag);
    if (options?.warnLegacyControlFlow) diagnostics.push(warnDiag);
  }

  function analyzeTemplateNodes(nodes: readonly TemplateNode[], currentScope: Scope): void {
    for (const node of nodes) {
      switch (node.type) {
        case "Element":
        case "ComponentCall":
        case "DynamicElement": {
          if (node.type === "ComponentCall" && !lookupInScope(currentScope, node.name)) {
            diagnostics.push({
              code: DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER,
              message: `Component '<${node.name}>' is not imported or defined in <script>.`,
              severity: "error",
              span: node.span
            });
          }
          if (node.type === "DynamicElement") {
            verifyExpressionIdentifiers(node.tagExpression, currentScope, diagnostics, node.span);
          }
          for (const attr of node.attributes) {
            if (attr.type === "DynamicAttribute") {
              if (attr.templateValue) analyzeTemplateNodes(attr.templateValue, currentScope);
              else verifyExpressionIdentifiers(attr.expression, currentScope, diagnostics, attr.span);
            } else if (attr.type === "DirectiveAttribute") {
              verifyExpressionIdentifiers(attr.expression, currentScope, diagnostics, attr.span);
            } else if (attr.type === "EventBinding") {
              verifyExpressionIdentifiers(attr.handler, currentScope, diagnostics, attr.span);
            } else if (attr.type === "RefBinding" || attr.type === "BindBinding") {
              verifyExpressionIdentifiers(attr.target, currentScope, diagnostics, attr.span);
            }
          }
          analyzeTemplateNodes(node.children, currentScope);
          break;
        }
        case "Interpolation":
          verifyExpressionIdentifiers(node.expression, currentScope, diagnostics, node.span);
          break;
        case "IfBlock": {
          if (node.legacySyntax) {
            emitLegacyWarning(
              "Legacy '{#if}...{/if}' control-flow syntax is deprecated. Use '{if ...}...{endif}' instead (D-133).",
              node.span
            );
          }
          verifyExpressionIdentifiers(node.condition, currentScope, diagnostics, node.span);
          analyzeTemplateNodes(node.consequent, currentScope);
          if (node.alternate) {
            analyzeTemplateNodes(
              Array.isArray(node.alternate) ? node.alternate : [node.alternate as TemplateNode],
              currentScope
            );
          }
          break;
        }
        case "EachBlock": {
          if (node.legacySyntax) {
            emitLegacyWarning(
              "Legacy '{#each}...{/each}' control-flow syntax is deprecated. Use '{each (item, idx) in list}...{endeach}' instead (D-133).",
              node.span
            );
          }
          verifyExpressionIdentifiers(node.collection, currentScope, diagnostics, node.span);
          const loopBindings = new Map<string, SymbolBinding>([
            [node.itemIdentifier, { name: node.itemIdentifier, kind: "loop", span: node.span }]
          ]);
          if (node.indexIdentifier) {
            loopBindings.set(node.indexIdentifier, { name: node.indexIdentifier, kind: "loop", span: node.span });
          }
          const loopScope: Scope = { parent: currentScope, bindings: loopBindings };
          verifyExpressionIdentifiers(node.keyExpression, loopScope, diagnostics, node.span);
          analyzeTemplateNodes(node.children, loopScope);
          break;
        }
        case "Text":
        case "Comment":
          break;
        case "SlotOutlet":
          analyzeTemplateNodes(node.fallback, currentScope);
          break;
        case "AwaitBlock": {
          if (node.legacySyntax) {
            emitLegacyWarning(
              "Legacy '{#await}...{/await}' control-flow syntax is deprecated. Use '{await ...}...{endawait}' instead (D-133).",
              node.span
            );
          }
          verifyExpressionIdentifiers(node.expression, currentScope, diagnostics, node.span);
          analyzeTemplateNodes(node.pending, currentScope);
          const thenScope: Scope = node.thenIdentifier
            ? {
                parent: currentScope,
                bindings: new Map([[node.thenIdentifier, { name: node.thenIdentifier, kind: "loop", span: node.span }]])
              }
            : currentScope;
          analyzeTemplateNodes(node.thenBranch, thenScope);
          const catchScope: Scope = node.catchIdentifier
            ? {
                parent: currentScope,
                bindings: new Map([[node.catchIdentifier, { name: node.catchIdentifier, kind: "loop", span: node.span }]])
              }
            : currentScope;
          analyzeTemplateNodes(node.catchBranch, catchScope);
          break;
        }
      }
    }
  }

  analyzeTemplateNodes(ast.template, rootScope);

  const firstError = diagnostics.find((d) => d.severity === "error");
  if ((options?.throwOnError ?? true) && firstError) {
    throw new MixDiagnosticError(firstError);
  }

  return deepFreeze({
    ast, filename, rootScope, signals, computeds, props, refs, functions, imports, cssImports, diagnostics, warnings
  });
}
