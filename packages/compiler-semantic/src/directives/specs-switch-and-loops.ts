/**
 * @dotmix/compiler-semantic/directives/specs-switch-and-loops — Registry entries for switch and loop directives.
 */

import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { DirectiveSpec } from "./types.js";
import {
  CHILDREN_REQ,
  defineBranchSpec,
  defineDirectiveSpec,
  prop
} from "./spec-helpers.js";

export const SWITCH_AND_LOOP_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "switch",
    family: "switch",
    branchComponents: [
      defineBranchSpec(
        "switch",
        "Case",
        [
          prop("is", "T | readonly T[]", false, "match-value"),
          prop("condition", "Maybe<unknown>", false, "boolean-gate"),
          CHILDREN_REQ
        ],
        "Matches subject equality (`is`) or boolean condition (`condition`) inside <Switch>."
      ),
      defineBranchSpec(
        "switch",
        "Default",
        [CHILDREN_REQ],
        "Default fallback branch at the end of <Switch>."
      )
    ],
    props: [prop("on", "Maybe<T>", false, "subject"), CHILDREN_REQ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_SWITCH_CASE_FORM,
      DiagnosticCodes.MIX_ERR_SWITCH_STRAY_CONTENT,
      DiagnosticCodes.MIX_ERR_SWITCH_DEFAULT_ORDER,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH
    ],
    irKind: "SwitchBlock",
    summary: "Multi-way branch without fall-through using Object.is or conditional cases."
  }),
  defineDirectiveSpec({
    id: "each",
    family: "loops",
    branchComponents: [
      defineBranchSpec(
        "each",
        "Empty",
        [CHILDREN_REQ],
        "Empty fallback branch inside <Each>."
      )
    ],
    props: [
      prop("data", "Maybe<readonly T[]>", true, "collection"),
      prop("key", "(item: T, index: number) => PropertyKey", false, "callback"),
      prop("skip", "(item: T, index: number) => boolean", false, "callback"),
      prop("stop", "(item: T, index: number) => boolean", false, "callback"),
      prop("fallback", "Children", false, "children"),
      prop("render", "Component<Record<K, T>>", false, "expression"),
      prop("as", "K", false, "target-name"),
      prop("children", "((item: T, index: () => number) => Children) | Children", false, "children")
    ],
    exposes: {
      blockSyntax: "inline",
      params: [
        { name: "item", typeText: "T" },
        { name: "index", typeText: "() => number" }
      ]
    },
    diagnostics: [
      DiagnosticCodes.MIX_ERR_LOOP_CONTROL_POSITION,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "EachExtBlock",
    summary: "Keyed reactive list iteration with optional skip/stop filters, render component, and empty fallback."
  }),
  defineDirectiveSpec({
    id: "for",
    family: "loops",
    props: [
      prop("from", "Maybe<number>", false, "expression"),
      prop("to", "Maybe<number>", false, "expression"),
      prop("step", "Maybe<number>", false, "expression"),
      prop("times", "Maybe<number>", false, "expression"),
      prop("children", "(i: number) => Children", true, "children")
    ],
    exposes: {
      blockSyntax: "inline",
      params: [{ name: "i", typeText: "number" }]
    },
    diagnostics: [
      DiagnosticCodes.MIX_ERR_FOR_STEP_ZERO,
      DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE
    ],
    irKind: "ForBlock",
    summary: "Bounded reactive numeric range or counted iteration."
  })
];
