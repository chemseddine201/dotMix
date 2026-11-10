/**
 * @mix/compiler-semantic — Lexical scopes, ESTree symbol resolution, .tix virtual TypeScript projection,
 * SourceMapSpanTable (R-SP-01..05), and TypeScript 6.0.3 Compiler API verification adapter (D-106, R-TC-01..03).
 *
 * Architecture Invariant:
 * - Zero regular expressions for variable/scope analysis (AGENTS.md §6, Guardrail D)
 * - Zero dependency on @mix/runtime (HAA-04)
 */

export { isESTreeNode, LineMap } from "@mix/ast";
export type {
  BindingKind,
  SymbolBinding,
  Scope,
  SpanKind,
  SpanEntry,
  SourceMapV3,
  TypeProjectionResult,
  ComponentDescriptor,
  AnalyzeOptions,
  TypecheckOptions,
  TypecheckResult,
  SeparatedScriptResult
} from "./types.js";
export {
  STYLE_EXTENSION_REGEX,
  ALLOWED_RELATIVE_IMPORT_REGEX,
  ALLOWED_GLOBALS
} from "./constants.js";
export {
  lookupInScope,
  collectPatternIdentifiers,
  verifyExpressionIdentifiers,
  analyzeScriptBlock,
  analyze
} from "./scope-analyzer.js";
export {
  encodeVlq,
  generateSourceMap,
  mapProjectedSpanToSource
} from "./sourcemap.js";
export {
  projectTypeScript,
  analyzeScriptForComponentExport,
  extractTixModuleSurface
} from "./projection.js";
export {
  posixDirname,
  IMMUTABLE_DTS_SOURCE_FILE_CACHE,
  MIX_PACKAGE_DTS_CACHE,
  resolveMixPackageDts,
  VIRTUAL_AMBIENT_RUNTIME_DTS
} from "./dts-resolver.js";
export { typecheckTix } from "./typechecker.js";
export {
  rewriteModuleImportExtensions,
  extractAndTranspileScript,
  transpileSourceModule
} from "./transpiler.js";
export { transformExpressionAstToJs } from "./expression-rewriter.js";
