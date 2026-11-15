/**
 * @dotmix/compiler-frontend/directives/parse-switch-for — Switch and bounded For block parsers.
 */

import {
  createDirectiveNode,
  createDirectiveSubNode,
  deepFreeze,
  type DirectiveGrammarEntry,
  type ForBlockNode,
  type SwitchBlockNode,
  type SwitchCaseBranch,
  type TemplateNode
} from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import { skipJsWhitespaceAndComments } from "../expression.js";
import { failSyntax, type ParserContext } from "../types.js";
import { isValidIdentifierName, matchDirectiveBranchAt } from "./scanner.js";
import {
  consumeExpectedClose,
  findHeaderCloseOffset,
  isClosingTagFor,
  parseSliceRequired,
  scanTopLevelKeywords,
  splitTopLevelCommas
} from "./scanner-expressions.js";

export function parseSwitchBlock(
  ctx: ParserContext,
  entry: DirectiveGrammarEntry,
  startOffset: number,
  afterKeywordOffset: number
): SwitchBlockNode {
  const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, startOffset, "switch");
  const rawSubject = ctx.source.slice(afterKeywordOffset, headerClose).trim();
  const subject = rawSubject.length > 0
    ? parseSliceRequired(ctx.source, afterKeywordOffset, headerClose, ctx.lineMap, "'{switch}'").expression
    : null;
  ctx.pos = headerClose + 1;

  const isSwitchStop = (): boolean => {
    if (isClosingTagFor(ctx.source, ctx.pos, entry)) return true;
    const branch = matchDirectiveBranchAt(ctx.source, ctx.pos);
    return branch !== null && (branch.marker === "case" || branch.marker === "default");
  };

  const leadingNodes = ctx.parseChildren(isSwitchStop);
  for (const leading of leadingNodes) {
    if (!(leading.type === "Text" && leading.value.trim() === "")) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_SWITCH_STRAY_CONTENT,
        "Unexpected content before the first '{case}' or '{default}' inside '{switch}'.",
        ctx.lineMap,
        leading.span.start.offset,
        leading.span.end.offset
      );
    }
  }

  const cases: SwitchCaseBranch[] = [];
  let defaultBranch: TemplateNode[] | null = null;

  while (ctx.pos < ctx.source.length && !isClosingTagFor(ctx.source, ctx.pos, entry)) {
    const branch = matchDirectiveBranchAt(ctx.source, ctx.pos);
    if (!branch || (branch.marker !== "case" && branch.marker !== "default")) {
      break;
    }
    if (branch.marker === "default") {
      if (defaultBranch !== null) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER,
          "Multiple '{default}' branches are not allowed in '{switch}'.",
          ctx.lineMap,
          branch.startOffset,
          branch.noArgCloseEnd ?? branch.afterKeywordOffset
        );
      }
      if (branch.noArgCloseEnd === null) {
        failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "Expected '}' after '{default}'.", ctx.lineMap, branch.startOffset, branch.afterKeywordOffset);
      }
      ctx.pos = branch.noArgCloseEnd;
      defaultBranch = ctx.parseChildren(isSwitchStop);
      continue;
    }

    if (defaultBranch !== null) {
      failSyntax(
        DiagnosticCodes.MIX_ERR_SWITCH_DEFAULT_ORDER,
        "'{default}' must be the last branch inside '{switch}'.",
        ctx.lineMap,
        branch.startOffset,
        branch.afterKeywordOffset
      );
    }

    const caseClose = findHeaderCloseOffset(ctx.source, branch.afterKeywordOffset, ctx.lineMap, branch.startOffset, "case");
    const afterCaseWs = skipJsWhitespaceAndComments(ctx.source, branch.afterKeywordOffset, ctx.lineMap, caseClose);
    const isConditionCase =
      ctx.source.startsWith("if", afterCaseWs) &&
      afterCaseWs + 2 < caseClose &&
      !isValidIdentifierName(ctx.source.slice(afterCaseWs, afterCaseWs + 3));

    if (isConditionCase) {
      const condSlice = parseSliceRequired(ctx.source, afterCaseWs + 2, caseClose, ctx.lineMap, "'{case if}'");
      ctx.pos = caseClose + 1;
      const body = ctx.parseChildren(isSwitchStop);
      cases.push(
        createDirectiveSubNode<SwitchCaseBranch>({
          kind: "condition",
          values: deepFreeze([]),
          rawValues: deepFreeze([]),
          condition: condSlice.expression,
          rawCondition: condSlice.raw,
          body: deepFreeze(body),
          span: ctx.lineMap.span(branch.startOffset, ctx.pos)
        })
      );
    } else {
      if (subject === null) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_SWITCH_CASE_FORM,
          "Value '{case}' requires a subject expression on '{switch}'; use '{case if ...}' instead.",
          ctx.lineMap,
          branch.startOffset,
          caseClose + 1
        );
      }
      const valueSlices = splitTopLevelCommas(ctx.source, afterCaseWs, caseClose, ctx.lineMap);
      if (valueSlices.length === 0) {
        failSyntax(
          DiagnosticCodes.MIX_ERR_SWITCH_CASE_FORM,
          "Expected one or more values in '{case ...}'.",
          ctx.lineMap,
          branch.startOffset,
          caseClose + 1
        );
      }
      ctx.pos = caseClose + 1;
      const body = ctx.parseChildren(isSwitchStop);
      cases.push(
        createDirectiveSubNode<SwitchCaseBranch>({
          kind: "values",
          values: deepFreeze(valueSlices.map((segment) => segment.expression)),
          rawValues: deepFreeze(valueSlices.map((segment) => segment.raw)),
          condition: null,
          rawCondition: null,
          body: deepFreeze(body),
          span: ctx.lineMap.span(branch.startOffset, ctx.pos)
        })
      );
    }
  }

  consumeExpectedClose(ctx, entry, startOffset);
  return createDirectiveNode<SwitchBlockNode>({
    type: "SwitchBlock",
    form: "block",
    subject,
    rawSubject: rawSubject.length > 0 ? rawSubject : null,
    cases: deepFreeze(cases),
    defaultBranch: defaultBranch ? deepFreeze(defaultBranch) : null,
    span: ctx.lineMap.span(startOffset, ctx.pos)
  });
}

