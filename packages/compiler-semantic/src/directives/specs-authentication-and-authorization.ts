/**
 * @dotmix/compiler-semantic/directives/specs-authentication-and-authorization — Registry entries for auth and permission directives.
 */

import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { DirectiveSpec } from "./types.js";
import {
  CHILDREN_OPT,
  CHILDREN_REQ,
  ELSE_PROP,
  defineBranchSpec,
  defineDirectiveSpec,
  elseBranch,
  prop
} from "./spec-helpers.js";

export const AUTHENTICATION_AND_AUTHORIZATION_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "auth",
    family: "authentication",
    branchComponents: [elseBranch("auth")],
    props: [
      prop("guard", "string", false, "expression"),
      prop("role", "string | readonly string[]", false, "expression"),
      ELSE_PROP,
      prop("children", "Children | ((user: U) => Children)", true, "children")
    ],
    exposes: {
      blockSyntax: "as",
      params: [{ name: "user", typeText: "U" }]
    },
    diagnostics: [
      DiagnosticCodes.MIX_ERR_AUTH_PROVIDER_MISSING,
      DiagnosticCodes.MIX_ERR_AUTH_ROLE_UNSUPPORTED,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "AuthBlock",
    summary: "Renders when the configured auth guard has an authenticated user matching optional roles."
  }),
  defineDirectiveSpec({
    id: "guest",
    family: "authentication",
    branchComponents: [elseBranch("guest")],
    props: [prop("guard", "string", false, "expression"), ELSE_PROP, CHILDREN_REQ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_AUTH_PROVIDER_MISSING,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "GuestBlock",
    summary: "Renders when the configured auth guard has no authenticated user."
  }),
  defineDirectiveSpec({
    id: "can",
    family: "authorization",
    branchComponents: [
      defineBranchSpec(
        "can",
        "ElseCan",
        [
          prop("I", "Action", true, "expression"),
          prop("this", "unknown", false, "subject"),
          prop("a", "string", false, "expression"),
          prop("an", "string", false, "expression"),
          prop("field", "string", false, "expression"),
          CHILDREN_REQ
        ],
        "Fallback permission check branch inside <Can>."
      ),
      elseBranch("can")
    ],
    props: [
      prop("I", "Action", true, "expression"),
      prop("this", "unknown", false, "subject"),
      prop("a", "string", false, "expression"),
      prop("an", "string", false, "expression"),
      prop("field", "string", false, "expression"),
      prop("not", "boolean", false, "boolean-gate"),
      prop("fallback", "Children", false, "children"),
      CHILDREN_OPT
    ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "CanChain",
    isRuntimeComponent: true,
    summary: "Permission gate lowering {can}/{elsecan}/{else} and branched <Can> to nested Can calls."
  }),
  defineDirectiveSpec({
    id: "cannot",
    family: "authorization",
    branchComponents: [elseBranch("cannot")],
    props: [
      prop("I", "Action", true, "expression"),
      prop("this", "unknown", false, "subject"),
      prop("a", "string", false, "expression"),
      prop("an", "string", false, "expression"),
      prop("field", "string", false, "expression"),
      ELSE_PROP,
      CHILDREN_REQ
    ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "CannotBlock",
    summary: "Negated permission gate equivalent to <Can not>."
  }),
  defineDirectiveSpec({
    id: "canany",
    family: "authorization",
    branchComponents: [elseBranch("canany")],
    props: [
      prop("I", "readonly Action[]", true, "expression"),
      prop("this", "unknown", false, "subject"),
      prop("a", "string", false, "expression"),
      prop("an", "string", false, "expression"),
      ELSE_PROP,
      CHILDREN_REQ
    ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "CanAnyBlock",
    summary: "Permission gate that renders when any listed action is permitted."
  })
];
