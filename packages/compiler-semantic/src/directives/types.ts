/**
 * @dotmix/compiler-semantic/directives/types — Canonical schema types for the dual-mode directive registry.
 */

import type { DiagnosticCode } from "@dotmix/diagnostics";
import type { DirectiveTemplateNode } from "@dotmix/ast";

export type DirectiveFamily =
  | "conditionals"
  | "switch"
  | "loops"
  | "async"
  | "authentication"
  | "authorization"
  | "environment-and-context"
  | "forms"
  | "layouts-and-stacks"
  | "composition"
  | "render-control"
  | "attributes-and-events"
  | "server-rendering"
  | "debug-and-text";

export type DirectiveIRKind =
  | DirectiveTemplateNode["type"]
  | "IfBlock"
  | "EachBlock"
  | "AwaitBlock";

export type PropValueKind =
  | "boolean-gate"
  | "value"
  | "subject"
  | "dependencies"
  | "collection"
  | "target-name"
  | "match-value"
  | "trigger"
  | "callback"
  | "children"
  | "expression";

export interface DirectivePropSchema {
  readonly name: string;
  readonly typeText: string;
  readonly required: boolean;
  readonly valueKind: PropValueKind;
}

export interface DirectiveExposesParam {
  readonly name: string;
  readonly typeText: string;
}

export interface DirectiveExposesSchema {
  readonly blockSyntax: "as" | "inline" | null;
  readonly params: readonly DirectiveExposesParam[];
}

export interface BranchComponentSpec {
  readonly name: string;
  readonly parentId: string;
  readonly role: "branch" | "subcomponent";
  readonly blockMarker: string | null;
  readonly importSource: string;
  readonly props: readonly DirectivePropSchema[];
  readonly summary: string;
}

export interface DirectiveSpec {
  readonly id: string;
  readonly family: Exclude<DirectiveFamily, "attributes-and-events">;
  readonly blockOpen: string;
  readonly blockClose: string | null;
  readonly branchMarkers: readonly string[];
  readonly inlineStatements: readonly string[];
  readonly componentName: string;
  readonly branchComponents: readonly BranchComponentSpec[];
  readonly importSources: readonly string[];
  readonly props: readonly DirectivePropSchema[];
  readonly exposes: DirectiveExposesSchema | null;
  readonly diagnostics: readonly DiagnosticCode[];
  readonly irKind: DirectiveIRKind;
  readonly isRuntimeComponent: boolean;
  readonly supportsElse: boolean;
  readonly rawTextMode: boolean;
  readonly summary: string;
}

export type AttributeDirectiveCategory =
  | "attribute-modifier"
  | "event-modifier"
  | "class-directive"
  | "style-directive"
  | "spread-modifier";

export interface AttributeDirectiveSpec {
  readonly id: string;
  readonly family: "attributes-and-events";
  readonly category: AttributeDirectiveCategory;
  readonly syntax: string;
  readonly modifier: string;
  readonly irKind:
    | "ConditionalAttribute"
    | "ConditionalEvent"
    | "ClassMap"
    | "StyleMap"
    | "ConditionalSpread";
  readonly diagnostics: readonly DiagnosticCode[];
  readonly summary: string;
}
