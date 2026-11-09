/**
 * @mix/compiler-css — AST-based CSS parser, selector scoper (`[data-mix-<hash>]`),
 * `:global(...)` and `:deep(...)` transformer, and static security validator (D-108, F-05).
 */

import * as csstree from "css-tree";
import type { CssPlainNode, CssLocation } from "css-tree";
import { createSpan } from "@mix/ast";
import type { SourceSpan } from "@mix/ast";
import { MixDiagnosticError, DiagnosticCodes } from "@mix/diagnostics";

export * from "./preprocess.js";

export interface CssCompileOptions {
  scopeId?: string;
  scopeHash?: string;
  scoped?: boolean;
  filename?: string;
  baseOffset?: number;
  baseLine?: number;
}

export interface CssCompileResult {
  readonly code: string;
  readonly css: string;
  readonly scopeId: string;
  readonly scopeAttribute: string;
}

/**
 * Deterministic FNV-1a 32-bit hash formatted as 6 hex chars (e.g. `c8f2a1`).
 */
export function computeScopeHash(seed: string, extra?: string): string {
  const combined = extra !== undefined ? `${seed}:${extra}` : seed;
  let hash = 0x811c9dc5;
  for (let i = 0; i < combined.length; i++) {
    hash ^= combined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(6, "0").slice(0, 6);
}

function toMixSpan(
  loc: CssLocation | null | undefined,
  options?: CssCompileOptions
): SourceSpan {
  const baseOffset = options?.baseOffset ?? 0;
  const baseLine = (options?.baseLine ?? 1) - 1;
  const startLine = (loc?.start.line ?? 1) + baseLine;
  const startCol = loc?.start.column ?? 1;
  const startOff = (loc?.start.offset ?? 0) + baseOffset;
  const endLine = (loc?.end.line ?? startLine - baseLine) + baseLine;
  const endCol = loc?.end.column ?? startCol + 1;
  const endOff = Math.max(startOff, (loc?.end.offset ?? startOff - baseOffset + 1) + baseOffset);

  return createSpan(
    { line: startLine, column: startCol, offset: startOff },
    { line: Math.max(startLine, endLine), column: endCol, offset: endOff },
    options?.filename
  );
}

function isSafeStaticCssUrl(rawUrl: string): boolean {
  // Strip control characters and whitespace before checking protocol (R-URL-01, R-CSS-05)
  const unquoted = rawUrl.replace(/^['"]|['"]$/g, "");
  let cleaned = "";
  for (let i = 0; i < unquoted.length; i++) {
    const code = unquoted.charCodeAt(i);
    if (code > 0x20 && code !== 0x7f) {
      cleaned += unquoted[i]!;
    }
  }
  cleaned = cleaned.toLowerCase();

  if (
    cleaned.startsWith("javascript:") ||
    cleaned.startsWith("vbscript:") ||
    cleaned.startsWith("data:text/html") ||
    cleaned.startsWith("data:image/svg+xml")
  ) {
    return false;
  }

  if (cleaned.startsWith("data:")) {
    return /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);/i.test(cleaned);
  }

  return true;
}

function createScopeAttributeNode(scopeAttr: string): CssPlainNode {
  return {
    type: "AttributeSelector",
    loc: null,
    name: {
      type: "Identifier",
      loc: null,
      name: scopeAttr
    },
    matcher: null,
    value: null,
    flags: null
  };
}

function appendScopeToCompoundSegment(segment: CssPlainNode[], scopeAttr: string): CssPlainNode[] {
  if (segment.length === 0) {
    return [createScopeAttributeNode(scopeAttr)];
  }
  const attrNode = createScopeAttributeNode(scopeAttr);
  const pseudoIdx = segment.findIndex(
    n => n.type === "PseudoClassSelector" || n.type === "PseudoElementSelector"
  );
  if (pseudoIdx === -1) {
    return [...segment, attrNode];
  }
  return [
    ...segment.slice(0, pseudoIdx),
    attrNode,
    ...segment.slice(pseudoIdx)
  ];
}

function parseInnerSelectorNodes(rawSelectorText: string, options?: CssCompileOptions, loc?: CssLocation | null): CssPlainNode[] {
  const trimmed = rawSelectorText.trim();
  if (!trimmed) {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      message: "Empty selector inside ':global()' or ':deep()' is not allowed.",
      severity: "error",
      span: toMixSpan(loc, options)
    });
  }
  const parsed = csstree.toPlainObject(
    csstree.parse(trimmed, { context: "selector", positions: true })
  );
  return parsed.children ?? [];
}

