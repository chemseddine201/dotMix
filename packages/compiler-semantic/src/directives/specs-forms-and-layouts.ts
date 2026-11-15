/**
 * @dotmix/compiler-semantic/directives/specs-forms-and-layouts — Registry entries for form, layout, stack, and head directives.
 */

import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { DirectiveSpec } from "./types.js";
import {
  CHILDREN_OPT,
  CHILDREN_REQ,
  defineBranchSpec,
  defineDirectiveSpec,
  prop
} from "./spec-helpers.js";

export const FORM_AND_LAYOUT_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "error",
    family: "forms",
    props: [
      prop("form", "FormController<F>", true, "expression"),
      prop("name", "keyof F & string", true, "target-name"),
      prop("children", "(message: string) => Children", false, "children")
    ],
    exposes: {
      blockSyntax: "as",
      params: [{ name: "message", typeText: "string" }]
    },
    diagnostics: [DiagnosticCodes.MIX_ERR_FORM_FIELD_UNKNOWN],
    irKind: "FieldError",
    summary: "Renders the first visible validation error for a form field."
  }),
  defineDirectiveSpec({
    id: "errors",
    family: "forms",
    props: [
      prop("form", "FormController<F>", true, "expression"),
      prop(
        "children",
        "(list: readonly { field: keyof F & string; message: string }[]) => Children",
        true,
        "children"
      )
    ],
    exposes: {
      blockSyntax: "as",
      params: [{ name: "list", typeText: "readonly { field: keyof F & string; message: string }[]" }]
    },
    irKind: "FormErrors",
    summary: "Renders all visible form errors when the list is non-empty."
  }),
  defineDirectiveSpec({
    id: "valid",
    family: "forms",
    props: [
      prop("form", "FormController<F>", true, "expression"),
      prop("name", "keyof F & string", true, "target-name"),
      CHILDREN_REQ
    ],
    diagnostics: [DiagnosticCodes.MIX_ERR_FORM_FIELD_UNKNOWN],
    irKind: "FieldValid",
    summary: "Renders when a form field is touched, valid, and not currently validating."
  }),
  defineDirectiveSpec({
    id: "csrf",
    family: "forms",
    props: [],
    irKind: "Csrf",
    summary: "Emits a hidden CSRF token input from RequestContext or meta[name=\"csrf-token\"]."
  }),
  defineDirectiveSpec({
    id: "method",
    family: "forms",
    props: [prop("value", "\"PUT\" | \"PATCH\" | \"DELETE\"", true, "value")],
    irKind: "Method",
    summary: "Emits a hidden _method input for HTML form method spoofing."
  }),
  defineDirectiveSpec({
    id: "section",
    family: "layouts-and-stacks",
    props: [prop("name", "string", true, "target-name"), CHILDREN_REQ],
    irKind: "Section",
    summary: "Defines a named layout section inside a layout component's children."
  }),
  defineDirectiveSpec({
    id: "yield",
    family: "layouts-and-stacks",
    props: [
      prop("name", "string", true, "target-name"),
      prop("fallback", "Children", false, "children"),
      CHILDREN_OPT
    ],
    diagnostics: [DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT],
    irKind: "Yield",
    summary: "Renders a named section outlet with optional fallback content."
  }),
  defineDirectiveSpec({
    id: "hassection",
    family: "layouts-and-stacks",
    props: [prop("name", "string", true, "target-name"), CHILDREN_REQ],
    irKind: "HasSection",
    summary: "Renders when the named section was provided."
  }),
  defineDirectiveSpec({
    id: "sectionmissing",
    family: "layouts-and-stacks",
    props: [prop("name", "string", true, "target-name"), CHILDREN_REQ],
    irKind: "SectionMissing",
    summary: "Renders when the named section is missing."
  }),
  defineDirectiveSpec({
    id: "push",
    family: "layouts-and-stacks",
    props: [
      prop("to", "string", true, "target-name"),
      prop("once", "string", false, "expression"),
      CHILDREN_REQ
    ],
    irKind: "StackPush",
    summary: "Appends content to a named stack and removes it on unmount."
  }),
  defineDirectiveSpec({
    id: "prepend",
    family: "layouts-and-stacks",
    props: [
      prop("to", "string", true, "target-name"),
      prop("once", "string", false, "expression"),
      CHILDREN_REQ
    ],
    irKind: "StackPush",
    summary: "Prepends content to a named stack and removes it on unmount."
  }),
  defineDirectiveSpec({
    id: "stack",
    family: "layouts-and-stacks",
    props: [prop("name", "string", true, "target-name")],
    irKind: "Stack",
    summary: "Renders prepended and pushed entries for a named stack."
  }),
  defineDirectiveSpec({
    id: "head",
    family: "layouts-and-stacks",
    branchComponents: [
      defineBranchSpec("head", "Title", [CHILDREN_REQ], "Managed <title> entry inside <Head>."),
      defineBranchSpec(
        "head",
        "Meta",
        [
          prop("name", "string", false, "expression"),
          prop("property", "string", false, "expression"),
          prop("http-equiv", "string", false, "expression"),
          prop("content", "string", false, "expression"),
          prop("charset", "string", false, "expression")
        ],
        "Deduplicated <meta> entry inside <Head>."
      ),
      defineBranchSpec(
        "head",
        "Link",
        [
          prop("rel", "string", false, "expression"),
          prop("href", "string", false, "expression"),
          prop("as", "string", false, "expression"),
          prop("type", "string", false, "expression")
        ],
        "Deduplicated <link> entry inside <Head>."
      )
    ],
    props: [CHILDREN_REQ],
    irKind: "HeadGroup",
    summary: "Pushes managed head entries to the reserved `head` stack."
  })
];
