/**
 * @mix/compiler-codegen — Deterministic AOT code generator emitting direct DOM operations.
 */

import type { ComponentDescriptor } from "@mix/compiler-semantic";
import type {
  ElementNode,
  DynamicElementNode,
  TextNode,
  InterpolationNode,
  TemplateChildNode,
  IfBlockNode,
  EachBlockNode
} from "@mix/ast";
import { compileCss } from "@mix/compiler-css";

export interface CodegenOptions {
  componentName?: string;
  scopeId?: string;
}

export interface CodegenResult {
  readonly code: string;
  readonly scopeId?: string;
  readonly css?: string;
}

/**
 * Deterministically generates readable JavaScript/TypeScript module code
 * calling @mix/runtime direct DOM operations.
 */
export function generate(descriptor: ComponentDescriptor, options: CodegenOptions = {}): CodegenResult {
  const lines: string[] = [];
  const componentName = options.componentName ?? "Component";

  // 1. Process Styles
  let scopeId = options.scopeId;
  let compiledCss = "";
  if (descriptor.ast.style) {
    const cssRes = compileCss(descriptor.ast.style.content, { scopeId });
    scopeId = cssRes.scopeId;
    compiledCss = cssRes.code;
  }

  // 2. Imports from @mix/runtime
  lines.push('import { createElement, createTextNode, createEffect, signal, onCleanup, createRoot, setTrustedHtml, setSafeSrcset, setSafeStyleProperty } from "@mix/runtime";');
  lines.push("");

  // 3. Exported Component Factory (D-106, D-111)
  lines.push(`export function ${componentName}(props = {}, owner = null) {`);

  // Stable scope context for HMR and methods (D-111)
  lines.push("  const __scope = Object.create(null);");

  // Signals initialization
  for (const sig of descriptor.signals) {
    lines.push(`  const ${sig.name} = signal(${sig.initialValueCode});`);
    lines.push(`  __scope.${sig.name} = ${sig.name};`);
  }
  if (descriptor.signals.length > 0) {
    lines.push("");
  }

  let elemIndex = 0;
  let textIndex = 0;
  let rootElemName = "";

  function emitNode(node: TemplateChildNode, parentName: string | null): void {
    if (node.type === "Element") {
      const el = node as ElementNode;
      const elName = `el${elemIndex++}`;
      if (!rootElemName) rootElemName = elName;

      lines.push(`  const ${elName} = createElement("${el.tag}");`);
      if (scopeId) {
        lines.push(`  ${elName}.setAttribute("${scopeId}", "");`);
      }

      // Attributes & Events & Directives (D-108, D-109)
      for (const attr of el.attributes) {
        if (attr.type === "StaticAttribute") {
          lines.push(`  ${elName}.setAttribute("${attr.name}", ${JSON.stringify(attr.value)});`);
        } else if (attr.type === "DynamicAttribute") {
          if (attr.name === "srcset") {
            lines.push("  createEffect(() => {");
            lines.push(`    setSafeSrcset(${elName}, String(${attr.expression.code}));`);
            lines.push("  });");
          } else {
            lines.push("  createEffect(() => {");
            lines.push(`    const __val = ${attr.expression.code};`);
            lines.push(`    if (typeof __val === "boolean") {`);
            lines.push(`      if (__val) ${elName}.setAttribute("${attr.name}", "");`);
            lines.push(`      else ${elName}.removeAttribute("${attr.name}");`);
            lines.push("    } else {");
            lines.push(`      ${elName}.setAttribute("${attr.name}", String(__val));`);
            lines.push("    }");
            lines.push("  });");
          }
        } else if (attr.type === "Directive") {
          if (attr.name === "mix-html") {
            lines.push("  createEffect(() => {");
            lines.push(`    setTrustedHtml(${elName}, ${attr.expression.code});`);
            lines.push("  });");
          }
        } else if (attr.type === "EventBinding") {
          lines.push(`  ${elName}.addEventListener("${attr.eventName}", ($event) => {`);
          lines.push(`    (${attr.handler.code})($event);`);
          lines.push("  });");
        } else if (attr.type === "RefBinding") {
          lines.push(`  if (typeof ${attr.target.code} === "function" && "set" in ${attr.target.code}) {`);
          lines.push(`    ${attr.target.code}.set(${elName});`);
          lines.push("  } else {");
          lines.push(`    ${attr.target.code} = ${elName};`);
          lines.push("  }");
        }
      }

      if (parentName) {
        lines.push(`  ${parentName}.appendChild(${elName});`);
      }

      for (const child of el.children) {
        emitNode(child, elName);
      }
    } else if (node.type === "DynamicElement") {
      const dyn = node as DynamicElementNode;
      const elName = `el${elemIndex++}`;
      if (!rootElemName) rootElemName = elName;

      // D-105: Evaluated once upon creation; resolved identity retained
      lines.push(`  const __dynTag = ${dyn.tagExpression.code};`);
      lines.push(`  const ${elName} = typeof __dynTag === "string" ? createElement(__dynTag) : __dynTag();`);
      if (scopeId) {
        lines.push(`  if (${elName} instanceof HTMLElement) ${elName}.setAttribute("${scopeId}", "");`);
      }

      if (parentName) {
        lines.push(`  ${parentName}.appendChild(${elName});`);
      }

      for (const child of dyn.children) {
        emitNode(child, elName);
      }
    } else if (node.type === "Text") {
      const text = node as TextNode;
      const tName = `t${textIndex++}`;
      lines.push(`  const ${tName} = createTextNode(${JSON.stringify(text.value)});`);
      if (parentName) {
        lines.push(`  ${parentName}.appendChild(${tName});`);
      }
    } else if (node.type === "Interpolation") {
      const interp = node as InterpolationNode;
      const tName = `t${textIndex++}`;
      lines.push(`  const ${tName} = createTextNode("");`);
      if (parentName) {
        lines.push(`  ${parentName}.appendChild(${tName});`);
      }
      lines.push("  createEffect(() => {");
      lines.push(`    ${tName}.data = String(${interp.expression.code});`);
      lines.push("  });");
    } else if (node.type === "IfBlock") {
      const ifNode = node as IfBlockNode;
      const anchorName = `anchor${textIndex++}`;
      lines.push(`  const ${anchorName} = createTextNode("");`);
      if (parentName) {
        lines.push(`  ${parentName}.appendChild(${anchorName});`);
      }

      lines.push("  createEffect(() => {");
      lines.push(`    if (${ifNode.condition.code}) {`);
      lines.push(`      // Conditional consequent branch`);
      lines.push("    }");
      if (ifNode.alternate) {
        lines.push("    else {");
        lines.push(`      // Conditional alternate branch`);
        lines.push("    }");
      }
      lines.push("  });");
    } else if (node.type === "EachBlock") {
      const eachNode = node as EachBlockNode;
      const anchorName = `anchor${textIndex++}`;
      lines.push(`  const ${anchorName} = createTextNode("");`);
      if (parentName) {
        lines.push(`  ${parentName}.appendChild(${anchorName});`);
      }

      lines.push("  createEffect(() => {");
      lines.push(`    const __items = ${eachNode.items.code};`);
      lines.push("    // Keyed reconciliation loop (D-110)");
      lines.push("  });");
    }
  }

  for (const tNode of descriptor.ast.template) {
    emitNode(tNode, null);
  }

  lines.push("");
  lines.push("  return {");
  lines.push(`    element: ${rootElemName || "null"},`);
  lines.push("    __scope,");
  for (const sig of descriptor.signals) {
    lines.push(`    ${sig.name},`);
  }
  lines.push("  };");
  lines.push("}");

  return Object.freeze({
    code: lines.join("\n") + "\n",
    ...(scopeId ? { scopeId } : {}),
    ...(compiledCss ? { css: compiledCss } : {})
  });
}
