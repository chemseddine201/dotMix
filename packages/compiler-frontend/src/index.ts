/**
 * @mix/compiler-frontend — Minimal parser & lexer for Phase 1 vertical slice.
 */

import {
  type ComponentNode,
  type ScriptBlockNode,
  type TemplateChildNode,
  createComponentNode,
  createScriptBlockNode,
  createElementNode,
  createTextNode,
  createInterpolationNode,
  createExpressionNode,
  createSourceSpan
} from "@mix/ast";

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
        if (source[i] === "\\" ) {
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          // Template interpolation - recursively scan nested expression
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
 * Minimal Phase 1 parser: Parses component source into a ComponentNode AST.
 */
export function parse(source: string, filename = "Component.mix"): ComponentNode {
  let scriptNode: ScriptBlockNode | null = null;
  const templateNodes: TemplateChildNode[] = [];

  // 1. Extract <script> block if present
  const scriptStartMatch = /<script(?:\s+[^>]*)?>/i.exec(source);
  let templateSource = source;
  let templateOffset = 0;

  if (scriptStartMatch) {
    const scriptTagStart = scriptStartMatch.index;
    const scriptContentStart = scriptTagStart + scriptStartMatch[0].length;
    const scriptEndMatch = /<\/script>/i.exec(source.slice(scriptContentStart));

    if (!scriptEndMatch) {
      throw new Error("Unclosed <script> tag");
    }

    const scriptContentEnd = scriptContentStart + scriptEndMatch.index;
    const scriptTagEnd = scriptContentEnd + scriptEndMatch[0].length;
    const scriptContent = source.slice(scriptContentStart, scriptContentEnd).trim();

    scriptNode = createScriptBlockNode(
      scriptContent,
      createSourceSpan(scriptTagStart, scriptTagEnd, filename)
    );

    // Template is the remainder
    templateSource = source.slice(scriptTagEnd).trim();
    templateOffset = scriptTagEnd + (source.slice(scriptTagEnd).indexOf(templateSource));
  }

  // 2. Parse template elements
  let cursor = 0;
  const tLen = templateSource.length;

  while (cursor < tLen) {
    // Check for element open: <tag ...>
    if (templateSource[cursor] === "<") {
      const tagMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)\s*>/i.exec(templateSource.slice(cursor));
      if (tagMatch && tagMatch[1]) {
        const tagName = tagMatch[1];
        const elemStart = templateOffset + cursor;
        const openTagEnd = cursor + tagMatch[0].length;
        const closeTagPattern = new RegExp(`</${tagName}>`, "i");
        const closeMatch = closeTagPattern.exec(templateSource.slice(openTagEnd));

        if (!closeMatch) {
          throw new Error(`Unclosed element <${tagName}> at offset ${elemStart}`);
        }

        const innerStart = openTagEnd;
        const innerEnd = openTagEnd + closeMatch.index;
        const elemEnd = templateOffset + innerEnd + closeMatch[0].length;
        const innerContent = templateSource.slice(innerStart, innerEnd);

        // Parse inner content (text + interpolations)
        const elementChildren: TemplateChildNode[] = [];
        let innerCursor = 0;

        while (innerCursor < innerContent.length) {
          const braceIndex = innerContent.indexOf("{", innerCursor);
          if (braceIndex === -1) {
            // Remainder is pure text
            const textVal = innerContent.slice(innerCursor);
            if (textVal.length > 0) {
              elementChildren.push(
                createTextNode(
                  textVal,
                  createSourceSpan(
                    templateOffset + innerStart + innerCursor,
                    templateOffset + innerStart + innerContent.length,
                    filename
                  )
                )
              );
            }
            break;
          }

          // Preceding text before '{'
          if (braceIndex > innerCursor) {
            const textVal = innerContent.slice(innerCursor, braceIndex);
            elementChildren.push(
              createTextNode(
                textVal,
                createSourceSpan(
                  templateOffset + innerStart + innerCursor,
                  templateOffset + innerStart + braceIndex,
                  filename
                )
              )
            );
          }

          // Scan interpolation
          const absBraceIndex = templateOffset + innerStart + braceIndex;
          const closeBraceOffset = scanExpressionBoundary(templateSource, innerStart + braceIndex);
          const exprCode = templateSource.slice(innerStart + braceIndex + 1, closeBraceOffset).trim();

          const exprSpan = createSourceSpan(
            absBraceIndex + 1,
            templateOffset + closeBraceOffset,
            filename
          );
          const interpSpan = createSourceSpan(
            absBraceIndex,
            templateOffset + closeBraceOffset + 1,
            filename
          );

          elementChildren.push(
            createInterpolationNode(
              createExpressionNode(exprCode, exprSpan),
              interpSpan
            )
          );

          innerCursor = closeBraceOffset - innerStart + 1;
        }

        templateNodes.push(
          createElementNode(tagName, elementChildren, createSourceSpan(elemStart, elemEnd, filename))
        );

        cursor = innerEnd + closeMatch[0].length;
        continue;
      }
    }

    cursor++;
  }

  return createComponentNode(
    scriptNode,
    templateNodes,
    createSourceSpan(0, source.length, filename)
  );
}
