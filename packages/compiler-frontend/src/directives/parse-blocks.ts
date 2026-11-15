/**
 * @dotmix/compiler-frontend/directives/parse-blocks — Core, switch, loop, auth, permission, and env block parsers.
 */

import {
  createDirectiveNode,
  createDirectiveSubNode,
  deepFreeze,
  type AuthBlockNode,
  type CanAnyBlockNode,
  type CanBranch,
  type CanChainNode,
  type CannotBlockNode,
  type DirectiveGrammarEntry,
  type ESTreeNode,
  type EnvGateNode,
  type GuestBlockNode,
  type IsEmptyBlockNode,
  type IsSetBlockNode,
  type TemplateNode,
  type UnlessBlockNode
} from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import { failSyntax, type ParserContext } from "../types.js";
import { parseExtendedDirectiveBlock } from "./parse-blocks-extended.js";
import { parseForBlock, parseSwitchBlock } from "./parse-switch-for.js";
import {
  isValidIdentifierName,
  matchDirectiveBranchAt,
  matchDirectiveOpenAt
} from "./scanner.js";
import {
  consumeExpectedClose,
  findHeaderCloseOffset,
  isClosingTagFor,
  isSimpleElseAt,
  parseOptionalElseBlockBodies,
  parseSliceRequired,
  scanTopLevelKeywords,
  splitTopLevelCommas
} from "./scanner-expressions.js";

function parseCanTargetClause(
  ctx: ParserContext,
  sliceStart: number,
  sliceEnd: number,
  blockStart: number,
  keywordLabel: string
): { action: ESTreeNode; rawAction: string; subject: ESTreeNode; rawSubject: string; field: ESTreeNode | null; rawField: string | null } {
  const keywords = scanTopLevelKeywords(ctx.source, sliceStart, sliceEnd, new Set(["on", "field"]));
  const onKw = keywords.find((kw) => kw.keyword === "on");
  if (!onKw) {
    failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, `'{${keywordLabel}}' requires 'on <subject>'.`, ctx.lineMap, blockStart, sliceEnd + 1);
  }
  const fieldKw = keywords.find((kw) => kw.keyword === "field" && kw.startOffset > onKw.endOffset);
  const actionSlice = parseSliceRequired(ctx.source, sliceStart, onKw.startOffset, ctx.lineMap, `'{${keywordLabel}}' action`);
  const subjectSlice = parseSliceRequired(ctx.source, onKw.endOffset, fieldKw ? fieldKw.startOffset : sliceEnd, ctx.lineMap, `'{${keywordLabel}}' subject`);
  const fieldSlice = fieldKw ? parseSliceRequired(ctx.source, fieldKw.endOffset, sliceEnd, ctx.lineMap, `'{${keywordLabel}}' field`) : null;
  return {
    action: actionSlice.expression,
    rawAction: actionSlice.raw,
    subject: subjectSlice.expression,
    rawSubject: subjectSlice.raw,
    field: fieldSlice ? fieldSlice.expression : null,
    rawField: fieldSlice ? fieldSlice.raw : null
  };
}

