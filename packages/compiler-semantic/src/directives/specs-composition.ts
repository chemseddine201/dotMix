/**
 * @dotmix/compiler-semantic/directives/specs-composition — Registry entries for composition directives.
 */

import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { DirectiveSpec } from "./types.js";
import {
  CHILDREN_OPT,
  defineDirectiveSpec,
  elseBranch,
  prop
} from "./spec-helpers.js";

export const COMPOSITION_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "include",
    family: "composition",
    props: [
      prop("component", "Component<P> | Loader<P>", true, "expression"),
      prop("props", "P", false, "expression"),
      prop("condition", "Maybe<unknown>", false, "boolean-gate"),
      prop("unless", "Maybe<unknown>", false, "boolean-gate"),
      prop("pending", "Children", false, "children"),
      prop("fallback", "Children", false, "children")
    ],
    irKind: "Include",
    summary: "Conditionally renders a synchronous component or lazy code-split loader."
  }),
  defineDirectiveSpec({
    id: "includefirst",
    family: "composition",
    branchComponents: [elseBranch("includefirst")],
    props: [
      prop("candidates", "readonly Loader<P>[]", true, "expression"),
      prop("props", "P", false, "expression"),
      prop("pending", "Children", false, "children"),
      prop("fallback", "Children", false, "children"),
      CHILDREN_OPT
    ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "IncludeFirst",
    summary: "Renders the first candidate loader that resolves, or the fallback."
  })
];
