/**
 * @dotmix/compiler-frontend — Lexer, expression boundary parser, and template AST builder.
 *
 * Implements Phase canonical contracts:
 * - R-SYN-01 / R-SYN-01a: TypeScript scanner boundary + ts.createSourceFile expression parse (ts-parser/)
 * - R-SYN-02 / R-SYN-03 / TEC: `<{~expr}>...</{~expr}>` and `<{~expr} />` with preserved attributes and token-sequence verification
 * - TEC: PascalCase `<Component />` parsed into `ComponentCallNode`
 * - Control flow: `{#if ...}...{:else if ...}...{:else}...{/if}` and `{#each list as item, idx (key)}...{/each}`
 * - Deeply frozen AST nodes with exact 1-based line/column and 0-based offset SourceSpans
 */

export { LineMap } from "./location.js";
export {
  parseEmbeddedExpression,
  parseExpressionSlice,
  compareExpressionTokens,
  skipJsWhitespaceAndComments,
  parseScriptProgram,
  createTsTokenizer,
  convertAcornNodeToESTree
} from "./expression.js";
export type { ParsedExpressionResult } from "./expression.js";
export type { ParseOptions, ExtractedSections, ParserContext } from "./types.js";
export {
  failSyntax,
  isAsciiWhitespace,
  isTagNameStart,
  isTagNameChar,
  isPascalCaseComponent,
  blankRangePreservingNewlines
} from "./types.js";
export {
  tryExtractFunctionalComponent,
  extractTopLevelSections
} from "./section-extractor.js";
export {
  isIfOpenAt,
  isEachOpenAt,
  matchElseOrElseIf,
  isElseOrElseIfAt,
  isEndIfAt,
  isEndEachAt,
  isAwaitOpenAt,
  isThenAt,
  isCatchAt,
  isEndAwaitAt
} from "./control-flow-scanner.js";
export { parseAttributes } from "./attribute-parser.js";
export {
  parseElementOrComponent,
  parseDollarDynamicElement,
  parseDynamicElement
} from "./element-parser.js";
export {
  parseIfBlock,
  parseElseIfChain,
  parseEachBlock,
  parseAwaitBlock
} from "./block-parser.js";
export * from "./directives/index.js";
export { TemplateParser, parse } from "./parser.js";
