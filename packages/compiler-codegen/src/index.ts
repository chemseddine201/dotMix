/**
 * @mix/compiler-codegen — Ahead-of-Time direct DOM JavaScript code generator.
 *
 * Scope Enclosure Notice (Gate 1): Minimal compilable skeleton only.
 * Full codegen and end-to-end vertical slice are deferred to Phase Gate 5.
 */

import type { ComponentDescriptor } from "@mix/compiler-semantic";
import { MixError, DiagnosticCodes } from "@mix/diagnostics";

export interface CodegenOptions {
  filename?: string;
  sourceMap?: boolean;
}

export interface CodegenResult {
  readonly js: string;
  readonly css?: string;
  readonly map?: unknown;
}

export function generate(_descriptor: ComponentDescriptor, _options?: CodegenOptions): CodegenResult {
  // Gate 1 stub: full implementation is authorized in Gate 5
  throw new MixError(
    DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
    "@mix/compiler-codegen generate is not yet implemented (Gate 5 deliverable)."
  );
}
