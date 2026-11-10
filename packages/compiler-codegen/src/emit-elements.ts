/**
 * @mix/compiler-codegen/emit-elements — DOM element, dynamic element, component call, and slot outlet emitters.
 */

import {
  SVG_TAGS,
  type TemplateNode,
  type ElementNode,
  type DynamicElementNode,
  type ComponentCallNode,
  type SlotOutletNode
} from "@mix/ast";
import { indentLines } from "./types.js";
import type { CodegenContext } from "./context.js";

export function emitSlotOutlet(
  ctx: CodegenContext,
  node: SlotOutletNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const fallbackFragVar = ctx.nextId("fallbackFrag");
  let fallbackCode = "null";
  if (node.fallback.length > 0) {
    const fallbackLines = [
      `const ${fallbackFragVar} = document.createDocumentFragment();`,
      ...ctx.emitTemplateNodes(node.fallback, fallbackFragVar, loopGetters, inSvg),
      `return [...${fallbackFragVar}.childNodes];`
    ];
    fallbackCode = `() => {\n${indentLines(fallbackLines.join("\n"), 2)}\n}`;
  }
  const nameArg = node.name ? JSON.stringify(node.name) : "null";
  return [
    `__renderSlot(${parentVar}, ${nameArg}, ${fallbackCode});`
  ];
}

export function emitElement(
  ctx: CodegenContext,
  node: ElementNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const elVar = ctx.nextId("el");
  const isSvg = inSvg || SVG_TAGS.has(node.tag);
  const createFn = isSvg ? "__createSvgElement" : "__createElement";
  const scopeArg = ctx.scopeAttr ? `, ${JSON.stringify(ctx.scopeAttr)}` : "";

  const lines: string[] = [
    `const ${elVar} = ${createFn}(${JSON.stringify(node.tag)}${scopeArg});`
  ];
  lines.push(...ctx.emitElementAttributes(node.attributes, elVar, loopGetters));
  lines.push(...ctx.emitTemplateNodes(node.children, elVar, loopGetters, isSvg));
  lines.push(`__insertNode(${parentVar}, ${elVar});`);
  return lines;
}

export function emitDynamicElement(
  ctx: CodegenContext,
  node: DynamicElementNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const dynVar = ctx.nextId("dyn");
  const setupParam = ctx.nextId("setupEl");
  const tagExpr = ctx.emitExpr(
    node.rawTagExpression,
    node.tagExpression,
    loopGetters
  );
  const scopeArg = ctx.scopeAttr ? `, ${JSON.stringify(ctx.scopeAttr)}` : "";

  const setupLines: string[] = [
    ...ctx.emitElementAttributes(node.attributes, setupParam, loopGetters),
    ...ctx.emitTemplateNodes(node.children, setupParam, loopGetters, inSvg)
  ];

  return [
    `const ${dynVar} = __createDynamicElement(() => (${tagExpr}), (${setupParam}) => {`,
    indentLines(setupLines.join("\n"), 2),
    `}${scopeArg});`,
    `__insertNode(${parentVar}, ${dynVar});`
  ];
}

export function emitComponentCall(
  ctx: CodegenContext,
  node: ComponentCallNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>
): string[] {
  const propEntries: string[] = [];
  for (const attr of node.attributes) {
    if (attr.type === "StaticAttribute") {
      const isBooleanShorthand =
        attr.value === "" && attr.span.end.offset - attr.span.start.offset === attr.name.length;
      const val = isBooleanShorthand ? "true" : JSON.stringify(attr.value);
      propEntries.push(`${JSON.stringify(attr.name)}: ${val}`);
    } else if (attr.type === "DynamicAttribute") {
      if (attr.templateValue) {
        const safeName = attr.name.replace(/[^A-Za-z0-9_$]/g, "_");
        const attrFrag = ctx.nextId(`attr_${safeName}`);
        const attrLines = [
          `const ${attrFrag} = document.createDocumentFragment();`,
          ...ctx.emitTemplateNodes(attr.templateValue, attrFrag, loopGetters),
          `return [...${attrFrag}.childNodes];`
        ];
        propEntries.push(
          `${JSON.stringify(attr.name)}: () => {\n${indentLines(attrLines.join("\n"), 2)}\n}`
        );
      } else {
        const jsExpr = ctx.emitExpr(
          attr.rawExpression,
          attr.expression,
          loopGetters
        );
        propEntries.push(
          `get ${JSON.stringify(attr.name)}() { return (${jsExpr}); }`
        );
      }
    } else if (attr.type === "RefBinding") {
      const jsExpr = ctx.emitExpr(
        attr.rawTarget,
        attr.target,
        loopGetters
      );
      propEntries.push(`ref: (${jsExpr})`);
    } else if (attr.type === "EventBinding") {
      const jsExpr = ctx.emitExpr(
        attr.rawHandler,
        attr.handler,
        loopGetters
      );
      const propName =
        "on" +
        attr.name[0]!.toUpperCase() +
        attr.name.slice(1);
      propEntries.push(`${JSON.stringify(propName)}: (${jsExpr})`);
    }
  }

  if (node.children.length > 0) {
    const defaultChildren: TemplateNode[] = [];
    const namedSlots = new Map<string, TemplateNode[]>();

    for (const child of node.children) {
      let slotName: string | null = null;
      if (child.type === "Element" || child.type === "ComponentCall" || child.type === "DynamicElement") {
        const slotAttr = child.attributes.find((a) => a.type === "StaticAttribute" && a.name === "slot");
        if (slotAttr && slotAttr.type === "StaticAttribute") {
          slotName = slotAttr.value;
        }
      }
      if (slotName) {
        if (!namedSlots.has(slotName)) namedSlots.set(slotName, []);
        namedSlots.get(slotName)!.push(child);
      } else {
        defaultChildren.push(child);
      }
    }

    const slotEntries: string[] = [];

    if (defaultChildren.length > 0) {
      const defaultFrag = ctx.nextId("slot_default");
      const defaultLines = [
        `const ${defaultFrag} = document.createDocumentFragment();`,
        ...ctx.emitTemplateNodes(defaultChildren, defaultFrag, loopGetters),
        `return [...${defaultFrag}.childNodes];`
      ];
      const defaultRenderCode = `() => {\n${indentLines(defaultLines.join("\n"), 2)}\n}`;
      propEntries.push(`children: ${defaultRenderCode}`);
      slotEntries.push(`default: ${defaultRenderCode}`);
    }

    for (const [name, slotNodes] of namedSlots.entries()) {
      const slotFrag = ctx.nextId(`slot_${name}`);
      const slotLines = [
        `const ${slotFrag} = document.createDocumentFragment();`,
        ...ctx.emitTemplateNodes(slotNodes, slotFrag, loopGetters),
        `return [...${slotFrag}.childNodes];`
      ];
      slotEntries.push(`${JSON.stringify(name)}: () => {\n${indentLines(slotLines.join("\n"), 2)}\n}`);
    }

    if (slotEntries.length > 0) {
      propEntries.push(`slots: { ${slotEntries.join(", ")} }`);
    }
  }

  const propsObj =
    propEntries.length > 0 ? `{ ${propEntries.join(", ")} }` : "{}";
  return [`__mountComponent(${node.name}, ${propsObj}, ${parentVar});`];
}