function parseCanChainBlock(
  ctx: ParserContext,
  entry: DirectiveGrammarEntry,
  startOffset: number,
  afterKeywordOffset: number
): CanChainNode {
  const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, startOffset, "can");
  const initialClause = parseCanTargetClause(ctx, afterKeywordOffset, headerClose, startOffset, "can");
  ctx.pos = headerClose + 1;

  const isCanStop = (): boolean => {
    if (isClosingTagFor(ctx.source, ctx.pos, entry) || isSimpleElseAt(ctx.source, ctx.pos)) return true;
    const branch = matchDirectiveBranchAt(ctx.source, ctx.pos);
    return branch !== null && branch.marker === "elsecan";
  };

  const firstBody = ctx.parseChildren(isCanStop);
  const branches: CanBranch[] = [
    createDirectiveSubNode<CanBranch>({
      ...initialClause,
      subjectType: null,
      rawSubjectType: null,
      body: deepFreeze(firstBody),
      span: ctx.lineMap.span(startOffset, ctx.pos)
    })
  ];

  let alternate: TemplateNode[] | null = null;
  while (ctx.pos < ctx.source.length && !isClosingTagFor(ctx.source, ctx.pos, entry)) {
    const branch = matchDirectiveBranchAt(ctx.source, ctx.pos);
    if (!branch) break;
    if (branch.marker === "else") {
      if (alternate !== null) {
        failSyntax(DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "Duplicate '{else}' branch inside '{can}'.", ctx.lineMap, branch.startOffset, branch.afterKeywordOffset);
      }
      ctx.pos = branch.noArgCloseEnd!;
      alternate = ctx.parseChildren(isCanStop);
      continue;
    }
    if (branch.marker === "elsecan") {
      if (alternate !== null) {
        failSyntax(DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER, "'{elsecan}' cannot appear after '{else}'.", ctx.lineMap, branch.startOffset, branch.afterKeywordOffset);
      }
      const branchClose = findHeaderCloseOffset(ctx.source, branch.afterKeywordOffset, ctx.lineMap, branch.startOffset, "elsecan");
      const branchClause = parseCanTargetClause(ctx, branch.afterKeywordOffset, branchClose, branch.startOffset, "elsecan");
      ctx.pos = branchClose + 1;
      const body = ctx.parseChildren(isCanStop);
      branches.push(
        createDirectiveSubNode<CanBranch>({
          ...branchClause,
          subjectType: null,
          rawSubjectType: null,
          body: deepFreeze(body),
          span: ctx.lineMap.span(branch.startOffset, ctx.pos)
        })
      );
      continue;
    }
    break;
  }

  consumeExpectedClose(ctx, entry, startOffset);
  return createDirectiveNode<CanChainNode>({
    type: "CanChain",
    form: "block",
    branches: deepFreeze(branches),
    alternate: alternate ? deepFreeze(alternate) : null,
    span: ctx.lineMap.span(startOffset, ctx.pos)
  });
}

