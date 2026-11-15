/**
 * @dotmix/compiler-frontend/directives/parse-dispatch — Thin parser.ts dispatch helpers.
 */

import type { TemplateNode } from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import { failSyntax, type ParserContext } from "../types.js";
import { tryParseDirectiveBlock } from "./parse-blocks.js";
import { tryParseArrowTemplateRender } from "./parse-arrow-templates.js";
import { matchDirectiveBranchAt, matchDirectiveCloseAt, matchInlineStatementAt } from "./scanner.js";

export function isDirectiveStopTokenAt(source: string, pos: number): boolean {
  return matchDirectiveBranchAt(source, pos) !== null || matchDirectiveCloseAt(source, pos) !== null;
}

export function checkOrphanDirectiveAtRoot(ctx: ParserContext): void {
  const orphanBranch = matchDirectiveBranchAt(ctx.source, ctx.pos);
  if (orphanBranch) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      `Orphan directive branch '{${orphanBranch.marker}}' outside its parent block.`,
      ctx.lineMap,
      orphanBranch.startOffset,
      orphanBranch.afterKeywordOffset
    );
  }
}

export function tryParseDirectiveOrRenderNode(ctx: ParserContext): TemplateNode | null {
  const inlineControl = matchInlineStatementAt(ctx.source, ctx.pos);
  if (inlineControl) {
    failSyntax(
      DiagnosticCodes.MIX_ERR_LOOP_CONTROL_POSITION,
      `'{${inlineControl.marker} if ...}' must appear as a leading statement inside '{each}'.`,
      ctx.lineMap,
      inlineControl.startOffset,
      inlineControl.headerStartOffset
    );
  }
  const blockNode = tryParseDirectiveBlock(ctx);
  if (blockNode) return blockNode;
  if (ctx.source.charCodeAt(ctx.pos) === 123 /* { */) {
    return tryParseArrowTemplateRender(ctx);
  }
  return null;
}
