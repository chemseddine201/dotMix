/**
 * @mix/compiler-ssr/compiler — Ahead-of-Time Server-Side Rendering Compiler (`compileToSsr`).
 */

import type {
  ComponentNode,
  TemplateNode,
  ElementNode,
  TextNode,
  InterpolationNode,
  IfBlockNode,
  EachBlockNode,
  SlotOutletNode,
  ComponentCallNode,
  DynamicElementNode,
  AwaitBlockNode,
  AttributeNode,
  DynamicAttributeNode,
  BindBindingNode,
  ESTreeNode,
} from "@mix/ast";
import type { ComponentDescriptor } from "@mix/compiler-semantic";
import { extractAndTranspileScript, analyze } from "@mix/compiler-semantic";
import type { CssCompileResult } from "@mix/compiler-css";
import type { SsrOptions, SsrCompilationResult } from "./types.js";
import { escapeHtml, SSR_RUNTIME_PREAMBLE } from "./escape.js";
import { transformSsrExpression } from "./expression-rewriter.js";

export function compileToSsr(
  descriptor: ComponentDescriptor | ComponentNode,
  cssResult?: CssCompileResult,
  options: SsrOptions = {}
): SsrCompilationResult {
  const includeMarkers = options.includeHydrationMarkers ?? true;
  const scopeHash = options.scopeHash || cssResult?.scopeAttribute || cssResult?.scopeId;
  const css = cssResult?.code || cssResult?.css || "";

  const rootNode: ComponentNode = "ast" in descriptor ? descriptor.ast : descriptor;

  let compDescriptor: ComponentDescriptor | undefined = "signals" in descriptor ? descriptor : undefined;
  if (!compDescriptor && rootNode.script) {
    try {
      compDescriptor = analyze(rootNode);
    } catch {
      // Graceful fallback if analysis fails
    }
  }

  const signalNames = new Set<string>();
  if (compDescriptor) {
    for (const s of compDescriptor.signals) signalNames.add(s);
    for (const c of compDescriptor.computeds) signalNames.add(c);
  }

  function transformExpr(
    raw: string,
    ast: ESTreeNode | undefined,
    shadowed: ReadonlySet<string> = new Set()
  ): string {
    return transformSsrExpression(raw, ast, signalNames, shadowed);
  }

  let scriptImports = "";
  let scriptBody = "";
  if (rootNode.script) {
    const isTs = rootNode.script.lang === "ts";
    const transpiled = extractAndTranspileScript(rootNode.script.content, isTs);
    scriptImports = transpiled.importsCode;
    scriptBody = transpiled.bodyCode;
  }

  let markerId = 0;
  const parts: string[] = [];

  function generateNode(node: TemplateNode, shadowed: ReadonlySet<string> = new Set()): void {
    switch (node.type) {
      case "Text": {
        const textNode = node as TextNode;
        parts.push(`__html += ${JSON.stringify(escapeHtml(textNode.value))};\n`);
        break;
      }

      case "Interpolation": {
        const interp = node as InterpolationNode;
        const id = markerId++;
        const expr = transformExpr(interp.rawExpression, interp.expression, shadowed);
        if (includeMarkers) {
          parts.push(`__html += "<!--mix:t:${id}-->" + __escapeHtml(${expr}) + "<!--/mix:t:${id}-->";\n`);
        } else {
          parts.push(`__html += __escapeHtml(${expr});\n`);
        }
        break;
      }

      case "Element": {
        const el = node as ElementNode;
        generateElement(el.tag, el.attributes, el.children, el.selfClosing, shadowed);
        break;
      }

      case "DynamicElement": {
        const dyn = node as DynamicElementNode;
        const tagExpr = transformExpr(dyn.rawTagExpression, dyn.tagExpression, shadowed);
        parts.push(`{\n`);
        parts.push(`  const __tag = String(${tagExpr});\n`);
        parts.push(`  __html += "<" + __tag;\n`);
        if (scopeHash) {
          parts.push(`  __html += " ${scopeHash}";\n`);
        }
        generateAttributes(dyn.attributes, shadowed);
        parts.push(`  __html += ">";\n`);
        for (const child of dyn.children) {
          generateNode(child, shadowed);
        }
        parts.push(`  __html += "</" + __tag + ">";\n`);
        parts.push(`}\n`);
        break;
      }

      case "IfBlock": {
        const ifBlock = node as IfBlockNode;
        generateIfBlock(ifBlock, shadowed);
        break;
      }

      case "EachBlock": {
        const each = node as EachBlockNode;
        const id = markerId++;
        if (includeMarkers) {
          parts.push(`__html += "<!--mix:each:${id}-->";\n`);
        }
        const collExpr = transformExpr(each.rawCollection, each.collection, shadowed);
        const indexVar = each.indexIdentifier || `__idx_${id}`;
        const nextShadowed = new Set(shadowed);
        nextShadowed.add(each.itemIdentifier);
        if (each.indexIdentifier) nextShadowed.add(each.indexIdentifier);

        const keyExpr = transformExpr(each.rawKeyExpression, each.keyExpression, nextShadowed);
        parts.push(`{\n`);
        parts.push(`  const __list = (${collExpr}) || [];\n`);
        parts.push(`  let ${indexVar} = 0;\n`);
        parts.push(`  for (const ${each.itemIdentifier} of __list) {\n`);
        parts.push(`    const __key = (${keyExpr});\n`);
        if (includeMarkers) {
          parts.push(`    __html += "<!--mix:item:" + __key + "-->";\n`);
        }
        for (const child of each.children) {
          generateNode(child, nextShadowed);
        }
        if (includeMarkers) {
          parts.push(`    __html += "<!--/mix:item:" + __key + "-->";\n`);
        }
        parts.push(`    ${indexVar}++;\n`);
        parts.push(`  }\n`);
        parts.push(`}\n`);
        if (includeMarkers) {
          parts.push(`__html += "<!--/mix:each:${id}-->";\n`);
        }
        break;
      }

      case "SlotOutlet": {
        const slot = node as SlotOutletNode;
        const slotName = slot.name ? JSON.stringify(slot.name) : '"default"';
        parts.push(`if (__props.slots && __props.slots[${slotName}]) {\n`);
        parts.push(`  __html += __props.slots[${slotName}](__props);\n`);
        parts.push(`} else if (${slotName} === "default" && __props.children) {\n`);
        parts.push(`  __html += typeof __props.children === "function" ? __props.children(__props) : String(__props.children);\n`);
        parts.push(`} else {\n`);
        for (const child of slot.fallback) {
          generateNode(child, shadowed);
        }
        parts.push(`}\n`);
        break;
      }

      case "ComponentCall": {
        const call = node as ComponentCallNode;
        const id = markerId++;
        if (includeMarkers) {
          parts.push(`__html += "<!--mix:c:${id}-->";\n`);
        }

        const propEntries: string[] = [];
        for (const attr of call.attributes) {
          if (attr.type === "StaticAttribute") {
            const isBooleanShorthand =
              attr.value === "" && attr.span.end.offset - attr.span.start.offset === attr.name.length;
            const val = isBooleanShorthand ? "true" : JSON.stringify(attr.value);
            propEntries.push(`${JSON.stringify(attr.name)}: ${val}`);
          } else if (attr.type === "DynamicAttribute") {
            if (attr.templateValue) {
              const savedLength = parts.length;
              for (const tmplChild of attr.templateValue) {
                generateNode(tmplChild, shadowed);
              }
              const subBody = parts.splice(savedLength).join("");
              propEntries.push(
                `${JSON.stringify(attr.name)}: () => {\n  let __html = "";\n${subBody}  return __html;\n}`
              );
            } else {
              const expr = transformExpr(attr.rawExpression, attr.expression, shadowed);
              propEntries.push(`get ${JSON.stringify(attr.name)}() { return (${expr}); }`);
            }
          }
        }

        if (call.children.length > 0) {
          const savedLength = parts.length;
          for (const child of call.children) {
            generateNode(child, shadowed);
          }
          const childBody = parts.splice(savedLength).join("");
          const childFn = `() => {\n  let __html = "";\n${childBody}  return __html;\n}`;
          propEntries.push(`children: ${childFn}`);
          propEntries.push(`slots: { default: ${childFn} }`);
        }

        const propsLiteral = `{ ...props${propEntries.length > 0 ? ", " + propEntries.join(", ") : ""} }`;

        parts.push(`if (typeof ${call.name} === "function") {\n`);
        parts.push(`  const __compProps = ${propsLiteral};\n`);
        parts.push(`  if (${call.name}.renderToString) {\n`);
        parts.push(`    __html += ${call.name}.renderToString(__compProps);\n`);
        parts.push(`  } else {\n`);
        parts.push(`    const __compRes = ${call.name}(__compProps);\n`);
        parts.push(`    if (typeof __compRes === "string") __html += __compRes;\n`);
        parts.push(`  }\n`);
        parts.push(`}\n`);
        if (includeMarkers) {
          parts.push(`__html += "<!--/mix:c:${id}-->";\n`);
        }
        break;
      }

      case "AwaitBlock": {
        const awaitBlock = node as AwaitBlockNode;
        const id = markerId++;
        if (includeMarkers) {
          parts.push(`__html += "<!--mix:await:${id}-->";\n`);
        }
        const awaitExpr = transformExpr(awaitBlock.rawExpression, awaitBlock.expression, shadowed);
        parts.push(`{\n`);
        parts.push(`  const __awaitTarget = (${awaitExpr});\n`);
        parts.push(`  const __isPromise = __awaitTarget !== null && typeof __awaitTarget === "object" && typeof __awaitTarget.then === "function";\n`);
        parts.push(`  const __isPendingResource = __awaitTarget !== null && typeof __awaitTarget === "object" && "loading" in __awaitTarget && typeof __awaitTarget.loading === "function" && __awaitTarget.loading();\n`);
        parts.push(`  if (__isPromise || __isPendingResource) {\n`);
        for (const child of awaitBlock.pending) {
          generateNode(child, shadowed);
        }
        parts.push(`  } else {\n`);
        const thenVar = awaitBlock.thenIdentifier || `__resolved_${id}`;
        const nextShadowed = new Set(shadowed);
        if (awaitBlock.thenIdentifier) nextShadowed.add(awaitBlock.thenIdentifier);
        parts.push(`    const ${thenVar} = (__awaitTarget !== null && typeof __awaitTarget === "object" && "data" in __awaitTarget && typeof __awaitTarget.data === "function") ? __awaitTarget.data() : __awaitTarget;\n`);
        for (const child of awaitBlock.thenBranch) {
          generateNode(child, nextShadowed);
        }
        parts.push(`  }\n`);
        parts.push(`}\n`);
        if (includeMarkers) {
          parts.push(`__html += "<!--/mix:await:${id}-->";\n`);
        }
        break;
      }

      default:
        break;
    }
  }

  function generateIfBlock(ifBlock: IfBlockNode, shadowed: ReadonlySet<string>): void {
    const id = markerId++;
    if (includeMarkers) {
      parts.push(`__html += "<!--mix:if:${id}-->";\n`);
    }
    const cond = transformExpr(ifBlock.rawCondition, ifBlock.condition, shadowed);
    parts.push(`if (${cond}) {\n`);
    for (const child of ifBlock.consequent) {
      generateNode(child, shadowed);
    }
    let alt = ifBlock.alternate;
    while (alt) {
      if (Array.isArray(alt)) {
        parts.push(`} else {\n`);
        for (const child of alt) {
          generateNode(child, shadowed);
        }
        break;
      } else if ("type" in alt && alt.type === "IfBlock") {
        const altIf = alt as IfBlockNode;
        const altCond = transformExpr(altIf.rawCondition, altIf.condition, shadowed);
        parts.push(`} else if (${altCond}) {\n`);
        for (const child of altIf.consequent) {
          generateNode(child, shadowed);
        }
        alt = altIf.alternate;
      } else {
        break;
      }
    }
    parts.push(`}\n`);
    if (includeMarkers) {
      parts.push(`__html += "<!--/mix:if:${id}-->";\n`);
    }
  }

  function generateElement(
    tagName: string,
    attributes: readonly AttributeNode[],
    children: readonly TemplateNode[],
    selfClosing: boolean,
    shadowed: ReadonlySet<string>
  ): void {
    parts.push(`__html += "<${tagName}";\n`);
    if (scopeHash) {
      parts.push(`__html += " ${scopeHash}";\n`);
    }
    generateAttributes(attributes, shadowed);
    if (selfClosing && children.length === 0) {
      parts.push(`__html += " />";\n`);
      return;
    }
    parts.push(`__html += ">";\n`);
    for (const child of children) {
      generateNode(child, shadowed);
    }
    parts.push(`__html += "</${tagName}>";\n`);
  }

  function generateAttributes(
    attributes: readonly AttributeNode[],
    shadowed: ReadonlySet<string>
  ): void {
    for (const attr of attributes) {
      if (attr.type === "StaticAttribute") {
        if (attr.name.startsWith("on:")) {
          // Event handlers omitted in SSR
          continue;
        }
        if (attr.value === null) {
          parts.push(`__html += " " + ${JSON.stringify(attr.name)};\n`);
        } else {
          parts.push(
            `__html += __escapeAttr(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});\n`
          );
        }
      } else if (attr.type === "DynamicAttribute") {
        const dynAttr = attr as DynamicAttributeNode;
        const expr = transformExpr(dynAttr.rawExpression, dynAttr.expression, shadowed);
        parts.push(
          `__html += __escapeAttr(${JSON.stringify(dynAttr.name)}, ${expr});\n`
        );
      } else if (attr.type === "BindBinding") {
        const bind = attr as BindBindingNode;
        const propName = bind.name === "checked" ? "checked" : "value";
        const expr = transformExpr(bind.rawTarget, bind.target, shadowed);
        parts.push(
          `__html += __escapeAttr(${JSON.stringify(propName)}, ${expr});\n`
        );
      }
    }
  }

  // Generate body from root component template
  for (const templateItem of rootNode.template) {
    generateNode(templateItem);
  }

  const hasPropsDeclaration = compDescriptor
    ? compDescriptor.rootScope.bindings.has("props")
    : false;

  const moduleCode = `
${scriptImports}

${SSR_RUNTIME_PREAMBLE}

export function renderToString(__props = {}) {
  const defineProps = (defaults) => Object.assign({}, defaults, __props);
${!hasPropsDeclaration ? "  const props = __props;\n" : ""}${scriptBody}
  let __html = "";
${parts.join("")}
  return __html;
}

export function renderToStream(__props = {}, onChunk) {
  const html = renderToString(__props);
  if (typeof onChunk === "function") {
    onChunk(html);
  }
  return (async function* () {
    yield html;
  })();
}

export const css = ${JSON.stringify(css)};
`;

  return {
    code: moduleCode,
    css,
  };
}