export function tryParseDirectiveBlock(ctx: ParserContext): TemplateNode | null {
  const matched = matchDirectiveOpenAt(ctx.source, ctx.pos);
  if (!matched) {
    return null;
  }
  const { entry, afterKeywordOffset, braceOffset } = matched;

  switch (entry.id) {
    case "unless": {
      const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, braceOffset, "unless");
      const condSlice = parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{unless}'");
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, braceOffset);
      return createDirectiveNode<UnlessBlockNode>({
        type: "UnlessBlock",
        form: "block",
        condition: condSlice.expression,
        rawCondition: condSlice.raw,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(braceOffset, ctx.pos)
      });
    }

    case "isset": {
      const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, braceOffset, "isset");
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["as"]));
      const asKw = keywords[0];
      const valSlice = parseSliceRequired(ctx.source, afterKeywordOffset, asKw ? asKw.startOffset : headerClose, ctx.lineMap, "'{isset}'");
      const asIdentifier = asKw ? ctx.source.slice(asKw.endOffset, headerClose).trim() : null;
      if (asKw && !isValidIdentifierName(asIdentifier ?? "")) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "Expected identifier after 'as' in '{isset}'.", ctx.lineMap, asKw.endOffset, headerClose);
      }
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, braceOffset);
      return createDirectiveNode<IsSetBlockNode>({
        type: "IsSetBlock",
        form: "block",
        value: valSlice.expression,
        rawValue: valSlice.raw,
        asIdentifier,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(braceOffset, ctx.pos)
      });
    }

    case "isempty": {
      const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, braceOffset, "isempty");
      const valSlice = parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{isempty}'");
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, braceOffset);
      return createDirectiveNode<IsEmptyBlockNode>({
        type: "IsEmptyBlock",
        form: "block",
        value: valSlice.expression,
        rawValue: valSlice.raw,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(braceOffset, ctx.pos)
      });
    }

    case "switch":
      return parseSwitchBlock(ctx, entry, braceOffset, afterKeywordOffset);

    case "for":
      return parseForBlock(ctx, entry, braceOffset, afterKeywordOffset);

    case "auth": {
      const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, braceOffset, "auth");
      const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["role", "as"]));
      const roleKw = keywords.find((kw) => kw.keyword === "role");
      const asKw = keywords.find((kw) => kw.keyword === "as");
      const firstKwOffset = keywords[0] ? keywords[0].startOffset : headerClose;
      const guardRaw = ctx.source.slice(afterKeywordOffset, firstKwOffset).trim();
      const guardSlice = guardRaw.length > 0 ? parseSliceRequired(ctx.source, afterKeywordOffset, firstKwOffset, ctx.lineMap, "'{auth}' guard") : null;
      const roleEnd = asKw && roleKw && asKw.startOffset > roleKw.endOffset ? asKw.startOffset : headerClose;
      const roleItems = roleKw ? splitTopLevelCommas(ctx.source, roleKw.endOffset, roleEnd, ctx.lineMap) : [];
      const asIdentifier = asKw ? ctx.source.slice(asKw.endOffset, headerClose).trim() : null;
      if (asKw && !isValidIdentifierName(asIdentifier ?? "")) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "Expected identifier after 'as' in '{auth}'.", ctx.lineMap, asKw.endOffset, headerClose);
      }
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, braceOffset);
      return createDirectiveNode<AuthBlockNode>({
        type: "AuthBlock",
        form: "block",
        guard: guardSlice ? guardSlice.expression : null,
        rawGuard: guardSlice ? guardSlice.raw : null,
        roles: deepFreeze(roleItems.map((item) => item.expression)),
        rawRoles: deepFreeze(roleItems.map((item) => item.raw)),
        roleExpression: null,
        rawRoleExpression: null,
        asIdentifier,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(braceOffset, ctx.pos)
      });
    }

    case "guest": {
      const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, braceOffset, "guest");
      const guardRaw = ctx.source.slice(afterKeywordOffset, headerClose).trim();
      const guardSlice = guardRaw.length > 0 ? parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{guest}' guard") : null;
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, braceOffset);
      return createDirectiveNode<GuestBlockNode>({
        type: "GuestBlock",
        form: "block",
        guard: guardSlice ? guardSlice.expression : null,
        rawGuard: guardSlice ? guardSlice.raw : null,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(braceOffset, ctx.pos)
      });
    }

    case "can":
      return parseCanChainBlock(ctx, entry, braceOffset, afterKeywordOffset);

    case "cannot": {
      const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, braceOffset, "cannot");
      const clause = parseCanTargetClause(ctx, afterKeywordOffset, headerClose, braceOffset, "cannot");
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, braceOffset);
      return createDirectiveNode<CannotBlockNode>({
        type: "CannotBlock",
        form: "block",
        ...clause,
        subjectType: null,
        rawSubjectType: null,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(braceOffset, ctx.pos)
      });
    }

    case "canany": {
      const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, braceOffset, "canany");
      const clause = parseCanTargetClause(ctx, afterKeywordOffset, headerClose, braceOffset, "canany");
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, braceOffset);
      return createDirectiveNode<CanAnyBlockNode>({
        type: "CanAnyBlock",
        form: "block",
        actions: clause.action,
        rawActions: clause.rawAction,
        subject: clause.subject,
        rawSubject: clause.rawSubject,
        subjectType: null,
        rawSubjectType: null,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(braceOffset, ctx.pos)
      });
    }

    case "dev":
    case "production":
    case "env": {
      const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, braceOffset, entry.blockOpen);
      const environments: string[] = [];
      let rawExpression: ESTreeNode | null = null;
      let rawExpressionText: string | null = null;
      if (entry.id === "env") {
        const envText = ctx.source.slice(afterKeywordOffset, headerClose).trim();
        rawExpressionText = envText;
        const envSlices = splitTopLevelCommas(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap);
        if (envSlices.length === 0) {
          failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "'{env}' requires at least one environment name.", ctx.lineMap, braceOffset, headerClose + 1);
        }
        rawExpression = envSlices[0]!.expression;
        for (const seg of envSlices) {
          if (seg.expression.type === "Literal" && typeof seg.expression.value === "string") {
            environments.push(seg.expression.value);
          } else {
            failSyntax(DiagnosticCodes.MIX_ERR_ENV_NOT_STATIC, "'{env}' argument must be static string literals.", ctx.lineMap, braceOffset, headerClose + 1);
          }
        }
      }
      ctx.pos = headerClose + 1;
      const { consequent, alternate } = parseOptionalElseBlockBodies(ctx, entry, braceOffset);
      return createDirectiveNode<EnvGateNode>({
        type: "EnvGate",
        form: "block",
        mode: entry.id as "dev" | "production" | "env",
        environments: deepFreeze(environments),
        rawExpression,
        rawExpressionText,
        consequent: deepFreeze(consequent),
        alternate: alternate ? deepFreeze(alternate) : null,
        span: ctx.lineMap.span(braceOffset, ctx.pos)
      });
    }

    default:
      return parseExtendedDirectiveBlock(ctx, entry, braceOffset, afterKeywordOffset);
  }
}
