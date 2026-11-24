/**
 * @dotmix/compiler-ssr/directives/emit-ssr-features — SSR codegen for forms, layouts, stacks, head, async/caching, session, json, dump, and verbatim.
 */

import type {
  ComponentCallNode,
  DumpNode,
  FieldErrorNode,
  FieldValidNode,
  FormErrorsNode,
  HasSectionNode,
  HeadChildEntry,
  HeadGroupNode,
  IncludeFirstNode,
  IncludeNode,
  JsonNode,
  KeepAliveBlockNode,
  LazyNode,
  MemoNode,
  MethodNode,
  OnceNode,
  PartialNode,
  SectionMissingNode,
  SectionNode,
  SessionBlockNode,
  StackNode,
  StackPushNode,
  TemplateNode,
  TryBlockNode,
  VerbatimNode,
  YieldNode
} from "@dotmix/ast";
import { escapeHtml } from "../escape.js";
import type { SsrEmitContext } from "./emit-ssr-attrs.js";

function emitBranchList(ctx: SsrEmitContext, nodes: readonly TemplateNode[], shadowed: ReadonlySet<string>): void {
  for (const child of nodes) ctx.emitNode(child, shadowed);
}

export function emitSsrFieldError(ctx: SsrEmitContext, node: FieldErrorNode, shadowed: ReadonlySet<string>): void {
  const formJs = ctx.transformExpr(node.rawFormExpr, node.formExpr, shadowed);
  const fieldJs = ctx.transformExpr(node.rawFieldName, node.fieldName, shadowed);
  const msgVar = node.asIdentifier ?? `__errMsg_${ctx.nextMarkerId()}`;
  const nextShadowed = new Set(shadowed);
  if (node.asIdentifier) nextShadowed.add(node.asIdentifier);
  ctx.pushCode(`{\n  const __fld = (${formJs})?.field?.(${fieldJs});\n`);
  ctx.pushCode(`  const ${msgVar} = __fld && typeof __fld.touched === "function" && __fld.touched() ? __fld.error() : null;\n`);
  ctx.pushCode(`  if (${msgVar} !== null && ${msgVar} !== undefined) {\n`);
  if (node.children.length > 0) {
    emitBranchList(ctx, node.children, nextShadowed);
  } else {
    ctx.pushCode(`    __html += '<span class="field-error" role="alert">' + __escapeHtml(${msgVar}) + '</span>';\n`);
  }
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrFormErrors(ctx: SsrEmitContext, node: FormErrorsNode, shadowed: ReadonlySet<string>): void {
  const formJs = ctx.transformExpr(node.rawFormExpr, node.formExpr, shadowed);
  const errsVar = node.asIdentifier ?? `__formErrs_${ctx.nextMarkerId()}`;
  const nextShadowed = new Set(shadowed);
  if (node.asIdentifier) nextShadowed.add(node.asIdentifier);
  ctx.pushCode(`{\n  const __fm = (${formJs});\n  const __rawErrs = __fm && typeof __fm.errors === "function" ? __fm.errors() : {};\n`);
  ctx.pushCode(`  const ${errsVar} = Object.entries(__rawErrs).filter(([, msg]) => msg !== null && msg !== undefined).map(([field, message]) => ({ field, message }));\n`);
  ctx.pushCode(`  if (${errsVar}.length > 0) {\n`);
  emitBranchList(ctx, node.children, nextShadowed);
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrFieldValid(ctx: SsrEmitContext, node: FieldValidNode, shadowed: ReadonlySet<string>): void {
  const formJs = ctx.transformExpr(node.rawFormExpr, node.formExpr, shadowed);
  const fieldJs = ctx.transformExpr(node.rawFieldName, node.fieldName, shadowed);
  ctx.pushCode(`{\n  const __fld = (${formJs})?.field?.(${fieldJs});\n`);
  ctx.pushCode(`  if (__fld && typeof __fld.touched === "function" && __fld.touched() && __fld.error() === null && !__fld.validating?.()) {\n`);
  emitBranchList(ctx, node.children, shadowed);
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrCsrf(ctx: SsrEmitContext): void {
  ctx.pushCode(`{\n  const __tok = typeof __ctx?.csrfToken === "function" ? __ctx.csrfToken() : (__ctx?.csrfToken ?? "");\n`);
  ctx.pushCode(`  __html += '<input type="hidden" name="_token" value="' + __escapeHtml(__tok) + '">';\n}\n`);
}

export function emitSsrMethod(ctx: SsrEmitContext, node: MethodNode, shadowed: ReadonlySet<string>): void {
  const methodJs = ctx.transformExpr(node.rawValue, node.value, shadowed);
  ctx.pushCode(`__html += '<input type="hidden" name="_method" value="' + __escapeHtml(${methodJs}) + '">';\n`);
}

export function emitSsrYield(ctx: SsrEmitContext, node: YieldNode, shadowed: ReadonlySet<string>): void {
  const nameExpr = ctx.transformExpr(node.rawName, node.name, shadowed);
  ctx.pushCode(`if (__props.slots && __props.slots[${nameExpr}]) {\n`);
  ctx.pushCode(`  __html += __props.slots[${nameExpr}](__props);\n`);
  ctx.pushCode(`} else {\n`);
  emitBranchList(ctx, node.fallback, shadowed);
  ctx.pushCode(`}\n`);
}

export function emitSsrHasOrMissingSection(
  ctx: SsrEmitContext,
  node: HasSectionNode | SectionMissingNode,
  shadowed: ReadonlySet<string>,
  invert: boolean
): void {
  const nameExpr = ctx.transformExpr(node.rawName, node.name, shadowed);
  const testExpr = invert ? `!(__props.slots && __props.slots[${nameExpr}])` : `Boolean(__props.slots && __props.slots[${nameExpr}])`;
  ctx.pushCode(`if (${testExpr}) {\n`);
  emitBranchList(ctx, node.children, shadowed);
  ctx.pushCode(`}\n`);
}

export function emitSsrStackPush(ctx: SsrEmitContext, node: StackPushNode, shadowed: ReadonlySet<string>): void {
  const targetJs = ctx.transformExpr(node.rawTarget, node.target, shadowed);
  const onceArg = node.onceId ? `, (${ctx.transformExpr(node.rawOnceId ?? "", node.onceId, shadowed)})` : "";
  const bodyCode = ctx.captureBlock(() => emitBranchList(ctx, node.children, shadowed));
  const method = node.operation === "prepend" ? "prepend" : "push";
  ctx.pushCode(`{\n  let __html = "";\n${bodyCode}  if (__ctx?.stacks && typeof __ctx.stacks.${method} === "function") {\n    __ctx.stacks.${method}((${targetJs}), __html${onceArg});\n  }\n}\n`);
}

export function emitSsrStack(ctx: SsrEmitContext, node: StackNode, shadowed: ReadonlySet<string>): void {
  const nameJs = ctx.transformExpr(node.rawName, node.name, shadowed);
  ctx.pushCode(`if (__ctx?.stacks && typeof __ctx.stacks.render === "function") {\n  __html += __ctx.stacks.render((${nameJs}));\n}\n`);
}

function buildHeadTextCode(ctx: SsrEmitContext, nodes: readonly TemplateNode[], shadowed: ReadonlySet<string>): string {
  const pieces: string[] = [];
  for (const child of nodes) {
    if (child.type === "Text") pieces.push(JSON.stringify(child.value));
    else if (child.type === "Interpolation") {
      pieces.push(`String((${ctx.transformExpr(child.rawExpression, child.expression, shadowed)}) ?? "")`);
    }
  }
  return pieces.length > 0 ? pieces.join(" + ") : "\"\"";
}

function buildHeadAttrsExpr(ctx: SsrEmitContext, entry: HeadChildEntry, shadowed: ReadonlySet<string>): string {
  const pairs: string[] = [];
  for (const attr of entry.attributes) {
    if (attr.type === "StaticAttribute") pairs.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value)}`);
    else if (attr.type === "DynamicAttribute") {
      pairs.push(`${JSON.stringify(attr.name)}: String((${ctx.transformExpr(attr.rawExpression, attr.expression, shadowed)}) ?? "")`);
    }
  }
  return `{ ${pairs.join(", ")} }`;
}

export function emitSsrHeadGroup(ctx: SsrEmitContext, node: HeadGroupNode, shadowed: ReadonlySet<string>): void {
  for (const entry of node.entries) {
    if (entry.tag === "title") {
      const textExpr = buildHeadTextCode(ctx, entry.children, shadowed);
      ctx.pushCode(`{\n  const __headTitle = (${textExpr});\n  if (__ctx?.head && typeof __ctx.head.addTitle === "function") {\n    __ctx.head.addTitle(__headTitle);\n  } else {\n    __html += "<title>" + __escapeHtml(__headTitle) + "</title>";\n  }\n}\n`);
    } else {
      const attrsObj = buildHeadAttrsExpr(ctx, entry, shadowed);
      const addMethod = entry.tag === "meta" ? "addMeta" : "addLink";
      ctx.pushCode(`{\n  const __headAttrs = ${attrsObj};\n  if (__ctx?.head && typeof __ctx.head.${addMethod} === "function") {\n    __ctx.head.${addMethod}(__headAttrs);\n  } else {\n    const __attrTxt = Object.entries(__headAttrs).map(([attrKey, attrVal]) => __escapeAttr(attrKey, attrVal)).join("");\n    __html += "<${entry.tag}" + __attrTxt + ">";\n  }\n}\n`);
    }
  }
}

export function emitSsrInclude(ctx: SsrEmitContext, node: IncludeNode, shadowed: ReadonlySet<string>): void {
  const compJs = ctx.transformExpr(node.rawComponent, node.component, shadowed);
  const propsJs = node.props ? ctx.transformExpr(node.rawProps ?? "", node.props, shadowed) : "{}";
  const condCheck = node.condition ? `Boolean(${ctx.transformExpr(node.rawCondition ?? "", node.condition, shadowed)})` : "true";
  const unlessCheck = node.unless ? `!(${ctx.transformExpr(node.rawUnless ?? "", node.unless, shadowed)})` : "true";
  ctx.pushCode(`if ((${condCheck}) && (${unlessCheck})) {\n`);
  ctx.pushCode(`  const __incTarget = (${compJs});\n  const __incProps = (${propsJs}) || {};\n`);
  ctx.pushCode(`  if (typeof __incTarget === "function") {\n`);
  ctx.pushCode(`    if (__incTarget.renderToString) __html += __incTarget.renderToString(__incProps, __ctx);\n`);
  ctx.pushCode(`    else { const __incOut = __incTarget(__incProps); if (typeof __incOut === "string") __html += __incOut; }\n  }\n`);
  if (node.fallback.length > 0) {
    ctx.pushCode(`} else {\n`);
    emitBranchList(ctx, node.fallback, shadowed);
  }
  ctx.pushCode(`}\n`);
}

export function emitSsrIncludeFirst(ctx: SsrEmitContext, node: IncludeFirstNode, shadowed: ReadonlySet<string>): void {
  const candsJs = ctx.transformExpr(node.rawCandidates, node.candidates, shadowed);
  const propsJs = node.props ? ctx.transformExpr(node.rawProps ?? "", node.props, shadowed) : "{}";
  ctx.pushCode(`{\n  const __cands = (${candsJs}) || [];\n  const __incProps = (${propsJs}) || {};\n  let __incRendered = false;\n`);
  ctx.pushCode(`  for (const __cand of __cands) {\n    if (typeof __cand === "function") {\n`);
  ctx.pushCode(`      if (__cand.renderToString) { __html += __cand.renderToString(__incProps, __ctx); __incRendered = true; break; }\n`);
  ctx.pushCode(`      const __candOut = __cand(__incProps); if (typeof __candOut === "string") { __html += __candOut; __incRendered = true; break; }\n    }\n  }\n`);
  if (node.fallback.length > 0) {
    ctx.pushCode(`  if (!__incRendered) {\n`);
    emitBranchList(ctx, node.fallback, shadowed);
    ctx.pushCode(`  }\n`);
  }
  ctx.pushCode(`}\n`);
}

export function emitSsrKeepAlive(ctx: SsrEmitContext, node: KeepAliveBlockNode, shadowed: ReadonlySet<string>): void {
  const keyJs = ctx.transformExpr(node.rawActiveKey, node.activeKey, shadowed);
  const keyVar = node.asIdentifier ?? `__kaKey_${ctx.nextMarkerId()}`;
  const nextShadowed = new Set(shadowed);
  if (node.asIdentifier) nextShadowed.add(node.asIdentifier);
  ctx.pushCode(`{\n  const ${keyVar} = (${keyJs});\n`);
  emitBranchList(ctx, node.children, nextShadowed);
  ctx.pushCode(`}\n`);
}

export function emitSsrSession(ctx: SsrEmitContext, node: SessionBlockNode, shadowed: ReadonlySet<string>): void {
  const keyJs = ctx.transformExpr(node.rawKey, node.key, shadowed);
  const sessVar = node.asIdentifier ?? `__sessVal_${ctx.nextMarkerId()}`;
  const nextShadowed = new Set(shadowed);
  if (node.asIdentifier) nextShadowed.add(node.asIdentifier);
  ctx.pushCode(`{\n  const __sKey = (${keyJs});\n  const ${sessVar} = typeof __ctx?.session === "function" ? __ctx.session(__sKey) : __ctx?.session?.[__sKey];\n`);
  ctx.pushCode(`  if (${sessVar} !== null && ${sessVar} !== undefined) {\n`);
  emitBranchList(ctx, node.consequent, nextShadowed);
  if (node.alternate) {
    ctx.pushCode(`  } else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrPartial(ctx: SsrEmitContext, node: PartialNode, shadowed: ReadonlySet<string>): void {
  const nameJs = ctx.transformExpr(node.rawName, node.name, shadowed);
  ctx.pushCode(`{\n  const __pName = String(${nameJs});\n`);
  ctx.pushCode(`  __html += "<!--mix:partial-start:" + __escapeHtml(__pName) + "-->";\n`);
  ctx.pushCode(`  const __pStart = __html.length;\n`);
  emitBranchList(ctx, node.children, shadowed);
  ctx.pushCode(`  const __pHtml = __html.slice(__pStart);\n`);
  ctx.pushCode(`  if (__ctx && typeof __ctx === "object") {\n`);
  ctx.pushCode(`    if (__ctx.partial === __pName) __ctx.__capturedPartial = __pHtml;\n`);
  ctx.pushCode(`    if (__ctx.partials && typeof __ctx.partials === "object") __ctx.partials[__pName] = __pHtml;\n`);
  ctx.pushCode(`  }\n`);
  ctx.pushCode(`  __html += "<!--mix:partial-end:" + __escapeHtml(__pName) + "-->";\n}\n`);
}

export function emitSsrJson(ctx: SsrEmitContext, node: JsonNode, shadowed: ReadonlySet<string>): void {
  ctx.requireHelper("escapeJson");
  const idJs = ctx.transformExpr(node.rawId, node.id, shadowed);
  const dataJs = ctx.transformExpr(node.rawData, node.data, shadowed);
  ctx.pushCode(`__html += '<script type="application/json" id="' + __escapeHtml(${idJs}) + '">' + __mixSsrEscapeJson(${dataJs}) + '</script>';\n`);
}

export function emitSsrDump(ctx: SsrEmitContext, node: DumpNode, shadowed: ReadonlySet<string>): void {
  if (ctx.mode !== "development") return;
  ctx.requireHelper("escapeJson");
  const valJs = ctx.transformExpr(node.rawValue, node.value, shadowed);
  ctx.pushCode(`__html += '<details class="mix-dump"><summary>Dump</summary><pre>' + __escapeHtml(__mixSsrEscapeJson((${valJs}), 2)) + '</pre></details>';\n`);
}

export function emitSsrVerbatim(ctx: SsrEmitContext, node: VerbatimNode): void {
  ctx.pushCode(`__html += ${JSON.stringify(escapeHtml(node.content))};\n`);
}

export function emitSsrComponentSectionsAndChildren(
  ctx: SsrEmitContext,
  call: ComponentCallNode,
  shadowed: ReadonlySet<string>,
  propEntries: string[]
): void {
  const defaultNodes: TemplateNode[] = [];
  const slotEntries: string[] = [];

  for (const child of call.children) {
    if (child.type === "Section") {
      const bodyCode = ctx.captureBlock(() => emitBranchList(ctx, child.children, shadowed));
      const slotFn = `() => {\n  let __html = "";\n${bodyCode}  return __html;\n}`;
      if (child.name.type === "Literal" && typeof child.name.value === "string") {
        slotEntries.push(`${JSON.stringify(child.name.value)}: ${slotFn}`);
      } else {
        const nameExpr = ctx.transformExpr(child.rawName, child.name, shadowed);
        slotEntries.push(`[${nameExpr}]: ${slotFn}`);
      }
    } else {
      defaultNodes.push(child);
    }
  }

  if (defaultNodes.length > 0) {
    const childCode = ctx.captureBlock(() => emitBranchList(ctx, defaultNodes, shadowed));
    const childFn = `() => {\n  let __html = "";\n${childCode}  return __html;\n}`;
    propEntries.push(`children: ${childFn}`);
    slotEntries.unshift(`default: ${childFn}`);
  }
  if (slotEntries.length > 0) {
    propEntries.push(`slots: { ${slotEntries.join(", ")} }`);
  }
}

export function emitSsrChildrenWrapper(
  ctx: SsrEmitContext,
  node: OnceNode | MemoNode | LazyNode | SectionNode,
  shadowed: ReadonlySet<string>
): void {
  emitBranchList(ctx, node.children, shadowed);
}

export function emitSsrTryBlock(
  ctx: SsrEmitContext,
  node: TryBlockNode,
  shadowed: ReadonlySet<string>
): void {
  const id = ctx.nextMarkerId();
  if (ctx.includeMarkers) ctx.pushCode(`__html += "<!--mix:try:${id}-->";\n`);
  ctx.pushCode(`{\n  const __trySavedHtml_${id} = __html;\n  try {\n`);
  emitBranchList(ctx, node.children, shadowed);
  ctx.pushCode(`  } catch (__tryErr_${id}) {\n    __html = __trySavedHtml_${id};\n`);
  const fallbackShadowed = new Set(shadowed);
  if (node.catchIdentifier) {
    fallbackShadowed.add(node.catchIdentifier);
    ctx.pushCode(`    const ${node.catchIdentifier} = __tryErr_${id};\n`);
  }
  if (node.resetIdentifier) {
    fallbackShadowed.add(node.resetIdentifier);
    ctx.pushCode(`    const ${node.resetIdentifier} = () => {};\n`);
  }
  emitBranchList(ctx, node.fallback, fallbackShadowed);
  ctx.pushCode(`  }\n}\n`);
  if (ctx.includeMarkers) ctx.pushCode(`__html += "<!--/mix:try:${id}-->";\n`);
}
