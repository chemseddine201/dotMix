/**
 * @mix/compiler-css — CSS analysis and validation for Phase 1.
 */

export interface CssValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates component static CSS rules (D-108).
 * Rejects forbidden at-rules (@import, @charset).
 */
export function validateStaticCss(cssContent: string): CssValidationResult {
  const errors: string[] = [];

  if (/@import\b/i.test(cssContent)) {
    errors.push("MIX_ERR_CSS_FORBIDDEN_IMPORT: @import rules are forbidden in component styles");
  }

  if (/@charset\b/i.test(cssContent)) {
    errors.push("MIX_ERR_CSS_FORBIDDEN_CHARSET: @charset rules are forbidden in component styles");
  }

  return Object.freeze({
    isValid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}
