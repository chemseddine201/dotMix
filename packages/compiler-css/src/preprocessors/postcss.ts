/**
 * @mix/compiler-css/preprocessors/postcss — PostCSS / CSS nesting flattener (`&`, nested `@media`/`@supports`/`@layer`/`@container`).
 */

export interface ParsedBlockItem {
  readonly kind: "declaration" | "block";
  readonly text: string;
  readonly header?: string;
  readonly body?: string;
}

export function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i]!;
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function combineSelectors(parentSelectors: readonly string[], childSelectorText: string): string[] {
  const childList = splitSelectorList(childSelectorText);
  if (parentSelectors.length === 0) {
    return childList.map((c) => c.replace(/&/g, "").trim()).filter(Boolean);
  }
  const combined: string[] = [];
  for (const parent of parentSelectors) {
    for (const child of childList) {
      if (child.includes("&")) {
        combined.push(child.replace(/&/g, parent));
      } else {
        combined.push(`${parent} ${child}`);
      }
    }
  }
  return combined;
}

export function parseBlockItems(source: string): ParsedBlockItem[] {
  const items: ParsedBlockItem[] = [];
  let pos = 0;
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let parenDepth = 0;

  while (pos < source.length) {
    const ch = source[pos]!;
    if (ch === "'" && !inDouble && source[pos - 1] !== "\\") {
      inSingle = !inSingle;
      pos++;
      continue;
    }
    if (ch === '"' && !inSingle && source[pos - 1] !== "\\") {
      inDouble = !inDouble;
      pos++;
      continue;
    }
    if (inSingle || inDouble) {
      pos++;
      continue;
    }

    if (ch === "(") {
      parenDepth++;
      pos++;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      pos++;
      continue;
    }

    if (ch === ";" && parenDepth === 0) {
      const decl = source.slice(start, pos).trim();
      if (decl.length > 0) {
        items.push({ kind: "declaration", text: decl });
      }
      pos++;
      start = pos;
      continue;
    }

    if (ch === "{" && parenDepth === 0) {
      const header = source.slice(start, pos).trim();
      const bodyStart = pos + 1;
      let braceDepth = 1;
      pos++;
      while (pos < source.length && braceDepth > 0) {
        const c = source[pos]!;
        if (c === "'" && !inDouble && source[pos - 1] !== "\\") inSingle = !inSingle;
        else if (c === '"' && !inSingle && source[pos - 1] !== "\\") inDouble = !inDouble;
        else if (!inSingle && !inDouble) {
          if (c === "{") braceDepth++;
          else if (c === "}") braceDepth--;
        }
        pos++;
      }
      const body = source.slice(bodyStart, pos - 1);
      items.push({
        kind: "block",
        text: `${header} { ${body} }`,
        header,
        body
      });
      start = pos;
      continue;
    }

    pos++;
  }

  const trailing = source.slice(start).trim();
  if (trailing.length > 0) {
    items.push({ kind: "declaration", text: trailing });
  }

  return items;
}

export function flattenNestedCss(
  source: string,
  parentSelectors: readonly string[] = [],
  parentAtRules: readonly string[] = []
): string {
  const items = parseBlockItems(source);
  const declarations: string[] = [];
  const childRules: string[] = [];

  for (const item of items) {
    if (item.kind === "declaration") {
      if (item.text.startsWith("@")) {
        childRules.push(`${item.text};`);
      } else {
        declarations.push(`${item.text};`);
      }
    } else if (item.kind === "block" && item.header !== undefined && item.body !== undefined) {
      const header = item.header.trim();
      if (header.startsWith("@")) {
        const lower = header.toLowerCase();
        if (lower.startsWith("@keyframes") || lower.startsWith("@-webkit-keyframes") || lower.startsWith("@font-face")) {
          childRules.push(`${header} {\n${item.body.trim()}\n}`);
        } else {
          // @media, @supports, @layer, @container
          const inner = flattenNestedCss(item.body, parentSelectors, [...parentAtRules, header]);
          childRules.push(inner);
        }
      } else {
        const nextSelectors = combineSelectors(parentSelectors, header);
        const nestedCss = flattenNestedCss(item.body, nextSelectors, parentAtRules);
        childRules.push(nestedCss);
      }
    }
  }

  const emitted: string[] = [];
  if (declarations.length > 0 && parentSelectors.length > 0) {
    let ruleBlock = `${parentSelectors.join(", ")} {\n  ${declarations.join("\n  ")}\n}`;
    for (let i = parentAtRules.length - 1; i >= 0; i--) {
      ruleBlock = `${parentAtRules[i]!} {\n${ruleBlock}\n}`;
    }
    emitted.push(ruleBlock);
  } else if (declarations.length > 0 && parentAtRules.length > 0) {
    let ruleBlock = declarations.join("\n");
    for (let i = parentAtRules.length - 1; i >= 0; i--) {
      ruleBlock = `${parentAtRules[i]!} {\n${ruleBlock}\n}`;
    }
    emitted.push(ruleBlock);
  }

  emitted.push(...childRules.filter((r) => r.trim().length > 0));
  return emitted.join("\n");
}

export function preprocessPostcss(source: string): string {
  return flattenNestedCss(source);
}
