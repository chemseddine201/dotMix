/**
 * @mix/compiler-semantic — Lexical scopes, ESTree symbol resolution, .tix virtual TypeScript projection,
 * SourceMapSpanTable (R-SP-01..05), and TypeScript 6.0.3 Compiler API verification adapter (D-106, R-TC-01..03).
 *
 * Architecture Invariant:
 * - Zero regular expressions for variable/scope analysis (AGENTS.md §6, Guardrail D)
 * - Zero dependency on @mix/runtime (HAA-04)
 */

import * as ts from "typescript";
import { deepFreeze, createSpan } from "@mix/ast";
import type {
  ComponentNode,
  TemplateNode,
  ElementNode,
  ComponentCallNode,
  DynamicElementNode,
  ESTreeNode,
  SourceLocation,
  SourceSpan
} from "@mix/ast";
import {
  MixDiagnosticError,
  DiagnosticCodes
} from "@mix/diagnostics";
import type { Diagnostic } from "@mix/diagnostics";

export type BindingKind =
  | "signal"
  | "computed"
  | "prop"
  | "ref"
  | "function"
  | "import"
  | "const"
  | "let"
  | "param"
  | "loop";

export interface SymbolBinding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly span: SourceSpan;
  readonly importSource?: string;
}

export interface Scope {
  readonly parent: Scope | null;
  readonly bindings: ReadonlyMap<string, SymbolBinding>;
}

export type SpanKind = "verbatim" | "origin" | "internal";

export interface SpanEntry {
  readonly genStart: number;
  readonly genEnd: number;
  readonly srcStart: number;
  readonly srcEnd: number;
  readonly kind: SpanKind;
}

export interface SourceMapV3 {
  readonly version: 3;
  readonly file: string;
  readonly sources: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

export interface TypeProjectionResult {
  readonly code: string;
  readonly virtualFilename: string;
  readonly spanTable: readonly SpanEntry[];
  readonly sourceMap: SourceMapV3;
}

export interface ComponentDescriptor {
  readonly ast: ComponentNode;
  readonly filename: string;
  readonly rootScope: Scope;
  readonly signals: readonly string[];
  readonly computeds: readonly string[];
  readonly props: readonly string[];
  readonly refs: readonly string[];
  readonly functions: readonly string[];
  readonly imports: ReadonlyMap<string, string>;
  readonly cssImports?: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface AnalyzeOptions {
  filename?: string;
  source?: string;
  throwOnError?: boolean;
}

export interface TypecheckOptions {
  filename?: string;
  virtualFiles?: Readonly<Record<string, string>>;
  throwOnError?: boolean;
}

export interface TypecheckResult {
  readonly projection: TypeProjectionResult;
  readonly diagnostics: readonly Diagnostic[];
}

const ALLOWED_GLOBALS = new Set([
  "Math",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "JSON",
  "Date",
  "Promise",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Symbol",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "BigInt",
  "Intl",
  "console",
  "undefined",
  "NaN",
  "Infinity",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "encodeURI",
  "encodeURIComponent",
  "decodeURI",
  "decodeURIComponent",
  "URL",
  "URLSearchParams",
  "AbortController",
  "AbortSignal",
  "structuredClone",
  "queueMicrotask",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "performance",
  "crypto",
  "window",
  "document",
  "globalThis",
  "event",
  "$event",
  "signal",
  "computed",
  "createEffect",
  "batch",
  "onCleanup",
  "createRoot",
  "createRef",
  "defineProps",
  "createTrustedHtml",
  "setSanitizerProvider",
  "createCancellationSource",
  "createResource",
  "createContext",
  "useContext",
  "provideContext"
]);

class InternalLineMap {
  private readonly lineStarts: number[];
  readonly source: string;
  readonly filename: string | undefined;

  constructor(source: string, filename?: string) {
    this.source = source;
    this.filename = filename;
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  locationAt(offset: number): SourceLocation {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.lineStarts[mid]! <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIndex = Math.max(0, high);
    const lineStart = this.lineStarts[lineIndex]!;
    return Object.freeze({
      line: lineIndex + 1,
      column: clamped - lineStart + 1,
      offset: clamped
    });
  }

  span(startOffset: number, endOffset: number): SourceSpan {
    return createSpan(
      this.locationAt(startOffset),
      this.locationAt(Math.max(startOffset, endOffset)),
      this.filename
    );
  }
}

function lookupInScope(scope: Scope, name: string): SymbolBinding | undefined {
  let current: Scope | null = scope;
  while (current !== null) {
    const found = current.bindings.get(name);
    if (found) return found;
    current = current.parent;
  }
  return undefined;
}

function collectPatternIdentifiers(patternNode: unknown, out: Set<string>): void {
  if (!patternNode || typeof patternNode !== "object") return;
  const node = patternNode as Record<string, unknown>;
  switch (node.type) {
    case "Identifier":
      if (typeof node.name === "string") {
        out.add(node.name);
      }
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
            if (p.type === "RestElement") {
              collectPatternIdentifiers(p.argument, out);
            } else {
              collectPatternIdentifiers(p.value, out);
            }
          }
        }
      }
      break;
  }
}

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

    // Ignore TypeScript type-level AST nodes
    if (type.startsWith("TS") && type !== "TSAsExpression" && type !== "TSSatisfiesExpression" && type !== "TSNonNullExpression" && type !== "TSTypeAssertion") {
      return;
    }

    if (type === "TSAsExpression" || type === "TSSatisfiesExpression" || type === "TSNonNullExpression" || type === "TSTypeAssertion") {
      walkExpr(n.expression, activeScope);
      return;
    }

    if (type === "Identifier") {
      const name = n.name;
      if (typeof name === "string") {
        if (!lookupInScope(activeScope, name) && !ALLOWED_GLOBALS.has(name)) {
          const span = (n.loc as SourceSpan | undefined) ?? defaultSpan;
          diagnostics.push({
            code: DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER,
            message: `Unresolved identifier '${name}' in template expression.`,
            severity: "error",
            span
          });
        }
      }
      return;
    }

    if (type === "MemberExpression" || type === "ChainExpression") {
      if (type === "ChainExpression") {
        walkExpr(n.expression, activeScope);
        return;
      }
      walkExpr(n.object, activeScope);
      if (n.computed === true) {
        walkExpr(n.property, activeScope);
      }
      return;
    }

    if (type === "Property" || type === "ObjectProperty") {
      if (n.computed === true) {
        walkExpr(n.key, activeScope);
      }
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
      for (const pName of paramNames) {
        childBindings.set(pName, {
          name: pName,
          kind: "param",
          span: (n.loc as SourceSpan | undefined) ?? defaultSpan
        });
      }
      const fnScope: Scope = {
        parent: activeScope,
        bindings: childBindings
      };
      walkExpr(n.body, fnScope);
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
                  blockBindings.set(nm, {
                    name: nm,
                    kind: "const",
                    span: defaultSpan
                  });
                }
              }
            }
          }
        }
      }
      const blockScope: Scope = {
        parent: activeScope,
        bindings: blockBindings
      };
      if (Array.isArray(n.body)) {
        for (const stmt of n.body) walkExpr(stmt, blockScope);
      }
      return;
    }

    if (type === "VariableDeclarator") {
      walkExpr(n.init, activeScope);
      return;
    }

    for (const key of Object.keys(n)) {
      if (key === "type" || key === "loc" || key === "range" || key === "start" || key === "end" || key === "typeAnnotation" || key === "typeParameters") {
        continue;
      }
      walkExpr(n[key], activeScope);
    }
  }

  walkExpr(expr, scope);
}

