/**
 * @mix/language-server — LSP Types and Protocols
 */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export type DiagnosticSeverityType =
  (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

export interface LspDiagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverityType;
  code?: string | undefined;
  source?: string | undefined;
}

export interface Hover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: Range | undefined;
}

export const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Keyword: 14,
  Snippet: 15,
} as const;

export type CompletionItemKindType =
  (typeof CompletionItemKind)[keyof typeof CompletionItemKind];

export interface CompletionItem {
  label: string;
  kind?: CompletionItemKindType | undefined;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

export interface Location {
  uri: string;
  range: Range;
}

