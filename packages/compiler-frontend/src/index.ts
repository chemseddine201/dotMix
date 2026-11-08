/**
 * @mix/compiler-frontend — Lexer, balanced delimiter state machine, and template parser.
 *
 * Scope Enclosure Notice (Gate 1): Minimal compilable skeleton only.
 * Full parser implementation is deferred to Phase Gate 2.
 */

import type { ComponentNode } from "@mix/ast";
import { MixError, DiagnosticCodes } from "@mix/diagnostics";

export interface ParseOptions {
  filename?: string;
}

export function parse(_source: string, _options?: ParseOptions): ComponentNode {
  // Gate 1 stub: full implementation is authorized in Gate 2
  throw new MixError(
    DiagnosticCodes.MIX_ERR_PARSE_SYNTAX,
    "@mix/compiler-frontend parser is not yet implemented (Gate 2 deliverable)."
  );
}