/**
 * Analyzes `<script>` using the official TypeScript 6.0.3 AST parser (`ts.createSourceFile`)
 * to extract top-level bindings and classify signals, computeds, props, refs, functions, and imports.
 */
function analyzeScriptBlock(
  ast: ComponentNode,
  lineMap: InternalLineMap | null,
  diagnostics: Diagnostic[]
): {
  bindings: Map<string, SymbolBinding>;
  signals: string[];
  computeds: string[];
  props: string[];
  refs: string[];
  functions: string[];
  imports: Map<string, string>;
  cssImports: string[];
} {
  const bindings = new Map<string, SymbolBinding>();
  const signals: string[] = [];
  const computeds: string[] = [];
  const props: string[] = [];
  const refs: string[] = [];
  const functions: string[] = [];
  const imports = new Map<string, string>();
  const cssImports: string[] = [];

  if (!ast.script) {
    return { bindings, signals, computeds, props, refs, functions, imports, cssImports };
  }

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
    if (lineMap) {
      return lineMap.span(startOff, endOff);
    }
    return ast.script!.contentSpan;
  }

  function recordBinding(name: string, kind: BindingKind, node: ts.Node, importSource?: string): void {
    const binding: SymbolBinding =
      importSource !== undefined
        ? { name, kind, span: spanForNode(node), importSource }
        : { name, kind, span: spanForNode(node) };
    bindings.set(name, binding);
    if (kind === "signal") signals.push(name);
    else if (kind === "computed") computeds.push(name);
    else if (kind === "prop") props.push(name);
    else if (kind === "ref") refs.push(name);
    else if (kind === "function") functions.push(name);
  }

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      if (spec.endsWith(".css") || /\.(css)(\?.*)?$/.test(spec)) {
        cssImports.push(spec);
      }
      // R-RS-01: Relative imports in .tix / .mix must have an explicit extension (.tix, .mix, .js, .ts, .css)
      if (
        (spec.startsWith("./") || spec.startsWith("../")) &&
        !/\.(tix|mix|js|mjs|ts|css)(\?.*)?$/.test(spec)
      ) {
        diagnostics.push({
          code: DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE,
          message: `Relative import '${spec}' is missing an explicit file extension (e.g. '.tix' or '.js') (R-RS-01).`,
          severity: "error",
          span: spanForNode(stmt.moduleSpecifier)
        });
      }

      const clause = stmt.importClause;
      if (clause && !clause.isTypeOnly) {
        if (clause.name) {
          const localName = clause.name.text;
          imports.set(localName, spec);
          recordBinding(localName, "import", clause.name, spec);
        }
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            const localName = clause.namedBindings.name.text;
            imports.set(localName, spec);
            recordBinding(localName, "import", clause.namedBindings.name, spec);
          } else if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              if (!el.isTypeOnly) {
                const localName = el.name.text;
                imports.set(localName, spec);
                recordBinding(localName, "import", el.name, spec);
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
                  recordBinding(
                    element.name.text,
                    inferredKind === "prop" ? "prop" : isConst ? "const" : "let",
                    element
                  );
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
  const lineMap = options?.source !== undefined ? new InternalLineMap(options.source, filename) : null;
  const diagnostics: Diagnostic[] = [];

  const { bindings, signals, computeds, props, refs, functions, imports, cssImports } = analyzeScriptBlock(
    ast,
    lineMap,
    diagnostics
  );

  const rootScope: Scope = {
    parent: null,
    bindings
  };

  function analyzeTemplateNodes(nodes: readonly TemplateNode[], currentScope: Scope): void {
    for (const node of nodes) {
      switch (node.type) {
        case "Element":
        case "ComponentCall":
        case "DynamicElement": {
          if (node.type === "ComponentCall") {
            if (!lookupInScope(currentScope, node.name)) {
              diagnostics.push({
                code: DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER,
                message: `Component '<${node.name}>' is not imported or defined in <script>.`,
                severity: "error",
                span: node.span
              });
            }
          }
          if (node.type === "DynamicElement") {
            verifyExpressionIdentifiers(node.tagExpression, currentScope, diagnostics, node.span);
          }
          for (const attr of node.attributes) {
            if (attr.type === "DynamicAttribute" || attr.type === "DirectiveAttribute") {
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
        case "Interpolation": {
          verifyExpressionIdentifiers(node.expression, currentScope, diagnostics, node.span);
          break;
        }
        case "IfBlock": {
          verifyExpressionIdentifiers(node.condition, currentScope, diagnostics, node.span);
          analyzeTemplateNodes(node.consequent, currentScope);
          if (node.alternate) {
            if (Array.isArray(node.alternate)) {
              analyzeTemplateNodes(node.alternate, currentScope);
            } else {
              analyzeTemplateNodes([node.alternate as TemplateNode], currentScope);
            }
          }
          break;
        }
        case "EachBlock": {
          verifyExpressionIdentifiers(node.collection, currentScope, diagnostics, node.span);
          const loopBindings = new Map<string, SymbolBinding>();
          loopBindings.set(node.itemIdentifier, {
            name: node.itemIdentifier,
            kind: "loop",
            span: node.span
          });
          if (node.indexIdentifier) {
            loopBindings.set(node.indexIdentifier, {
              name: node.indexIdentifier,
              kind: "loop",
              span: node.span
            });
          }
          const loopScope: Scope = {
            parent: currentScope,
            bindings: loopBindings
          };
          verifyExpressionIdentifiers(node.keyExpression, loopScope, diagnostics, node.span);
          analyzeTemplateNodes(node.children, loopScope);
          break;
        }
        case "Text":
        case "Comment":
          break;
        case "SlotOutlet": {
          analyzeTemplateNodes(node.fallback, currentScope);
          break;
        }
        case "AwaitBlock": {
          verifyExpressionIdentifiers(node.expression, currentScope, diagnostics, node.span);
          analyzeTemplateNodes(node.pending, currentScope);
          if (node.thenIdentifier) {
            const thenBindings = new Map<string, SymbolBinding>();
            thenBindings.set(node.thenIdentifier, {
              name: node.thenIdentifier,
              kind: "loop",
              span: node.span
            });
            const thenScope: Scope = {
              parent: currentScope,
              bindings: thenBindings
            };
            analyzeTemplateNodes(node.thenBranch, thenScope);
          } else {
            analyzeTemplateNodes(node.thenBranch, currentScope);
          }
          if (node.catchIdentifier) {
            const catchBindings = new Map<string, SymbolBinding>();
            catchBindings.set(node.catchIdentifier, {
              name: node.catchIdentifier,
              kind: "loop",
              span: node.span
            });
            const catchScope: Scope = {
              parent: currentScope,
              bindings: catchBindings
            };
            analyzeTemplateNodes(node.catchBranch, catchScope);
          } else {
            analyzeTemplateNodes(node.catchBranch, currentScope);
          }
          break;
        }
      }
    }
  }

  analyzeTemplateNodes(ast.template, rootScope);

  if ((options?.throwOnError ?? true) && diagnostics.length > 0) {
    throw new MixDiagnosticError(diagnostics[0]!);
  }

  return deepFreeze({
    ast,
    filename,
    rootScope,
    signals,
    computeds,
    props,
    refs,
    functions,
    imports,
    cssImports,
    diagnostics
  });
}

// Base64 VLQ encoder for SourceMapV3
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVlq(value: number): string {
  let vlq = value < 0 ? ((-value) << 1) + 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    encoded += BASE64_CHARS[digit]!;
  } while (vlq > 0);
  return encoded;
}

export function generateSourceMap(
  filename: string,
  originalSource: string,
  generatedSource: string,
  spanTable: readonly SpanEntry[]
): SourceMapV3 {
  const origMap = new InternalLineMap(originalSource, filename);
  const genLines = generatedSource.split("\n");

  let prevGenLine = 0;
  let prevGenCol = 0;
  let prevSrcLine = 0;
  let prevSrcCol = 0;

  const lineSegments: string[][] = Array.from({ length: genLines.length }, () => []);
  const genMap = new InternalLineMap(generatedSource, `${filename}.ts`);

  for (const entry of spanTable) {
    if (entry.kind === "internal" || entry.genStart >= entry.genEnd) {
      continue;
    }
    const genLoc = genMap.locationAt(entry.genStart);
    const srcLoc = origMap.locationAt(entry.srcStart);

    const genLineIdx = genLoc.line - 1;
    const genColIdx = genLoc.column - 1;
    const srcLineIdx = srcLoc.line - 1;
    const srcColIdx = srcLoc.column - 1;

    if (genLineIdx !== prevGenLine) {
      prevGenCol = 0;
      prevGenLine = genLineIdx;
    }

    const seg =
      encodeVlq(genColIdx - prevGenCol) +
      encodeVlq(0) + // source index 0
      encodeVlq(srcLineIdx - prevSrcLine) +
      encodeVlq(srcColIdx - prevSrcCol);

    lineSegments[genLineIdx]?.push(seg);

    prevGenCol = genColIdx;
    prevSrcLine = srcLineIdx;
    prevSrcCol = srcColIdx;
  }

  return deepFreeze({
    version: 3,
    file: `${filename}.ts`,
    sources: [filename],
    names: [],
    mappings: lineSegments.map(segs => segs.join(",")).join(";")
  });
}

const SVG_ELEMENTS = new Set([
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "g",
  "text",
  "defs",
  "use",
  "symbol",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop"
]);

/**
 * Projects a `.tix` ComponentNode into a virtual `.tix.ts` file with a 100% byte-covered
 * `SourceMapSpanTable` (`verbatim | origin | internal`) per D-106, R-TC-01..03, and R-SP-01..05.
 */
export function projectTypeScript(
  ast: ComponentNode,
  originalSource?: string,
  filename: string = ast.span.file ?? "Component.tix"
): TypeProjectionResult {
  const chunks: string[] = [];
  const spanTable: SpanEntry[] = [];
  let cursor = 0;

  function appendInternal(text: string): void {
    if (text.length === 0) return;
    const start = cursor;
    cursor += text.length;
    chunks.push(text);
    spanTable.push({
      genStart: start,
      genEnd: cursor,
      srcStart: 0,
      srcEnd: 0,
      kind: "internal"
    });
  }

  function appendVerbatim(text: string, srcStart: number): void {
    if (text.length === 0) return;
    const start = cursor;
    cursor += text.length;
    chunks.push(text);
    spanTable.push({
      genStart: start,
      genEnd: cursor,
      srcStart,
      srcEnd: srcStart + text.length,
      kind: "verbatim"
    });
  }

  function appendOrigin(text: string, originSpan: SourceSpan): void {
    if (text.length === 0) return;
    const start = cursor;
    cursor += text.length;
    chunks.push(text);
    spanTable.push({
      genStart: start,
      genEnd: cursor,
      srcStart: originSpan.start.offset,
      srcEnd: originSpan.end.offset,
      kind: "origin"
    });
  }

  appendInternal(
    `import { VerifyProps, VerifyRef, ElementOf, SvgElementOf, AnyElement } from "@mix/runtime/typecheck";\n`
  );

  if (ast.script) {
    appendVerbatim(ast.script.content, ast.script.contentSpan.start.offset);
    appendInternal("\n");
  }

  appendInternal(`export function __mixTypecheckTemplate(): void {\n`);

  function emitAttributeChecks(
    ownerNode: ElementNode | ComponentCallNode | DynamicElementNode,
    inSvg: boolean
  ): void {
    if (ownerNode.type === "ComponentCall") {
      // R-TC-02: Emit VerifyProps(Comp, { ... }) with fresh object literal and verbatim prop expressions
      appendOrigin(`  VerifyProps(${ownerNode.name}, { `, ownerNode.span);
      let firstProp = true;
      for (const attr of ownerNode.attributes) {
        if (attr.type === "StaticAttribute") {
          if (!firstProp) appendInternal(", ");
          firstProp = false;
          // Emit attribute name verbatim so misspelled prop names map directly to the attribute span!
          appendVerbatim(attr.name, attr.span.start.offset);
          appendOrigin(`: ${JSON.stringify(attr.value)}`, attr.span);
        } else if (attr.type === "DynamicAttribute") {
          if (!firstProp) appendInternal(", ");
          firstProp = false;
          appendVerbatim(attr.name, attr.span.start.offset);
          appendInternal(": (");
          const exprStart = attr.expression.start ?? attr.span.start.offset;
          appendVerbatim(attr.rawExpression, exprStart);
          appendInternal(")");
        }
      }
      appendOrigin(` });\n`, ownerNode.span);
    }

    for (const attr of ownerNode.attributes) {
      if (attr.type === "RefBinding") {
        // R-TC-01: VerifyRef(ref, ElementOf("tag") | SvgElementOf("tag") | AnyElement())
        const exprStart = attr.target.start ?? attr.span.start.offset;
        appendOrigin(`  VerifyRef(`, attr.span);
        appendVerbatim(attr.rawTarget, exprStart);
        if (ownerNode.type === "DynamicElement") {
          appendOrigin(`, AnyElement());\n`, attr.span);
        } else if (ownerNode.type === "Element") {
          if (inSvg || SVG_ELEMENTS.has(ownerNode.tag)) {
            appendOrigin(`, SvgElementOf(${JSON.stringify(ownerNode.tag)}));\n`, attr.span);
          } else {
            appendOrigin(`, ElementOf(${JSON.stringify(ownerNode.tag)}));\n`, attr.span);
          }
        } else {
          appendOrigin(`, AnyElement());\n`, attr.span);
        }
      } else if (attr.type === "DynamicAttribute" && ownerNode.type !== "ComponentCall") {
        const exprStart = attr.expression.start ?? attr.span.start.offset;
        appendInternal("  void (");
        appendVerbatim(attr.rawExpression, exprStart);
        appendInternal(");\n");
      } else if (attr.type === "DirectiveAttribute") {
        const exprStart = attr.expression.start ?? attr.span.start.offset;
        appendInternal("  void (");
        appendVerbatim(attr.rawExpression, exprStart);
        appendInternal(");\n");
      } else if (attr.type === "EventBinding") {
        const exprStart = attr.handler.start ?? attr.span.start.offset;
        appendInternal("  void (");
        appendVerbatim(attr.rawHandler, exprStart);
        appendInternal(");\n");
      } else if (attr.type === "BindBinding") {
        const exprStart = attr.target.start ?? attr.span.start.offset;
        appendInternal("  void (");
        appendVerbatim(attr.rawTarget, exprStart);
        appendInternal(");\n");
      }
    }
  }

  function emitTemplateChecks(nodes: readonly TemplateNode[], inSvg: boolean): void {
    for (const node of nodes) {
      switch (node.type) {
        case "Element": {
          const nextSvg = inSvg || node.tag === "svg";
          emitAttributeChecks(node, nextSvg);
          emitTemplateChecks(node.children, nextSvg);
          break;
        }
        case "ComponentCall": {
          emitAttributeChecks(node, inSvg);
          emitTemplateChecks(node.children, inSvg);
          break;
        }
        case "DynamicElement": {
          const tagStart = node.tagExpression.start ?? node.span.start.offset;
          appendInternal("  void (");
          appendVerbatim(node.rawTagExpression, tagStart);
          appendInternal(");\n");
          emitAttributeChecks(node, inSvg);
          emitTemplateChecks(node.children, inSvg);
          break;
        }
        case "Interpolation": {
          const exprStart = node.expression.start ?? node.span.start.offset;
          appendInternal("  void (");
          appendVerbatim(node.rawExpression, exprStart);
          appendInternal(");\n");
          break;
        }
        case "IfBlock": {
          const condStart = node.condition.start ?? node.span.start.offset;
          appendInternal("  if (");
          appendVerbatim(node.rawCondition, condStart);
          appendInternal(") {\n");
          emitTemplateChecks(node.consequent, inSvg);
          appendInternal("  }\n");
          if (node.alternate) {
            if (Array.isArray(node.alternate)) {
              appendInternal("  else {\n");
              emitTemplateChecks(node.alternate, inSvg);
              appendInternal("  }\n");
            } else {
              emitTemplateChecks([node.alternate as TemplateNode], inSvg);
            }
          }
          break;
        }
        case "EachBlock": {
          const colStart = node.collection.start ?? node.span.start.offset;
          const keyStart = node.keyExpression.start ?? node.span.start.offset;
          appendInternal("  for (const [");
          appendOrigin(`${node.indexIdentifier ?? "__idx"}, ${node.itemIdentifier}`, node.span);
          appendInternal("] of Array.from(");
          appendVerbatim(node.rawCollection, colStart);
          appendInternal(").entries()) {\n    void ");
          appendInternal(`${node.indexIdentifier ?? "__idx"};\n    void (`);
          appendVerbatim(node.rawKeyExpression, keyStart);
          appendInternal(");\n");
          emitTemplateChecks(node.children, inSvg);
          appendInternal("  }\n");
          break;
        }
        case "Text":
        case "Comment":
          break;
        case "SlotOutlet": {
          emitTemplateChecks(node.fallback, inSvg);
          break;
        }
        case "AwaitBlock": {
          const exprStart = node.expression.start ?? node.span.start.offset;
          appendInternal("  void (");
          appendVerbatim(node.rawExpression, exprStart);
          appendInternal(");\n");
          emitTemplateChecks(node.pending, inSvg);
          if (node.thenIdentifier) {
            appendInternal(`  {\n    const ${node.thenIdentifier} = {} as any;\n`);
            emitTemplateChecks(node.thenBranch, inSvg);
            appendInternal("  }\n");
          } else {
            emitTemplateChecks(node.thenBranch, inSvg);
          }
          if (node.catchIdentifier) {
            appendInternal(`  {\n    const ${node.catchIdentifier} = {} as any;\n`);
            emitTemplateChecks(node.catchBranch, inSvg);
            appendInternal("  }\n");
          } else {
            emitTemplateChecks(node.catchBranch, inSvg);
          }
          break;
        }
      }
    }
  }

  emitTemplateChecks(ast.template, false);
  appendInternal("}\n");

  const code = chunks.join("");
  const virtualFilename = filename.endsWith(".ts") ? filename : `${filename}.ts`;
  const sourceMap = generateSourceMap(filename, originalSource ?? "", code, spanTable);

  return deepFreeze({
    code,
    virtualFilename,
    spanTable,
    sourceMap
  });
}

/**
 * R-SP-04: Maps a diagnostic offset and length in the projected `.tix.ts` file back to the original
 * `.tix` source span using `SourceMapSpanTable`.
 */
export function mapProjectedSpanToSource(
  spanTable: readonly SpanEntry[],
  genStart: number,
  genLength: number,
  originalSource: string,
  filename?: string
): { span: SourceSpan; isInternal: boolean } {
  const lineMap = new InternalLineMap(originalSource, filename);
  const genEnd = genStart + Math.max(1, genLength);

  // Find smallest containing or overlapping verbatim/origin entry first
  let bestEntry: SpanEntry | null = null;
  for (const entry of spanTable) {
    if (genStart >= entry.genStart && genStart < entry.genEnd) {
      bestEntry = entry;
      break;
    }
  }

  if (!bestEntry && spanTable.length > 0) {
    bestEntry = spanTable[spanTable.length - 1]!;
  }

  if (!bestEntry || bestEntry.kind === "internal") {
    // Check if the range overlaps a verbatim or origin entry nearby (e.g., object literal span)
    for (const entry of spanTable) {
      if (entry.kind !== "internal" && entry.genStart < genEnd && entry.genEnd > genStart) {
        bestEntry = entry;
        break;
      }
    }
  }

  if (!bestEntry || bestEntry.kind === "internal") {
    return {
      span: lineMap.span(0, Math.min(originalSource.length, 1)),
      isInternal: true
    };
  }

  if (bestEntry.kind === "verbatim") {
    const delta = Math.max(0, genStart - bestEntry.genStart);
    const srcStart = Math.min(bestEntry.srcEnd, bestEntry.srcStart + delta);
    const srcEnd = Math.min(bestEntry.srcEnd, srcStart + Math.max(1, genLength));
    return {
      span: lineMap.span(srcStart, srcEnd),
      isInternal: false
    };
  }

  return {
    span: lineMap.span(bestEntry.srcStart, bestEntry.srcEnd),
    isInternal: false
  };
}

const VIRTUAL_AMBIENT_RUNTIME_DTS = `
declare module "@mix/runtime/typecheck" {
  export interface RefTarget<T> { current: T | null; }
  export type ComponentFactory<P = Record<string, unknown>, R = unknown> = (props: P, children?: unknown) => R;
  export function VerifyRef<T>(ref: RefTarget<T>, element: NoInfer<T>): void;
  export function VerifyProps<P>(comp: ComponentFactory<P, any> | ((props: P) => any), props: NoInfer<P>): void;
  export function ElementOf<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
  export function SvgElementOf<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K];
  export function AnyElement(): Element;
}

declare module "@mix/runtime" {
  export interface Signal<T> { (): T; set(next: T | ((prev: T) => T)): T; }
  export interface Computed<T> { (): T; }
  export interface RefTarget<T> { current: T | null; }
  export type ComponentFactory<P = Record<string, unknown>, R = unknown> = (props: P, children?: unknown) => R;
  export function signal<T>(initialValue: T): Signal<T>;
  export function computed<T>(fn: () => T): Computed<T>;
  export function createEffect(fn: () => void | (() => void)): void;
  export function createRef<T = Element>(initial?: T | null): RefTarget<T>;
  export function defineProps<P>(defaults?: Partial<P>): P;
  export function createTrustedHtml(dirtyHtml: string): object;
}

declare module "*.css" {
  const css: string;
  export default css;
}

interface HTMLElementTagNameMap {
  div: HTMLDivElement;
  span: HTMLSpanElement;
  p: HTMLParagraphElement;
  button: HTMLButtonElement;
  input: HTMLInputElement;
  a: HTMLAnchorElement;
  img: HTMLImageElement;
  ul: HTMLUListElement;
  li: HTMLLIElement;
  h1: HTMLHeadingElement;
  h2: HTMLHeadingElement;
  h3: HTMLHeadingElement;
  section: HTMLElement;
  article: HTMLElement;
  strong: HTMLElement;
  em: HTMLElement;
  main: HTMLElement;
  header: HTMLElement;
  footer: HTMLElement;
  form: HTMLFormElement;
}
interface SVGElementTagNameMap {
  svg: SVGSVGElement;
  path: SVGElement;
}
interface Element { readonly tagName: string; }
interface HTMLElement extends Element { style: Record<string, string>; }
interface HTMLDivElement extends HTMLElement { readonly __tag: "div"; }
interface HTMLSpanElement extends HTMLElement { readonly __tag: "span"; }
interface HTMLParagraphElement extends HTMLElement { readonly __tag: "p"; }
interface HTMLButtonElement extends HTMLElement { disabled: boolean; readonly __tag: "button"; }
interface HTMLInputElement extends HTMLElement { value: string; checked: boolean; readonly __tag: "input"; }
interface HTMLAnchorElement extends HTMLElement { href: string; readonly __tag: "a"; }
interface HTMLImageElement extends HTMLElement { src: string; srcset: string; readonly __tag: "img"; }
interface HTMLUListElement extends HTMLElement { readonly __tag: "ul"; }
interface HTMLLIElement extends HTMLElement { readonly __tag: "li"; }
interface HTMLHeadingElement extends HTMLElement { readonly __tag: "h"; }
interface HTMLFormElement extends HTMLElement { action: string; readonly __tag: "form"; }
interface SVGElement extends Element { readonly __svg: true; }
interface SVGSVGElement extends SVGElement { readonly __tag: "svg"; }

declare function signal<T>(initialValue: T): { (): T; set(next: T | ((prev: T) => T)): T };
declare function computed<T>(fn: () => T): () => T;
declare function createEffect(fn: () => void | (() => void)): void;
declare function createRef<T = Element>(initial?: T | null): { current: T | null };
declare function defineProps<P>(defaults?: Partial<P>): P;
interface Context<T> { readonly id: symbol; readonly defaultValue: T; }
declare function createContext<T>(defaultValue?: T): Context<T>;
declare function useContext<T>(ctx: Context<T>): T;
declare function provideContext<T>(ctx: Context<T>, value: T): void;
`;

/**
 * Verifies a `.tix` ComponentNode or ComponentDescriptor using the official TypeScript 6.0.3 Compiler API (D-106).
 */
export function typecheckTix(
  astOrDesc: ComponentNode | ComponentDescriptor,
  originalSource: string,
  options?: TypecheckOptions
): TypecheckResult {
  const ast: ComponentNode = "ast" in astOrDesc ? astOrDesc.ast : astOrDesc;
  const filename =
    options?.filename ??
    ("filename" in astOrDesc ? astOrDesc.filename : undefined) ??
    ast.span.file ??
    "Component.tix";
  const semanticDesc = analyze(ast, {
    filename,
    source: originalSource,
    throwOnError: false
  });

  const projection = projectTypeScript(ast, originalSource, filename);
  const diagnostics: Diagnostic[] = [...semanticDesc.diagnostics];

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true
  };

  const defaultLibPath = ts.getDefaultLibFilePath(compilerOptions);
  const virtualFileMap = new Map<string, string>();
  virtualFileMap.set(projection.virtualFilename, projection.code);
  virtualFileMap.set("/__mix_ambient.d.ts", VIRTUAL_AMBIENT_RUNTIME_DTS);

  if (options?.virtualFiles) {
    for (const [vPath, vContent] of Object.entries(options.virtualFiles)) {
      virtualFileMap.set(vPath, vContent);
      if (vPath.endsWith(".tix")) {
        virtualFileMap.set(`${vPath}.ts`, vContent);
      }
    }
  }

  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const customHost: ts.CompilerHost = {
    ...defaultHost,
    fileExists(fileName: string): boolean {
      const normalized = fileName.replace(/\\/g, "/");
      if (virtualFileMap.has(fileName) || virtualFileMap.has(normalized)) return true;
      for (const key of virtualFileMap.keys()) {
        if (normalized.endsWith(`/${key.replace(/^\.\//, "")}`) || key === normalized) return true;
      }
      return defaultHost.fileExists(fileName);
    },
    readFile(fileName: string): string | undefined {
      const normalized = fileName.replace(/\\/g, "/");
      if (virtualFileMap.has(fileName)) return virtualFileMap.get(fileName);
      if (virtualFileMap.has(normalized)) return virtualFileMap.get(normalized);
      for (const [key, val] of virtualFileMap.entries()) {
        if (normalized.endsWith(`/${key.replace(/^\.\//, "")}`)) return val;
      }
      return defaultHost.readFile(fileName);
    },
    getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, onError?: (message: string) => void) {
      const content = this.readFile(fileName);
      if (content !== undefined) {
        return ts.createSourceFile(fileName, content, languageVersion, true);
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError);
    },
    resolveModuleNames(moduleNames: string[], containingFile: string): (ts.ResolvedModule | undefined)[] {
      return moduleNames.map(modName => {
        if (modName === "@mix/runtime" || modName === "@mix/runtime/typecheck" || modName.endsWith(".css")) {
          return {
            resolvedFileName: "/__mix_ambient.d.ts",
            isExternalLibraryImport: true
          };
        }
        const candidates = [
          modName,
          `${modName}.ts`,
          modName.replace(/^\.\//, "")
        ];
        for (const cand of candidates) {
          if (virtualFileMap.has(cand)) {
            return {
              resolvedFileName: cand,
              extension: ts.Extension.Ts
            };
          }
        }
        const resolved = ts.resolveModuleName(modName, containingFile, compilerOptions, defaultHost);
        return resolved.resolvedModule;
      });
    }
  };

  const rootNames = [defaultLibPath, "/__mix_ambient.d.ts", projection.virtualFilename];
  const program = ts.createProgram(rootNames, compilerOptions, customHost);
  const projectedSf = program.getSourceFile(projection.virtualFilename);
  const tsDiagnostics = projectedSf ? program.getSemanticDiagnostics(projectedSf) : [];

  for (const tsDiag of tsDiagnostics) {
    const msg = ts.flattenDiagnosticMessageText(tsDiag.messageText, "\n");
    const genStart = tsDiag.start ?? 0;
    const genLen = tsDiag.length ?? 1;
    const mapped = mapProjectedSpanToSource(
      projection.spanTable,
      genStart,
      genLen,
      originalSource,
      filename
    );

    if (mapped.isInternal) {
      diagnostics.push({
        code: DiagnosticCodes.MIX_INTERNAL_TYPECHECK,
        message: `Internal TypeScript projection diagnostic: ${msg}`,
        severity: "error",
        span: mapped.span
      });
    } else {
      diagnostics.push({
        code: DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE,
        message: msg,
        severity: "error",
        span: mapped.span
      });
    }
  }

  if ((options?.throwOnError ?? false) && diagnostics.length > 0) {
    throw new MixDiagnosticError(diagnostics[0]!);
  }

  return deepFreeze({
    projection,
    diagnostics
  });
}

/**
 * Rewrites `.tix` / `.mix` import specifiers to `.tix.js` / `.mix.js` in emitted JavaScript (R-RS-03, R-RS-04).
 */
export function rewriteModuleImportExtensions(scriptCode: string): string {
  const sf = ts.createSourceFile("script.ts", scriptCode, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const rawSpec = stmt.moduleSpecifier.text;
      if (rawSpec.endsWith(".tix") || rawSpec.endsWith(".mix")) {
        replacements.push({
          start: stmt.moduleSpecifier.getStart(sf),
          end: stmt.moduleSpecifier.getEnd(),
          text: JSON.stringify(`${rawSpec}.js`)
        });
      }
    }
  }

  let out = scriptCode;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]!;
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

