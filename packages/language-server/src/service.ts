/**
 * @mix/language-server — Language Service Implementation
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "@mix/compiler-frontend";
import { analyze, typecheckTix } from "@mix/compiler-semantic";
import type {
  SourceSpan,
  TemplateNode,
  EachBlockNode,
  IfBlockNode,
  AwaitBlockNode,
} from "@mix/ast";
import type { Diagnostic } from "@mix/diagnostics";
import {
  type Position,
  type Range,
  type LspDiagnostic,
  type Hover,
  type CompletionItem,
  type Location,
  DiagnosticSeverity,
  CompletionItemKind,
} from "./types.js";

export function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

export function positionToOffset(text: string, position: Position): number {
  let line = 0;
  let character = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === position.line && character === position.character) {
      return i;
    }
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return text.length;
}

export function spanToRange(span: SourceSpan): Range {
  return {
    start: {
      line: Math.max(0, span.start.line - 1),
      character: Math.max(0, span.start.column - 1),
    },
    end: {
      line: Math.max(0, span.end.line - 1),
      character: Math.max(0, span.end.column - 1),
    },
  };
}

function getWordAtOffset(text: string, offset: number): { word: string; start: number; end: number } | null {
  if (offset < 0 || offset > text.length) return null;
  let start = offset;
  while (start > 0 && /[a-zA-Z0-9_$]/.test(text[start - 1]!)) {
    start--;
  }
  let end = offset;
  while (end < text.length && /[a-zA-Z0-9_$]/.test(text[end]!)) {
    end++;
  }
  if (start === end) return null;
  return {
    word: text.slice(start, end),
    start,
    end,
  };
}

export function resolveRelativeUri(baseUri: string, relativePath: string): string {
  const normBase = baseUri.replace(/\\/g, "/");
  const normRel = relativePath.replace(/\\/g, "/");

  const lastSlash = normBase.lastIndexOf("/");
  const baseDir = lastSlash >= 0 ? normBase.slice(0, lastSlash + 1) : "";

  const combined = baseDir + normRel;
  const isFileUri = combined.startsWith("file:///");
  const isSlash = combined.startsWith("/");

  const clean = isFileUri
    ? combined.slice(8)
    : isSlash
    ? combined.slice(1)
    : combined;

  const segments = clean.split("/");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  if (isFileUri) {
    return "file:///" + resolved.join("/");
  }
  if (isSlash) {
    return "/" + resolved.join("/");
  }
  return resolved.join("/");
}

export function extractCssClasses(cssText: string): string[] {
  const classes = new Set<string>();
  const regex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cssText)) !== null) {
    if (match[1]) {
      classes.add(match[1]);
    }
  }
  return Array.from(classes);
}

function findEnclosingTemplateNodes(nodes: readonly TemplateNode[], offset: number): TemplateNode[] {
  const result: TemplateNode[] = [];
  for (const node of nodes) {
    if (node.span && offset >= node.span.start.offset && offset <= node.span.end.offset) {
      result.push(node);
      if ("children" in node && Array.isArray((node as unknown as { children?: unknown }).children)) {
        result.push(
          ...findEnclosingTemplateNodes(
            (node as unknown as { children: readonly TemplateNode[] }).children,
            offset
          )
        );
      }
      if (node.type === "IfBlock") {
        const ifBlock = node as IfBlockNode;
        result.push(...findEnclosingTemplateNodes(ifBlock.consequent, offset));
        let alt = ifBlock.alternate;
        while (alt) {
          if (Array.isArray(alt)) {
            result.push(...findEnclosingTemplateNodes(alt, offset));
            break;
          } else if (alt && "type" in alt && alt.type === "IfBlock") {
            const altIf = alt as IfBlockNode;
            if (altIf.span && offset >= altIf.span.start.offset && offset <= altIf.span.end.offset) {
              result.push(altIf);
              result.push(...findEnclosingTemplateNodes(altIf.consequent, offset));
            }
            alt = altIf.alternate;
          } else {
            break;
          }
        }
      }
      if (node.type === "AwaitBlock") {
        const awaitNode = node as AwaitBlockNode;
        result.push(...findEnclosingTemplateNodes(awaitNode.pending, offset));
        result.push(...findEnclosingTemplateNodes(awaitNode.thenBranch, offset));
        result.push(...findEnclosingTemplateNodes(awaitNode.catchBranch, offset));
      }
    }
  }
  return result;
}

export class MixLanguageService {
  private workspaceFiles = new Map<string, string>();

  public setWorkspaceFile(uri: string, content: string): void {
    this.workspaceFiles.set(this.normalizeUri(uri), content);
  }

  public setWorkspaceFiles(files: Record<string, string> | Map<string, string>): void {
    if (files instanceof Map) {
      for (const [uri, content] of files) {
        this.setWorkspaceFile(uri, content);
      }
    } else {
      for (const [uri, content] of Object.entries(files)) {
        this.setWorkspaceFile(uri, content);
      }
    }
  }

  public removeWorkspaceFile(uri: string): void {
    this.workspaceFiles.delete(this.normalizeUri(uri));
  }

  public getWorkspaceFiles(): ReadonlyMap<string, string> {
    return this.workspaceFiles;
  }

  private normalizeUri(uri: string): string {
    return uri.replace(/\\/g, "/");
  }

  public getFileContent(uri: string): string | null {
    const norm = this.normalizeUri(uri);
    if (this.workspaceFiles.has(norm)) {
      return this.workspaceFiles.get(norm)!;
    }
    const pathOnly = norm.replace(/^file:\/\/\/?/, "");
    if (this.workspaceFiles.has(pathOnly)) {
      return this.workspaceFiles.get(pathOnly)!;
    }
    try {
      const fsPath = norm.startsWith("file://") ? fileURLToPath(norm) : norm;
      if (fs.existsSync(fsPath)) {
        return fs.readFileSync(fsPath, "utf-8");
      }
    } catch {
      // Ignore if not a valid fs path
    }
    return null;
  }

  public getDiagnostics(uri: string, text: string): LspDiagnostic[] {
    const filename = uri.replace(/^file:\/\//, "");
    const results: LspDiagnostic[] = [];

    try {
      const ast = parse(text, { filename });
      const desc = analyze(ast, { filename, source: text, throwOnError: false });

      for (const diag of desc.diagnostics) {
        results.push(this.toLspDiagnostic(diag));
      }

      if (filename.endsWith(".tix")) {
        const typecheckResult = typecheckTix(desc, text, { filename, throwOnError: false });
        for (const diag of typecheckResult.diagnostics) {
          results.push(this.toLspDiagnostic(diag));
        }
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && "span" in err && "message" in err) {
        const d = err as Diagnostic;
        results.push(this.toLspDiagnostic(d));
      } else {
        results.push({
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: String(err),
          severity: DiagnosticSeverity.Error,
          source: "mix",
        });
      }
    }

    return results;
  }

  public doHover(uri: string, text: string, position: Position): Hover | null {
    const filename = uri.replace(/^file:\/\//, "");
    const offset = positionToOffset(text, position);
    const wordInfo = getWordAtOffset(text, offset);
    if (!wordInfo) return null;

    try {
      const ast = parse(text, { filename });
      const desc = analyze(ast, { filename, source: text, throwOnError: false });

      const binding = desc.rootScope.bindings.get(wordInfo.word);
      if (binding) {
        const range: Range = {
          start: offsetToPosition(text, wordInfo.start),
          end: offsetToPosition(text, wordInfo.end),
        };
        const md = [
          `**${binding.name}** (${binding.kind})`,
          "",
          `Mix reactive binding declared as \`${binding.kind}\`.`,
        ].join("\n");

        return {
          contents: { kind: "markdown", value: md },
          range,
        };
      }
    } catch {
      // Syntax errors during editing - return null
    }

    return null;
  }

  public doComplete(uri: string, text: string, position: Position): CompletionItem[] {
    const filename = uri.replace(/^file:\/\//, "");
    const offset = positionToOffset(text, position);
    const items: CompletionItem[] = [];
    const seenLabels = new Set<string>();

    function addItem(item: CompletionItem): void {
      if (!seenLabels.has(item.label)) {
        seenLabels.add(item.label);
        items.push(item);
      }
    }

    try {
      const ast = parse(text, { filename });
      const desc = analyze(ast, { filename, source: text, throwOnError: false });

      // 1. Suggest variables in root scope
      for (const [name, binding] of desc.rootScope.bindings) {
        addItem({
          label: name,
          kind:
            binding.kind === "function"
              ? CompletionItemKind.Function
              : binding.kind === "prop"
              ? CompletionItemKind.Property
              : CompletionItemKind.Variable,
          detail: `(${binding.kind}) ${name}`,
          documentation: `Mix ${binding.kind} binding in scope`,
        });
      }

      // 2. Suggest nested block-scoped variables ({#each}, {#await})
      const enclosing = findEnclosingTemplateNodes(ast.template, offset);
      for (const node of enclosing) {
        if (node.type === "EachBlock") {
          const each = node as EachBlockNode;
          addItem({
            label: each.itemIdentifier,
            kind: CompletionItemKind.Variable,
            detail: `(loop item) ${each.itemIdentifier}`,
            documentation: `Item identifier in {#each} iteration block`,
          });
          if (each.indexIdentifier) {
            addItem({
              label: each.indexIdentifier,
              kind: CompletionItemKind.Variable,
              detail: `(loop index) ${each.indexIdentifier}`,
              documentation: `Index identifier in {#each} iteration block`,
            });
          }
        } else if (node.type === "AwaitBlock") {
          const awaitNode = node as AwaitBlockNode;
          if (awaitNode.thenIdentifier) {
            addItem({
              label: awaitNode.thenIdentifier,
              kind: CompletionItemKind.Variable,
              detail: `(resolved data) ${awaitNode.thenIdentifier}`,
              documentation: `Resolved promise data in {#await} block`,
            });
          }
          if (awaitNode.catchIdentifier) {
            addItem({
              label: awaitNode.catchIdentifier,
              kind: CompletionItemKind.Variable,
              detail: `(error) ${awaitNode.catchIdentifier}`,
              documentation: `Rejected promise error in {#await} block`,
            });
          }
        }
      }

      // 3. Suggest CSS classes from embedded <style>, linked <style src="...">, and import "./foo.css"
      const cssSources: string[] = [];
      if (ast.style && ast.style.content) {
        cssSources.push(ast.style.content);
      }
      if (ast.style && ast.style.src) {
        const cssUri = resolveRelativeUri(uri, ast.style.src);
        const content = this.getFileContent(cssUri);
        if (content) cssSources.push(content);
      }
      if (desc.cssImports) {
        for (const cssImp of desc.cssImports) {
          const cssUri = resolveRelativeUri(uri, cssImp);
          const content = this.getFileContent(cssUri);
          if (content) cssSources.push(content);
        }
      }

      for (const cssText of cssSources) {
        const classes = extractCssClasses(cssText);
        for (const cls of classes) {
          addItem({
            label: cls,
            kind: CompletionItemKind.Property,
            detail: `(css class) .${cls}`,
            documentation: `CSS class selector available in this component`,
          });
        }
      }
    } catch {
      // If syntax is currently broken while typing, still offer framework keywords
    }

    // Add framework template keywords and directives
    const keywords = [
      { label: "if", insertText: "if ${1:condition}} $0 {endif", detail: "{if ...} conditional block" },
      { label: "elseif", insertText: "elseif ${1:condition}}", detail: "{elseif ...} branch" },
      { label: "else", insertText: "else}", detail: "{else} branch" },
      { label: "each", insertText: "each (${1:item}, ${2:idx}) in ${3:list}} $0 {endeach", detail: "{each ...} loop" },
      { label: "await", insertText: "await ${1:promise}} {then ${2:res}} $0 {endawait", detail: "{await ...} async block" },
      { label: "bind:value", insertText: "bind:value={${1:value}}", detail: "Two-way input value binding" },
      { label: "bind:checked", insertText: "bind:checked={${1:checked}}", detail: "Two-way checkbox binding" },
    ];

    for (const kw of keywords) {
      addItem({
        label: kw.label,
        kind: CompletionItemKind.Keyword,
        detail: kw.detail,
        insertText: kw.insertText,
      });
    }

    return items;
  }

  public doDefinition(uri: string, text: string, position: Position): Location | null {
    const filename = uri.replace(/^file:\/\//, "");
    const offset = positionToOffset(text, position);
    const wordInfo = getWordAtOffset(text, offset);
    if (!wordInfo) return null;

    try {
      const ast = parse(text, { filename });
      const desc = analyze(ast, { filename, source: text, throwOnError: false });

      // 1. Check if word is an imported component or module in <script>
      const importSource = desc.imports.get(wordInfo.word);
      if (importSource && (importSource.startsWith("./") || importSource.startsWith("../"))) {
        const targetUri = resolveRelativeUri(uri, importSource);
        return {
          uri: targetUri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        };
      }

      // 2. Check bindings declared in current component
      const binding = desc.rootScope.bindings.get(wordInfo.word);
      if (binding) {
        if (binding.importSource && (binding.importSource.startsWith("./") || binding.importSource.startsWith("../"))) {
          const targetUri = resolveRelativeUri(uri, binding.importSource);
          return {
            uri: targetUri,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          };
        }
        if (binding.span) {
          return {
            uri,
            range: spanToRange(binding.span),
          };
        }
      }
    } catch {
      // Ignore parse errors while typing
    }

    return null;
  }

  private toLspDiagnostic(diag: Diagnostic): LspDiagnostic {
    return {
      range: spanToRange(diag.span),
      message: diag.message,
      severity:
        diag.severity === "error"
          ? DiagnosticSeverity.Error
          : diag.severity === "warning"
          ? DiagnosticSeverity.Warning
          : DiagnosticSeverity.Information,
      code: typeof diag.code === "string" ? diag.code : undefined,
      source: "mix",
    };
  }
}
