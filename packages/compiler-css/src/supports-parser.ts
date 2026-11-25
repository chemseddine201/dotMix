/**
 * @dotmix/compiler-css/supports-parser — Full CSS Conditional Rules `<supports-condition>`
 * parser extension for `css-tree` (D-190 B2).
 *
 * Accepts nested and outer parentheses, `not`/`and`/`or`, `selector()`, `font-tech()`,
 * `font-format()`, and unknown `<general-enclosed>` conditions without triggering
 * speculative-backtrack `onParseError` false positives, while still rejecting genuinely
 * malformed CSS (such as unclosed parentheses).
 */

import * as csstree from "css-tree";
import type { CssPlainNode, ParseOptions } from "css-tree";

const {
  Ident,
  Function: FunctionToken,
  Colon,
  LeftParenthesis,
  RightParenthesis,
  WhiteSpace,
  Comment
} = csstree.tokenTypes;

interface CssTreeList {
  isEmpty: boolean;
  push(item: unknown): void;
}

interface CssParserThis {
  readonly eof: boolean;
  readonly tokenType: number;
  readonly tokenIndex: number;
  readonly tokenStart: number;
  readonly tokenEnd: number;
  readonly features: Record<string, Record<string, unknown> | undefined>;
  readonly scope: { Value: unknown };
  next(): void;
  skipSC(): void;
  eat(tokenType: number): void;
  error(message?: string, offset?: number): never;
  substring(start: number, end: number): string;
  consumeFunctionName(): string;
  lookupTypeNonSC(offset: number): number;
  lookupValue(offset: number, referenceStr: string): boolean;
  isBalanceEdge(startToken: number): boolean;
  createList(): CssTreeList;
  createSingleNodeList(node: unknown): CssTreeList;
  getLocation(start: number, end: number): unknown;
  getLocationFromList(list: CssTreeList): unknown;
  Identifier(): unknown;
  SupportsDeclaration(): unknown;
  FeatureFunction(kind: string): unknown;
  Condition(kind: string): unknown;
  Raw(startToken: number | null, consumeUntil: unknown, excludeWhiteSpace: boolean): unknown;
  readSequence(recognizer: unknown): CssTreeList;
}

function parseGeneralEnclosedSupports(this: CssParserThis): Record<string, unknown> {
  const start = this.tokenStart;
  let functionName: string | null = null;

  if (this.tokenType === FunctionToken) {
    functionName = this.consumeFunctionName();
  } else {
    this.eat(LeftParenthesis);
  }

  const contentStartToken = this.tokenIndex;
  let depth = 1;
  while (!this.eof && depth > 0) {
    if (this.tokenType === LeftParenthesis || this.tokenType === FunctionToken) {
      depth++;
      this.next();
    } else if (this.tokenType === RightParenthesis) {
      depth--;
      if (depth === 0) break;
      this.next();
    } else {
      // Stop early if an unclosed supports prelude runs into the rule block `{`
      if (this.substring(this.tokenStart, this.tokenEnd) === "{") {
        break;
      }
      this.next();
    }
  }

  const rawEnd = this.tokenStart;
  const rawStart = contentStartToken;
  const rawNode = {
    type: "Raw",
    loc: this.getLocation(start, rawEnd),
    value: this.substring(start + (functionName ? functionName.length + 1 : 1), rawEnd)
  };
  void rawStart;

  this.eat(RightParenthesis);

  return {
    type: "GeneralEnclosed",
    loc: this.getLocation(start, this.tokenStart),
    kind: "supports",
    function: functionName,
    children: this.createSingleNodeList(rawNode)
  };
}

function parseSupportsCondition(this: CssParserThis): Record<string, unknown> {
  const children = this.createList();

  scan: while (!this.eof) {
    switch (this.tokenType) {
      case Comment:
      case WhiteSpace:
        this.next();
        continue;

      case Ident:
        children.push(this.Identifier());
        break;

      case LeftParenthesis: {
        const t1 = this.lookupTypeNonSC(1);
        const t2 = this.lookupTypeNonSC(2);

        if (t1 === Ident && t2 === Colon) {
          children.push(this.SupportsDeclaration());
        } else if (
          t1 === LeftParenthesis ||
          t1 === FunctionToken ||
          (t1 === Ident && this.lookupValue(1, "not"))
        ) {
          this.eat(LeftParenthesis);
          const nested = this.Condition("supports");
          this.skipSC();
          this.eat(RightParenthesis);
          children.push(nested);
        } else {
          children.push(parseGeneralEnclosedSupports.call(this));
        }
        break;
      }

      case FunctionToken: {
        const fnName = this.substring(this.tokenStart, this.tokenEnd - 1).toLowerCase();
        const supportsFeatures = this.features.supports;
        if (supportsFeatures && typeof supportsFeatures[fnName] === "function") {
          children.push(this.FeatureFunction("supports"));
        } else {
          children.push(parseGeneralEnclosedSupports.call(this));
        }
        break;
      }

      default:
        break scan;
    }
  }

  if (children.isEmpty) {
    this.error("Condition is expected");
  }

  return {
    type: "Condition",
    loc: this.getLocationFromList(children),
    kind: "supports",
    children
  };
}

const cssSyntax = csstree.fork((baseConfig) => {
  const nodeMap = (baseConfig.node ?? {}) as Record<string, Record<string, unknown>>;
  const origCondition = nodeMap.Condition;
  if (origCondition && typeof origCondition.parse === "function") {
    const origParse = origCondition.parse as (this: CssParserThis, kind?: string) => unknown;
    nodeMap.Condition = {
      ...origCondition,
      parse(this: CssParserThis, kind = "media") {
        if (kind === "supports") {
          return parseSupportsCondition.call(this);
        }
        return origParse.call(this, kind);
      }
    };
  }
  return baseConfig;
});

export function parseCssWithSupports(source: string, options?: ParseOptions): unknown {
  return cssSyntax.parse(source, options);
}

export function toPlainCssAst(ast: unknown): CssPlainNode {
  return cssSyntax.toPlainObject(ast);
}

export function fromPlainCssAst(plain: CssPlainNode): unknown {
  return cssSyntax.fromPlainObject(plain);
}

export function generateCssAst(ast: unknown): string {
  return cssSyntax.generate(ast);
}

