/**
 * @dotmix/compiler-semantic/directives/spec-helpers — Shared builders for directive registry specs.
 */

import {
  DIRECTIVES_IMPORT_PATH,
  PERMISSIONS_IMPORT_PATH,
  getDirectiveGrammarById
} from "@dotmix/ast";
import type { DiagnosticCode } from "@dotmix/diagnostics";
import type {
  BranchComponentSpec,
  DirectiveExposesSchema,
  DirectiveFamily,
  DirectiveIRKind,
  DirectivePropSchema,
  DirectiveSpec,
  PropValueKind
} from "./types.js";

export const DIRECTIVES_IMPORT = DIRECTIVES_IMPORT_PATH;
export const PERMISSIONS_IMPORT = PERMISSIONS_IMPORT_PATH;

export function prop(
  name: string,
  typeText: string,
  required: boolean,
  valueKind: PropValueKind
): DirectivePropSchema {
  return { name, typeText, required, valueKind };
}

export const CHILDREN_REQ: DirectivePropSchema = prop("children", "Children", true, "children");
export const CHILDREN_OPT: DirectivePropSchema = prop("children", "Children", false, "children");
export const ELSE_PROP: DirectivePropSchema = prop("else", "Children", false, "children");

export function elseBranch(parentId: string): BranchComponentSpec {
  const grammar = getDirectiveGrammarById(parentId);
  const branchMeta = grammar.branchComponents.find((branch) => branch.blockMarker === "else");
  return {
    name: branchMeta ? branchMeta.name : "Else",
    parentId,
    role: "branch",
    blockMarker: "else",
    importSource: branchMeta ? branchMeta.importSource : DIRECTIVES_IMPORT,
    props: [CHILDREN_REQ],
    summary: "Fallback branch rendered when the primary condition or lookup does not match."
  };
}

export function defineBranchSpec(
  parentId: string,
  branchName: string,
  props: readonly DirectivePropSchema[],
  summary: string
): BranchComponentSpec {
  const grammar = getDirectiveGrammarById(parentId);
  const branchMeta = grammar.branchComponents.find((branch) => branch.name === branchName);
  if (!branchMeta) {
    throw new Error(`Missing branch grammar '${branchName}' for directive '${parentId}'.`);
  }
  return {
    name: branchMeta.name,
    parentId: branchMeta.parentId,
    role: branchMeta.role,
    blockMarker: branchMeta.blockMarker,
    importSource: branchMeta.importSource,
    props,
    summary
  };
}

export function defineDirectiveSpec(params: {
  readonly id: string;
  readonly family: Exclude<DirectiveFamily, "attributes-and-events">;
  readonly branchComponents?: readonly BranchComponentSpec[];
  readonly props: readonly DirectivePropSchema[];
  readonly exposes?: DirectiveExposesSchema | null;
  readonly diagnostics?: readonly DiagnosticCode[];
  readonly irKind: DirectiveIRKind;
  readonly isRuntimeComponent?: boolean;
  readonly summary: string;
}): DirectiveSpec {
  const grammar = getDirectiveGrammarById(params.id);
  return {
    id: grammar.id,
    family: params.family,
    blockOpen: grammar.blockOpen,
    blockClose: grammar.blockClose,
    branchMarkers: grammar.branchMarkers,
    inlineStatements: grammar.inlineStatements,
    componentName: grammar.componentName,
    branchComponents: params.branchComponents ?? [],
    importSources: grammar.importSources,
    props: params.props,
    exposes: params.exposes ?? null,
    diagnostics: params.diagnostics ?? [],
    irKind: params.irKind,
    isRuntimeComponent: params.isRuntimeComponent ?? false,
    supportsElse: grammar.supportsElse,
    rawTextMode: grammar.rawTextMode,
    summary: params.summary
  };
}
