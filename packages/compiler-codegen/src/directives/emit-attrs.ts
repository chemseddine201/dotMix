/**
 * @dotmix/compiler-codegen/directives/emit-attrs — Client codegen for directive attribute/event modifiers, class/style maps, spreads, and component slots.
 */

import {
  DIRECTIVE_GRAMMAR,
  type AttributeNode,
  type ClassMapNode,
  type ConditionalAttributeNode,
  type ConditionalEventNode,
  type EventBindingNode,
  type StyleMapNode,
  type TemplateNode
} from "@dotmix/ast";
import { indentLines } from "../types.js";
import type { CodegenContext } from "../context.js";

const BOOLEAN_HTML_ATTR_SET = new Set<string>(DIRECTIVE_GRAMMAR.booleanHtmlAttributes);
const STYLE_UNITS = new Set<string>(["px", "rem", "em", "%", "vh", "vw", "vmin", "vmax", "ch", "ex", "deg", "rad", "turn", "ms", "s", "fr"]);

export function hasElementDirectiveModifiers(attributes: readonly AttributeNode[]): boolean {
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
    if (attr.type === "EventBinding" && attr.name.includes(".")) {
      return true;
    }
  }
  return false;
}

function parseEventModifierSpec(rawEventName: string): {
  baseEvent: string;
  modifiersLiteral: string | null;
} {
  const parts = rawEventName.split(".");
  if (parts.length <= 1) {
    return { baseEvent: rawEventName, modifiersLiteral: null };
  }
  const baseEvent = parts[0] ?? rawEventName;
  const specEntries: string[] = [];
  const keyTokens: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const mod = parts[i] ?? "";
    if (!mod) continue;
    if (
      mod === "prevent" ||
      mod === "stop" ||
      mod === "self" ||
      mod === "once" ||
      mod === "passive" ||
      mod === "capture" ||
      mod === "window" ||
      mod === "document" ||
      mod === "outside" ||
      mod === "enter" ||
      mod === "esc" ||
      mod === "tab" ||
      mod === "space"
    ) {
      specEntries.push(`${mod}: true`);
    } else if (mod.startsWith("debounce-")) {
      const ms = Number.parseInt(mod.slice("debounce-".length), 10);
      if (Number.isFinite(ms)) specEntries.push(`debounce: ${ms}`);
    } else if (mod.startsWith("throttle-")) {
      const ms = Number.parseInt(mod.slice("throttle-".length), 10);
      if (Number.isFinite(ms)) specEntries.push(`throttle: ${ms}`);
    } else {
      keyTokens.push(mod);
    }
  }
  if (keyTokens.length > 0) {
    specEntries.push(`keys: ${JSON.stringify(keyTokens)}`);
  }
  if (specEntries.length === 0) {
    return { baseEvent, modifiersLiteral: null };
  }
  return { baseEvent, modifiersLiteral: `{ ${specEntries.join(", ")} }` };
}

function splitStylePropAndUnit(rawProp: string): { cssProp: string; unit: string | null } {
  if (rawProp.startsWith("--")) {
    return { cssProp: rawProp, unit: null };
  }
  const dotIdx = rawProp.lastIndexOf(".");
  if (dotIdx > 0) {
    const suffix = rawProp.slice(dotIdx + 1);
    if (STYLE_UNITS.has(suffix)) {
      return { cssProp: rawProp.slice(0, dotIdx), unit: suffix };
    }
  }
  return { cssProp: rawProp, unit: null };
}

function formatAttrValueGetter(
  ctx: CodegenContext,
  attr: ConditionalAttributeNode | Extract<AttributeNode, { type: "StaticAttribute" | "DynamicAttribute" }> | undefined,
  loopGetters: ReadonlyMap<string, string>
): string {
  if (!attr) return "() => \"\"";
  if (attr.type === "StaticAttribute") {
    return `() => ${JSON.stringify(attr.value)}`;
  }
  if (attr.type === "DynamicAttribute") {
    const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
    return `() => (${jsExpr})`;
  }
  if (attr.type === "ConditionalAttribute") {
    if (attr.isStatic) {
      return `() => ${JSON.stringify(attr.staticValue ?? "")}`;
    }
    if (attr.expression) {
      const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
      return `() => (${jsExpr})`;
    }
  }
  return "() => \"\"";
}