export function parseForBlock(
  ctx: ParserContext,
  entry: DirectiveGrammarEntry,
  startOffset: number,
  afterKeywordOffset: number
): ForBlockNode {
  const headerClose = findHeaderCloseOffset(ctx.source, afterKeywordOffset, ctx.lineMap, startOffset, "for");
  const keywords = scanTopLevelKeywords(ctx.source, afterKeywordOffset, headerClose, new Set(["from", "to", "step", "times"]));
  const timesKw = keywords.find((kw) => kw.keyword === "times");
  const fromKw = keywords.find((kw) => kw.keyword === "from");

  if (timesKw) {
    const identRaw = ctx.source.slice(afterKeywordOffset, timesKw.startOffset).trim();
    if (!isValidIdentifierName(identRaw)) {
      failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "Expected loop identifier before 'times' in '{for}'.", ctx.lineMap, startOffset, headerClose + 1);
    }
    const timesSlice = parseSliceRequired(ctx.source, timesKw.endOffset, headerClose, ctx.lineMap, "'{for} times'");
    ctx.pos = headerClose + 1;
    const children = ctx.parseChildren(() => isClosingTagFor(ctx.source, ctx.pos, entry));
    consumeExpectedClose(ctx, entry, startOffset);
    return createDirectiveNode<ForBlockNode>({
      type: "ForBlock",
      form: "block",
      variant: "times",
      itemIdentifier: identRaw,
      from: null,
      rawFrom: null,
      to: null,
      rawTo: null,
      step: null,
      rawStep: null,
      times: timesSlice.expression,
      rawTimes: timesSlice.raw,
      children: deepFreeze(children),
      span: ctx.lineMap.span(startOffset, ctx.pos)
    });
  }

  const toKw = keywords.find((kw) => kw.keyword === "to");
  if (!fromKw || !toKw || toKw.startOffset <= fromKw.endOffset) {
    failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "Expected '{for ident from expr to expr}' or '{for ident times expr}'.", ctx.lineMap, startOffset, headerClose + 1);
  }
  const stepKw = keywords.find((kw) => kw.keyword === "step" && kw.startOffset > toKw.endOffset);
  const identRaw = ctx.source.slice(afterKeywordOffset, fromKw.startOffset).trim();
  if (!isValidIdentifierName(identRaw)) {
    failSyntax(DiagnosticCodes.MIX_ERR_PARSE_SYNTAX, "Expected loop identifier before 'from' in '{for}'.", ctx.lineMap, startOffset, headerClose + 1);
  }
  const fromSlice = parseSliceRequired(ctx.source, fromKw.endOffset, toKw.startOffset, ctx.lineMap, "'{for} from'");
  const toSlice = parseSliceRequired(ctx.source, toKw.endOffset, stepKw ? stepKw.startOffset : headerClose, ctx.lineMap, "'{for} to'");
  const stepSlice = stepKw ? parseSliceRequired(ctx.source, stepKw.endOffset, headerClose, ctx.lineMap, "'{for} step'") : null;

  ctx.pos = headerClose + 1;
  const children = ctx.parseChildren(() => isClosingTagFor(ctx.source, ctx.pos, entry));
  consumeExpectedClose(ctx, entry, startOffset);
  return createDirectiveNode<ForBlockNode>({
    type: "ForBlock",
    form: "block",
    variant: "range",
    itemIdentifier: identRaw,
    from: fromSlice.expression,
    rawFrom: fromSlice.raw,
    to: toSlice.expression,
    rawTo: toSlice.raw,
    step: stepSlice ? stepSlice.expression : null,
    rawStep: stepSlice ? stepSlice.raw : null,
    times: null,
    rawTimes: null,
    children: deepFreeze(children),
    span: ctx.lineMap.span(startOffset, ctx.pos)
  });
}
