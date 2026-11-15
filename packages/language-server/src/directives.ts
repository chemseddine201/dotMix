/**
 * @dotmix/language-server/directives — Registry-driven completions and hover for all Gate 38 directives (G4, T-38.8).
 * Zero hand-written directive lists: generated dynamically from DIRECTIVE_SPECS, ATTRIBUTE_DIRECTIVE_SPECS,
 * and CONTEXTUAL_BLOCK_KEYWORDS in @dotmix/compiler-semantic.
 */

import {
  ATTRIBUTE_DIRECTIVE_SPECS,
  CONTEXTUAL_BLOCK_KEYWORDS,
  DIRECTIVE_SPECS,
  getBlockDirectiveSpec,
  getBranchComponentSpecs,
  getComponentDirectiveSpec,
  type AttributeDirectiveSpec,
  type BranchComponentSpec,
  type DirectivePropSchema,
  type DirectiveSpec
} from "@dotmix/compiler-semantic";
import {
  CompletionItemKind,
  type CompletionItem,
  type Hover,
  type Range
} from "./types.js";
import { getWordAtOffset, offsetToPosition } from "./indexer.js";

function isAsciiWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isAttrTokenChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    ch === "_" ||
    ch === "$" ||
    ch === "-" ||
    ch === ":" ||
    ch === "@" ||
    ch === "."
  );
}

function formatPropsTableMarkdown(props: readonly DirectivePropSchema[]): string {
  if (props.length === 0) {
    return "_No props._";
  }
  const lines = ["**Props:**"];
  for (const p of props) {
    const req = p.required ? "required" : "optional";
    lines.push(`- \`${p.name}: ${p.typeText}\` (${req}, ${p.valueKind})`);
  }
  return lines.join("\n");
}

function formatSpecHoverMarkdown(spec: DirectiveSpec, matchedKeyword?: string): string {
  const blockForm = spec.blockClose
    ? `{${spec.blockOpen} ...} ... {${spec.blockClose}}`
    : `{${spec.blockOpen} ...}`;
  const header = matchedKeyword
    ? `**{${matchedKeyword}}** — Mix directive (\`${spec.family}\`, \`${spec.id}\`)`
    : `**<${spec.componentName}>** — Mix directive component (\`${spec.family}\`, \`${spec.id}\`)`;

  const lines: string[] = [
    header,
    "",
    spec.summary,
    "",
    `- **Block form:** \`${blockForm}\``,
    `- **Component form:** \`<${spec.componentName}>\``,
    `- **Import:** \`${spec.importSources.join(" | ")}\``
  ];

  if (spec.branchMarkers.length > 0) {
    lines.push(`- **Branch markers:** ${spec.branchMarkers.map((m) => `\`{${m}}\``).join(", ")}`);
  }
  if (spec.exposes && spec.exposes.params.length > 0) {
    const params = spec.exposes.params.map((p) => `\`${p.name}: ${p.typeText}\``).join(", ");
    lines.push(`- **Exposes (${spec.exposes.blockSyntax ?? "value"}):** ${params}`);
  }
  if (spec.diagnostics.length > 0) {
    lines.push(`- **Diagnostics:** ${spec.diagnostics.map((d) => `\`${d}\``).join(", ")}`);
  }
  lines.push("", formatPropsTableMarkdown(spec.props));
  return lines.join("\n");
}

function formatBranchHoverMarkdown(
  branch: BranchComponentSpec,
  parentSpec: DirectiveSpec | undefined
): string {
  const lines: string[] = [
    `**<${branch.name}>** — ${branch.role} of \`<${parentSpec?.componentName ?? branch.parentId}>\``,
    "",
    branch.summary,
    "",
    `- **Import:** \`${branch.importSource}\``
  ];
  if (branch.blockMarker) {
    lines.push(`- **Block equivalent:** \`{${branch.blockMarker}}\``);
  }
  lines.push("", formatPropsTableMarkdown(branch.props));
  return lines.join("\n");
}

function formatPropHoverMarkdown(
  componentName: string,
  prop: DirectivePropSchema
): string {
  const req = prop.required ? "required" : "optional";
  return [
    `**${componentName}.${prop.name}**`,
    "",
    `\`\`\`ts\n${prop.name}${prop.required ? "" : "?"}: ${prop.typeText}\n\`\`\``,
    "",
    `${req} prop (${prop.valueKind}).`
  ].join("\n");
}