function transformSelector(
  selectorNode: CssPlainNode,
  scopeAttr: string,
  options?: CssCompileOptions
): void {
  const children = selectorNode.children ?? [];

  // Split into compound selector segments separated by Combinator nodes
  const segments: CssPlainNode[][] = [];
  const combinators: CssPlainNode[] = [];
  let currentSegment: CssPlainNode[] = [];

  for (const child of children) {
    if (child.type === "PseudoClassSelector" && child.name === "host") {
      // spec/CSS_SCOPING.md §2.2: :host is not supported
      throw new MixDiagnosticError({
        code: DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
        message: "The ':host' pseudo-class is not supported in Mix/Tix scoped CSS (F-05).",
        severity: "error",
        span: toMixSpan(child.loc, options)
      });
    }
    if (child.type === "Combinator") {
      segments.push(currentSegment);
      currentSegment = [];
      combinators.push(child);
    } else {
      currentSegment.push(child);
    }
  }
  segments.push(currentSegment);

  const rebuiltChildren: CssPlainNode[] = [];
  let encounteredDeep = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (i > 0) {
      rebuiltChildren.push(combinators[i - 1]!);
    }

    const globalIdx = seg.findIndex(
      n => n.type === "PseudoClassSelector" && n.name === "global"
    );
    const deepIdx = seg.findIndex(
      n => n.type === "PseudoClassSelector" && n.name === "deep"
    );

    if (globalIdx !== -1) {
      // Unwrap :global(...) without adding scope attribute to the global contents
      for (const node of seg) {
        if (node.type === "PseudoClassSelector" && node.name === "global") {
          const rawChild = node.children?.[0];
          const rawVal =
            rawChild && typeof rawChild.value === "string"
              ? rawChild.value
              : "";
          const innerNodes = parseInnerSelectorNodes(rawVal, options, node.loc);
          rebuiltChildren.push(...innerNodes);
        } else {
          rebuiltChildren.push(node);
        }
      }
      continue;
    }

    if (deepIdx !== -1) {
      encounteredDeep = true;
      const beforeDeep = seg.slice(0, deepIdx);
      const deepNode = seg[deepIdx]!;
      const afterDeep = seg.slice(deepIdx + 1);

      const rawChild = deepNode.children?.[0];
      const rawVal =
        rawChild && typeof rawChild.value === "string"
          ? rawChild.value
          : "";
      const innerNodes = parseInnerSelectorNodes(rawVal, options, deepNode.loc);

      if (beforeDeep.length > 0) {
        rebuiltChildren.push(...appendScopeToCompoundSegment(beforeDeep, scopeAttr));
        rebuiltChildren.push({ type: "Combinator", loc: null, name: " " });
      } else if (i === 0) {
        // Leading `:deep(.child)` -> `[data-mix-hash] .child`
        rebuiltChildren.push(createScopeAttributeNode(scopeAttr));
        rebuiltChildren.push({ type: "Combinator", loc: null, name: " " });
      }

      rebuiltChildren.push(...innerNodes, ...afterDeep);
      continue;
    }

    if (encounteredDeep) {
      // Segments after :deep(...) target child components and are left unscoped
      rebuiltChildren.push(...seg);
    } else {
      rebuiltChildren.push(...appendScopeToCompoundSegment(seg, scopeAttr));
    }
  }

  selectorNode.children = rebuiltChildren;
}