export interface SeparatedScriptResult {
  readonly importsCode: string;
  readonly bodyCode: string;
}

/**
 * Uses the TypeScript 6.0.3 Compiler API to separate top-level `import` declarations
 * from component body statements, rewrite `.tix`/`.mix` module specifiers to `.js`,
 * and transpile TypeScript syntax (interfaces, type aliases, type annotations) to clean ES2023 JS.
 */
export function extractAndTranspileScript(
  scriptContent: string,
  isTypeScript: boolean
): SeparatedScriptResult {
  const rewritten = rewriteModuleImportExtensions(scriptContent);
  const sf = ts.createSourceFile(
    isTypeScript ? "component.ts" : "component.js",
    rewritten,
    ts.ScriptTarget.ES2023,
    true,
    isTypeScript ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );

  const importSlices: string[] = [];
  const bodySlices: string[] = [];

  for (const stmt of sf.statements) {
    const text = rewritten.slice(stmt.getFullStart(), stmt.getEnd());
    if (ts.isImportDeclaration(stmt)) {
      // Skip type-only imports (`import type ...`)
      if (stmt.importClause?.isTypeOnly) {
        continue;
      }
      // Skip pure CSS imports (`import "./foo.css"`) because styles are compiled into __injectStylesheet
      if (ts.isStringLiteral(stmt.moduleSpecifier) && (stmt.moduleSpecifier.text.endsWith(".css") || stmt.moduleSpecifier.text.includes(".css?"))) {
        continue;
      }
      importSlices.push(text.trim());
    } else if (
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt)
    ) {
      // Erase pure TypeScript type declarations
      continue;
    } else {
      bodySlices.push(text);
    }
  }

  const rawImports = importSlices.join("\n");
  const rawBody = bodySlices.join("\n");

  if (!isTypeScript) {
    return {
      importsCode: rawImports,
      bodyCode: rawBody.trim()
    };
  }

  const transpiledImports = ts.transpileModule(rawImports, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: false
    }
  }).outputText.trim();

  const transpiledBody = ts.transpileModule(rawBody, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext
    }
  }).outputText.trim();

  return {
    importsCode: transpiledImports,
    bodyCode: transpiledBody
  };
}

