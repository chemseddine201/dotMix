/**
 * @dotmix/compiler-codegen/directives/emit-layouts-runtime — Client codegen for layouts, stacks, head, async composition, caching, session, json, dump, and verbatim.
 */

import type {
  DumpNode,
  HasSectionNode,
  HeadChildEntry,
  HeadGroupNode,
  IncludeFirstNode,
  IncludeNode,
  JsonNode,
  KeepAliveBlockNode,
  LazyNode,
  MemoNode,
  OnceNode,
  PartialNode,
  SectionMissingNode,
  SectionNode,
  SessionBlockNode,
  StackNode,
  StackPushNode,
  TemplateNode,
  VerbatimNode,
  YieldNode
} from "@dotmix/ast";
import { indentLines } from "../types.js";
import type { CodegenContext } from "../context.js";
import { emitFragRenderFn } from "./emit-control.js";

function emitHeadTextExpr(
  ctx: CodegenContext,
  nodes: readonly TemplateNode[],
  loopGetters: ReadonlyMap<string, string>
): string {
  const parts: string[] = [];
  for (const child of nodes) {
    if (child.type === "Text") {
      parts.push(JSON.stringify(child.value));
    } else if (child.type === "Interpolation") {
      const jsExpr = ctx.emitExpr(child.rawExpression, child.expression, loopGetters);
      parts.push(`String((${jsExpr}) ?? "")`);
    }
  }
  return parts.length > 0 ? parts.join(" + ") : "\"\"";
}

