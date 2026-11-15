/**
 * @dotmix/compiler-codegen/directives — Client directive codegen dispatcher.
 */

import type { TemplateNode } from "@dotmix/ast";
import type { CodegenContext } from "../context.js";
import {
  emitAuthBlock,
  emitCanAnyBlock,
  emitCanChain,
  emitCannotBlock,
  emitContextBlock,
  emitCsrf,
  emitEnvGate,
  emitFieldError,
  emitFieldValid,
  emitFormErrors,
  emitGuestBlock,
  emitMethod
} from "./emit-auth-forms.js";
import {
  emitEachExtBlock,
  emitForBlock,
  emitIsEmptyBlock,
  emitIsSetBlock,
  emitSwitchBlock,
  emitTemplateRenderFunctionFallback,
  emitUnlessBlock
} from "./emit-control.js";
import {
  emitDump,
  emitHasOrMissingSection,
  emitHeadGroup,
  emitInclude,
  emitIncludeFirst,
  emitJson,
  emitKeepAliveBlock,
  emitLazy,
  emitMemo,
  emitOnce,
  emitPartial,
  emitSectionFallback,
  emitSessionBlock,
  emitStack,
  emitStackPush,
  emitVerbatim,
  emitYield
} from "./emit-layouts-runtime.js";

export * from "./emit-attrs.js";

export function emitDirectiveTemplateNode(
  ctx: CodegenContext,
  node: TemplateNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  switch (node.type) {
    case "UnlessBlock":
      return emitUnlessBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "IsSetBlock":
      return emitIsSetBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "IsEmptyBlock":
      return emitIsEmptyBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "SwitchBlock":
      return emitSwitchBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "EachExtBlock":
      return emitEachExtBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "ForBlock":
      return emitForBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "AuthBlock":
      return emitAuthBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "GuestBlock":
      return emitGuestBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "CanChain":
      return emitCanChain(ctx, node, parentVar, loopGetters, inSvg);
    case "CannotBlock":
      return emitCannotBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "CanAnyBlock":
      return emitCanAnyBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "EnvGate":
      return emitEnvGate(ctx, node, parentVar, loopGetters, inSvg);
    case "ContextBlock":
      return emitContextBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "FieldError":
      return emitFieldError(ctx, node, parentVar, loopGetters, inSvg);
    case "FormErrors":
      return emitFormErrors(ctx, node, parentVar, loopGetters, inSvg);
    case "FieldValid":
      return emitFieldValid(ctx, node, parentVar, loopGetters, inSvg);
    case "Csrf":
      return emitCsrf(ctx, node, parentVar);
    case "Method":
      return emitMethod(ctx, node, parentVar, loopGetters);
    case "Section":
      return emitSectionFallback(ctx, node, parentVar, loopGetters, inSvg);
    case "Yield":
      return emitYield(ctx, node, parentVar, loopGetters, inSvg);
    case "HasSection":
      return emitHasOrMissingSection(ctx, node, parentVar, loopGetters, inSvg, false);
    case "SectionMissing":
      return emitHasOrMissingSection(ctx, node, parentVar, loopGetters, inSvg, true);
    case "StackPush":
      return emitStackPush(ctx, node, loopGetters, inSvg);
    case "Stack":
      return emitStack(ctx, node, parentVar, loopGetters);
    case "HeadGroup":
      return emitHeadGroup(ctx, node, loopGetters);
    case "Include":
      return emitInclude(ctx, node, parentVar, loopGetters, inSvg);
    case "IncludeFirst":
      return emitIncludeFirst(ctx, node, parentVar, loopGetters, inSvg);
    case "Once":
      return emitOnce(ctx, node, parentVar, loopGetters, inSvg);
    case "Memo":
      return emitMemo(ctx, node, parentVar, loopGetters, inSvg);
    case "Lazy":
      return emitLazy(ctx, node, parentVar, loopGetters, inSvg);
    case "KeepAliveBlock":
      return emitKeepAliveBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "SessionBlock":
      return emitSessionBlock(ctx, node, parentVar, loopGetters, inSvg);
    case "Partial":
      return emitPartial(ctx, node, parentVar, loopGetters, inSvg);
    case "Json":
      return emitJson(ctx, node, parentVar, loopGetters);
    case "Dump":
      return emitDump(ctx, node, parentVar, loopGetters);
    case "Verbatim":
      return emitVerbatim(ctx, node, parentVar);
    case "TemplateRenderFunction":
      return emitTemplateRenderFunctionFallback(ctx, node, parentVar, loopGetters, inSvg);
    default:
      return [];
  }
}
