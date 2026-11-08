/**
 * @mix/compiler-css — Scoped CSS compilation, selector scoping transform, and at-rule validation.
 */

export interface CompileCssOptions {
  scopeId?: string | undefined;
}

export interface CompileCssResult {
  readonly code: string;
  readonly scopeId: string;
  readonly errors: readonly string[];
}

/**
 * Deterministically generates a unique hash id from component content/filename.
 */
export function generateScopeId(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return `data-mix-${(hash >>> 0).toString(16).slice(0, 8)}`;
}

/**
 * Validates and compiles component-scoped CSS rules (D-108).
 * Scopes selectors and rejects forbidden at-rules (@import, @charset).
 */
export function compileCss(cssContent: string, options: CompileCssOptions = {}): CompileCssResult {
  const errors: string[] = [];
  const scopeId = options.scopeId ?? generateScopeId(cssContent);

  // 1. Validate forbidden at-rules and stylesheet syntax (D-108)
  if (/@import\b/i.test(cssContent)) {
    errors.push("MIX_ERR_CSS_FORBIDDEN_IMPORT: @import rules are forbidden in component styles");
  }

  if (/@charset\b/i.test(cssContent)) {
    errors.push("MIX_ERR_CSS_FORBIDDEN_CHARSET: @charset rules are forbidden in component styles");
  }

  let braceDepth = 0;
  for (let i = 0; i < cssContent.length; i++) {
    if (cssContent[i] === "{") {
      braceDepth++;
    } else if (cssContent[i] === "}") {
      braceDepth--;
      if (braceDepth < 0) {
        errors.push("MIX_ERR_CSS_SYNTAX: Unbalanced braces in component stylesheet");
        break;
      }
    }
  }
  if (braceDepth !== 0 && !errors.some((e) => e.includes("MIX_ERR_CSS_SYNTAX"))) {
    errors.push("MIX_ERR_CSS_SYNTAX: Unbalanced braces in component stylesheet");
  }

  // Check for dangerous functions or unsafe protocol injections in static declarations
  if (/url\(\s*['"]?\s*(?:javascript|vbscript):/i.test(cssContent) ||
      /expression\s*\(/i.test(cssContent) ||
      /-moz-binding\s*:/i.test(cssContent)) {
    errors.push("MIX_ERR_CSS_UNSAFE_DECLARATION: Unsafe declaration detected in component stylesheet");
  }

  if (errors.length > 0) {
    return Object.freeze({
      code: "",
      scopeId,
      errors: Object.freeze(errors)
    });
  }

  // 2. Scoped selector transformation
  // Matches rules: selector { declarations }
  const ruleRegex = /([^{}]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  const transformedRules: string[] = [];

  while ((match = ruleRegex.exec(cssContent)) !== null) {
    const rawSelectors = match[1]!.trim();
    const declarations = match[2]!.trim();

    // At-rules like @media or @keyframes pass through or scope inner rules
    if (rawSelectors.startsWith("@")) {
      transformedRules.push(`${rawSelectors} { ${declarations} }`);
      continue;
    }

    // Comma-separated selectors
    const scopedSelectors = rawSelectors
      .split(",")
      .map((sel) => {
        const s = sel.trim();
        if (s.startsWith(":global(") && s.endsWith(")")) {
          // Escape scoping
          return s.slice(8, -1).trim();
        }
        if (s === ":host") {
          return `[${scopeId}]`;
        }
        return `${s}[${scopeId}]`;
      })
      .join(", ");

    transformedRules.push(`${scopedSelectors} { ${declarations} }`);
  }

  const finalCode = transformedRules.join("\n");

  return Object.freeze({
    code: finalCode,
    scopeId,
    errors: Object.freeze([])
  });
}
