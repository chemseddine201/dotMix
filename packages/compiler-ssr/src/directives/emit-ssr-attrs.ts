/**
 * @dotmix/compiler-ssr/directives/emit-ssr-attrs — SSR helpers and attribute/slot/expression directive emitters.
 */

import {
  DIRECTIVE_GRAMMAR,
  isESTreeNode,
  type AttributeNode,
  type ClassMapNode,
  type ConditionalAttributeNode,
  type ESTreeNode,
  type StyleMapNode,
  type TemplateNode
} from "@dotmix/ast";
import { getBareGetterIdents } from "@dotmix/compiler-semantic";

const BOOLEAN_HTML_ATTR_SET = new Set<string>(DIRECTIVE_GRAMMAR.booleanHtmlAttributes);

export interface SsrEmitContext {
  readonly mode: string;
  readonly includeMarkers: boolean;
  readonly signalNames: ReadonlySet<string>;
  nextMarkerId(): number;
  transformExpr(raw: string, ast: ESTreeNode | undefined, shadowed: ReadonlySet<string>): string;
  emitNode(node: TemplateNode, shadowed: ReadonlySet<string>): void;
  pushCode(code: string): void;
  captureBlock(renderNodes: () => void): string;
  requireHelper(name: SsrHelperId): void;
}

export type SsrHelperId =
  | "isEmpty"
  | "escapeJson"
  | "eachPipeline"
  | "forRange"
  | "forTimes"
  | "formatStyleProp"
  | "classAttr"
  | "styleAttr";

const SSR_HELPER_SNIPPETS: Record<SsrHelperId, string> = {
  isEmpty: `function __mixSsrIsEmpty(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === null || proto === Object.prototype) return Object.keys(value).length === 0;
  }
  return false;
}`,
  escapeJson: `function __mixSsrEscapeJson(value, space) {
  const serialized = JSON.stringify(value, null, space) ?? "null";
  return serialized.replace(/</g, "\\\\u003c").replace(/\\u2028/g, "\\\\u2028").replace(/\\u2029/g, "\\\\u2029");
}`,
  eachPipeline: `function __mixSsrEachPipeline(items, opts) {
  let list = Array.isArray(items) ? items : [];
  if (opts.skip) {
    const kept = [];
    for (let i = 0; i < list.length; i++) {
      if (!opts.skip(list[i], i)) kept.push(list[i]);
    }
    list = kept;
  }
  if (opts.stop) {
    const taken = [];
    for (let i = 0; i < list.length; i++) {
      if (opts.stop(list[i], i)) break;
      taken.push(list[i]);
    }
    list = taken;
  }
  return list;
}`,
  forRange: `function __mixSsrForRange(start, end, step) {
  const resolvedStep = step === undefined ? (start > end ? -1 : 1) : step;
  if (resolvedStep === 0 || !Number.isFinite(start) || !Number.isFinite(end)) return [];
  if ((resolvedStep > 0 && start > end) || (resolvedStep < 0 && start < end)) return [];
  const out = [];
  for (let current = start; resolvedStep > 0 ? current <= end : current >= end; current += resolvedStep) {
    out.push(current);
    if (out.length > 100000) break;
  }
  return out;
}`,
  forTimes: `function __mixSsrForTimes(count) {
  const total = Number.isFinite(count) ? Math.min(Math.max(Math.floor(count), 0), 100000) : 0;
  const out = [];
  for (let i = 0; i < total; i++) out.push(i);
  return out;
}`,
  formatStyleProp: `function __mixSsrFormatStyle(prop, rawValue, unit) {
  if (rawValue === null || rawValue === undefined) return "";
  const formatted = typeof rawValue === "number" && unit ? String(rawValue) + unit : String(rawValue);
  return prop + ": " + formatted + "; ";
}`,
  classAttr: `function __mixSsrClassTokens(input) {
  const tokens = [];
  if (typeof input === "string") { if (input.trim()) tokens.push(input.trim()); }
  else if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      if (input[i]) tokens.push(String(input[i]));
    }
  } else if (input && typeof input === "object") {
    for (const [cls, active] of Object.entries(input)) {
      if (active) tokens.push(cls);
    }
  }
  return tokens.join(" ");
}`,
  styleAttr: `function __mixSsrStyleMap(map) {
  if (!map || typeof map !== "object") return "";
  let out = "";
  for (const [prop, styleVal] of Object.entries(map)) {
    if (styleVal !== null && styleVal !== undefined) out += prop + ": " + String(styleVal) + "; ";
  }
  return out.trim();
}`
};

