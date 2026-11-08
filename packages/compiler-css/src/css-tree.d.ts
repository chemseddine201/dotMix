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
    onParseError?: (error: Error & { line?: number; column?: number; offset?: number }) => void;
  }

  export function parse(source: string, options?: ParseOptions): unknown;
  export function toPlainObject(ast: unknown): CssPlainNode;
  export function fromPlainObject(plain: CssPlainNode): unknown;
  export function generate(ast: unknown): string;
}