function emitHeadEntryObject(
  ctx: CodegenContext,
  entry: HeadChildEntry,
  loopGetters: ReadonlyMap<string, string>
): string {
  if (entry.tag === "title") {
    const textExpr = emitHeadTextExpr(ctx, entry.children, loopGetters);
    return `{ kind: "title", text: () => (${textExpr}) }`;
  }
  const attrPairs: string[] = [];
  for (const attr of entry.attributes) {
    if (attr.type === "StaticAttribute") {
      attrPairs.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value)}`);
    } else if (attr.type === "DynamicAttribute") {
      const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
      attrPairs.push(`${JSON.stringify(attr.name)}: String((${jsExpr}) ?? "")`);
    }
  }
  return `{ kind: ${JSON.stringify(entry.tag)}, attrs: () => ({ ${attrPairs.join(", ")} }) }`;
}

export function emitHeadGroup(
  ctx: CodegenContext,
  node: HeadGroupNode,
  loopGetters: ReadonlyMap<string, string>
): string[] {
  if (node.entries.length === 0) return [];
  const headHelper = ctx.useHelper("__mixHead");
  const specs = node.entries.map((entry) => emitHeadEntryObject(ctx, entry, loopGetters));
  return [`${headHelper}([${specs.join(", ")}]);`];
}

export function emitSectionFallback(
  ctx: CodegenContext,
  node: SectionNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  return ctx.emitTemplateNodes(node.children, parentVar, loopGetters, inSvg);
}

export function emitYield(
  ctx: CodegenContext,
  node: YieldNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const nameArg =
    node.name.type === "Literal" && typeof node.name.value === "string"
      ? JSON.stringify(node.name.value)
      : `(${ctx.emitExpr(node.rawName, node.name, loopGetters)})`;
  const fallbackFn = node.fallback.length > 0
    ? emitFragRenderFn(ctx, node.fallback, loopGetters, inSvg, "yieldFallbackFrag")
    : "null";
  return [`__renderSlot(${parentVar}, ${nameArg}, ${fallbackFn});`];
}

export function emitHasOrMissingSection(
  ctx: CodegenContext,
  node: HasSectionNode | SectionMissingNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean,
  invert: boolean
): string[] {
  const nameExpr =
    node.name.type === "Literal" && typeof node.name.value === "string"
      ? JSON.stringify(node.name.value)
      : `(${ctx.emitExpr(node.rawName, node.name, loopGetters)})`;
  const renderFn = emitFragRenderFn(ctx, node.children, loopGetters, inSvg, "sectionCondFrag");
  const condBody = invert ? `!(__props?.slots?.[${nameExpr}])` : `Boolean(__props?.slots?.[${nameExpr}])`;
  return [
    `__createConditional(${parentVar}, [`,
    `  {`,
    `    condition: () => ${condBody},`,
    `    render: ${indentLines(renderFn, 4).trimStart()}`,
    `  }`,
    `], null);`
  ];
}

export function emitStackPush(
  ctx: CodegenContext,
  node: StackPushNode,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const helperName = ctx.useHelper(node.operation === "prepend" ? "__mixPrependStack" : "__mixPushStack");
  const targetJs = ctx.emitExpr(node.rawTarget, node.target, loopGetters);
  const renderFn = emitFragRenderFn(ctx, node.children, loopGetters, inSvg, "stackFrag");
  const onceArg = node.onceId ? `, (${ctx.emitExpr(node.rawOnceId ?? "", node.onceId, loopGetters)})` : "";
  return [`${helperName}((${targetJs}), ${renderFn}${onceArg});`];
}

export function emitStack(
  ctx: CodegenContext,
  node: StackNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>
): string[] {
  const stackHelper = ctx.useHelper("__mixRenderStack");
  const nameJs = ctx.emitExpr(node.rawName, node.name, loopGetters);
  return [`${stackHelper}(${parentVar}, (${nameJs}));`];
}

export function emitInclude(
  ctx: CodegenContext,
  node: IncludeNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const includeHelper = ctx.useHelper("__mixInclude");
  const compJs = ctx.emitExpr(node.rawComponent, node.component, loopGetters);
  const propsArg = node.props ? `() => (${ctx.emitExpr(node.rawProps ?? "", node.props, loopGetters)})` : "null";
  const optFields: string[] = [];
  if (node.condition) {
    optFields.push(`condition: () => (${ctx.emitExpr(node.rawCondition ?? "", node.condition, loopGetters)})`);
  }
  if (node.unless) {
    optFields.push(`unless: () => (${ctx.emitExpr(node.rawUnless ?? "", node.unless, loopGetters)})`);
  }
  if (node.pending.length > 0) {
    optFields.push(`pending: ${emitFragRenderFn(ctx, node.pending, loopGetters, inSvg, "incPendingFrag")}`);
  }
  if (node.fallback.length > 0) {
    optFields.push(`fallback: ${emitFragRenderFn(ctx, node.fallback, loopGetters, inSvg, "incFallbackFrag")}`);
  }
  const optsArg = optFields.length > 0 ? `{ ${optFields.join(", ")} }` : "undefined";
  return [`${includeHelper}(${parentVar}, () => (${compJs}), ${propsArg}, ${optsArg});`];
}

export function emitIncludeFirst(
  ctx: CodegenContext,
  node: IncludeFirstNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const firstHelper = ctx.useHelper("__mixIncludeFirst");
  const candidatesJs = ctx.emitExpr(node.rawCandidates, node.candidates, loopGetters);
  const propsArg = node.props ? `() => (${ctx.emitExpr(node.rawProps ?? "", node.props, loopGetters)})` : "null";
  const optFields: string[] = [];
  if (node.pending.length > 0) {
    optFields.push(`pending: ${emitFragRenderFn(ctx, node.pending, loopGetters, inSvg, "incPendingFrag")}`);
  }
  if (node.fallback.length > 0) {
    optFields.push(`fallback: ${emitFragRenderFn(ctx, node.fallback, loopGetters, inSvg, "incFallbackFrag")}`);
  }
  const optsArg = optFields.length > 0 ? `{ ${optFields.join(", ")} }` : "undefined";
  return [`${firstHelper}(${parentVar}, () => (${candidatesJs}), ${propsArg}, ${optsArg});`];
}

export function emitOnce(
  ctx: CodegenContext,
  node: OnceNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const onceHelper = ctx.useHelper("__mixOnce");
  const renderFn = emitFragRenderFn(ctx, node.children, loopGetters, inSvg, "onceFrag");
  return [`${onceHelper}(${parentVar}, ${indentLines(renderFn, 2).trimStart()});`];
}

export function emitMemo(
  ctx: CodegenContext,
  node: MemoNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const memoHelper = ctx.useHelper("__mixMemo");
  const depsJs = ctx.emitExpr(node.rawDeps, node.deps, loopGetters);
  const renderFn = emitFragRenderFn(ctx, node.children, loopGetters, inSvg, "memoFrag");
  const equalsArg = node.equals ? `(${ctx.emitExpr(node.rawEquals ?? "", node.equals, loopGetters)})` : "null";
  return [`${memoHelper}(${parentVar}, () => (${depsJs}), ${indentLines(renderFn, 2).trimStart()}, ${equalsArg});`];
}

export function emitLazy(
  ctx: CodegenContext,
  node: LazyNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const lazyHelper = ctx.useHelper("__mixLazy");
  const renderFn = emitFragRenderFn(ctx, node.children, loopGetters, inSvg, "lazyFrag");
  const fallbackArg = node.fallback.length > 0
    ? emitFragRenderFn(ctx, node.fallback, loopGetters, inSvg, "lazyFallbackFrag")
    : "null";
  return [`${lazyHelper}(${parentVar}, ${JSON.stringify(node.trigger)}, ${indentLines(renderFn, 2).trimStart()}, ${fallbackArg});`];
}

export function emitKeepAliveBlock(
  ctx: CodegenContext,
  node: KeepAliveBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const kaHelper = ctx.useHelper("KeepAlive as __KeepAlive");
  const keyJs = ctx.emitExpr(node.rawActiveKey, node.activeKey, loopGetters);
  const keyParamVar = ctx.nextId("kaKey");
  const keyGetterVar = ctx.nextId("get_kaKey");
  const nextGetters = new Map(loopGetters);
  if (node.asIdentifier) {
    nextGetters.set(node.asIdentifier, keyGetterVar);
  }
  const bodyFrag = ctx.nextId("kaFrag");
  const bodyLines = [
    `const ${keyGetterVar} = () => ${keyParamVar};`,
    `void ${keyGetterVar};`,
    `const ${bodyFrag} = document.createDocumentFragment();`,
    ...ctx.emitTemplateNodes(node.children, bodyFrag, nextGetters, inSvg),
    `return [...${bodyFrag}.childNodes];`
  ];
  const maxField = node.max ? `, max: (${ctx.emitExpr(node.rawMax ?? "", node.max, loopGetters)})` : "";
  return [
    `${kaHelper}({`,
    `  activeKey: () => (${keyJs})${maxField},`,
    `  children: (${keyParamVar}) => {`,
    indentLines(bodyLines.join("\n"), 4),
    `  }`,
    `}, ${parentVar});`
  ];
}

export function emitSessionBlock(
  ctx: CodegenContext,
  node: SessionBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const sessionHelper = ctx.useHelper("__mixSessionBlock");
  const keyJs = ctx.emitExpr(node.rawKey, node.key, loopGetters);
  const getterVar = ctx.nextId("get_sessionVal");
  const nextGetters = new Map(loopGetters);
  if (node.asIdentifier) {
    nextGetters.set(node.asIdentifier, getterVar);
  }
  const renderFn = emitFragRenderFn(ctx, node.consequent, nextGetters, inSvg, "sessionFrag", [getterVar]);
  const elseFn = node.alternate ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "elseFrag") : "null";
  return [
    `${sessionHelper}(${parentVar}, (${keyJs}), ${indentLines(renderFn, 2).trimStart()}, ${elseFn});`
  ];
}

export function emitPartial(
  ctx: CodegenContext,
  node: PartialNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  return ctx.emitTemplateNodes(node.children, parentVar, loopGetters, inSvg);
}

export function emitJson(
  ctx: CodegenContext,
  node: JsonNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>
): string[] {
  const jsonHelper = ctx.useHelper("__mixJsonScript");
  const idJs = ctx.emitExpr(node.rawId, node.id, loopGetters);
  const dataJs = ctx.emitExpr(node.rawData, node.data, loopGetters);
  return [`${jsonHelper}(${parentVar}, (${idJs}), () => (${dataJs}));`];
}

export function emitDump(
  ctx: CodegenContext,
  node: DumpNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>
): string[] {
  if (ctx.mode !== "development") {
    return [];
  }
  const jsonFmtHelper = ctx.useHelper("__mixJson");
  const valJs = ctx.emitExpr(node.rawValue, node.value, loopGetters);
  const detailsVar = ctx.nextId("dumpDetails");
  const summaryVar = ctx.nextId("dumpSummary");
  const preVar = ctx.nextId("dumpPre");
  const txtVar = ctx.nextId("dumpTxt");
  return [
    `const ${detailsVar} = __createElement("details");`,
    `__setAttribute(${detailsVar}, "class", "mix-dump");`,
    `const ${summaryVar} = __createElement("summary");`,
    `__insertNode(${summaryVar}, __createTextNode("Dump"));`,
    `const ${preVar} = __createElement("pre");`,
    `const ${txtVar} = __createTextNode("");`,
    `createEffect(() => { __setText(${txtVar}, ${jsonFmtHelper}((${valJs}), 2)); });`,
    `__insertNode(${preVar}, ${txtVar});`,
    `__insertNode(${detailsVar}, ${summaryVar});`,
    `__insertNode(${detailsVar}, ${preVar});`,
    `__insertNode(${parentVar}, ${detailsVar});`
  ];
}

export function emitVerbatim(
  ctx: CodegenContext,
  node: VerbatimNode,
  parentVar: string
): string[] {
  const txtVar = ctx.nextId("verbatimTxt");
  return [
    `const ${txtVar} = __createTextNode(${JSON.stringify(node.content)});`,
    `__insertNode(${parentVar}, ${txtVar});`
  ];
}
