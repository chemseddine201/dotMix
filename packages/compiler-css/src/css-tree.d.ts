declare module "css-tree" {
  export interface CssLocationPoint {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
  }

  export interface CssLocation {
    readonly source?: string;
    readonly start: CssLocationPoint;
    readonly end: CssLocationPoint;
  }

  export interface CssPlainNode {
    type: string;
    loc?: CssLocation | null;
    name?: string | CssPlainNode;
    value?: string | CssPlainNode | null;
    prelude?: CssPlainNode | null;
    block?: CssPlainNode | null;
    matcher?: string | null;
    flags?: string | null;
    children?: CssPlainNode[] | null;
    [key: string]: unknown;
  }

  export interface ParseOptions {
    context?: string;
    positions?: boolean;
    filename?: string;
    parseValue?: boolean;
    parseRulePrelude?: boolean;
    parseAtrulePrelude?: boolean;
    parseCustomProperty?: boolean;
    onParseError?: (error: Error & { line?: number; column?: number; offset?: number }) => void;
  }

  export interface CssTokenTypes {
    readonly Ident: number;
    readonly Function: number;
    readonly Colon: number;
    readonly LeftParenthesis: number;
    readonly RightParenthesis: number;
    readonly WhiteSpace: number;
    readonly Comment: number;
    readonly EOF: number;
  }

  export interface CssSyntaxInstance {
    parse(source: string, options?: ParseOptions): unknown;
    toPlainObject(ast: unknown): CssPlainNode;
    fromPlainObject(plain: CssPlainNode): unknown;
    generate(ast: unknown): string;
  }

  export const tokenTypes: CssTokenTypes;
  export function fork(extension: (config: Record<string, unknown>) => Record<string, unknown>): CssSyntaxInstance;
  export function parse(source: string, options?: ParseOptions): unknown;
  export function toPlainObject(ast: unknown): CssPlainNode;
  export function fromPlainObject(plain: CssPlainNode): unknown;
  export function generate(ast: unknown): string;
}
