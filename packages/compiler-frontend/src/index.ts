/**
 * @mix/compiler-frontend — Lexer, tokenizer, and markup parser for Mix & Tix.
 */

import {
  type ComponentNode,
  type ScriptBlockNode,
  type StyleBlockNode,
  type TemplateChildNode,
  type AttributeNode,
  type ElseIfBlockNode,
  createComponentNode,
  createScriptBlockNode,
  createStyleBlockNode,
  createElementNode,
  createDynamicElementNode,
  createIfBlockNode,
  createElseIfBlockNode,
  createEachBlockNode,
  createAwaitBlockNode,
  createTextNode,
  createInterpolationNode,
  createExpressionNode,
  createStaticAttributeNode,
  createDynamicAttributeNode,
  createEventBindingNode,
  createRefBindingNode,
  createDirectiveNode,
  createCommentNode,
  createSourceSpan
} from "@mix/ast";

export const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

/**
 * Scan expression boundary from opening '{' at startOffset to its matching '}',
 * accounting for strings, template strings, comments, and nested braces (D-105).
 */
export function scanExpressionBoundary(source: string, startOffset: number): number {
  if (source[startOffset] !== "{") {
    throw new Error(`Expected '{' at offset ${startOffset}`);
  }

  let depth = 0;
  let i = startOffset;
  const len = source.length;

  while (i < len) {
    const char = source[i];

    // Single-line comment
    if (char === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") i++;
      continue;
    }

    // Multi-line comment
    if (char === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Single-quoted string
    if (char === "'") {
      i++;
      while (i < len && source[i] !== "'") {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }

    // Double-quoted string
    if (char === '"') {
      i++;
      while (i < len && source[i] !== '"') {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }

    // Template string
    if (char === "`") {
      i++;
      while (i < len && source[i] !== "`") {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          i = scanExpressionBoundary(source, i + 1);
          continue;
        }
        i++;
      }
      i++;
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return i; // Index of closing '}'
      }
    }

    i++;
  }

  throw new Error(`Unterminated expression starting at offset ${startOffset}`);
}

/**
 * Parses raw attribute string into strongly-typed AttributeNodes.
 */
export function parseAttributes(rawAttrs: string, baseOffset: number, file: string): AttributeNode[] {
  const attributes: AttributeNode[] = [];
  let i = 0;
  const len = rawAttrs.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(rawAttrs[i]!)) i++;
    if (i >= len) break;

    const attrStart = i;

    // Directives (e.g. mix-html={expr})
    if (rawAttrs.startsWith("mix-", i)) {
      const match = /^([a-zA-Z0-9-]+)\s*=\s*\{/i.exec(rawAttrs.slice(i));
      if (match) {
        const dirName = match[1]!;
        const braceIndex = i + match[0].length - 1;
        const closeBrace = scanExpressionBoundary(rawAttrs, braceIndex);
        const exprCode = rawAttrs.slice(braceIndex + 1, closeBrace).trim();
        const span = createSourceSpan(baseOffset + attrStart, baseOffset + closeBrace + 1, file);
        const exprSpan = createSourceSpan(baseOffset + braceIndex + 1, baseOffset + closeBrace, file);
        attributes.push(createDirectiveNode(dirName, createExpressionNode(exprCode, exprSpan), span));
        i = closeBrace + 1;
        continue;
      }
    }

    // Event binding: @event={handler} or on:event={handler}
    if (rawAttrs[i] === "@" || rawAttrs.startsWith("on:", i)) {
      const prefixLen = rawAttrs[i] === "@" ? 1 : 3;
      const match = /^[a-zA-Z0-9-:_]+\s*=\s*\{/i.exec(rawAttrs.slice(i + prefixLen));
      if (match) {
        const fullMatch = match[0];
        const eventName = fullMatch.slice(0, fullMatch.indexOf("=")).trim();
        const braceIndex = i + prefixLen + fullMatch.indexOf("{");
        const closeBrace = scanExpressionBoundary(rawAttrs, braceIndex);
        const handlerCode = rawAttrs.slice(braceIndex + 1, closeBrace).trim();
        const span = createSourceSpan(baseOffset + attrStart, baseOffset + closeBrace + 1, file);
        const exprSpan = createSourceSpan(baseOffset + braceIndex + 1, baseOffset + closeBrace, file);
        attributes.push(createEventBindingNode(eventName, createExpressionNode(handlerCode, exprSpan), span));
        i = closeBrace + 1;
        continue;
      }
    }

    // Ref binding: ref={target}
    if (rawAttrs.startsWith("ref=", i) || rawAttrs.startsWith("ref =", i)) {
      const match = /^ref\s*=\s*\{/i.exec(rawAttrs.slice(i));
      if (match) {
        const braceIndex = i + match[0].length - 1;
        const closeBrace = scanExpressionBoundary(rawAttrs, braceIndex);
        const refCode = rawAttrs.slice(braceIndex + 1, closeBrace).trim();
        const span = createSourceSpan(baseOffset + attrStart, baseOffset + closeBrace + 1, file);
        const exprSpan = createSourceSpan(baseOffset + braceIndex + 1, baseOffset + closeBrace, file);
        attributes.push(createRefBindingNode(createExpressionNode(refCode, exprSpan), span));
        i = closeBrace + 1;
        continue;
      }
    }

    // Regular attribute: name="value", name='value', name={expr}, or boolean name
    const nameMatch = /^[a-zA-Z0-9-_]+/i.exec(rawAttrs.slice(i));
    if (!nameMatch) {
      i++;
      continue;
    }

    const attrName = nameMatch[0];
    i += attrName.length;

    // Check for '='
    while (i < len && /\s/.test(rawAttrs[i]!)) i++;

    if (i < len && rawAttrs[i] === "=") {
      i++; // skip '='
      while (i < len && /\s/.test(rawAttrs[i]!)) i++;

      if (i < len && rawAttrs[i] === "{") {
        // Dynamic attribute: attr={expr}
        const braceIndex = i;
        const closeBrace = scanExpressionBoundary(rawAttrs, braceIndex);
        const exprCode = rawAttrs.slice(braceIndex + 1, closeBrace).trim();
        const span = createSourceSpan(baseOffset + attrStart, baseOffset + closeBrace + 1, file);
        const exprSpan = createSourceSpan(baseOffset + braceIndex + 1, baseOffset + closeBrace, file);
        attributes.push(createDynamicAttributeNode(attrName, createExpressionNode(exprCode, exprSpan), span));
        i = closeBrace + 1;
      } else if (i < len && (rawAttrs[i] === '"' || rawAttrs[i] === "'")) {
        // Quoted static attribute: attr="value"
        const quote = rawAttrs[i]!;
        i++;
        const valStart = i;
        while (i < len && rawAttrs[i] !== quote) {
          if (rawAttrs[i] === "\\") i++;
          i++;
        }
        const val = rawAttrs.slice(valStart, i);
        if (i < len && rawAttrs[i] === quote) i++;
        const span = createSourceSpan(baseOffset + attrStart, baseOffset + i, file);
        attributes.push(createStaticAttributeNode(attrName, val, span));
      } else {
        // Unquoted static attribute
        const valStart = i;
        while (i < len && !/\s/.test(rawAttrs[i]!)) i++;
        const val = rawAttrs.slice(valStart, i);
        const span = createSourceSpan(baseOffset + attrStart, baseOffset + i, file);
        attributes.push(createStaticAttributeNode(attrName, val, span));
      }
    } else {
      // Boolean attribute (val = "true")
      const span = createSourceSpan(baseOffset + attrStart, baseOffset + i, file);
      attributes.push(createStaticAttributeNode(attrName, "true", span));
    }
  }

  return attributes;
}

export interface ParseOptions {
  filename?: string;
  mode?: "mix" | "tix";
}

/**
 * Full Phase 2 Parser for Mix & Tix.
 */
export function parse(source: string, options: ParseOptions | string = "Component.mix"): ComponentNode {
  const filename = typeof options === "string" ? options : options.filename ?? "Component.mix";
  const mode = typeof options === "string"
    ? (options.endsWith(".tix") ? "tix" : "mix")
    : options.mode ?? (filename.endsWith(".tix") ? "tix" : "mix");

  let scriptNode: ScriptBlockNode | null = null;
  let styleNode: StyleBlockNode | null = null;
  let cleanSource = source;

  // 1. Extract <script> block
  const scriptMatch = /<script(?:\s+lang=["'](ts|js)["'])?(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i.exec(cleanSource);
  if (scriptMatch) {
    const lang = (scriptMatch[1] as "ts" | "js") || undefined;
    const content = scriptMatch[2]!.trim();
    const span = createSourceSpan(scriptMatch.index, scriptMatch.index + scriptMatch[0].length, filename);
    scriptNode = createScriptBlockNode(content, span, lang);
    cleanSource = cleanSource.slice(0, scriptMatch.index) + " ".repeat(scriptMatch[0].length) + cleanSource.slice(scriptMatch.index + scriptMatch[0].length);
  }

  // 2. Extract <style> block
  const styleMatch = /<style(?:\s+(scoped))?(?:\s+[^>]*)?>([\s\S]*?)<\/style>/i.exec(cleanSource);
  if (styleMatch) {
    const scoped = Boolean(styleMatch[1]) || true;
    const content = styleMatch[2]!.trim();
    const span = createSourceSpan(styleMatch.index, styleMatch.index + styleMatch[0].length, filename);
    styleNode = createStyleBlockNode(content, span, scoped);
    cleanSource = cleanSource.slice(0, styleMatch.index) + " ".repeat(styleMatch[0].length) + cleanSource.slice(styleMatch.index + styleMatch[0].length);
  }

  // 3. Parse template nodes recursively
  const templateNodes = parseTemplate(cleanSource, 0, cleanSource.length, filename);

  return createComponentNode(
    scriptNode,
    templateNodes,
    createSourceSpan(0, source.length, filename),
    styleNode,
    mode
  );
}

function parseTemplate(source: string, start: number, end: number, file: string): TemplateChildNode[] {
  const nodes: TemplateChildNode[] = [];
  let i = start;

  while (i < end) {
    // 1. Comments: <!-- ... -->
    if (source.startsWith("<!--", i)) {
      const closeIdx = source.indexOf("-->", i + 4);
      const commentEnd = closeIdx === -1 ? end : closeIdx + 3;
      const commentVal = source.slice(i + 4, closeIdx === -1 ? end : closeIdx).trim();
      nodes.push(createCommentNode(commentVal, createSourceSpan(i, commentEnd, file)));
      i = commentEnd;
      continue;
    }

    // 2. Dynamic Element: <{~expr ...}> ... </{~expr}> or <{~expr} /> (D-105)
    if (source.startsWith("<{~", i)) {
      const openTagStart = i;
      const exprStart = i + 3;

      // Check self-closing: }/> or } />
      const selfCloseMatch = /^([\s\S]*?)\}\s*\/>/.exec(source.slice(exprStart));
      if (selfCloseMatch) {
        const rawTagExpr = selfCloseMatch[1]!.trim();
        const tagEndOffset = openTagStart + 3 + selfCloseMatch[0].length;
        const tagExprSpan = createSourceSpan(exprStart, exprStart + rawTagExpr.length, file);
        const tagExpressionNode = createExpressionNode(rawTagExpr, tagExprSpan);

        nodes.push(
          createDynamicElementNode(
            tagExpressionNode,
            [],
            [],
            createSourceSpan(openTagStart, tagEndOffset, file)
          )
        );

        i = tagEndOffset;
        continue;
      }

      // Find standard closing '}>'
      const closeTagBracket = source.indexOf("}>", exprStart);
      if (closeTagBracket === -1) {
        throw new Error(`Unclosed dynamic element opening tag at offset ${openTagStart}`);
      }
      const rawTagExpr = source.slice(exprStart, closeTagBracket).trim();
      const openTagEnd = closeTagBracket + 2;

      // Scan dynamic element children up to matching </{~
      const closePattern = "</{~";
      const closeTagIdx = source.indexOf(closePattern, openTagEnd);
      if (closeTagIdx === -1) {
        throw new Error(`Unclosed dynamic element <{~${rawTagExpr}}> at offset ${openTagStart}`);
      }
      const closeEndBracket = source.indexOf("}>", closeTagIdx + closePattern.length);
      if (closeEndBracket === -1) {
        throw new Error(`Malformed dynamic element closing tag at offset ${closeTagIdx}`);
      }
      const totalEnd = closeEndBracket + 2;

      const tagExprSpan = createSourceSpan(exprStart, closeTagBracket, file);
      const tagExpressionNode = createExpressionNode(rawTagExpr, tagExprSpan);
      const children = parseTemplate(source, openTagEnd, closeTagIdx, file);

      nodes.push(
        createDynamicElementNode(
          tagExpressionNode,
          [],
          children,
          createSourceSpan(openTagStart, totalEnd, file)
        )
      );

      i = totalEnd;
      continue;
    }

    // 3. Control Flow: {#if condition}
    if (source.startsWith("{#if ", i) || source.startsWith("{#if\n", i)) {
      const ifStart = i;
      const condStart = i + 5;
      const closeBrace = source.indexOf("}", condStart);
      if (closeBrace === -1) throw new Error(`Unclosed {#if} condition at offset ${ifStart}`);
      const condExpr = source.slice(condStart, closeBrace).trim();
      const conditionNode = createExpressionNode(condExpr, createSourceSpan(condStart, closeBrace, file));

      // Scan for {/if}, handling {:else if} and {:else}
      const endIfTag = "{/if}";
      const endIfIdx = source.indexOf(endIfTag, closeBrace + 1);
      if (endIfIdx === -1) throw new Error(`Unclosed {#if} block starting at offset ${ifStart}`);

      const fullBlockContent = source.slice(closeBrace + 1, endIfIdx);
      const elseMatch = fullBlockContent.indexOf("{:else}");
      let consequent: TemplateChildNode[];
      let alternate: TemplateChildNode[] | null = null;

      if (elseMatch !== -1) {
        consequent = parseTemplate(source, closeBrace + 1, closeBrace + 1 + elseMatch, file);
        alternate = parseTemplate(source, closeBrace + 1 + elseMatch + 7, endIfIdx, file);
      } else {
        consequent = parseTemplate(source, closeBrace + 1, endIfIdx, file);
      }

      nodes.push(
        createIfBlockNode(
          conditionNode,
          consequent,
          [],
          alternate,
          createSourceSpan(ifStart, endIfIdx + endIfTag.length, file)
        )
      );

      i = endIfIdx + endIfTag.length;
      continue;
    }

    // 4. Control Flow: {#each items as item (key)}
    if (source.startsWith("{#each ", i) || source.startsWith("{#each\n", i)) {
      const eachStart = i;
      const headerStart = i + 7;
      const headerEnd = source.indexOf("}", headerStart);
      if (headerEnd === -1) throw new Error(`Unclosed {#each} header at offset ${eachStart}`);
      const header = source.slice(headerStart, headerEnd).trim();

      // Syntax: items as item, index (key)
      const eachRegex = /^([\s\S]+?)\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s*,\s*([a-zA-Z_$][a-zA-Z0-9_$]*))?(?:\s*\(([\s\S]+)\))?$/;
      const match = eachRegex.exec(header);
      if (!match) throw new Error(`Invalid {#each} syntax: "${header}" at offset ${eachStart}`);

      const itemsExprCode = match[1]!.trim();
      const itemBinding = match[2]!;
      const indexBinding = match[3];
      const keyExprCode = match[4]?.trim();

      const endEachTag = "{/each}";
      const endEachIdx = source.indexOf(endEachTag, headerEnd + 1);
      if (endEachIdx === -1) throw new Error(`Unclosed {#each} block at offset ${eachStart}`);

      const body = parseTemplate(source, headerEnd + 1, endEachIdx, file);
      const itemsNode = createExpressionNode(itemsExprCode, createSourceSpan(headerStart, headerStart + itemsExprCode.length, file));
      const keyNode = keyExprCode ? createExpressionNode(keyExprCode, createSourceSpan(headerStart, headerEnd, file)) : undefined;

      nodes.push(
        createEachBlockNode(
          itemsNode,
          itemBinding,
          body,
          createSourceSpan(eachStart, endEachIdx + endEachTag.length, file),
          indexBinding,
          keyNode
        )
      );

      i = endEachIdx + endEachTag.length;
      continue;
    }

    // 5. Regular Element: <tag ...>
    if (source[i] === "<" && /[a-zA-Z]/.test(source[i + 1] || "")) {
      const elemStart = i;
      const openTagClose = source.indexOf(">", i);
      if (openTagClose === -1) throw new Error(`Unclosed tag at offset ${elemStart}`);

      const rawOpenTag = source.slice(i + 1, openTagClose);
      const isSelfClosing = rawOpenTag.endsWith("/");
      const cleanOpenTag = isSelfClosing ? rawOpenTag.slice(0, -1).trim() : rawOpenTag.trim();

      const spaceIdx = cleanOpenTag.search(/\s/);
      const tagName = spaceIdx === -1 ? cleanOpenTag : cleanOpenTag.slice(0, spaceIdx);
      const rawAttrs = spaceIdx === -1 ? "" : cleanOpenTag.slice(spaceIdx);

      const attributes = parseAttributes(rawAttrs, i + 1 + (spaceIdx === -1 ? tagName.length : spaceIdx), file);
      const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());

      if (isSelfClosing || isVoid) {
        nodes.push(
          createElementNode(
            tagName,
            attributes,
            [],
            createSourceSpan(elemStart, openTagClose + 1, file),
            true
          )
        );
        i = openTagClose + 1;
        continue;
      }

      // Normal element with children: find matching </tag>
      const closeTagPattern = new RegExp(`</${tagName}\\s*>`, "i");
      const sub = source.slice(openTagClose + 1, end);
      const match = closeTagPattern.exec(sub);
      if (!match) {
        throw new Error(`Unclosed element <${tagName}> at offset ${elemStart}`);
      }

      const innerStart = openTagClose + 1;
      const innerEnd = openTagClose + 1 + match.index;
      const elemEnd = innerEnd + match[0].length;
      const children = parseTemplate(source, innerStart, innerEnd, file);

      nodes.push(
        createElementNode(
          tagName,
          attributes,
          children,
          createSourceSpan(elemStart, elemEnd, file),
          false
        )
      );

      i = elemEnd;
      continue;
    }

    // 6. Text Interpolation: {expr}
    if (source[i] === "{" && source[i + 1] !== "#" && source[i + 1] !== "/" && source[i + 1] !== ":") {
      const interpStart = i;
      const closeBrace = scanExpressionBoundary(source, interpStart);
      const exprCode = source.slice(interpStart + 1, closeBrace).trim();
      const exprSpan = createSourceSpan(interpStart + 1, closeBrace, file);
      const interpSpan = createSourceSpan(interpStart, closeBrace + 1, file);

      nodes.push(createInterpolationNode(createExpressionNode(exprCode, exprSpan), interpSpan));
      i = closeBrace + 1;
      continue;
    }

    // 7. Plain Text
    const textStart = i;
    while (i < end && source[i] !== "<" && source[i] !== "{") {
      i++;
    }

    const textVal = source.slice(textStart, i);
    if (textVal.length > 0 && textVal.trim().length > 0) {
      nodes.push(createTextNode(textVal, createSourceSpan(textStart, i, file)));
    }
  }

  return nodes;
}
