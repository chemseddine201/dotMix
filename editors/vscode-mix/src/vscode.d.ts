/**
 * Minimal VS Code API type declarations for compiling editors/vscode-mix.
 * Matches standard VS Code Extension API without external runtime dependencies.
 */

declare module "vscode" {
  export interface Disposable {
    dispose(): void;
  }

  export class Uri {
    static file(path: string): Uri;
    static parse(value: string, strict?: boolean): Uri;
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly query: string;
    readonly fragment: string;
    readonly fsPath: string;
    toString(skipEncoding?: boolean): string;
  }

  export class Position {
    constructor(line: number, character: number);
    readonly line: number;
    readonly character: number;
    isBefore(other: Position): boolean;
    isAfter(other: Position): boolean;
    isEqual(other: Position): boolean;
    translate(lineDelta?: number, characterDelta?: number): Position;
  }

  export class Range {
    constructor(start: Position, end: Position);
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    readonly start: Position;
    readonly end: Position;
    readonly isEmpty: boolean;
    readonly isSingleLine: boolean;
  }

  export class Location {
    constructor(uri: Uri, rangeOrPosition: Range | Position);
    readonly uri: Uri;
    readonly range: Range;
  }

  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
  }

  export class Diagnostic {
    constructor(range: Range, message: string, severity?: DiagnosticSeverity);
    range: Range;
    message: string;
    severity: DiagnosticSeverity;
    source?: string;
    code?: string | number | { value: string | number; target: Uri };
  }

  export interface DiagnosticCollection extends Disposable {
    readonly name: string;
    set(uri: Uri, diagnostics: readonly Diagnostic[] | undefined): void;
    delete(uri: Uri): void;
    clear(): void;
    forEach(callback: (uri: Uri, diagnostics: readonly Diagnostic[], collection: DiagnosticCollection) => void): void;
    get(uri: Uri): readonly Diagnostic[] | undefined;
    has(uri: Uri): boolean;
  }

  export class MarkdownString {
    constructor(value?: string, supportThemeIcons?: boolean);
    value: string;
    isTrusted?: boolean;
    supportHtml?: boolean;
    appendMarkdown(value: string): MarkdownString;
    appendCodeblock(value: string, language?: string): MarkdownString;
  }

  export class Hover {
    constructor(contents: MarkdownString | string | Array<MarkdownString | string>, range?: Range);
    contents: Array<MarkdownString | string>;
    range?: Range;
  }

  export interface HoverProvider {
    provideHover(
      document: TextDocument,
      position: Position,
      token: CancellationToken
    ): Hover | null | undefined | Promise<Hover | null | undefined>;
  }

  export enum CompletionItemKind {
    Text = 0,
    Method = 1,
    Function = 2,
    Constructor = 3,
    Field = 4,
    Variable = 5,
    Class = 6,
    Interface = 7,
    Module = 8,
    Property = 9,
    Unit = 10,
    Value = 11,
    Enum = 12,
    Keyword = 13,
    Snippet = 14,
    Color = 15,
    File = 16,
    Reference = 17,
    Folder = 18,
    EnumMember = 19,
    Constant = 20,
    Struct = 21,
    Event = 22,
    Operator = 23,
    TypeParameter = 24,
  }

  export class SnippetString {
    constructor(value?: string);
    value: string;
    appendText(string: string): SnippetString;
    appendTabstop(number?: number): SnippetString;
    appendPlaceholder(value: string | ((snippet: SnippetString) => void), number?: number): SnippetString;
  }

  export class CompletionItem {
    constructor(label: string, kind?: CompletionItemKind);
    label: string;
    kind?: CompletionItemKind;
    detail?: string;
    documentation?: string | MarkdownString;
    insertText?: string | SnippetString;
    range?: Range;
    sortText?: string;
    filterText?: string;
  }

  export interface CompletionItemProvider {
    provideCompletionItems(
      document: TextDocument,
      position: Position,
      token: CancellationToken,
      context: unknown
    ): CompletionItem[] | Promise<CompletionItem[]>;
  }

  export interface DefinitionProvider {
    provideDefinition(
      document: TextDocument,
      position: Position,
      token: CancellationToken
    ): Location | Location[] | null | undefined | Promise<Location | Location[] | null | undefined>;
  }

  export interface TextDocument {
    readonly uri: Uri;
    readonly fileName: string;
    readonly isUntitled: boolean;
    readonly languageId: string;
    readonly version: number;
    readonly isDirty: boolean;
    readonly lineCount: number;
    getText(range?: Range): string;
    positionAt(offset: number): Position;
    offsetAt(position: Position): number;
  }

  export interface TextEditor {
    readonly document: TextDocument;
  }

  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: (e: unknown) => void): Disposable;
  }

  export interface OutputChannel extends Disposable {
    readonly name: string;
    append(value: string): void;
    appendLine(value: string): void;
    clear(): void;
    show(preserveFocus?: boolean): void;
    hide(): void;
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string, defaultValue?: T): T;
    has(section: string): boolean;
    update(section: string, value: unknown, configurationTarget?: unknown): Promise<void>;
  }

  export interface ExtensionContext {
    readonly subscriptions: Disposable[];
    readonly extensionPath: string;
    readonly storagePath?: string;
    readonly globalStoragePath: string;
  }

  export namespace languages {
    export function createDiagnosticCollection(name?: string): DiagnosticCollection;
    export function registerHoverProvider(
      selector: string | string[] | { language: string; scheme?: string },
      provider: HoverProvider
    ): Disposable;
    export function registerCompletionItemProvider(
      selector: string | string[] | { language: string; scheme?: string },
      provider: CompletionItemProvider,
      ...triggerCharacters: string[]
    ): Disposable;
    export function registerDefinitionProvider(
      selector: string | string[] | { language: string; scheme?: string },
      provider: DefinitionProvider
    ): Disposable;
  }

  export namespace workspace {
    export const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    export function getConfiguration(section?: string, scope?: unknown): WorkspaceConfiguration;
    export function findFiles(
      include: string,
      exclude?: string | null,
      maxResults?: number,
      token?: CancellationToken
    ): Promise<Uri[]>;
    export function openTextDocument(uri: Uri): Promise<TextDocument>;
    export function onDidChangeTextDocument(
      listener: (e: { document: TextDocument; contentChanges: readonly unknown[] }) => void
    ): Disposable;
    export function onDidOpenTextDocument(listener: (e: TextDocument) => void): Disposable;
    export function onDidCloseTextDocument(listener: (e: TextDocument) => void): Disposable;
    export function onDidSaveTextDocument(listener: (e: TextDocument) => void): Disposable;
    export function onDidCreateFiles(listener: (e: { files: readonly Uri[] }) => void): Disposable;
    export function onDidDeleteFiles(listener: (e: { files: readonly Uri[] }) => void): Disposable;
    export function onDidRenameFiles(listener: (e: { files: readonly { oldUri: Uri; newUri: Uri }[] }) => void): Disposable;
  }

  export namespace window {
    export const visibleTextEditors: readonly TextEditor[];
    export const activeTextEditor: TextEditor | undefined;
    export function createOutputChannel(name: string): OutputChannel;
    export function showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
    export function showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
    export function showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
  }

  export namespace commands {
    export function registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
    export function executeCommand<T>(command: string, ...rest: unknown[]): Promise<T>;
  }
}
