/**
 * @dotmix/compiler-semantic/directives/specs-render-control — Registry entries for render-control directives.
 */

import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { DirectiveSpec } from "./types.js";
import {
  CHILDREN_REQ,
  defineDirectiveSpec,
  elseBranch,
  prop
} from "./spec-helpers.js";

export const RENDER_CONTROL_DIRECTIVE_SPECS: readonly DirectiveSpec[] = [
  defineDirectiveSpec({
    id: "once",
    family: "render-control",
    props: [CHILDREN_REQ],
    diagnostics: [DiagnosticCodes.MIX_ERR_ONCE_WRITE],
    irKind: "Once",
    summary: "Renders a static snapshot once with untracked reads."
  }),
  defineDirectiveSpec({
    id: "memo",
    family: "render-control",
    props: [
      prop("on", "readonly Maybe<unknown>[]", true, "dependencies"),
      prop("equals", "(prev: readonly unknown[], next: readonly unknown[]) => boolean", false, "callback"),
      CHILDREN_REQ
    ],
    diagnostics: [DiagnosticCodes.MIX_WARN_MEMO_EMPTY_DEPS],
    irKind: "Memo",
    summary: "Updates subtree only when listed dependencies change."
  }),
  defineDirectiveSpec({
    id: "lazy",
    family: "render-control",
    branchComponents: [elseBranch("lazy")],
    props: [
      prop("trigger", "\"visible\" | \"idle\"", false, "trigger"),
      prop("fallback", "Children", false, "children"),
      CHILDREN_REQ
    ],
    diagnostics: [
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH,
      DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT
    ],
    irKind: "Lazy",
    summary: "Defers rendering until visible in viewport or browser idle (immediate on SSR)."
  }),
  defineDirectiveSpec({
    id: "hydrate",
    family: "render-control",
    props: [
      prop("when", '"load" | "idle" | "visible" | `media ${string}` | "media" | "never"', true, "trigger"),
      prop("media", "string", false, "value"),
      CHILDREN_REQ
    ],
    diagnostics: [DiagnosticCodes.MIX_ERR_PARSE_SYNTAX],
    irKind: "Hydrate",
    summary: "Controls island hydration strategy (load | idle | visible | media \"<query>\" | never)."
  }),
  defineDirectiveSpec({
    id: "try",
    family: "render-control",
    props: [
      prop("fallback", "Children | ((error: unknown, reset: () => void) => Children)", true, "children"),
      CHILDREN_REQ
    ],
    diagnostics: [DiagnosticCodes.MIX_ERR_PARSE_SYNTAX],
    irKind: "TryBlock",
    isRuntimeComponent: true,
    summary: "Catches render, effect, and event handler errors in its subtree and renders a recoverable fallback."
  }),
  defineDirectiveSpec({
    id: "keepalive",
    family: "render-control",
    props: [
      prop("activeKey", "string | (() => string)", true, "expression"),
      prop("max", "number", false, "expression"),
      prop("render", "(key: string) => Children", false, "callback"),
      prop("children", "((key?: string) => Children) | Children", false, "children")
    ],
    exposes: {
      blockSyntax: "as",
      params: [{ name: "key", typeText: "string" }]
    },
    irKind: "KeepAliveBlock",
    isRuntimeComponent: true,
    summary: "Preserves offscreen DOM and signal state across activeKey switches using LRU eviction."
  })
];
