/**
 * @mix/language-server/completions — Template scope walker, hover resolution, and completion item providers.
 */

import { parse } from "@mix/compiler-frontend";
import { analyze } from "@mix/compiler-semantic";
import type {
  TemplateNode,
  IfBlockNode,
} from "@mix/ast";
import {
  type Position,
  type Range,
  type Hover,
  type CompletionItem,
  CompletionItemKind,
} from "./types.js";
import {
  offsetToPosition,
  positionToOffset,
  getWordAtOffset,
} from "./indexer.js";
import { extractCssClasses, collectComponentCssSources } from "./css-extractor.js";

export function findEnclosingTemplateNodes(
  nodes: readonly TemplateNode[],
  offset: number
): TemplateNode[] {
  const result: TemplateNode[] = [];
  for (const node of nodes) {
    if (node.span && offset >= node.span.start.offset && offset <= node.span.end.offset) {
      result.push(node);
      if (
        node.type === "Element" ||
        node.type === "ComponentCall" ||
        node.type === "DynamicElement"
      ) {
        for (const attr of node.attributes) {
          if (attr.type === "DynamicAttribute" && attr.templateValue) {
            result.push(...findEnclosingTemplateNodes(attr.templateValue, offset));
          }
        }
        result.push(...findEnclosingTemplateNodes(node.children, offset));
      } else if (node.type === "EachBlock") {
        result.push(...findEnclosingTemplateNodes(node.children, offset));
      } else if (node.type === "SlotOutlet") {
        result.push(...findEnclosingTemplateNodes(node.fallback, offset));
      } else if (node.type === "IfBlock") {
        result.push(...findEnclosingTemplateNodes(node.consequent, offset));
        let alt = node.alternate;
        while (alt) {
          if (Array.isArray(alt)) {
            result.push(...findEnclosingTemplateNodes(alt, offset));
            break;
          } else if ("type" in alt && alt.type === "IfBlock") {
            const altIf = alt as IfBlockNode;
            if (altIf.span && offset >= altIf.span.start.offset && offset <= altIf.span.end.offset) {
              result.push(altIf);
              result.push(...findEnclosingTemplateNodes(altIf.consequent, offset));
            }
            alt = altIf.alternate;
          } else {
            break;
          }
        }
      } else if (node.type === "AwaitBlock") {
        result.push(...findEnclosingTemplateNodes(node.pending, offset));
        result.push(...findEnclosingTemplateNodes(node.thenBranch, offset));
        result.push(...findEnclosingTemplateNodes(node.catchBranch, offset));
      }
    }
  }
  return result;
}

export function resolveHover(
  uri: string,
  text: string,
  position: Position
): Hover | null {
  const filename = uri.replace(/^file:\/\//, "");
  const offset = positionToOffset(text, position);
  const wordInfo = getWordAtOffset(text, offset);
  if (!wordInfo) return null;

  try {
    const ast = parse(text, { filename });
    const desc = analyze(ast, {
      filename,
      source: text,
      throwOnError: false,
      warnLegacyControlFlow: true,
    });

    const binding = desc.rootScope.bindings.get(wordInfo.word);
    if (binding) {
      const range: Range = {
        start: offsetToPosition(text, wordInfo.start),
        end: offsetToPosition(text, wordInfo.end),
      };
      const md = [
        `**${binding.name}** (${binding.kind})`,
        "",
        `Mix reactive binding declared as \`${binding.kind}\`.`,
      ].join("\n");

      return {
        contents: { kind: "markdown", value: md },
        range,
      };
    }
  } catch {
    // Syntax errors during editing - return null
  }

  return null;
}

export function resolveCompletions(
  uri: string,
  text: string,
  position: Position,
  getFileContent: (targetUri: string) => string | null
): CompletionItem[] {
  const filename = uri.replace(/^file:\/\//, "");
  const offset = positionToOffset(text, position);
  const items: CompletionItem[] = [];
  const seenLabels = new Set<string>();

  function addItem(item: CompletionItem): void {
    if (!seenLabels.has(item.label)) {
      seenLabels.add(item.label);
      items.push(item);
    }
  }

  try {
    const ast = parse(text, { filename });
    const desc = analyze(ast, {
      filename,
      source: text,
      throwOnError: false,
      warnLegacyControlFlow: true,
    });

    // 1. Suggest variables in root scope
    for (const [name, binding] of desc.rootScope.bindings) {
      addItem({
        label: name,
        kind:
          binding.kind === "function"
            ? CompletionItemKind.Function
            : binding.kind === "prop"
            ? CompletionItemKind.Property
            : CompletionItemKind.Variable,
        detail: `(${binding.kind}) ${name}`,
        documentation: `Mix ${binding.kind} binding in scope`,
      });
    }

    // 2. Suggest nested block-scoped variables ({#each}, {#await})
    const enclosing = findEnclosingTemplateNodes(ast.template, offset);
    for (const node of enclosing) {
      if (node.type === "EachBlock") {
        addItem({
          label: node.itemIdentifier,
          kind: CompletionItemKind.Variable,
          detail: `(loop item) ${node.itemIdentifier}`,
          documentation: `Item identifier in {#each} iteration block`,
        });
        if (node.indexIdentifier) {
          addItem({
            label: node.indexIdentifier,
            kind: CompletionItemKind.Variable,
            detail: `(loop index) ${node.indexIdentifier}`,
            documentation: `Index identifier in {#each} iteration block`,
          });
        }
      } else if (node.type === "AwaitBlock") {
        if (node.thenIdentifier) {
          addItem({
            label: node.thenIdentifier,
            kind: CompletionItemKind.Variable,
            detail: `(resolved data) ${node.thenIdentifier}`,
            documentation: `Resolved promise data in {#await} block`,
          });
        }
        if (node.catchIdentifier) {
          addItem({
            label: node.catchIdentifier,
            kind: CompletionItemKind.Variable,
            detail: `(error) ${node.catchIdentifier}`,
            documentation: `Rejected promise error in {#await} block`,
          });
        }
      }
    }

    // 3. Suggest CSS classes from embedded <style>, linked <style src="...">, and import "./foo.css"
    const cssSources = collectComponentCssSources(uri, ast, desc, getFileContent);
    for (const cssText of cssSources) {
      const classes = extractCssClasses(cssText);
      for (const cls of classes) {
        addItem({
          label: cls,
          kind: CompletionItemKind.Property,
          detail: `(css class) .${cls}`,
          documentation: `CSS class selector available in this component`,
        });
      }
    }
  } catch {
    // If syntax is currently broken while typing, still offer framework keywords
  }

  // Add framework template keywords and directives
  const keywords = [
    { label: "if", insertText: "if ${1:condition}} $0 {endif", detail: "{if ...} conditional block" },
    { label: "elseif", insertText: "elseif ${1:condition}}", detail: "{elseif ...} branch" },
    { label: "else", insertText: "else}", detail: "{else} branch" },
    { label: "each", insertText: "each (${1:item}, ${2:idx}) in ${3:list}} $0 {endeach", detail: "{each ...} loop" },
    { label: "await", insertText: "await ${1:promise}} {then ${2:res}} $0 {endawait", detail: "{await ...} async block" },
    { label: "bind:value", insertText: "bind:value={${1:value}}", detail: "Two-way input value binding" },
    { label: "bind:checked", insertText: "bind:checked={${1:checked}}", detail: "Two-way checkbox binding" },
  ];

  for (const kw of keywords) {
    addItem({
      label: kw.label,
      kind: CompletionItemKind.Keyword,
      detail: kw.detail,
      insertText: kw.insertText,
    });
  }

  return items;
}
