/**
 * @dotmix/compiler-semantic/directives/specs-attributes-and-events — Attribute, class, style, spread, and event modifier specs.
 */

import { DIRECTIVE_GRAMMAR } from "@dotmix/ast";
import { DiagnosticCodes } from "@dotmix/diagnostics";
import type { AttributeDirectiveSpec } from "./types.js";

export const ATTRIBUTE_AND_EVENT_DIRECTIVE_SPECS: readonly AttributeDirectiveSpec[] = [
  {
    id: "attr:if",
    family: "attributes-and-events",
    category: "attribute-modifier",
    syntax: "attr:if={cond}",
    modifier: "if",
    irKind: "ConditionalAttribute",
    diagnostics: [DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE, DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT],
    summary: "Applies the base attribute only while condition is truthy."
  },
  {
    id: "attr:unless",
    family: "attributes-and-events",
    category: "attribute-modifier",
    syntax: "attr:unless={cond}",
    modifier: "unless",
    irKind: "ConditionalAttribute",
    diagnostics: [DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE, DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT],
    summary: "Applies the base attribute only while condition is falsy."
  },
  {
    id: "attr:else",
    family: "attributes-and-events",
    category: "attribute-modifier",
    syntax: "attr:else={expr}",
    modifier: "else",
    irKind: "ConditionalAttribute",
    diagnostics: [DiagnosticCodes.MIX_ERR_CONDITIONAL_ELSE_ALONE],
    summary: "Fallback attribute value when `:if`, `:unless`, or `:match` does not match."
  },
  {
    id: "attr:match",
    family: "attributes-and-events",
    category: "attribute-modifier",
    syntax: "attr:match={expr}",
    modifier: "match",
    irKind: "ConditionalAttribute",
    diagnostics: [],
    summary: "Selects an attribute value from matching `attr:case-<token>` modifiers."
  },
  {
    id: "attr:case",
    family: "attributes-and-events",
    category: "attribute-modifier",
    syntax: "attr:case-<token>={expr}",
    modifier: "case-",
    irKind: "ConditionalAttribute",
    diagnostics: [DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE],
    summary: "Matches an identifier or integer token against `attr:match`."
  },
  {
    id: "spread:if",
    family: "attributes-and-events",
    category: "spread-modifier",
    syntax: "{...attrs} spread:if={cond}",
    modifier: "spread:if",
    irKind: "ConditionalSpread",
    diagnostics: [DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE],
    summary: "Applies a spread attribute object conditionally."
  },
  {
    id: "class:map",
    family: "attributes-and-events",
    category: "class-directive",
    syntax: "class={{ ... }} | class={[...]}",
    modifier: "class",
    irKind: "ClassMap",
    diagnostics: [],
    summary: "Merges object/array class bindings with per-key toggleClass effects."
  },
  {
    id: "class:name",
    family: "attributes-and-events",
    category: "class-directive",
    syntax: "class:<name>={cond}",
    modifier: "class:",
    irKind: "ClassMap",
    diagnostics: [],
    summary: "Toggles a single CSS class name with a reactive effect."
  },
  {
    id: "style:map",
    family: "attributes-and-events",
    category: "style-directive",
    syntax: "style={{ ... }}",
    modifier: "style",
    irKind: "StyleMap",
    diagnostics: [],
    summary: "Sets inline style properties and CSS custom properties with per-key effects."
  },
  {
    id: "style:prop",
    family: "attributes-and-events",
    category: "style-directive",
    syntax: "style:<prop>={expr}",
    modifier: "style:",
    irKind: "StyleMap",
    diagnostics: [],
    summary: "Sets a single style property or CSS custom property with a reactive effect."
  },
  {
    id: "event:if",
    family: "attributes-and-events",
    category: "event-modifier",
    syntax: "onEvent:if={cond}",
    modifier: "if",
    irKind: "ConditionalEvent",
    diagnostics: [
      DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE,
      DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT,
      DiagnosticCodes.MIX_WARN_INERT_INTERACTIVE
    ],
    summary: "Attaches an event listener only while condition is truthy."
  },
  {
    id: "event:unless",
    family: "attributes-and-events",
    category: "event-modifier",
    syntax: "onEvent:unless={cond}",
    modifier: "unless",
    irKind: "ConditionalEvent",
    diagnostics: [
      DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE,
      DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT
    ],
    summary: "Attaches an event listener only while condition is falsy."
  },
  {
    id: "event:else",
    family: "attributes-and-events",
    category: "event-modifier",
    syntax: "onEvent:else={handler}",
    modifier: "else",
    irKind: "ConditionalEvent",
    diagnostics: [DiagnosticCodes.MIX_ERR_CONDITIONAL_ELSE_ALONE],
    summary: "Alternative event handler swapped atomically when `:if` or `:unless` is inactive."
  }
];

export const BOOLEAN_HTML_ATTRIBUTES: ReadonlySet<string> = new Set(
  DIRECTIVE_GRAMMAR.booleanHtmlAttributes
);
