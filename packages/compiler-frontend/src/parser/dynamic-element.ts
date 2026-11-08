/**
 * packages/compiler-frontend/src/parser/dynamic-element.ts
 *
 * Mix v3.2.2 Dynamic Element Syntax Subsystem (§4.2).
 * Implements token-stream closing tag comparison (R-SYN-02) and non-evaluation guarantee (R-SYN-03).
 */

import { TSParser } from "./expression.js";
import { MixError } from "@mix/runtime/core";

export interface TokenEntry {
  readonly type: string;
  readonly value: unknown;
}

/**
 * Extracts normalized tokens from an expression using the parser's tokenizer.
 * Automatically ignores whitespace and comments (R-SYN-02).
 */
export function tokenizeExpression(exprString: string): TokenEntry[] {
  const tokenizer = TSParser.tokenizer(exprString, {
    ecmaVersion: "latest",
    sourceType: "module"
  });

  const tokens: TokenEntry[] = [];
  let token: any;

  while ((token = tokenizer.getToken()).type.label !== "eof") {
    tokens.push({
      type: token.type.label,
      value: token.value
    });
  }

  return tokens;
}

/**
 * Compares two expression token streams by type and value (R-SYN-02).
 */
export function compareTokenStreams(openTokens: readonly TokenEntry[], closeTokens: readonly TokenEntry[]): boolean {
  if (openTokens.length !== closeTokens.length) {
    return false;
  }

  for (let i = 0; i < openTokens.length; i++) {
    const o = openTokens[i]!;
    const c = closeTokens[i]!;
    if (o.type !== c.type || o.value !== c.value) {
      return false;
    }
  }

  return true;
}

/**
 * Asserts that a dynamic element's closing expression matches its opening expression (R-SYN-02).
 * Throws MIX_SYN_DYNAMIC_CLOSE_MISMATCH on mismatch.
 */
export function assertDynamicCloseMatch(
  openExpr: string,
  closeExpr: string,
  openSpan?: { start: number; end: number },
  closeSpan?: { start: number; end: number }
): void {
  const openTokens = tokenizeExpression(openExpr);
  const closeTokens = tokenizeExpression(closeExpr);

  if (!compareTokenStreams(openTokens, closeTokens)) {
    throw new MixError(
      "MIX_SYN_DYNAMIC_CLOSE_MISMATCH",
      `Dynamic element closing tag expression </{~ ${closeExpr.trim()} }> does not match opening tag <{~ ${openExpr.trim()} }>.`,
      {
        openExpr,
        closeExpr,
        openSpan,
        closeSpan
      }
    );
  }
}
