/**
 * @mix/language-server/css-extractor — CSS class selector extraction and component stylesheet collector.
 */

import type { ComponentNode } from "@mix/ast";
import type { ComponentDescriptor } from "@mix/compiler-semantic";
import { resolveRelativeUri } from "./indexer.js";

export function extractCssClasses(cssText: string): string[] {
  const classes = new Set<string>();
  const regex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cssText)) !== null) {
    if (match[1]) {
      classes.add(match[1]);
    }
  }
  return Array.from(classes);
}

export function collectComponentCssSources(
  uri: string,
  ast: ComponentNode,
  desc: ComponentDescriptor,
  getFileContent: (targetUri: string) => string | null
): string[] {
  const cssSources: string[] = [];
  if (ast.style && ast.style.content) {
    cssSources.push(ast.style.content);
  }
  if (ast.style && ast.style.src) {
    const cssUri = resolveRelativeUri(uri, ast.style.src);
    const content = getFileContent(cssUri);
    if (content) cssSources.push(content);
  }
  if (desc.cssImports) {
    for (const cssImp of desc.cssImports) {
      const cssUri = resolveRelativeUri(uri, cssImp);
      const content = getFileContent(cssUri);
      if (content) cssSources.push(content);
    }
  }
  return cssSources;
}
