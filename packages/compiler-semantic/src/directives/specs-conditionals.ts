/**
 * @dotmix/compiler-semantic/directives/specs-conditionals — Registry entries for conditional directives.
 */

import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { DirectiveSpec } from "./types.js";
import {
  CHILDREN_REQ,
  ELSE_PROP,
  defineBranchSpec,
  defineDirectiveSpec,
  elseBranch,
  prop
} from "./spec-helpers.js";

export const CONDITIONAL_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "if",
    family: "conditionals",
    branchComponents: [
      defineBranchSpec(
        "if",
        "ElseIf",
        [prop("condition", "Maybe<unknown>", true, "boolean-gate"), CHILDREN_REQ],
        "Conditional alternative branch inside <If>."
      ),
      elseBranch("if")
    ],
    props: [prop("condition", "Maybe<unknown>", true, "boolean-gate"), CHILDREN_REQ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "IfBlock",
    summary: "Renders the first truthy conditional branch."
  }),
  defineDirectiveSpec({
    id: "unless",
    family: "conditionals",
    branchComponents: [elseBranch("unless")],
    props: [prop("condition", "Maybe<unknown>", true, "boolean-gate"), ELSE_PROP, CHILDREN_REQ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "UnlessBlock",
    summary: "Renders body when condition is falsy."
  }),
  defineDirectiveSpec({
    id: "isset",
    family: "conditionals",
    branchComponents: [elseBranch("isset")],
    props: [
      prop("value", "Maybe<T | null | undefined>", true, "value"),
      ELSE_PROP,
      prop("children", "Children | ((value: NonNullable<T>) => Children)", true, "children")
    ],
    exposes: {
      blockSyntax: "as",
      params: [{ name: "value", typeText: "NonNullable<T>" }]
    },
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "IsSetBlock",
    summary: "Renders when value is not null or undefined, narrowing the exposed binding."
  }),
  defineDirectiveSpec({
    id: "isempty",
    family: "conditionals",
    branchComponents: [elseBranch("isempty")],
    props: [prop("value", "Maybe<unknown>", true, "value"), ELSE_PROP, CHILDREN_REQ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "IsEmptyBlock",
    summary: "Renders when value is null, undefined, empty string, empty collection, or empty plain object."
  })
];
