/**
 * @mix/compiler-ssr — Ahead-of-Time Server-Side Rendering Compiler
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
  AttributeNode,
} from "@mix/ast";
import type { ComponentDescriptor } from "@mix/compiler-semantic";
import { extractAndTranspileScript } from "@mix/compiler-semantic";
import type { CssCompileResult } from "@mix/compiler-css";

export interface SsrOptions {
  includeHydrationMarkers?: boolean | undefined;
  scopeHash?: string | undefined;
}

export interface SsrCompilationResult {
  code: string;
  css: string;
}

export function escapeHtml(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function serializeState(data: unknown): string {
  const json = JSON.stringify(data);
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function compileToSsr(
  descriptor: ComponentDescriptor | ComponentNode,
  cssResult?: CssCompileResult,
  options: SsrOptions = {}
): SsrCompilationResult {
  const includeMarkers = options.includeHydrationMarkers ?? true;
  const scopeHash = options.scopeHash || cssResult?.scopeAttribute || cssResult?.scopeId;
  const css = cssResult?.code || cssResult?.css || "";

  const rootNode: ComponentNode = "ast" in descriptor ? descriptor.ast : descriptor;

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

  function generateNode(node: TemplateNode): void {
    switch (node.type) {
      case "Text": {
        const textNode = node as TextNode;
        parts.push(`__html += ${JSON.stringify(escapeHtml(textNode.value))};\n`);
        break;
      }

      case "Interpolation": {
        const interp = node as InterpolationNode;
        const id = markerId++;
        if (includeMarkers) {
          parts.push(`__html += "<!--mix:t:${id}-->" + __escapeHtml(${interp.rawExpression}) + "<!--/mix:t:${id}-->";\n`);
        } else {
          parts.push(`__html += __escapeHtml(${interp.rawExpression});\n`);
        }
        break;
      }

      case "Element": {
        const el = node as ElementNode;
        generateElement(el.tag, el.attributes, el.children, el.selfClosing);
        break;
      }

      case "DynamicElement": {
        const dyn = node as DynamicElementNode;
        const tagExpr = dyn.rawTagExpression;
        parts.push(`{\n`);
        parts.push(`  const __tag = String(${tagExpr});\n`);
        parts.push(`  __html += "<" + __tag;\n`);
        if (scopeHash) {
          parts.push(`  __html += " ${scopeHash}";\n`);
        }
        generateAttributes(dyn.attributes);
        parts.push(`  __html += ">";\n`);
        for (const child of dyn.children) {
          generateNode(child);
        }
        parts.push(`  __html += "</" + __tag + ">";\n`);
        parts.push(`}\n`);
        break;
      }

      case "IfBlock": {
        const ifBlock = node as IfBlockNode;
        generateIfBlock(ifBlock);
        break;
      }

      case "EachBlock": {
        const each = node as EachBlockNode;
        const id = markerId++;
        if (includeMarkers) {
          parts.push(`__html += "<!--mix:each:${id}-->";\n`);
        }
        const indexVar = each.indexIdentifier || `__idx_${id}`;
        parts.push(`{\n`);
        parts.push(`  const __list = (${each.rawCollection}) || [];\n`);
        parts.push(`  let ${indexVar} = 0;\n`);
        parts.push(`  for (const ${each.itemIdentifier} of __list) {\n`);
        parts.push(`    const __key = (${each.rawKeyExpression});\n`);
        if (includeMarkers) {
          parts.push(`    __html += "<!--mix:item:" + __key + "-->";\n`);
        }
        for (const child of each.children) {
          generateNode(child);
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
        parts.push(`if (props.slots && props.slots[${slotName}]) {\n`);
        parts.push(`  __html += props.slots[${slotName}](props);\n`);
        parts.push(`} else if (${slotName} === "default" && props.children) {\n`);
        parts.push(`  __html += typeof props.children === "function" ? props.children(props) : String(props.children);\n`);
        parts.push(`} else {\n`);
        for (const child of slot.fallback) {
          generateNode(child);
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
        parts.push(`if (typeof ${call.name} === "function") {\n`);
        parts.push(`  if (${call.name}.renderToString) {\n`);
        parts.push(`    __html += ${call.name}.renderToString({ ...props });\n`);
        parts.push(`  } else {\n`);
        parts.push(`    __html += ${call.name}({ ...props });\n`);
        parts.push(`  }\n`);
        parts.push(`}\n`);
        if (includeMarkers) {
          parts.push(`__html += "<!--/mix:c:${id}-->";\n`);
        }
        break;
      }

      default:
        break;
    }
  }

  function generateIfBlock(ifBlock: IfBlockNode): void {
    const id = markerId++;
    if (includeMarkers) {
      parts.push(`__html += "<!--mix:if:${id}-->";\n`);
    }
    parts.push(`if (${ifBlock.rawCondition}) {\n`);
    for (const child of ifBlock.consequent) {
      generateNode(child);
    }
    let alt = ifBlock.alternate;
    while (alt) {
      if (Array.isArray(alt)) {
        parts.push(`} else {\n`);
        for (const child of alt) {
          generateNode(child);
        }
        break;
      } else if ("type" in alt && alt.type === "IfBlock") {
        const altIf = alt as IfBlockNode;
        parts.push(`} else if (${altIf.rawCondition}) {\n`);
        for (const child of altIf.consequent) {
          generateNode(child);
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
    selfClosing: boolean
  ): void {
    parts.push(`__html += "<${tagName}";\n`);
    if (scopeHash) {
      parts.push(`__html += " ${scopeHash}";\n`);
    }
    generateAttributes(attributes);
    if (selfClosing && children.length === 0) {
      parts.push(`__html += " />";\n`);
      return;
    }
    parts.push(`__html += ">";\n`);
    for (const child of children) {
      generateNode(child);
    }
    parts.push(`__html += "</${tagName}>";\n`);
  }

  function generateAttributes(attributes: readonly AttributeNode[]): void {
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
        parts.push(
          `__html += __escapeAttr(${JSON.stringify(attr.name)}, ${attr.rawExpression});\n`
        );
      } else if (attr.type === "BindBinding") {
        const propName = attr.name === "checked" ? "checked" : "value";
        parts.push(
          `__html += __escapeAttr(${JSON.stringify(propName)}, ${attr.rawTarget});\n`
        );
      }
    }
  }

  // Generate body from root component template
  for (const templateItem of rootNode.template) {
    generateNode(templateItem);
  }

  const moduleCode = `
${scriptImports}

function __escapeHtml(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function __escapeAttr(name, val) {
  if (val === null || val === undefined || val === false) return "";
  if (val === true) return " " + name;
  const str = String(val);
  if (name === "href" || name === "src" || name === "action") {
    const norm = str.replace(/[\\x00-\\x20\\x7f]/g, "").toLowerCase();
    if (norm.startsWith("javascript:") || norm.startsWith("vbscript:")) {
      return ' ' + name + '="about:blank"';
    }
  }
  return ' ' + name + '="' + __escapeHtml(str) + '"';
}

export function renderToString(props = {}) {
${scriptBody}
  let __html = "";
${parts.join("")}
  return __html;
}

export function renderToStream(props = {}, onChunk) {
  const html = renderToString(props);
  onChunk(html);
}

export const css = ${JSON.stringify(css)};
`;

  return {
    code: moduleCode,
    css,
  };
}