function walkAndTransformCssAst(
  node: CssPlainNode,
  scopeAttr: string,
  scoped: boolean,
  inKeyframes: boolean,
  options?: CssCompileOptions
): void {
  if (node.type === "Raw") {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      message: `Malformed CSS syntax near '${String(node.value ?? "").slice(0, 30)}'.`,
      severity: "error",
      span: toMixSpan(node.loc, options)
    });
  }

  if (node.type === "Atrule" || node.type === "AtRule") {
    const atName = typeof node.name === "string" ? node.name.toLowerCase() : "";
    if (atName === "import") {
      throw new MixDiagnosticError({
        code: DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_IMPORT,
        message: "'@import' is forbidden in component <style> blocks (D-108).",
        severity: "error",
        span: toMixSpan(node.loc, options)
      });
    }
    if (atName === "charset") {
      throw new MixDiagnosticError({
        code: DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_CHARSET,
        message: "'@charset' is forbidden in component <style> blocks (D-108).",
        severity: "error",
        span: toMixSpan(node.loc, options)
      });
    }
    const isKeyframes = atName === "keyframes" || atName.endsWith("-keyframes");
    if (node.prelude && typeof node.prelude === "object") {
      walkAndTransformCssAst(node.prelude, scopeAttr, scoped, isKeyframes, options);
    }
    if (node.block && typeof node.block === "object") {
      walkAndTransformCssAst(node.block, scopeAttr, scoped, isKeyframes, options);
    }
    return;
  }

  if (node.type === "Url") {
    const rawVal =
      typeof node.value === "string"
        ? node.value
        : typeof (node.value as { value?: unknown } | null)?.value === "string"
          ? ((node.value as { value: string }).value)
          : "";
    if (!isSafeStaticCssUrl(rawVal)) {
      throw new MixDiagnosticError({
        code: DiagnosticCodes.MIX_SEC_UNSAFE_URL,
        message: `Unsafe URL protocol in static CSS url('${rawVal}') (R-CSS-05).`,
        severity: "error",
        span: toMixSpan(node.loc, options)
      });
    }
  }

  if (node.type === "Declaration" && node.value && typeof node.value === "object") {
    const valNode = node.value as CssPlainNode;
    if (typeof node.property === "string" && node.property.startsWith("--") && valNode.type === "Raw") {
      return;
    }
    walkAndTransformCssAst(valNode, scopeAttr, scoped, inKeyframes, options);
    return;
  }

  if (node.type === "Function" && (node.name === "var" || node.name === "env")) {
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child.type !== "Raw") {
          walkAndTransformCssAst(child, scopeAttr, scoped, inKeyframes, options);
        }
      }
    }
    return;
  }

  if (node.type === "Rule") {
    if (scoped && !inKeyframes && node.prelude && node.prelude.type === "SelectorList") {
      for (const selector of node.prelude.children ?? []) {
        if (selector.type === "Selector") {
          transformSelector(selector, scopeAttr, options);
        }
      }
    }
    if (node.block && typeof node.block === "object") {
      walkAndTransformCssAst(node.block, scopeAttr, scoped, inKeyframes, options);
    }
    return;
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkAndTransformCssAst(child, scopeAttr, scoped, inKeyframes, options);
    }
  }
}

export function compileCss(cssSource: string, options?: CssCompileOptions): CssCompileResult {
  const charsetMatch = /@charset\b/i.exec(cssSource);
  if (charsetMatch) {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_CHARSET,
      message: "'@charset' is forbidden in component <style> blocks (D-108).",
      severity: "error",
      span: toMixSpan(
        {
          start: { line: 1, column: charsetMatch.index + 1, offset: charsetMatch.index },
          end: {
            line: 1,
            column: charsetMatch.index + charsetMatch[0].length + 1,
            offset: charsetMatch.index + charsetMatch[0].length
          }
        },
        options
      )
    });
  }

  // Check for unbalanced braces before or during parsing
  let parseErr: (Error & { line?: number; column?: number; offset?: number }) | null = null;
  const rawAst = csstree.parse(cssSource, {
    positions: true,
    filename: options?.filename ?? "style.css",
    onParseError(err) {
      if (!parseErr) {
        parseErr = err;
      }
    }
  });

  if (parseErr !== null) {
    const errObj = parseErr as Error & { line?: number; column?: number; offset?: number };
    const line = errObj.line ?? 1;
    const col = errObj.column ?? 1;
    const off = errObj.offset ?? 0;
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
      message: `CSS syntax error: ${errObj.message}`,
      severity: "error",
      span: toMixSpan(
        {
          start: { line, column: col, offset: off },
          end: { line, column: col + 1, offset: off + 1 }
        },
        options
      )
    });
  }

  const providedScope = options?.scopeId ?? options?.scopeHash;
  const hash = providedScope
    ? providedScope.replace(/^data-mix-/, "").replace(/^mx-/, "")
    : computeScopeHash(`${options?.filename ?? "component"}:${cssSource}`);
  const scopeId = `mx-${hash}`;
  const scopeAttribute = `data-mix-${hash}`;
  const scoped = options?.scoped ?? true;

  const plainAst = csstree.toPlainObject(rawAst);
  walkAndTransformCssAst(plainAst, scopeAttribute, scoped, false, options);

  const rebuiltAst = csstree.fromPlainObject(plainAst);
  const code = csstree.generate(rebuiltAst);

  return Object.freeze({
    code,
    css: code,
    scopeId,
    scopeAttribute
  });
}
