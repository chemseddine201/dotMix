/**
 * @mix/language-server — Language Service Implementation
 */

import { parse } from "@mix/compiler-frontend";
import { analyze, typecheckTix } from "@mix/compiler-semantic";
import type { Diagnostic } from "@mix/diagnostics";
import {
  type Position,
  type LspDiagnostic,
  type Hover,
  type CompletionItem,
  type Location,
  DiagnosticSeverity,
} from "./types.js";
import {
  offsetToPosition,
  positionToOffset,
  spanToRange,
  resolveRelativeUri,
  normalizeUri,
  readWorkspaceFileContent,
} from "./indexer.js";
import { extractCssClasses } from "./css-extractor.js";
import { resolveHover, resolveCompletions } from "./completions.js";
import { resolveDefinition } from "./navigation.js";

export {
  offsetToPosition,
  positionToOffset,
  spanToRange,
  resolveRelativeUri,
  extractCssClasses,
};

export class MixLanguageService {
  private workspaceFiles = new Map<string, string>();

  public setWorkspaceFile(uri: string, content: string): void {
    this.workspaceFiles.set(normalizeUri(uri), content);
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
    this.workspaceFiles.delete(normalizeUri(uri));
  }

  public getWorkspaceFiles(): ReadonlyMap<string, string> {
    return this.workspaceFiles;
  }

  public getFileContent(uri: string): string | null {
    return readWorkspaceFileContent(this.workspaceFiles, uri);
  }

  public getDiagnostics(uri: string, text: string): LspDiagnostic[] {
    const filename = uri.replace(/^file:\/\//, "");
    const results: LspDiagnostic[] = [];

    try {
      const ast = parse(text, { filename });
      const desc = analyze(ast, {
        filename,
        source: text,
        throwOnError: false,
        warnLegacyControlFlow: true,
      });

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
    return resolveHover(uri, text, position);
  }

  public doComplete(uri: string, text: string, position: Position): CompletionItem[] {
    return resolveCompletions(uri, text, position, (targetUri) =>
      this.getFileContent(targetUri)
    );
  }

  public doDefinition(uri: string, text: string, position: Position): Location | null {
    return resolveDefinition(uri, text, position);
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
