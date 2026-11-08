/**
 * @mix/compiler-semantic — Scope resolution, symbol tables, and virtual .tix type projection.
 *
 * Scope Enclosure Notice (Gate 1): Minimal compilable skeleton only.
 * Full semantic analysis and .tix type projection are deferred to Phase Gate 3.
 */

import type { ComponentNode } from "@mix/ast";
import { MixError, DiagnosticCodes } from "@mix/diagnostics";

export interface ComponentDescriptor {
  readonly ast: ComponentNode;
  readonly signals: readonly string[];
  readonly props: readonly string[];
}

export function analyze(_ast: ComponentNode): ComponentDescriptor {
  // Gate 1 stub: full implementation is authorized in Gate 3
  throw new MixError(
    DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER,
    "@mix/compiler-semantic analyze is not yet implemented (Gate 3 deliverable)."
  );
}