export function renderUsedSsrHelpers(usedHelpers: ReadonlySet<SsrHelperId>): string {
  const chunks: string[] = [];
  for (const helperId of usedHelpers) {
    chunks.push(SSR_HELPER_SNIPPETS[helperId]);
  }
  return chunks.join("\n\n");
}

export function hasSsrDirectiveModifiers(attributes: readonly AttributeNode[]): boolean {
  for (const attr of attributes) {
    if (
      attr.type === "ConditionalAttribute" ||
      attr.type === "ConditionalEvent" ||
      attr.type === "ClassMap" ||
      attr.type === "StyleMap" ||
      attr.type === "ConditionalSpread"
    ) {
      return true;
    }
    if (attr.type === "DynamicAttribute" && BOOLEAN_HTML_ATTR_SET.has(attr.name)) {
      return true;
    }
  }
  return false;
}

export function createSsrEmitContext(config: {
  mode: string;
  includeMarkers: boolean;
  signalNames: ReadonlySet<string>;
  nextMarkerId: () => number;
  transformExpr: SsrEmitContext["transformExpr"];
  emitNode: SsrEmitContext["emitNode"];
  parts: string[];
  usedHelpers: Set<SsrHelperId>;
}): SsrEmitContext {
  return {
    mode: config.mode,
    includeMarkers: config.includeMarkers,
    signalNames: config.signalNames,
    nextMarkerId: config.nextMarkerId,
    transformExpr: config.transformExpr,
    emitNode: config.emitNode,
    pushCode: (chunk) => { config.parts.push(chunk); },
    captureBlock: (run) => {
      const idx = config.parts.length;
      run();
      return config.parts.splice(idx).join("");
    },
    requireHelper: (helperId) => { config.usedHelpers.add(helperId); }
  };
}

export function rewriteBareGettersForSsr(
  rawExpression: string,
  expressionAst: ESTreeNode | undefined,
  signalNames: ReadonlySet<string>,
  shadowed: ReadonlySet<string>,
  baseTransform: (raw: string, ast: ESTreeNode | undefined, sigs: ReadonlySet<string>, sh: ReadonlySet<string>) => string
): string {
  const bareIdents = expressionAst ? getBareGetterIdents(expressionAst) : undefined;
  if (!expressionAst || !bareIdents || bareIdents.size === 0) {
    return baseTransform(rawExpression, expressionAst, signalNames, shadowed);
  }
  const baseOffset = expressionAst.start ?? 0;
  function visitBare(node: ESTreeNode, parentNode: ESTreeNode | null, parentKey: string | null): string {
    const relStart = (node.start ?? baseOffset) - baseOffset;
    const relEnd = (node.end ?? baseOffset + rawExpression.length) - baseOffset;
    if (node.type === "Identifier" && typeof node.name === "string") {
      if (bareIdents!.has(node.name) && shadowed.has(node.name)) {
        return `(() => ${node.name})`;
      }
      if (
        signalNames.has(node.name) &&
        !shadowed.has(node.name) &&
        !(parentNode && parentNode.type === "CallExpression" && parentKey === "callee")
      ) {
        return `${node.name}()`;
      }
      return rawExpression.slice(relStart, relEnd);
    }
    const partsOut: Array<{ start: number; end: number; text: string }> = [];
    for (const [propKey, propValue] of Object.entries(node)) {
      if (propKey === "type" || propKey === "start" || propKey === "end" || propKey === "loc" || propKey === "range") continue;
      if (node.type === "MemberExpression" && propKey === "property" && node.computed === false) continue;
      if ((node.type === "Property" || node.type === "ObjectProperty") && propKey === "key" && node.computed === false && node.shorthand !== true) continue;
      if (Array.isArray(propValue)) {
        for (const elem of propValue) {
          if (isESTreeNode(elem) && typeof elem.start === "number" && typeof elem.end === "number") {
            partsOut.push({ start: elem.start - baseOffset, end: elem.end - baseOffset, text: visitBare(elem, node, propKey) });
          }
        }
      } else if (isESTreeNode(propValue) && typeof propValue.start === "number" && typeof propValue.end === "number") {
        partsOut.push({ start: propValue.start - baseOffset, end: propValue.end - baseOffset, text: visitBare(propValue, node, propKey) });
      }
    }
    if (partsOut.length === 0) return rawExpression.slice(relStart, relEnd);
    partsOut.sort((left, right) => left.start - right.start);
    let combined = "";
    let cursor = relStart;
    for (const rep of partsOut) {
      if (rep.start < cursor || rep.end > relEnd) continue;
      combined += rawExpression.slice(cursor, rep.start) + rep.text;
      cursor = rep.end;
    }
    return combined + rawExpression.slice(cursor, relEnd);
  }
  return visitBare(expressionAst, null, null);
}

