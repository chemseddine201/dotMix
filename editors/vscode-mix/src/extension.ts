/**
 * vscode-mix — dotMix Language Support Extension Host
 *
 * Connects VS Code to @dotmix/language-server for live diagnostics, hover tooltips,
 * IntelliSense autocompletions, and cross-file go-to-definition.
 */

import fs from "node:fs";
import type * as vscode from "vscode";
import {
  MixLanguageService,
  CompletionItemKind as LspCompletionKind,
  DiagnosticSeverity as LspDiagSeverity,
  type LspDiagnostic,
  type Hover as LspHover,
  type CompletionItem as LspCompletionItem,
  type Location as LspLocation,
} from "@dotmix/language-server";

/** Delay before diagnostics after a keystroke (debounced). */
const CHANGE_DIAGNOSTICS_DELAY_MS = 200;
/** Delay before diagnostics of a newly opened file, so navigation finishes first. */
const OPEN_DIAGNOSTICS_DELAY_MS = 150;

let _vscode: typeof vscode | undefined;

try {
  _vscode = await import("vscode");
} catch {
  _vscode = (globalThis as unknown as { __mock_vscode__?: typeof vscode }).__mock_vscode__;
}

export function vs(): typeof vscode {
  if (!_vscode) {
    _vscode = (globalThis as unknown as { __mock_vscode__?: typeof vscode }).__mock_vscode__;
  }
  if (!_vscode) {
    throw new Error("VS Code runtime environment not available");
  }
  return _vscode;
}

export function setVsCode(customVsCode: typeof vscode): void {
  _vscode = customVsCode;
}

const SUPPORTED_LANGUAGES = ["mix", "tix"] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function isSupportedLanguage(langId: string): langId is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(langId as SupportedLanguage);
}

function mapDiagnosticSeverity(severity: number): vscode.DiagnosticSeverity {
  const v = vs();
  switch (severity) {
    case LspDiagSeverity.Error:
      return v.DiagnosticSeverity.Error;
    case LspDiagSeverity.Warning:
      return v.DiagnosticSeverity.Warning;
    case LspDiagSeverity.Information:
      return v.DiagnosticSeverity.Information;
    case LspDiagSeverity.Hint:
      return v.DiagnosticSeverity.Hint;
    default:
      return v.DiagnosticSeverity.Error;
  }
}

function mapCompletionKind(kind?: number): vscode.CompletionItemKind {
  const v = vs();
  switch (kind) {
    case LspCompletionKind.Method:
      return v.CompletionItemKind.Method;
    case LspCompletionKind.Function:
      return v.CompletionItemKind.Function;
    case LspCompletionKind.Constructor:
      return v.CompletionItemKind.Constructor;
    case LspCompletionKind.Field:
      return v.CompletionItemKind.Field;
    case LspCompletionKind.Variable:
      return v.CompletionItemKind.Variable;
    case LspCompletionKind.Class:
      return v.CompletionItemKind.Class;
    case LspCompletionKind.Interface:
      return v.CompletionItemKind.Interface;
    case LspCompletionKind.Module:
      return v.CompletionItemKind.Module;
    case LspCompletionKind.Property:
      return v.CompletionItemKind.Property;
    case LspCompletionKind.Keyword:
      return v.CompletionItemKind.Keyword;
    case LspCompletionKind.Snippet:
      return v.CompletionItemKind.Snippet;
    default:
      return v.CompletionItemKind.Text;
  }
}

