/**
 * @dotmix/compiler-semantic/build-transforms — TypeScript-based helpers used by the CLI build and check.
 */

export {
  removeSideEffectImports,
  removeJavaScriptComments,
  computeRemoveSideEffectImportsEdits,
  computeRemoveCommentsEdits,
  listStaticImportSpecifiers,
  listDynamicImportSpecifiers
} from "./module-transforms.js";
export {
  typecheckScriptModules,
  type ScriptModuleDiagnostic,
  type ScriptModuleTypecheckResult
} from "./script-typecheck.js";
export {
  replaceImportMetaEnv,
  computeImportMetaEnvEdits,
  type ImportMetaEnvValues
} from "./import-meta-env.js";