function formatEventHandlerExpr(
  ctx: CodegenContext,
  node: ConditionalEventNode | EventBindingNode,
  loopGetters: ReadonlyMap<string, string>
): string {
  const raw = node.type === "ConditionalEvent" ? node.rawExpression.trim() : node.rawHandler.trim();
  const ast = node.type === "ConditionalEvent" ? node.expression : node.handler;
  const jsExpr = ctx.emitExpr(raw, ast, loopGetters);
  if (
    ast.type === "Identifier" ||
    ast.type === "MemberExpression" ||
    ast.type === "ArrowFunctionExpression" ||
    ast.type === "FunctionExpression"
  ) {
    return `($event) => { const __handler = (${jsExpr}); return typeof __handler === "function" ? __handler($event) : __handler; }`;
  }
  return `($event) => { const event = $event; void event; return (${jsExpr}); }`;
}

export function emitElementDirectiveAttributes(
  ctx: CodegenContext,
  attributes: readonly AttributeNode[],
  elVar: string,
  loopGetters: ReadonlyMap<string, string>
): string[] {
  const condAttrsByName = new Map<string, ConditionalAttributeNode[]>();
  const baseAttrByName = new Map<string, Extract<AttributeNode, { type: "StaticAttribute" | "DynamicAttribute" }>>();
  const condEventsByName = new Map<string, ConditionalEventNode[]>();
  const baseEventByName = new Map<string, EventBindingNode>();

  for (const attr of attributes) {
    if (attr.type === "ConditionalAttribute") {
      const list = condAttrsByName.get(attr.name) ?? [];
      list.push(attr);
      condAttrsByName.set(attr.name, list);
    } else if (attr.type === "StaticAttribute" || attr.type === "DynamicAttribute") {
      baseAttrByName.set(attr.name, attr);
    } else if (attr.type === "ConditionalEvent") {
      const parsedEvt = parseEventModifierSpec(attr.eventName);
      const list = condEventsByName.get(parsedEvt.baseEvent) ?? [];
      list.push(attr);
      condEventsByName.set(parsedEvt.baseEvent, list);
    } else if (attr.type === "EventBinding") {
      const parsedEvt = parseEventModifierSpec(attr.name);
      baseEventByName.set(parsedEvt.baseEvent, attr);
    }
  }

  const lines: string[] = [];
  const emittedCondAttrs = new Set<string>();
  const emittedCondEvents = new Set<string>();

  for (const attr of attributes) {
    if (attr.type === "StaticAttribute") {
      if (condAttrsByName.has(attr.name)) continue;
      lines.push(`__setAttribute(${elVar}, ${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});`);
      continue;
    }

    if (attr.type === "DynamicAttribute") {
      if (condAttrsByName.has(attr.name)) continue;
      const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
      if (BOOLEAN_HTML_ATTR_SET.has(attr.name)) {
        const helperName = ctx.useHelper("__mixBindBooleanAttr");
        lines.push(`${helperName}(${elVar}, ${JSON.stringify(attr.name)}, () => (${jsExpr}));`);
      } else {
        lines.push(`createEffect(() => { __setAttribute(${elVar}, ${JSON.stringify(attr.name)}, (${jsExpr})); });`);
      }
      continue;
    }

    if (attr.type === "ConditionalAttribute") {
      if (emittedCondAttrs.has(attr.name)) continue;
      emittedCondAttrs.add(attr.name);
      const group = condAttrsByName.get(attr.name) ?? [];
      const baseAttr = baseAttrByName.get(attr.name);
      const matchAttr = group.find((entry) => entry.modifier === "match");
      const caseAttrs = group.filter((entry) => entry.modifier === "case");
      const elseAttr = group.find((entry) => entry.modifier === "else");

      if (matchAttr && matchAttr.expression) {
        const matchHelper = ctx.useHelper("__mixBindMatchAttr");
        const subjExpr = ctx.emitExpr(matchAttr.rawExpression, matchAttr.expression, loopGetters);
        const caseEntries = caseAttrs.map(
          (caseEntry) =>
            `{ token: ${JSON.stringify(caseEntry.caseToken ?? "")}, value: ${formatAttrValueGetter(ctx, caseEntry, loopGetters)} }`
        );
        const elseGetter = elseAttr ? formatAttrValueGetter(ctx, elseAttr, loopGetters) : "null";
        lines.push(
          `${matchHelper}(${elVar}, ${JSON.stringify(attr.name)}, () => (${subjExpr}), [${caseEntries.join(", ")}], ${elseGetter});`
        );
        continue;
      }

      const gateAttr = group.find((entry) => entry.modifier === "if" || entry.modifier === "unless");
      if (gateAttr && gateAttr.expression) {
        const condHelper = ctx.useHelper("__mixBindConditionalAttr");
        const condExpr = ctx.emitExpr(gateAttr.rawExpression, gateAttr.expression, loopGetters);
        const valueGetter = baseAttr ? formatAttrValueGetter(ctx, baseAttr, loopGetters) : "() => true";
        const elseGetter = elseAttr ? formatAttrValueGetter(ctx, elseAttr, loopGetters) : "null";
        const invertFlag = gateAttr.modifier === "unless" ? "true" : "false";
        lines.push(
          `${condHelper}(${elVar}, ${JSON.stringify(attr.name)}, () => (${condExpr}), ${valueGetter}, ${elseGetter}, ${invertFlag});`
        );
      }
      continue;
    }

    if (attr.type === "EventBinding") {
      const parsedEvt = parseEventModifierSpec(attr.name);
      if (condEventsByName.has(parsedEvt.baseEvent)) continue;
      if (parsedEvt.modifiersLiteral) {
        const onHelper = ctx.useHelper("__mixOnEvent");
        const handlerFn = formatEventHandlerExpr(ctx, attr, loopGetters);
        lines.push(`${onHelper}(${elVar}, ${JSON.stringify(parsedEvt.baseEvent)}, ${handlerFn}, ${parsedEvt.modifiersLiteral});`);
      } else {
        lines.push(ctx.emitEventHandler(attr, elVar, loopGetters));
      }
      continue;
    }

    if (attr.type === "ConditionalEvent") {
      const parsedEvt = parseEventModifierSpec(attr.eventName);
      if (emittedCondEvents.has(parsedEvt.baseEvent)) continue;
      emittedCondEvents.add(parsedEvt.baseEvent);
      const group = condEventsByName.get(parsedEvt.baseEvent) ?? [];
      const baseEvt = baseEventByName.get(parsedEvt.baseEvent);
      const gateEvt = group.find((entry) => entry.modifier === "if" || entry.modifier === "unless");
      const elseEvt = group.find((entry) => entry.modifier === "else");

      if (gateEvt) {
        const condEventHelper = ctx.useHelper("__mixOnConditionalEvent");
        const condExpr = ctx.emitExpr(gateEvt.rawExpression, gateEvt.expression, loopGetters);
        const handlerFn = baseEvt
          ? formatEventHandlerExpr(ctx, baseEvt, loopGetters)
          : formatEventHandlerExpr(ctx, gateEvt, loopGetters);
        const elseFn = elseEvt ? formatEventHandlerExpr(ctx, elseEvt, loopGetters) : "null";
        const modifiersArg = parsedEvt.modifiersLiteral ?? "undefined";
        const invertArg = gateEvt.modifier === "unless" ? "true" : "false";
        lines.push(
          `${condEventHelper}(${elVar}, ${JSON.stringify(parsedEvt.baseEvent)}, () => (${condExpr}), ${handlerFn}, ${elseFn}, ${modifiersArg}, ${invertArg});`
        );
      }
      continue;
    }

    if (attr.type === "ClassMap") {
      emitClassMapLine(ctx, attr, elVar, loopGetters, lines);
      continue;
    }

    if (attr.type === "StyleMap") {
      emitStyleMapLine(ctx, attr, elVar, loopGetters, lines);
      continue;
    }

    if (attr.type === "ConditionalSpread") {
      const spreadHelper = ctx.useHelper("__mixSpreadAttrs");
      const spreadJs = ctx.emitExpr(attr.rawSpreadExpression, attr.spreadExpression, loopGetters);
      const condArg = attr.condition
        ? `, () => (${ctx.emitExpr(attr.rawCondition ?? "", attr.condition, loopGetters)})`
        : "";
      lines.push(`${spreadHelper}(${elVar}, () => (${spreadJs})${condArg});`);
      continue;
    }

    if (attr.type === "DirectiveAttribute") {
      const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
      lines.push(`createEffect(() => { __setAttribute(${elVar}, ${JSON.stringify(attr.name)}, (${jsExpr})); });`);
    } else if (attr.type === "RefBinding") {
      const jsExpr = ctx.emitExpr(attr.rawTarget, attr.target, loopGetters);
      lines.push(`__bindRef(${elVar}, (${jsExpr}));`);
    } else if (attr.type === "BindBinding") {
      const jsTarget = ctx.emitExpr(attr.rawTarget, attr.target, loopGetters);
      const bindHelper = attr.name === "checked" ? "__bindChecked" : "__bindValue";
      lines.push(
        `${bindHelper}(${elVar}, () => (typeof (${jsTarget}) === "function" ? (${jsTarget})() : (${jsTarget})), (__v) => { if (typeof (${jsTarget})?.set === "function") { (${jsTarget}).set(__v); } else { (${jsTarget}) = __v; } });`
      );
    }
  }

  return lines;
}

