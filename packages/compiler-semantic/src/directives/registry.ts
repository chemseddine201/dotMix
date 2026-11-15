/**
 * @dotmix/compiler-semantic/directives/registry — Single canonical directive registry.
 */

import { DIRECTIVE_GRAMMAR, deepFreeze } from "@dotmix/ast";
import type {
  AttributeDirectiveSpec,
  BranchComponentSpec,
  DirectiveSpec
} from "./types.js";
import { CONDITIONAL_DIRECTIVE_SPECS } from "./specs-conditionals.js";
import { SWITCH_AND_LOOP_DIRECTIVE_SPECS } from "./specs-switch-and-loops.js";
import { ASYNC_DIRECTIVE_SPECS } from "./specs-async.js";
import { AUTHENTICATION_AND_AUTHORIZATION_DIRECTIVE_SPECS } from "./specs-authentication-and-authorization.js";
import { ENVIRONMENT_AND_CONTEXT_DIRECTIVE_SPECS } from "./specs-environment-and-context.js";
import { FORM_AND_LAYOUT_DIRECTIVE_SPECS } from "./specs-forms-and-layouts.js";
import { COMPOSITION_DIRECTIVE_SPECS } from "./specs-composition.js";
import { RENDER_CONTROL_DIRECTIVE_SPECS } from "./specs-render-control.js";
import { SERVER_AND_DEBUG_DIRECTIVE_SPECS } from "./specs-server-and-debug.js";
import { ATTRIBUTE_AND_EVENT_DIRECTIVE_SPECS } from "./specs-attributes-and-events.js";

export type {
  DirectiveFamily,
  DirectiveIRKind,
  PropValueKind,
  DirectivePropSchema,
  DirectiveExposesParam,
  DirectiveExposesSchema,
  BranchComponentSpec,
  DirectiveSpec,
  AttributeDirectiveCategory,
  AttributeDirectiveSpec
} from "./types.js";

export { DIRECTIVES_IMPORT, PERMISSIONS_IMPORT } from "./spec-helpers.js";
export { BOOLEAN_HTML_ATTRIBUTES } from "./specs-attributes-and-events.js";

export const DIRECTIVE_SPECS: readonly DirectiveSpec[] = deepFreeze([
  ...CONDITIONAL_DIRECTIVE_SPECS,
  ...SWITCH_AND_LOOP_DIRECTIVE_SPECS,
  ...ASYNC_DIRECTIVE_SPECS,
  ...AUTHENTICATION_AND_AUTHORIZATION_DIRECTIVE_SPECS,
  ...ENVIRONMENT_AND_CONTEXT_DIRECTIVE_SPECS,
  ...FORM_AND_LAYOUT_DIRECTIVE_SPECS,
  ...COMPOSITION_DIRECTIVE_SPECS,
  ...RENDER_CONTROL_DIRECTIVE_SPECS,
  ...SERVER_AND_DEBUG_DIRECTIVE_SPECS
]);

export const ATTRIBUTE_DIRECTIVE_SPECS: readonly AttributeDirectiveSpec[] = deepFreeze([
  ...ATTRIBUTE_AND_EVENT_DIRECTIVE_SPECS
]);

export const CONTEXTUAL_BLOCK_KEYWORDS: readonly string[] = DIRECTIVE_GRAMMAR.contextualKeywords;

const blockMap = new Map<string, DirectiveSpec>();
const idMap = new Map<string, DirectiveSpec>();
const componentMap = new Map<string, DirectiveSpec>();
const branchComponentMap = new Map<string, BranchComponentSpec[]>();
const branchMarkerSet = new Set<string>();
const closeKeywordSet = new Set<string>();
const inlineStatementSet = new Set<string>();
const elseSupportingSet = new Set<string>();

for (const spec of DIRECTIVE_SPECS) {
  idMap.set(spec.id, spec);
  // `{push "head"}` shares the `push` block opener with `<Push>`; keep `push` mapped to the `push` block spec.
  if (spec.id !== "head") {
    blockMap.set(spec.blockOpen, spec);
  }
  componentMap.set(spec.componentName, spec);
  if (spec.blockClose !== null) {
    closeKeywordSet.add(spec.blockClose);
  }
  for (const marker of spec.branchMarkers) {
    branchMarkerSet.add(marker);
  }
  for (const stmt of spec.inlineStatements) {
    inlineStatementSet.add(stmt);
  }
  if (spec.supportsElse) {
    elseSupportingSet.add(spec.blockOpen);
  }
  for (const branch of spec.branchComponents) {
    const existing = branchComponentMap.get(branch.name);
    if (existing) {
      existing.push(branch);
    } else {
      branchComponentMap.set(branch.name, [branch]);
    }
  }
}

export const DIRECTIVE_BY_ID: ReadonlyMap<string, DirectiveSpec> = idMap;
export const BLOCK_DIRECTIVE_MAP: ReadonlyMap<string, DirectiveSpec> = blockMap;
export const COMPONENT_DIRECTIVE_MAP: ReadonlyMap<string, DirectiveSpec> = componentMap;
export const BRANCH_COMPONENT_MAP: ReadonlyMap<string, readonly BranchComponentSpec[]> =
  branchComponentMap;

export const ALL_BLOCK_OPEN_KEYWORDS: readonly string[] = deepFreeze([...blockMap.keys()]);
export const ALL_BLOCK_CLOSE_KEYWORDS: readonly string[] = deepFreeze([...closeKeywordSet]);
export const ALL_BRANCH_MARKERS: readonly string[] = deepFreeze([...branchMarkerSet]);
export const ALL_INLINE_STATEMENTS: readonly string[] = deepFreeze([...inlineStatementSet]);
export const ELSE_SUPPORTING_BLOCKS: ReadonlySet<string> = elseSupportingSet;

export const ALL_MAIN_COMPONENT_NAMES: readonly string[] = deepFreeze([
  ...componentMap.keys()
]);
export const ALL_BRANCH_COMPONENT_NAMES: readonly string[] = deepFreeze([
  ...branchComponentMap.keys()
]);
export const ALL_COMPONENT_NAMES: readonly string[] = deepFreeze([
  ...componentMap.keys(),
  ...branchComponentMap.keys()
]);

export function getDirectiveSpecById(id: string): DirectiveSpec | undefined {
  return idMap.get(id);
}

export function getBlockDirectiveSpec(keyword: string): DirectiveSpec | undefined {
  return blockMap.get(keyword);
}

export function getComponentDirectiveSpec(name: string): DirectiveSpec | undefined {
  return componentMap.get(name);
}

export function getBranchComponentSpecs(name: string): readonly BranchComponentSpec[] {
  return branchComponentMap.get(name) ?? [];
}

export function isDirectiveBlockKeyword(keyword: string): boolean {
  return (
    blockMap.has(keyword) ||
    closeKeywordSet.has(keyword) ||
    branchMarkerSet.has(keyword) ||
    inlineStatementSet.has(keyword)
  );
}

export function isDirectiveComponentName(name: string): boolean {
  return componentMap.has(name) || branchComponentMap.has(name);
}

export function isBranchComponentName(name: string): boolean {
  return branchComponentMap.has(name);
}

export function isElseSupportingBlock(keyword: string): boolean {
  return elseSupportingSet.has(keyword);
}

export function isValidDirectiveImportSource(
  componentName: string,
  importSource: string
): boolean {
  const main = componentMap.get(componentName);
  if (main) {
    return main.importSources.includes(importSource);
  }
  const branches = branchComponentMap.get(componentName);
  if (branches && branches.length > 0) {
    return branches.some((branch) => branch.importSource === importSource);
  }
  return false;
}
