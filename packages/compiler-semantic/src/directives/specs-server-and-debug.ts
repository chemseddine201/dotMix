/**
 * @dotmix/compiler-semantic/directives/specs-server-and-debug — Registry entries for server-rendering and debug/text directives.
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

export const SERVER_AND_DEBUG_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "session",
    family: "server-rendering",
    branchComponents: [elseBranch("session")],
    props: [
      prop("key", "string", true, "target-name"),
      ELSE_PROP,
      prop("children", "(value: unknown) => Children", true, "children")
    ],
    exposes: {
      blockSyntax: "as",
      params: [{ name: "value", typeText: "unknown" }]
    },
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "SessionBlock",
    summary: "Reads a request-session key during SSR and hydrates read-only on the client."
  }),
  defineDirectiveSpec({
    id: "partial",
    family: "server-rendering",
    props: [prop("name", "string", true, "target-name"), CHILDREN_REQ],
    irKind: "Partial",
    summary: "Marks an independently renderable SSR partial region."
  }),
  defineDirectiveSpec({
    id: "json",
    family: "server-rendering",
    props: [
      prop("id", "string", true, "target-name"),
      prop("data", "unknown", true, "value")
    ],
    irKind: "Json",
    summary: "Emits a safely escaped <script type=\"application/json\"> element."
  }),
  defineDirectiveSpec({
    id: "dump",
    family: "debug-and-text",
    props: [prop("value", "unknown", true, "value")],
    irKind: "Dump",
    summary: "Renders a collapsible JSON view in development; stripped in production."
  }),
  defineDirectiveSpec({
    id: "verbatim",
    family: "debug-and-text",
    props: [CHILDREN_REQ],
    irKind: "Verbatim",
    summary: "Emits raw literal template text without parsing template syntax."
  })
];
