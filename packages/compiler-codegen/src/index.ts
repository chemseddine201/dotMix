/**
 * @mix/compiler-codegen — Deterministic AOT code generation targeting direct DOM operations.
 */

import type { ComponentDescriptor } from "@mix/compiler-semantic";
import type { ElementNode, TextNode, InterpolationNode, TemplateChildNode } from "@mix/ast";

export interface CodegenResult {
  readonly code: string;
}

/**
 * Deterministically generates JavaScript module code calling @mix/runtime direct DOM operations.
 */
export function generate(descriptor: ComponentDescriptor): CodegenResult {
  const lines: string[] = [];

  // 1. Imports from @mix/runtime
  lines.push('import { createElement, createTextNode, createEffect, signal } from "@mix/runtime";');
  lines.push("");
  lines.push("export function renderComponent() {");

  // 2. Signals initialization
  for (const sig of descriptor.signals) {
    lines.push(`  const ${sig.name} = signal(${sig.initialValueCode});`);
  }
  if (descriptor.signals.length > 0) {
    lines.push("");
  }

  // 3. Elements creation
  let elemIndex = 0;
  let textIndex = 0;
  let rootElemName = "";

  function emitNode(node: TemplateChildNode, parentName: string | null) {
    if (node.type === "Element") {
      const el = node as ElementNode;
      const elName = `el${elemIndex++}`;
      if (!rootElemName) rootElemName = elName;

      lines.push(`  const ${elName} = createElement("${el.tag}");`);
      if (parentName) {
        lines.push(`  ${parentName}.appendChild(${elName});`);
      }

      for (const child of el.children) {
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
    }
  }

  for (const tNode of descriptor.ast.template) {
    emitNode(tNode, null);
  }

  lines.push("");
  lines.push("  return {");
  lines.push(`    element: ${rootElemName || "null"},`);
  for (const sig of descriptor.signals) {
    lines.push(`    ${sig.name},`);
  }
  lines.push("  };");
  lines.push("}");

  return Object.freeze({
    code: lines.join("\n") + "\n"
  });
}