function formatAttrDirectiveHoverMarkdown(spec: AttributeDirectiveSpec): string {
  const lines = [
    `**${spec.id}** — ${spec.category} (\`${spec.family}\`)`,
    "",
    spec.summary,
    "",
    `- **Syntax:** \`${spec.syntax}\``,
    `- **IR:** \`${spec.irKind}\``
  ];
  if (spec.diagnostics.length > 0) {
    lines.push(`- **Diagnostics:** ${spec.diagnostics.map((d) => `\`${d}\``).join(", ")}`);
  }
  return lines.join("\n");
}

function findEnclosingOpeningTag(text: string, offset: number): string | null {
  let scanOffset = offset - 1;
  let braceDepth = 0;
  while (scanOffset >= 0) {
    const ch = text[scanOffset]!;
    if (ch === "}") braceDepth++;
    else if (ch === "{") {
      if (braceDepth > 0) braceDepth--;
    } else if (braceDepth === 0) {
      if (ch === ">") {
        return null;
      }
      if (ch === "<") {
        if (text[scanOffset + 1] === "/") return null;
        let end = scanOffset + 1;
        while (end < text.length && !isAsciiWhitespace(text[end]!) && text[end] !== ">" && text[end] !== "/") {
          end++;
        }
        return text.slice(scanOffset + 1, end);
      }
    }
    scanOffset--;
  }
  return null;
}

function isInsideBlockHeader(text: string, offset: number): boolean {
  let scanOffset = offset - 1;
  while (scanOffset >= 0) {
    const ch = text[scanOffset]!;
    if (ch === "}") return false;
    if (ch === "{") return true;
    scanOffset--;
  }
  return false;
}

function isPrecededByChar(text: string, startOffset: number, target: string): boolean {
  let scanOffset = startOffset - 1;
  while (scanOffset >= 0 && isAsciiWhitespace(text[scanOffset]!)) {
    scanOffset--;
  }
  if (scanOffset < 0) return false;
  if (target === "<" && text[scanOffset] === "/" && scanOffset > 0 && text[scanOffset - 1] === "<") {
    return true;
  }
  return text[scanOffset] === target;
}

function getExtendedTokenAtOffset(
  text: string,
  offset: number
): { token: string; start: number; end: number } | null {
  if (offset < 0 || offset > text.length) return null;
  let start = offset;
  while (start > 0 && isAttrTokenChar(text[start - 1]!)) {
    start--;
  }
  let end = offset;
  while (end < text.length && isAttrTokenChar(text[end]!)) {
    end++;
  }
  if (start === end) return null;
  return { token: text.slice(start, end), start, end };
}

function findSpecsForBlockKeyword(keyword: string): readonly DirectiveSpec[] {
  const direct = getBlockDirectiveSpec(keyword);
  if (direct) return [direct];
  return DIRECTIVE_SPECS.filter(
    (s) =>
      s.blockOpen === keyword ||
      s.blockClose === keyword ||
      s.branchMarkers.includes(keyword) ||
      s.inlineStatements.includes(keyword)
  );
}

function findAttrDirectiveMatch(token: string): AttributeDirectiveSpec | undefined {
  if (token.startsWith("class:")) {
    return ATTRIBUTE_DIRECTIVE_SPECS.find((s) => s.id === "class:name");
  }
  if (token.startsWith("style:")) {
    return ATTRIBUTE_DIRECTIVE_SPECS.find((s) => s.id === "style:prop");
  }
  if (token === "spread:if") {
    return ATTRIBUTE_DIRECTIVE_SPECS.find((s) => s.id === "spread:if");
  }
  const colonIdx = token.lastIndexOf(":");
  if (colonIdx === -1) return undefined;
  const base = token.slice(0, colonIdx);
  const modifier = token.slice(colonIdx + 1);
  const isEvent = base.startsWith("on") || base.startsWith("@");
  if (isEvent) {
    return ATTRIBUTE_DIRECTIVE_SPECS.find(
      (s) => s.category === "event-modifier" && s.modifier === modifier
    );
  }
  if (modifier.startsWith("case-")) {
    return ATTRIBUTE_DIRECTIVE_SPECS.find((s) => s.id === "attr:case");
  }
  return ATTRIBUTE_DIRECTIVE_SPECS.find(
    (s) => s.category === "attribute-modifier" && s.modifier === modifier
  );
}

export function getComponentPropsForName(name: string): readonly DirectivePropSchema[] {
  const main = getComponentDirectiveSpec(name);
  if (main) return main.props;
  const branches = getBranchComponentSpecs(name);
  if (branches.length > 0) return branches[0]!.props;
  return [];
}

export function resolveDirectiveHover(text: string, offset: number): Hover | null {
  const wordInfo = getWordAtOffset(text, offset);
  const extInfo = getExtendedTokenAtOffset(text, offset);

  if (extInfo && extInfo.token.includes(":")) {
    const attrSpec = findAttrDirectiveMatch(extInfo.token);
    if (attrSpec) {
      const range: Range = {
        start: offsetToPosition(text, extInfo.start),
        end: offsetToPosition(text, extInfo.end)
      };
      return {
        contents: { kind: "markdown", value: formatAttrDirectiveHoverMarkdown(attrSpec) },
        range
      };
    }
  }

  if (!wordInfo) return null;
  const word = wordInfo.word;
  const range: Range = {
    start: offsetToPosition(text, wordInfo.start),
    end: offsetToPosition(text, wordInfo.end)
  };

  if (isPrecededByChar(text, wordInfo.start, "{")) {
    const matches = findSpecsForBlockKeyword(word);
    if (matches.length > 0) {
      return {
        contents: { kind: "markdown", value: formatSpecHoverMarkdown(matches[0]!, word) },
        range
      };
    }
  }

  if (isPrecededByChar(text, wordInfo.start, "<")) {
    const compSpec = getComponentDirectiveSpec(word);
    if (compSpec) {
      return {
        contents: { kind: "markdown", value: formatSpecHoverMarkdown(compSpec) },
        range
      };
    }
    const branchSpecs = getBranchComponentSpecs(word);
    if (branchSpecs.length > 0) {
      const branch = branchSpecs[0]!;
      const parentSpec = DIRECTIVE_SPECS.find((s) => s.id === branch.parentId);
      return {
        contents: { kind: "markdown", value: formatBranchHoverMarkdown(branch, parentSpec) },
        range
      };
    }
  }

  const enclosingTag = findEnclosingOpeningTag(text, wordInfo.start);
  if (enclosingTag) {
    const props = getComponentPropsForName(enclosingTag);
    const propName = extInfo && !extInfo.token.includes(":") ? extInfo.token : word;
    const matchedProp = props.find((p) => p.name === propName);
    if (matchedProp) {
      return {
        contents: { kind: "markdown", value: formatPropHoverMarkdown(enclosingTag, matchedProp) },
        range
      };
    }
  }

  if (isInsideBlockHeader(text, wordInfo.start) && CONTEXTUAL_BLOCK_KEYWORDS.includes(word)) {
    return {
      contents: {
        kind: "markdown",
        value: `**${word}** — Contextual Mix directive keyword.`
      },
      range
    };
  }

  return null;
}

export function resolveDirectiveFallbackHover(text: string, offset: number): Hover | null {
  const wordInfo = getWordAtOffset(text, offset);
  if (!wordInfo) return null;
  const word = wordInfo.word;
  const range: Range = {
    start: offsetToPosition(text, wordInfo.start),
    end: offsetToPosition(text, wordInfo.end)
  };

  const compSpec = getComponentDirectiveSpec(word);
  if (compSpec) {
    return {
      contents: { kind: "markdown", value: formatSpecHoverMarkdown(compSpec) },
      range
    };
  }
  const branchSpecs = getBranchComponentSpecs(word);
  if (branchSpecs.length > 0) {
    const branch = branchSpecs[0]!;
    const parentSpec = DIRECTIVE_SPECS.find((s) => s.id === branch.parentId);
    return {
      contents: { kind: "markdown", value: formatBranchHoverMarkdown(branch, parentSpec) },
      range
    };
  }
  const blockMatches = findSpecsForBlockKeyword(word);
  if (blockMatches.length > 0) {
    return {
      contents: { kind: "markdown", value: formatSpecHoverMarkdown(blockMatches[0]!, word) },
      range
    };
  }
  return null;
}

function buildBlockSnippet(spec: DirectiveSpec): string {
  if (spec.blockClose) {
    return `${spec.blockOpen} \${1}} $0 {${spec.blockClose}`;
  }
  return `${spec.blockOpen} \${1}`;
}

function buildComponentInsertText(name: string, props: readonly DirectivePropSchema[]): string {
  const requiredNonChildren = props.filter((p) => p.required && p.name !== "children");
  const attrList = requiredNonChildren.map((p, idx) => `${p.name}={\${${idx + 1}}}`).join(" ");
  const hasChildren = props.some((p) => p.name === "children");
  const attrSuffix = attrList.length > 0 ? ` ${attrList}` : "";
  if (!hasChildren) {
    return `${name}${attrSuffix} />`;
  }
  return `${name}${attrSuffix}>$0</${name}>`;
}

export function getDirectiveCompletionItems(text?: string, offset?: number): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  const pushUnique = (item: CompletionItem): void => {
    if (!seen.has(item.label)) {
      seen.add(item.label);
      items.push(item);
    }
  };

  if (text !== undefined && offset !== undefined) {
    const enclosingTag = findEnclosingOpeningTag(text, offset);
    if (enclosingTag) {
      for (const p of getComponentPropsForName(enclosingTag)) {
        pushUnique({
          label: p.name,
          kind: CompletionItemKind.Property,
          detail: `${p.typeText}${p.required ? " (required)" : " (optional)"}`,
          documentation: `${enclosingTag} prop (${p.valueKind})`,
          insertText: `${p.name}={\${1}}`
        });
      }
    }
    if (isInsideBlockHeader(text, offset)) {
      for (const kw of CONTEXTUAL_BLOCK_KEYWORDS) {
        pushUnique({
          label: kw,
          kind: CompletionItemKind.Keyword,
          detail: "contextual directive keyword",
          documentation: `Contextual block header keyword '${kw}'`
        });
      }
    }
  }

  for (const spec of DIRECTIVE_SPECS) {
    pushUnique({
      label: spec.blockOpen,
      kind: CompletionItemKind.Keyword,
      detail: spec.blockClose ? `{${spec.blockOpen} ...} ... {${spec.blockClose}}` : `{${spec.blockOpen} ...}`,
      documentation: formatSpecHoverMarkdown(spec, spec.blockOpen),
      insertText: buildBlockSnippet(spec)
    });

    if (spec.blockClose) {
      pushUnique({
        label: spec.blockClose,
        kind: CompletionItemKind.Keyword,
        detail: `{${spec.blockClose}} closer`,
        documentation: `Closes {${spec.blockOpen}} block (${spec.family})`
      });
    }

    for (const marker of spec.branchMarkers) {
      pushUnique({
        label: marker,
        kind: CompletionItemKind.Keyword,
        detail: `{${marker}} branch marker`,
        documentation: `Branch marker inside {${spec.blockOpen}} (${spec.family})`
      });
    }

    for (const stmt of spec.inlineStatements) {
      pushUnique({
        label: stmt,
        kind: CompletionItemKind.Keyword,
        detail: `{${stmt} if ...} loop statement`,
        documentation: `Loop control statement inside {${spec.blockOpen}}`,
        insertText: `${stmt} if \${1:condition}`
      });
    }

    pushUnique({
      label: spec.componentName,
      kind: CompletionItemKind.Class,
      detail: `<${spec.componentName}> (${spec.importSources[0] ?? "@dotmix/runtime/directives"})`,
      documentation: formatSpecHoverMarkdown(spec),
      insertText: buildComponentInsertText(spec.componentName, spec.props)
    });

    for (const branch of spec.branchComponents) {
      pushUnique({
        label: branch.name,
        kind: CompletionItemKind.Class,
        detail: `<${branch.name}> (${branch.role} of <${spec.componentName}>)`,
        documentation: formatBranchHoverMarkdown(branch, spec),
        insertText: buildComponentInsertText(branch.name, branch.props)
      });
    }
  }

  for (const attrSpec of ATTRIBUTE_DIRECTIVE_SPECS) {
    pushUnique({
      label: attrSpec.id,
      kind: CompletionItemKind.Property,
      detail: attrSpec.syntax,
      documentation: formatAttrDirectiveHoverMarkdown(attrSpec)
    });
  }

  return items;
}