function isESTreeNode(val: unknown): val is ESTreeNode {
  if (!val || typeof val !== "object" || Array.isArray(val)) return false;
  const rec = val as Record<string, unknown>;
  return (
    typeof rec.type === "string" &&
    typeof rec.start === "number" &&
    typeof rec.end === "number" &&
    !rec.type.startsWith("TS") ||
    rec.type === "TSAsExpression" ||
    rec.type === "TSTypeAssertion" ||
    rec.type === "TSNonNullExpression" ||
    rec.type === "TSSatisfiesExpression"
  );
}

/**
 * AST-based expression transformer for code generation (Guardrail D: zero regexes).
 * Rewrites referenced `{#each}` loop variables to their signal getter calls (e.g. `item` -> `__get_item()`)
 * and strips TypeScript type assertions (`as T`, `!`, `satisfies T`) using exact AST offsets.
 */
export function transformExpressionAstToJs(
  rawExpression: string,
  expressionAst: ESTreeNode,
  loopGetterMap: ReadonlyMap<string, string>
): string {
  const baseOffset = expressionAst.start ?? 0;

  function walkExpr(node: ESTreeNode, shadowed: ReadonlySet<string>): string {
    const relStart = (node.start ?? baseOffset) - baseOffset;
    const relEnd = (node.end ?? baseOffset + rawExpression.length) - baseOffset;

    if (
      node.type === "TSAsExpression" ||
      node.type === "TSTypeAssertion" ||
      node.type === "TSNonNullExpression" ||
      node.type === "TSSatisfiesExpression"
    ) {
      const inner = node.expression as ESTreeNode | undefined;
      if (inner) {
        return walkExpr(inner, shadowed);
      }
    }

    if (node.type === "Identifier") {
      const name = typeof node.name === "string" ? node.name : "";
      if (!shadowed.has(name) && loopGetterMap.has(name)) {
        return `${loopGetterMap.get(name)!}()`;
      }
      return rawExpression.slice(relStart, relEnd);
    }

    // Collect direct child AST nodes and their replacements
    const childReplacements: Array<{ start: number; end: number; text: string }> = [];
    let nextShadowed = shadowed;

    if (
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression"
    ) {
      const copy = new Set(shadowed);
      const params = Array.isArray(node.params) ? (node.params as ESTreeNode[]) : [];
      for (const p of params) {
        collectPatternIdentifiers(p, copy);
      }
      nextShadowed = copy;
    }

    for (const [key, val] of Object.entries(node)) {
      if (
        key === "type" ||
        key === "start" ||
        key === "end" ||
        key === "loc" ||
        key === "range" ||
        key === "typeAnnotation" ||
        key === "typeParameters" ||
        key === "returnType"
      ) {
        continue;
      }
      if (node.type === "MemberExpression" && key === "property" && node.computed === false) {
        continue;
      }
      if (
        (node.type === "Property" || node.type === "ObjectProperty") &&
        key === "key" &&
        node.computed === false &&
        node.shorthand !== true
      ) {
        continue;
      }

      if (Array.isArray(val)) {
        for (const item of val) {
          if (isESTreeNode(item)) {
            const cStart = (item.start ?? baseOffset) - baseOffset;
            const cEnd = (item.end ?? baseOffset) - baseOffset;
            const cText = walkExpr(item, nextShadowed);
            if (cText !== rawExpression.slice(cStart, cEnd)) {
              childReplacements.push({ start: cStart, end: cEnd, text: cText });
            }
          }
        }
      } else if (isESTreeNode(val)) {
        const cStart = (val.start ?? baseOffset) - baseOffset;
        const cEnd = (val.end ?? baseOffset) - baseOffset;
        let cText = walkExpr(val, nextShadowed);
        if (
          (node.type === "Property" || node.type === "ObjectProperty") &&
          key === "value" &&
          node.shorthand === true &&
          cText !== rawExpression.slice(cStart, cEnd)
        ) {
          const origKey = rawExpression.slice(cStart, cEnd);
          cText = `${origKey}: ${cText}`;
        }
        if (cText !== rawExpression.slice(cStart, cEnd)) {
          childReplacements.push({ start: cStart, end: cEnd, text: cText });
        }
      }
    }

    // Also strip parameter type annotations inside arrow/function expressions
    if (
      (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") &&
      Array.isArray(node.params)
    ) {
      for (const p of node.params as ESTreeNode[]) {
        const typeAnn = p.typeAnnotation as ESTreeNode | undefined;
        if (typeAnn && typeof typeAnn.start === "number" && typeof typeAnn.end === "number") {
          childReplacements.push({
            start: typeAnn.start - baseOffset,
            end: typeAnn.end - baseOffset,
            text: ""
          });
        }
      }
      const retType = node.returnType as ESTreeNode | undefined;
      if (retType && typeof retType.start === "number" && typeof retType.end === "number") {
        childReplacements.push({
          start: retType.start - baseOffset,
          end: retType.end - baseOffset,
          text: ""
        });
      }
    }

    childReplacements.sort((a, b) => b.start - a.start);
    let slice = rawExpression.slice(relStart, relEnd);
    for (const rep of childReplacements) {
      const localStart = rep.start - relStart;
      const localEnd = rep.end - relStart;
      if (localStart >= 0 && localEnd <= slice.length) {
        slice = slice.slice(0, localStart) + rep.text + slice.slice(localEnd);
      }
    }
    return slice;
  }

  return walkExpr(expressionAst, new Set());
}