function formatCondAttrValue(
  ctx: SsrEmitContext,
  attr: ConditionalAttributeNode | Extract<AttributeNode, { type: "StaticAttribute" | "DynamicAttribute" }> | undefined,
  shadowed: ReadonlySet<string>
): string {
  if (!attr) return "true";
  if (attr.type === "StaticAttribute") return JSON.stringify(attr.value ?? "");
  if (attr.type === "DynamicAttribute") return `(${ctx.transformExpr(attr.rawExpression, attr.expression, shadowed)})`;
  if (attr.isStatic) return JSON.stringify(attr.staticValue ?? "");
  if (attr.expression) return `(${ctx.transformExpr(attr.rawExpression, attr.expression, shadowed)})`;
  return "true";
}

export function emitSsrDirectiveAttributes(
  ctx: SsrEmitContext,
  attributes: readonly AttributeNode[],
  shadowed: ReadonlySet<string>
): void {
  const condAttrsByName = new Map<string, ConditionalAttributeNode[]>();
  const baseAttrByName = new Map<string, Extract<AttributeNode, { type: "StaticAttribute" | "DynamicAttribute" }>>();
  const classAttrs: Array<ClassMapNode | Extract<AttributeNode, { type: "StaticAttribute" | "DynamicAttribute" }>> = [];
  const styleAttrs: Array<StyleMapNode | Extract<AttributeNode, { type: "StaticAttribute" | "DynamicAttribute" }>> = [];

  for (const attr of attributes) {
    if (attr.type === "ConditionalAttribute") {
      const list = condAttrsByName.get(attr.name) ?? [];
      list.push(attr);
      condAttrsByName.set(attr.name, list);
    } else if (attr.type === "StaticAttribute" || attr.type === "DynamicAttribute") {
      if (attr.name === "class") classAttrs.push(attr);
      else if (attr.name === "style") styleAttrs.push(attr);
      else baseAttrByName.set(attr.name, attr);
    } else if (attr.type === "ClassMap") {
      classAttrs.push(attr);
    } else if (attr.type === "StyleMap") {
      styleAttrs.push(attr);
    }
  }

  const emittedConds = new Set<string>();
  let emittedClassGroup = false;
  let emittedStyleGroup = false;

  for (const attr of attributes) {
    if (attr.type === "StaticAttribute") {
      if (attr.name === "class" || attr.name === "style") {
        if (attr.name === "class" && !emittedClassGroup) {
          emittedClassGroup = true;
          emitCombinedClassAttrs(ctx, classAttrs, shadowed);
        } else if (attr.name === "style" && !emittedStyleGroup) {
          emittedStyleGroup = true;
          emitCombinedStyleAttrs(ctx, styleAttrs, shadowed);
        }
        continue;
      }
      if (condAttrsByName.has(attr.name) || attr.name.startsWith("on:")) continue;
      ctx.pushCode(`__html += __escapeAttr(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});\n`);
    } else if (attr.type === "DynamicAttribute") {
      if (attr.name === "class" || attr.name === "style") {
        if (attr.name === "class" && !emittedClassGroup) {
          emittedClassGroup = true;
          emitCombinedClassAttrs(ctx, classAttrs, shadowed);
        } else if (attr.name === "style" && !emittedStyleGroup) {
          emittedStyleGroup = true;
          emitCombinedStyleAttrs(ctx, styleAttrs, shadowed);
        }
        continue;
      }
      if (condAttrsByName.has(attr.name)) continue;
      const expr = ctx.transformExpr(attr.rawExpression, attr.expression, shadowed);
      if (BOOLEAN_HTML_ATTR_SET.has(attr.name)) {
        ctx.pushCode(`if (Boolean(${expr})) __html += " " + ${JSON.stringify(attr.name)};\n`);
      } else {
        ctx.pushCode(`__html += __escapeAttr(${JSON.stringify(attr.name)}, ${expr});\n`);
      }
    } else if (attr.type === "ClassMap") {
      if (!emittedClassGroup) {
        emittedClassGroup = true;
        emitCombinedClassAttrs(ctx, classAttrs, shadowed);
      }
    } else if (attr.type === "StyleMap") {
      if (!emittedStyleGroup) {
        emittedStyleGroup = true;
        emitCombinedStyleAttrs(ctx, styleAttrs, shadowed);
      }
    } else if (attr.type === "ConditionalAttribute") {
      if (emittedConds.has(attr.name)) continue;
      emittedConds.add(attr.name);
      const group = condAttrsByName.get(attr.name) ?? [];
      const baseAttr = baseAttrByName.get(attr.name);
      const matchAttr = group.find((entry) => entry.modifier === "match");
      const caseAttrs = group.filter((entry) => entry.modifier === "case");
      const elseAttr = group.find((entry) => entry.modifier === "else");

      if (matchAttr && matchAttr.expression) {
        const subjExpr = ctx.transformExpr(matchAttr.rawExpression, matchAttr.expression, shadowed);
        ctx.pushCode(`{\n  const __matchSubj = String(${subjExpr});\n`);
        for (let i = 0; i < caseAttrs.length; i++) {
          const caseEntry = caseAttrs[i]!;
          const prefix = i === 0 ? "if" : "} else if";
          ctx.pushCode(`  ${prefix} (__matchSubj === ${JSON.stringify(caseEntry.caseToken ?? "")}) {\n`);
          ctx.pushCode(`    __html += __escapeAttr(${JSON.stringify(attr.name)}, ${formatCondAttrValue(ctx, caseEntry, shadowed)});\n`);
        }
        if (elseAttr) {
          ctx.pushCode(caseAttrs.length > 0 ? `  } else {\n` : `  {\n`);
          ctx.pushCode(`    __html += __escapeAttr(${JSON.stringify(attr.name)}, ${formatCondAttrValue(ctx, elseAttr, shadowed)});\n`);
        }
        if (caseAttrs.length > 0 || elseAttr) ctx.pushCode(`  }\n`);
        ctx.pushCode(`}\n`);
        continue;
      }

      const gateAttr = group.find((entry) => entry.modifier === "if" || entry.modifier === "unless");
      if (gateAttr && gateAttr.expression) {
        const condExpr = ctx.transformExpr(gateAttr.rawExpression, gateAttr.expression, shadowed);
        const testExpr = gateAttr.modifier === "unless" ? `!(${condExpr})` : `(${condExpr})`;
        ctx.pushCode(`if (${testExpr}) {\n`);
        ctx.pushCode(`  __html += __escapeAttr(${JSON.stringify(attr.name)}, ${formatCondAttrValue(ctx, baseAttr, shadowed)});\n`);
        if (elseAttr) {
          ctx.pushCode(`} else {\n`);
          ctx.pushCode(`  __html += __escapeAttr(${JSON.stringify(attr.name)}, ${formatCondAttrValue(ctx, elseAttr, shadowed)});\n`);
        }
        ctx.pushCode(`}\n`);
      }
    } else if (attr.type === "ConditionalSpread") {
      const spreadExpr = ctx.transformExpr(attr.rawSpreadExpression, attr.spreadExpression, shadowed);
      const condExpr = attr.condition ? ctx.transformExpr(attr.rawCondition ?? "", attr.condition, shadowed) : "true";
      ctx.pushCode(`if (${condExpr}) {\n`);
      ctx.pushCode(`  const __spreadObj = (${spreadExpr});\n`);
      ctx.pushCode(`  if (__spreadObj && typeof __spreadObj === "object") {\n`);
      ctx.pushCode(`    for (const [__spKey, __spVal] of Object.entries(__spreadObj)) {\n`);
      ctx.pushCode(`      if (__spKey === "children" || __spKey === "key" || __spKey === "ref" || __spKey.startsWith("on")) continue;\n`);
      ctx.pushCode(`      __html += __escapeAttr(__spKey, __spVal);\n`);
      ctx.pushCode(`    }\n  }\n}\n`);
    } else if (attr.type === "BindBinding") {
      const propName = attr.name === "checked" ? "checked" : "value";
      const expr = ctx.transformExpr(attr.rawTarget, attr.target, shadowed);
      ctx.pushCode(`__html += __escapeAttr(${JSON.stringify(propName)}, ${expr});\n`);
    }
  }
}