function emitClassMapLine(
  ctx: CodegenContext,
  attr: ClassMapNode,
  elVar: string,
  loopGetters: ReadonlyMap<string, string>,
  lines: string[]
): void {
  if (attr.kind === "directive" && attr.className) {
    const toggleHelper = ctx.useHelper("__mixToggleClass");
    const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
    lines.push(`${toggleHelper}(${elVar}, ${JSON.stringify(attr.className)}, () => (${jsExpr}));`);
    return;
  }
  const mapHelper = ctx.useHelper("__mixBindClassMap");
  const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
  lines.push(`${mapHelper}(${elVar}, () => (${jsExpr}));`);
}

function emitStyleMapLine(
  ctx: CodegenContext,
  attr: StyleMapNode,
  elVar: string,
  loopGetters: ReadonlyMap<string, string>,
  lines: string[]
): void {
  if (attr.kind === "directive" && attr.property) {
    const propHelper = ctx.useHelper("__mixSetStyleProp");
    const { cssProp, unit } = splitStylePropAndUnit(attr.property);
    const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
    const unitArg = unit ? `, ${JSON.stringify(unit)}` : "";
    lines.push(`${propHelper}(${elVar}, ${JSON.stringify(cssProp)}, () => (${jsExpr})${unitArg});`);
    return;
  }
  const mapHelper = ctx.useHelper("__mixBindStyleMap");
  const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
  lines.push(`${mapHelper}(${elVar}, () => (${jsExpr}));`);
}

