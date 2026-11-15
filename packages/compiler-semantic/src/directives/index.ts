/**
 * @dotmix/compiler-semantic/directives — Barrel exports for directive registry, lowering, validation, and projection.
 */

export * from "./registry.js";
export * from "./types.js";
export {
  getBareGetterIdents,
  hasBareGetterRef,
  normalizeBlockConditionToCanonicalArrow,
  normalizeEachBodyExpression,
  normalizePredicateToCanonicalArrow,
  stripDirectiveImportsFromJs,
  transformWithBareGetters
} from "./expr-helpers.js";
export { lowerDirectiveComponents } from "./lower-components.js";
export {
  collectScriptDirectiveHints,
  validateDirectiveTemplateNode,
  validateElementDirectiveAttributes
} from "./validate-directives.js";
export { projectDirectiveTemplateNode } from "./project-directives.js";