function emitCombinedClassAttrs(
  ctx: SsrEmitContext,
  attrs: readonly (ClassMapNode | Extract<AttributeNode, { type: "StaticAttribute" | "DynamicAttribute" }>)[],
  shadowed: ReadonlySet<string>
): void {
  if (attrs.length === 0) return;
  ctx.requireHelper("classAttr");
  ctx.pushCode(`{\n  const __clsList = [];\n`);
  for (const attr of attrs) {
    if (attr.type === "StaticAttribute") {
      if (attr.value) ctx.pushCode(`  __clsList.push(${JSON.stringify(attr.value)});\n`);
    } else if (attr.type === "DynamicAttribute") {
      const expr = ctx.transformExpr(attr.rawExpression, attr.expression, shadowed);
      ctx.pushCode(`  { const __c = __mixSsrClassTokens(${expr}); if (__c) __clsList.push(__c); }\n`);
    } else if (attr.kind === "directive" && attr.className) {
      const expr = ctx.transformExpr(attr.rawExpression, attr.expression, shadowed);
      ctx.pushCode(`  if (${expr}) __clsList.push(${JSON.stringify(attr.className)});\n`);
    } else {
      const expr = ctx.transformExpr(attr.rawExpression, attr.expression, shadowed);
      ctx.pushCode(`  { const __c = __mixSsrClassTokens(${expr}); if (__c) __clsList.push(__c); }\n`);
    }
  }
  ctx.pushCode(`  if (__clsList.length > 0) __html += __escapeAttr("class", __clsList.join(" "));\n}\n`);
}

