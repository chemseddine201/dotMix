/**
 * @dotmix/compiler-semantic/directives/specs-environment-and-context — Registry entries for compile-time env and context directives.
 */

import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { DirectiveSpec } from "./types.js";
import {
  CHILDREN_REQ,
  ELSE_PROP,
  defineDirectiveSpec,
  elseBranch,
  prop
} from "./spec-helpers.js";

export const ENVIRONMENT_AND_CONTEXT_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "dev",
    family: "environment-and-context",
    props: [CHILDREN_REQ],
    irKind: "EnvGate",
    summary: "Compile-time environment gate active only in development mode."
  }),
  defineDirectiveSpec({
    id: "production",
    family: "environment-and-context",
    props: [CHILDREN_REQ],
    irKind: "EnvGate",
    summary: "Compile-time environment gate active only in production mode."
  }),
  defineDirectiveSpec({
    id: "env",
    family: "environment-and-context",
    branchComponents: [elseBranch("env")],
    props: [prop("is", "string | readonly string[]", true, "match-value"), ELSE_PROP, CHILDREN_REQ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_ENV_NOT_STATIC,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "EnvGate",
    summary: "Compile-time environment gate matching static build mode names."
  }),
  defineDirectiveSpec({
    id: "context",
    family: "environment-and-context",
    branchComponents: [elseBranch("context")],
    props: [
      prop("of", "Context<T>", true, "expression"),
      ELSE_PROP,
      prop("children", "(value: NonNullable<T>) => Children", true, "children")
    ],
    exposes: {
      blockSyntax: "as",
      params: [{ name: "value", typeText: "NonNullable<T>" }]
    },
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "ContextBlock",
    summary: "Reads a context value via getContext(of) and narrows non-nullish results."
  })
];