export class DotMixExtensionController {
  private service: MixLanguageService;
  private diagnosticCollection: vscode.DiagnosticCollection;
  private outputChannel: vscode.OutputChannel;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    const v = vs();
    this.service = new MixLanguageService();
    this.diagnosticCollection = v.languages.createDiagnosticCollection("dotmix");
    this.outputChannel = v.window.createOutputChannel("dotMix");
  }

  public getService(): MixLanguageService {
    return this.service;
  }

  public getDiagnosticCollection(): vscode.DiagnosticCollection {
    return this.diagnosticCollection;
  }

  public getOutputChannel(): vscode.OutputChannel {
    return this.outputChannel;
  }

  public log(message: string): void {
    const time = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${time}] ${message}`);
  }

  public async activate(context: vscode.ExtensionContext): Promise<void> {
    const v = vs();
    this.log("Activating dotMix Language Support (Mix & Tix)...");

    // 1. Register diagnostics collection
    context.subscriptions.push(this.diagnosticCollection);
    context.subscriptions.push(this.outputChannel);

    // 2. Index workspace files in the background, so go-to-definition and the other
    //    providers registered below are available immediately.
    void this.indexWorkspace();

    // 3. Register document synchronization and live diagnostic listeners
    context.subscriptions.push(
      v.workspace.onDidChangeTextDocument((e) => this.onDocumentChange(e.document)),
      v.workspace.onDidOpenTextDocument((doc) => this.onDocumentOpen(doc)),
      v.workspace.onDidSaveTextDocument((doc) => this.onDocumentSave(doc)),
      v.workspace.onDidCloseTextDocument((doc) => this.onDocumentClose(doc)),
      v.workspace.onDidCreateFiles((e) => this.onFilesCreated(e.files)),
      v.workspace.onDidDeleteFiles((e) => this.onFilesDeleted(e.files))
    );

    // 4. Register Hover Provider
    context.subscriptions.push(
      v.languages.registerHoverProvider(
        ["mix", "tix"],
        {
          provideHover: (document, position) => this.provideHover(document, position),
        }
      )
    );

    // 5. Register Completion Provider
    context.subscriptions.push(
      v.languages.registerCompletionItemProvider(
        ["mix", "tix"],
        {
          provideCompletionItems: (document, position) =>
            this.provideCompletionItems(document, position),
        },
        ".", "<", "{", ":", "\"", "'", "/", " "
      )
    );

    // 6. Register Go-To-Definition Provider
    context.subscriptions.push(
      v.languages.registerDefinitionProvider(
        ["mix", "tix"],
        {
          provideDefinition: (document, position) =>
            this.provideDefinition(document, position),
        }
      )
    );

    // 7. Register Commands
    context.subscriptions.push(
      v.commands.registerCommand("mix.restartServer", async () => {
        await this.indexWorkspace();
        for (const editor of v.window.visibleTextEditors) {
          if (isSupportedLanguage(editor.document.languageId)) {
            this.updateDiagnostics(editor.document);
          }
        }
        await v.window.showInformationMessage("dotMix: Language server restarted and workspace re-indexed.");
      }),
      v.commands.registerCommand("mix.checkWorkspace", async () => {
        const summary = await this.checkEntireWorkspace();
        await v.window.showInformationMessage(
          `dotMix: Checked ${summary.files} files. Found ${summary.errors} errors, ${summary.warnings} warnings.`
        );
      }),
      v.commands.registerCommand("mix.showOutput", () => {
        this.outputChannel.show();
      })
    );

    // 8. Run initial diagnostics on all open editors
    for (const editor of v.window.visibleTextEditors) {
      this.scheduleDiagnostics(editor.document, OPEN_DIAGNOSTICS_DELAY_MS);
    }

    this.log("dotMix Language Support ready.");
  }

  public deactivate(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.diagnosticCollection.clear();
    this.log("dotMix Language Support deactivated.");
  }

  public async indexWorkspace(): Promise<number> {
    const v = vs();
    try {
      const files = await v.workspace.findFiles(
        "**/*.{mix,tix,css,scss,less,pcss}",
        "{**/node_modules/**,**/dist/**,**/.git/**,**/public/**}"
      );
      let count = 0;
      for (const uri of files) {
        try {
          const content = await fs.promises.readFile(uri.fsPath, "utf8");
          this.service.setWorkspaceFile(uri.toString(), content);
          count++;
        } catch {
          // Skip unreadable files
        }
      }
      this.log(`Indexed ${count} workspace files for cross-file intelligence.`);
      return count;
    } catch {
      return 0;
    }
  }

  public updateDiagnostics(document: vscode.TextDocument): void {
    if (!isSupportedLanguage(document.languageId)) return;
    const v = vs();

    const config = v.workspace.getConfiguration("mix");
    const enabled = config.get<boolean>("diagnostics.enable", true);
    if (!enabled) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const uriStr = document.uri.toString();
    const text = document.getText();
    this.service.setWorkspaceFile(uriStr, text);

    const lspDiagnostics: LspDiagnostic[] = this.service.getDiagnostics(uriStr, text);
    const vsDiagnostics: vscode.Diagnostic[] = lspDiagnostics.map((d) => {
      const range = new v.Range(
        d.range.start.line,
        d.range.start.character,
        d.range.end.line,
        d.range.end.character
      );
      const vsDiag = new v.Diagnostic(range, d.message, mapDiagnosticSeverity(d.severity));
      vsDiag.source = "dotMix";
      if (d.code) vsDiag.code = d.code;
      return vsDiag;
    });

    this.diagnosticCollection.set(document.uri, vsDiagnostics);
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | null {
    if (!isSupportedLanguage(document.languageId)) return null;
    const v = vs();

    const config = v.workspace.getConfiguration("mix");
    if (!config.get<boolean>("hover.enable", true)) return null;

    const uriStr = document.uri.toString();
    const text = document.getText();
    const lspHover: LspHover | null = this.service.doHover(uriStr, text, {
      line: position.line,
      character: position.character,
    });

    if (!lspHover) return null;

    const md = new v.MarkdownString(lspHover.contents.value);
    md.isTrusted = true;
    const range = lspHover.range
      ? new v.Range(
          lspHover.range.start.line,
          lspHover.range.start.character,
          lspHover.range.end.line,
          lspHover.range.end.character
        )
      : undefined;

    return new v.Hover(md, range);
  }

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    if (!isSupportedLanguage(document.languageId)) return [];
    const v = vs();

    const config = v.workspace.getConfiguration("mix");
    if (!config.get<boolean>("completions.enable", true)) return [];

    const uriStr = document.uri.toString();
    const text = document.getText();
    const lspItems: LspCompletionItem[] = this.service.doComplete(uriStr, text, {
      line: position.line,
      character: position.character,
    });

    return lspItems.map((item) => {
      const vsItem = new v.CompletionItem(item.label, mapCompletionKind(item.kind));
      if (item.detail) vsItem.detail = item.detail;
      if (item.documentation) {
        vsItem.documentation = new v.MarkdownString(item.documentation);
      }
      if (item.insertText) {
        if (item.insertText.includes("$")) {
          vsItem.insertText = new v.SnippetString(item.insertText);
        } else {
          vsItem.insertText = item.insertText;
        }
      }
      return vsItem;
    });
  }

  public provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location | null {
    if (!isSupportedLanguage(document.languageId)) return null;
    const v = vs();

    const uriStr = document.uri.toString();
    const text = document.getText();
    const loc: LspLocation | null = this.service.doDefinition(uriStr, text, {
      line: position.line,
      character: position.character,
    });

    if (!loc) return null;

    const targetUri = v.Uri.parse(loc.uri);
    const targetRange = new v.Range(
      loc.range.start.line,
      loc.range.start.character,
      loc.range.end.line,
      loc.range.end.character
    );

    return new v.Location(targetUri, targetRange);
  }

  public async checkEntireWorkspace(): Promise<{ files: number; errors: number; warnings: number }> {
    const v = vs();
    const files = await v.workspace.findFiles("**/*.{mix,tix}");
    let errors = 0;
    let warnings = 0;

    for (const uri of files) {
      try {
        const doc = await v.workspace.openTextDocument(uri);
        this.updateDiagnostics(doc);
        const diags = this.diagnosticCollection.get(uri) || [];
        for (const d of diags) {
          if (d.severity === v.DiagnosticSeverity.Error) errors++;
          else if (d.severity === v.DiagnosticSeverity.Warning) warnings++;
        }
      } catch {
        // Skip unopenable documents
      }
    }

    return { files: files.length, errors, warnings };
  }

  /**
   * Diagnostics run the type checker synchronously, so they are always deferred: opening a file
   * with Ctrl+click (or typing) must not wait for them.
   */
  private scheduleDiagnostics(document: vscode.TextDocument, delayMs: number): void {
    if (!isSupportedLanguage(document.languageId)) return;

    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.updateDiagnostics(document);
    }, delayMs);

    this.debounceTimers.set(key, timer);
  }

  private onDocumentChange(document: vscode.TextDocument): void {
    this.scheduleDiagnostics(document, CHANGE_DIAGNOSTICS_DELAY_MS);
  }

  private onDocumentOpen(document: vscode.TextDocument): void {
    this.scheduleDiagnostics(document, OPEN_DIAGNOSTICS_DELAY_MS);
  }

  private onDocumentSave(document: vscode.TextDocument): void {
    this.scheduleDiagnostics(document, 0);
  }

  private onDocumentClose(document: vscode.TextDocument): void {
    if (isSupportedLanguage(document.languageId)) {
      const key = document.uri.toString();
      const existing = this.debounceTimers.get(key);
      if (existing) {
        clearTimeout(existing);
        this.debounceTimers.delete(key);
      }
      this.diagnosticCollection.delete(document.uri);
    }
  }

  private onFilesCreated(files: readonly vscode.Uri[]): void {
    const v = vs();
    for (const uri of files) {
      const uriStr = uri.toString();
      if (/\.(mix|tix|css|scss|less|pcss)$/.test(uriStr)) {
        v.workspace.openTextDocument(uri).then((doc) => {
          this.service.setWorkspaceFile(uriStr, doc.getText());
        });
      }
    }
  }

  private onFilesDeleted(files: readonly vscode.Uri[]): void {
    for (const uri of files) {
      const uriStr = uri.toString();
      this.service.removeWorkspaceFile(uriStr);
      this.diagnosticCollection.delete(uri);
    }
  }
}

let activeController: DotMixExtensionController | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<DotMixExtensionController> {
  activeController = new DotMixExtensionController();
  await activeController.activate(context);
  return activeController;
}

export function deactivate(): void {
  if (activeController) {
    activeController.deactivate();
    activeController = null;
  }
}
