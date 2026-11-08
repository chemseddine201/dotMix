/**
 * @mix/compiler-css — CSS AST parser, selector scoping, :global/:deep, and at-rule validation.
 *
 * Scope Enclosure Notice (Gate 1): Minimal compilable skeleton only.
 * Full CSS compilation and scoping are deferred to Phase Gate 6.
 */

import { MixError, DiagnosticCodes } from "@mix/diagnostics";

export interface CssCompileOptions {
  scopeId?: string;
}

export interface CssCompileResult {
  code: string;
  scopeId: string;
}

export function compileCss(_cssSource: string, _options?: CssCompileOptions): CssCompileResult {
  // Gate 1 stub: full implementation is authorized in Gate 6
  throw new MixError(
    DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_IMPORT,
    "@mix/compiler-css compileCss is not yet implemented (Gate 6 deliverable)."
  );
}