export function emitComponentSectionSlots(
  ctx: CodegenContext,
  children: readonly TemplateNode[],
  loopGetters: ReadonlyMap<string, string>,
  slotEntries: string[]
): readonly TemplateNode[] {
  const remaining: TemplateNode[] = [];
  for (const child of children) {
    if (child.type === "Section") {
      const slotFrag = ctx.nextId("slot_sec");
      const slotLines = [
        `const ${slotFrag} = document.createDocumentFragment();`,
        ...ctx.emitTemplateNodes(child.children, slotFrag, loopGetters),
        `return [...${slotFrag}.childNodes];`
      ];
      const renderFn = `() => {\n${indentLines(slotLines.join("\n"), 2)}\n}`;
      if (child.name.type === "Literal" && typeof child.name.value === "string") {
        slotEntries.push(`${JSON.stringify(child.name.value)}: ${renderFn}`);
      } else {
        const nameExpr = ctx.emitExpr(child.rawName, child.name, loopGetters);
        slotEntries.push(`[${nameExpr}]: ${renderFn}`);
      }
    } else {
      remaining.push(child);
    }
  }
  return remaining;
}

export function hasComponentDirectiveProps(attributes: readonly AttributeNode[]): boolean {
  for (const attr of attributes) {
    if (
      attr.type === "ConditionalSpread" ||
      attr.type === "ConditionalAttribute" ||
      attr.type === "ConditionalEvent"
    ) {
      return true;
    }
  }
  return false;
}

