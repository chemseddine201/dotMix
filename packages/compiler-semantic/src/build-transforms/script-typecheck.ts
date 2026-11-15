/**
 * @dotmix/compiler-semantic/build-transforms/script-typecheck — Type-checks the plain `.ts` modules
 * of a project with its own tsconfig.json, as `tsc --noEmit` does.
 */

import * as ts from "typescript";
import { posixDirname } from "../dts-resolver.js";

export interface ScriptModuleDiagnostic {
  readonly file: string;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly column: number;
  readonly code: number;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export interface ScriptModuleTypecheckResult {
  /** The tsconfig.json that was used, or null when the project has none (nothing is checked). */
  readonly configPath: string | null;
  readonly diagnostics: readonly ScriptModuleDiagnostic[];
}

function toComparablePath(filePath: string): string {
  return ts.sys.resolvePath(filePath).split("\\").join("/").toLowerCase();
}

/**
 * Runs the TypeScript compiler over `files` with the compiler options of the nearest tsconfig.json
 * (searched from `projectDirectory` upwards). The project's declaration files (such as
 * src/env.d.ts) are part of the program. Only diagnostics of `files` are returned.
 */
export function typecheckScriptModules(
  projectDirectory: string,
  files: readonly string[]
): ScriptModuleTypecheckResult {
  const configPath = ts.findConfigFile(projectDirectory, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    return { configPath: null, diagnostics: [] };
  }
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config ?? {},
    ts.sys,
    posixDirname(configPath.split("\\").join("/"))
  );
  const declarationFiles = parsedConfig.fileNames.filter((fileName) => fileName.endsWith(".d.ts"));
  const program = ts.createProgram({
    rootNames: [...new Set([...files, ...declarationFiles])],
    options: { ...parsedConfig.options, noEmit: true }
  });

  const checkedFiles = new Set(files.map(toComparablePath));
  const diagnostics: ScriptModuleDiagnostic[] = [];
  const configDiagnostics = configFile.error ? [configFile.error] : [];
  for (const diagnostic of [...configDiagnostics, ...ts.getPreEmitDiagnostics(program)]) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error && diagnostic.category !== ts.DiagnosticCategory.Warning) {
      continue;
    }
    const sourceFile = diagnostic.file;
    if (sourceFile && !checkedFiles.has(toComparablePath(sourceFile.fileName))) continue;
    const position = sourceFile && diagnostic.start !== undefined
      ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
      : { line: 0, character: 0 };
    diagnostics.push({
      file: sourceFile ? sourceFile.fileName : configPath,
      line: position.line + 1,
      column: position.character + 1,
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning"
    });
  }
  return { configPath, diagnostics };
}
