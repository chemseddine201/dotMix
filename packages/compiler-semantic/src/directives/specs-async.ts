/**
 * @dotmix/compiler-semantic/directives/specs-async — Registry entry for async directives.
 */

import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { DirectiveSpec } from "./types.js";
import { defineDirectiveSpec, prop } from "./spec-helpers.js";

export const ASYNC_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "await",
    family: "async",
    props: [
      prop("promise", "Maybe<Promise<T>>", true, "expression"),
      prop("pending", "Children", false, "children"),
      prop("catch", "(error: unknown) => Children", false, "callback"),
      prop("children", "(value: T) => Children", true, "children")
    ],
    exposes: {
      blockSyntax: "inline",
      params: [{ name: "value", typeText: "T" }]
    },
    diagnostics: [DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH],
    irKind: "AwaitBlock",
    summary: "Reactive async promise gate ignoring stale resolutions."
  })
];
