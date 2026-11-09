/**
 * @mix/language-server — Language Service Implementation
 */

import { parse } from "@mix/compiler-frontend";
import { analyze, typecheckTix } from "@mix/compiler-semantic";
import type { SourceSpan } from "@mix/ast";
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

export class MixLanguageService {
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
    const _offset = positionToOffset(text, position);
    const items: CompletionItem[] = [];

    try {
      const ast = parse(text, { filename });
      const desc = analyze(ast, { filename, source: text, throwOnError: false });

      // Suggest variables in scope
      for (const [name, binding] of desc.rootScope.bindings) {
        items.push({
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
      items.push({
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

      const binding = desc.rootScope.bindings.get(wordInfo.word);
      if (binding && binding.span) {
        return {
          uri,
          range: spanToRange(binding.span),
        };
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
