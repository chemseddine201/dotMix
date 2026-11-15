/**
 * @dotmix/compiler-ssr/directives — SSR directive emitter dispatcher.
 */

import type { TemplateNode } from "@dotmix/ast";
import type { SsrEmitContext } from "./emit-ssr-attrs.js";
import {
  emitSsrAuth,
  emitSsrCanAny,
  emitSsrCanChain,
  emitSsrCannot,
  emitSsrContextBlock,
  emitSsrEachExt,
  emitSsrEnvGate,
  emitSsrFor,
  emitSsrGuest,
  emitSsrIsEmpty,
  emitSsrIsSet,
  emitSsrRenderFunctionFallback,
  emitSsrSwitch,
  emitSsrUnless
} from "./emit-ssr-blocks.js";
import {
  emitSsrChildrenWrapper,
  emitSsrCsrf,
  emitSsrDump,
  emitSsrFieldError,
  emitSsrFieldValid,
  emitSsrFormErrors,
  emitSsrHasOrMissingSection,
  emitSsrHeadGroup,
  emitSsrInclude,
  emitSsrIncludeFirst,
  emitSsrJson,
  emitSsrKeepAlive,
  emitSsrMethod,
  emitSsrPartial,
  emitSsrSession,
  emitSsrStack,
  emitSsrStackPush,
  emitSsrVerbatim,
  emitSsrYield
} from "./emit-ssr-features.js";

export * from "./emit-ssr-attrs.js";
export { emitSsrComponentSectionsAndChildren } from "./emit-ssr-features.js";

export function emitSsrDirectiveNode(
  ctx: SsrEmitContext,
  node: TemplateNode,
  shadowed: ReadonlySet<string>
): boolean {
  switch (node.type) {
    case "UnlessBlock":
      emitSsrUnless(ctx, node, shadowed);
      return true;
    case "IsSetBlock":
      emitSsrIsSet(ctx, node, shadowed);
      return true;
    case "IsEmptyBlock":
      emitSsrIsEmpty(ctx, node, shadowed);
      return true;
    case "SwitchBlock":
      emitSsrSwitch(ctx, node, shadowed);
      return true;
    case "EachExtBlock":
      emitSsrEachExt(ctx, node, shadowed);
      return true;
    case "ForBlock":
      emitSsrFor(ctx, node, shadowed);
      return true;
    case "AuthBlock":
      emitSsrAuth(ctx, node, shadowed);
      return true;
    case "GuestBlock":
      emitSsrGuest(ctx, node, shadowed);
      return true;
    case "CanChain":
      emitSsrCanChain(ctx, node, shadowed);
      return true;
    case "CannotBlock":
      emitSsrCannot(ctx, node, shadowed);
      return true;
    case "CanAnyBlock":
      emitSsrCanAny(ctx, node, shadowed);
      return true;
    case "EnvGate":
      emitSsrEnvGate(ctx, node, shadowed);
      return true;
    case "ContextBlock":
      emitSsrContextBlock(ctx, node, shadowed);
      return true;
    case "FieldError":
      emitSsrFieldError(ctx, node, shadowed);
      return true;
    case "FormErrors":
      emitSsrFormErrors(ctx, node, shadowed);
      return true;
    case "FieldValid":
      emitSsrFieldValid(ctx, node, shadowed);
      return true;
    case "Csrf":
      emitSsrCsrf(ctx);
      return true;
    case "Method":
      emitSsrMethod(ctx, node, shadowed);
      return true;
    case "Section":
    case "Once":
    case "Memo":
    case "Lazy":
      emitSsrChildrenWrapper(ctx, node, shadowed);
      return true;
    case "Yield":
      emitSsrYield(ctx, node, shadowed);
      return true;
    case "HasSection":
      emitSsrHasOrMissingSection(ctx, node, shadowed, false);
      return true;
    case "SectionMissing":
      emitSsrHasOrMissingSection(ctx, node, shadowed, true);
      return true;
    case "StackPush":
      emitSsrStackPush(ctx, node, shadowed);
      return true;
    case "Stack":
      emitSsrStack(ctx, node, shadowed);
      return true;
    case "HeadGroup":
      emitSsrHeadGroup(ctx, node, shadowed);
      return true;
    case "Include":
      emitSsrInclude(ctx, node, shadowed);
      return true;
    case "IncludeFirst":
      emitSsrIncludeFirst(ctx, node, shadowed);
      return true;
    case "KeepAliveBlock":
      emitSsrKeepAlive(ctx, node, shadowed);
      return true;
    case "SessionBlock":
      emitSsrSession(ctx, node, shadowed);
      return true;
    case "Partial":
      emitSsrPartial(ctx, node, shadowed);
      return true;
    case "Json":
      emitSsrJson(ctx, node, shadowed);
      return true;
    case "Dump":
      emitSsrDump(ctx, node, shadowed);
      return true;
    case "Verbatim":
      emitSsrVerbatim(ctx, node);
      return true;
    case "TemplateRenderFunction":
      emitSsrRenderFunctionFallback(ctx, node, shadowed);
      return true;
    default:
      return false;
  }
}