function emitCombinedStyleAttrs(
  ctx: SsrEmitContext,
  attrs: readonly (StyleMapNode | Extract<AttributeNode, { type: "StaticAttribute" | "DynamicAttribute" }>)[],
  shadowed: ReadonlySet<string>
): void {
  if (attrs.length === 0) return;
  ctx.requireHelper("styleAttr");
  ctx.requireHelper("formatStyleProp");
  ctx.pushCode(`{\n  let __styleOut = "";\n`);
  for (const attr of attrs) {
    if (attr.type === "StaticAttribute") {
      if (attr.value) ctx.pushCode(`  __styleOut += ${JSON.stringify(attr.value.trim() + " ")};\n`);
    } else if (attr.type === "DynamicAttribute") {
      const expr = ctx.transformExpr(attr.rawExpression, attr.expression, shadowed);
      ctx.pushCode(`  __styleOut += String(${expr} ?? "");\n`);
    } else if (attr.kind === "directive" && attr.property) {
      const expr = ctx.transformExpr(attr.rawExpression, attr.expression, shadowed);
      const dotIdx = attr.property.startsWith("--") ? -1 : attr.property.lastIndexOf(".");
      const cssProp = dotIdx > 0 ? attr.property.slice(0, dotIdx) : attr.property;
      const unit = dotIdx > 0 ? attr.property.slice(dotIdx + 1) : "";
      ctx.pushCode(`  __styleOut += __mixSsrFormatStyle(${JSON.stringify(cssProp)}, ${expr}, ${JSON.stringify(unit)});\n`);
    } else {
      const expr = ctx.transformExpr(attr.rawExpression, attr.expression, shadowed);
      ctx.pushCode(`  __styleOut += __mixSsrStyleMap(${expr}) + " ";\n`);
    }
  }
  ctx.pushCode(`  if (__styleOut.trim()) __html += __escapeAttr("style", __styleOut.trim());\n}\n`);
}
