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
  AwaitBlockNode,
  AttributeNode,
  DynamicAttributeNode,
  BindBindingNode,
  ESTreeNode,
} from "@mix/ast";
import type { ComponentDescriptor } from "@mix/compiler-semantic";
import { extractAndTranspileScript, analyze } from "@mix/compiler-semantic";
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
  const resolved = typeof val === "function" ? (val as () => unknown)() : val;
  if (resolved === null || resolved === undefined) return "";
  const str = String(resolved);
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

function isESTreeNode(value: unknown): value is ESTreeNode {
  return value !== null && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

/**
 * Transforms template expressions for SSR by auto-invoking bare signal identifiers
 * (e.g. `count` -> `count()`) when they match reactive variables in the component's scope.
 */
export function transformSsrExpression(
  rawExpression: string,
  expressionAst: ESTreeNode | undefined,
  signalNames: ReadonlySet<string>,
  outerShadowed: ReadonlySet<string> = new Set()
): string {
  if (!rawExpression || signalNames.size === 0) {
    return rawExpression;
  }
  if (!expressionAst) {
    const trimmed = rawExpression.trim();
    if (signalNames.has(trimmed) && !outerShadowed.has(trimmed)) {
      return `${trimmed}()`;
    }
    return rawExpression;
  }

  const baseOffset = (expressionAst as { start?: number }).start ?? 0;

  function walk(
    node: ESTreeNode,
    parent: ESTreeNode | null,
    parentKey: string | null,
    shadowed: ReadonlySet<string>
  ): string {
    const relStart = ((node as { start?: number }).start ?? baseOffset) - baseOffset;
    const relEnd = ((node as { end?: number }).end ?? baseOffset + rawExpression.length) - baseOffset;

    if (
      node.type === "TSAsExpression" ||
      node.type === "TSTypeAssertion" ||
      node.type === "TSNonNullExpression" ||
      node.type === "TSSatisfiesExpression"
    ) {
      const inner = (node as { expression?: ESTreeNode }).expression;
      if (inner) {
        return walk(inner, parent, parentKey, shadowed);
      }
    }

    if (node.type === "Identifier") {
      const name = (node as { name?: string }).name ?? "";
      if (signalNames.has(name) && !shadowed.has(name)) {
        // Do not auto-invoke if it is already the callee of a CallExpression: count()
        if (parent && parent.type === "CallExpression" && parentKey === "callee") {
          return rawExpression.slice(relStart, relEnd);
        }
        // Do not auto-invoke if it is the non-computed property of a MemberExpression: obj.count
        if (
          parent &&
          parent.type === "MemberExpression" &&
          parentKey === "property" &&
          !(parent as { computed?: boolean }).computed
        ) {
          return rawExpression.slice(relStart, relEnd);
        }
        // Do not auto-invoke if it is the non-computed key of an Object property: { count: 123 }
        if (
          parent &&
          (parent.type === "Property" || parent.type === "ObjectProperty") &&
          parentKey === "key" &&
          !(parent as { computed?: boolean }).computed
        ) {
          return rawExpression.slice(relStart, relEnd);
        }
        return `${name}()`;
      }
      return rawExpression.slice(relStart, relEnd);
    }

    const childReplacements: Array<{ start: number; end: number; text: string }> = [];
    let nextShadowed = shadowed;

    if (
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression"
    ) {
      const copy = new Set(shadowed);
      const params = Array.isArray((node as { params?: unknown[] }).params)
        ? ((node as { params?: ESTreeNode[] }).params as ESTreeNode[])
        : [];
      for (const p of params) {
        if (p.type === "Identifier" && (p as unknown as { name?: string }).name) {
          copy.add((p as unknown as { name: string }).name);
        }
      }
      nextShadowed = copy;
    }

    for (const [key, val] of Object.entries(node)) {
      if (
        key === "type" ||
        key === "start" ||
        key === "end" ||
        key === "loc" ||
        key === "range" ||
        key === "typeAnnotation" ||
        key === "typeParameters" ||
        key === "returnType"
      ) {
        continue;
      }
      if (node.type === "MemberExpression" && key === "property" && !(node as { computed?: boolean }).computed) {
        continue;
      }
      if (
        (node.type === "Property" || node.type === "ObjectProperty") &&
        key === "key" &&
        !(node as { computed?: boolean }).computed
      ) {
        continue;
      }

      if (Array.isArray(val)) {
        for (const item of val) {
          if (isESTreeNode(item)) {
            const cStart = ((item as { start?: number }).start ?? baseOffset) - baseOffset;
            const cEnd = ((item as { end?: number }).end ?? baseOffset) - baseOffset;
            const cText = walk(item, node, key, nextShadowed);
            if (cText !== rawExpression.slice(cStart, cEnd)) {
              childReplacements.push({ start: cStart, end: cEnd, text: cText });
            }
          }
        }
      } else if (isESTreeNode(val)) {
        const cStart = ((val as { start?: number }).start ?? baseOffset) - baseOffset;
        const cEnd = ((val as { end?: number }).end ?? baseOffset) - baseOffset;
        let cText = walk(val, node, key, nextShadowed);
        if (
          (node.type === "Property" || node.type === "ObjectProperty") &&
          key === "value" &&
          (node as { shorthand?: boolean }).shorthand === true &&
          cText !== rawExpression.slice(cStart, cEnd)
        ) {
          const origKey = rawExpression.slice(cStart, cEnd);
          cText = `${origKey}: ${cText}`;
        }
        if (cText !== rawExpression.slice(cStart, cEnd)) {
          childReplacements.push({ start: cStart, end: cEnd, text: cText });
        }
      }
    }

    childReplacements.sort((a, b) => b.start - a.start);
    let slice = rawExpression.slice(relStart, relEnd);
    for (const rep of childReplacements) {
      const localStart = rep.start - relStart;
      const localEnd = rep.end - relStart;
      if (localStart >= 0 && localEnd <= slice.length) {
        slice = slice.slice(0, localStart) + rep.text + slice.slice(localEnd);
      }
    }
    return slice;
  }

  return walk(expressionAst, null, null, outerShadowed);
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
        const expr = transformExpr(bind.rawTarget, (bind as { target?: ESTreeNode }).target, shadowed);
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

function __escapeHtml(val) {
  if (val === null || val === undefined) return "";
  const resolved = typeof val === "function" ? val() : val;
  if (resolved === null || resolved === undefined) return "";
  const str = String(resolved);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function __escapeAttr(name, val) {
  const resolved = typeof val === "function" ? val() : val;
  if (resolved === null || resolved === undefined || resolved === false) return "";
  if (resolved === true) return " " + name;
  const str = String(resolved);
  if (name === "href" || name === "src" || name === "action") {
    const norm = str.replace(/[\\x00-\\x20\\x7f]/g, "").toLowerCase();
    if (norm.startsWith("javascript:") || norm.startsWith("vbscript:")) {
      return ' ' + name + '="about:blank"';
    }
  }
  return ' ' + name + '="' + __escapeHtml(str) + '"';
}

export function renderToString(__props = {}) {
  const defineProps = (defaults) => Object.assign({}, defaults, __props);
${!hasPropsDeclaration ? "  const props = __props;\n" : ""}${scriptBody}
  let __html = "";
${parts.join("")}
  return __html;
}

export function renderToStream(__props = {}, onChunk) {
  const html = renderToString(__props);
  onChunk(html);
}

export const css = ${JSON.stringify(css)};
`;

  return {
    code: moduleCode,
    css,
  };
}