export function emitComponentDirectivePropEntries(
  ctx: CodegenContext,
  attributes: readonly AttributeNode[],
  loopGetters: ReadonlyMap<string, string>,
  propEntries: string[]
): void {
  const condAttrs = new Set<string>();
  const condEvents = new Set<string>();
  for (const attr of attributes) {
    if (attr.type === "ConditionalAttribute") condAttrs.add(attr.name);
    if (attr.type === "ConditionalEvent") {
      const baseEvt = parseEventModifierSpec(attr.eventName).baseEvent;
      condEvents.add("on" + baseEvt[0]!.toUpperCase() + baseEvt.slice(1));
    }
  }

  for (const attr of attributes) {
    if (attr.type === "StaticAttribute") {
      if (condAttrs.has(attr.name)) continue;
      const isBool = attr.value === "" && attr.span.end.offset - attr.span.start.offset === attr.name.length;
      propEntries.push(`${JSON.stringify(attr.name)}: ${isBool ? "true" : JSON.stringify(attr.value)}`);
    } else if (attr.type === "DynamicAttribute") {
      if (condAttrs.has(attr.name)) continue;
      const jsExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
      propEntries.push(`get ${JSON.stringify(attr.name)}() { return (${jsExpr}); }`);
    } else if (attr.type === "EventBinding") {
      const baseEvt = parseEventModifierSpec(attr.name).baseEvent;
      const propName = "on" + baseEvt[0]!.toUpperCase() + baseEvt.slice(1);
      if (condEvents.has(propName)) continue;
      const jsExpr = ctx.emitExpr(attr.rawHandler, attr.handler, loopGetters);
      propEntries.push(`${JSON.stringify(propName)}: (${jsExpr})`);
    } else if (attr.type === "RefBinding") {
      propEntries.push(`ref: (${ctx.emitExpr(attr.rawTarget, attr.target, loopGetters)})`);
    } else if (attr.type === "ConditionalSpread") {
      const spreadJs = ctx.emitExpr(attr.rawSpreadExpression, attr.spreadExpression, loopGetters);
      propEntries.push(
        attr.condition
          ? `...((${ctx.emitExpr(attr.rawCondition ?? "", attr.condition, loopGetters)}) ? (${spreadJs}) : undefined)`
          : `...(${spreadJs})`
      );
    } else if (attr.type === "ConditionalAttribute" && (attr.modifier === "if" || attr.modifier === "unless") && attr.expression) {
      const baseAttr = attributes.find((entry) => (entry.type === "StaticAttribute" || entry.type === "DynamicAttribute") && entry.name === attr.name);
      const elseAttr = attributes.find(
        (entry): entry is ConditionalAttributeNode =>
          entry.type === "ConditionalAttribute" && entry.name === attr.name && entry.modifier === "else"
      );
      const condExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
      const activeExpr = attr.modifier === "unless" ? `!(${condExpr})` : `(${condExpr})`;
      const valExpr =
        baseAttr?.type === "StaticAttribute" ? JSON.stringify(baseAttr.value)
          : baseAttr?.type === "DynamicAttribute" ? `(${ctx.emitExpr(baseAttr.rawExpression, baseAttr.expression, loopGetters)})`
          : "true";
      const elseExpr =
        elseAttr && elseAttr.isStatic ? JSON.stringify(elseAttr.staticValue ?? "")
          : elseAttr && elseAttr.expression ? `(${ctx.emitExpr(elseAttr.rawExpression, elseAttr.expression, loopGetters)})`
          : "undefined";
      propEntries.push(`get ${JSON.stringify(attr.name)}() { return ${activeExpr} ? ${valExpr} : ${elseExpr}; }`);
    } else if (attr.type === "ConditionalEvent" && (attr.modifier === "if" || attr.modifier === "unless")) {
      const baseEvtName = parseEventModifierSpec(attr.eventName).baseEvent;
      const propName = "on" + baseEvtName[0]!.toUpperCase() + baseEvtName.slice(1);
      const baseEvt = attributes.find((entry) => entry.type === "EventBinding" && parseEventModifierSpec(entry.name).baseEvent === baseEvtName);
      const elseEvt = attributes.find((entry) => entry.type === "ConditionalEvent" && parseEventModifierSpec(entry.eventName).baseEvent === baseEvtName && entry.modifier === "else");
      const condExpr = ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters);
      const activeExpr = attr.modifier === "unless" ? `!(${condExpr})` : `(${condExpr})`;
      const handlerJs = baseEvt?.type === "EventBinding" ? `(${ctx.emitExpr(baseEvt.rawHandler, baseEvt.handler, loopGetters)})` : `(${ctx.emitExpr(attr.rawExpression, attr.expression, loopGetters)})`;
      const elseJs = elseEvt?.type === "ConditionalEvent" ? `(${ctx.emitExpr(elseEvt.rawExpression, elseEvt.expression, loopGetters)})` : "undefined";
      propEntries.push(`get ${JSON.stringify(propName)}() { return ${activeExpr} ? ${handlerJs} : ${elseJs}; }`);
    }
  }
}
