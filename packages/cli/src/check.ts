/**
 * @dotmix/cli — `mix check` (Static type checking & diagnostic verification)
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@dotmix/compiler-frontend";
import { analyze, typecheckScriptModules, typecheckTix } from "@dotmix/compiler-semantic";
import {
  formatCliDiagnostic,
  MixDiagnosticError,
  type Diagnostic
} from "@dotmix/diagnostics";
import { scanInputDirectory } from "./scanner.js";
import { normalizeDriveLetter } from "./normalize-path.js";

export interface CheckOptions {
  files?: string[] | undefined;
  dir?: string | undefined;
  silent?: boolean | undefined;
  debug?: boolean | undefined;
}

export interface CheckResult {
  success: boolean;
  errorsCount: number;
  warningsCount: number;
  diagnostics: Diagnostic[];
}

export function check(options: CheckOptions = {}): CheckResult {
  const targetDir = normalizeDriveLetter(options.dir ? path.resolve(options.dir) : process.cwd());
  const scannedSources = options.files && options.files.length > 0 ? null : scanInputDirectory(targetDir);
  const filePaths = scannedSources ? scannedSources.mixFiles : options.files ?? [];
  const typeScriptModules = (scannedSources ? scannedSources.scriptFiles : options.files ?? []).filter(
    (filePath) => filePath.endsWith(".ts") && !filePath.endsWith(".d.ts")
  );

  const allDiagnostics: Diagnostic[] = [];
  const fileSources = new Map<string, string>();
  let errorsCount = 0;
  let warningsCount = 0;

  for (const filePath of filePaths) {
    const filename = path.basename(filePath);
    let source = "";
    try {
      source = fs.readFileSync(filePath, "utf-8");
      fileSources.set(filePath, source);
      fileSources.set(filename, source);
      const readExternalStyle = (relPath: string): string => {
        const resolved = path.resolve(path.dirname(filePath), relPath);
        return fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf-8") : "";
      };
      const ast = parse(source, { filename, readFile: readExternalStyle });
      const desc = analyze(ast, { filename, source, throwOnError: false });

      if (desc.diagnostics && desc.diagnostics.length > 0) {
        allDiagnostics.push(...desc.diagnostics);
      }

      if (filename.endsWith(".tix")) {
        const typecheckResult = typecheckTix(desc, source, {
          filename,
          baseDir: normalizeDriveLetter(path.dirname(filePath)),
          throwOnError: false
        });
        if (typecheckResult.diagnostics && typecheckResult.diagnostics.length > 0) {
          allDiagnostics.push(...typecheckResult.diagnostics);
        }
      }
    } catch (err: unknown) {
      if (err instanceof MixDiagnosticError || (err && typeof err === "object" && "diagnostic" in err)) {
        const diag = (err as { diagnostic: Diagnostic }).diagnostic;
        allDiagnostics.push(diag);
        if (options.debug && !options.silent && err instanceof Error && err.stack) {
          console.error(err.stack);
        }
      } else {
        errorsCount++;
        if (!options.silent) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] ${filename}:1:1: ${msg}`);
          if (options.debug && err instanceof Error && err.stack) {
            console.error(err.stack);
          }
        }
      }
    }
  }

  if (typeScriptModules.length > 0) {
    const scriptCheck = typecheckScriptModules(targetDir, typeScriptModules);
    if (scriptCheck.configPath === null) {
      if (!options.silent) {
        console.log("[INFO] No tsconfig.json found: .ts modules were not type-checked.");
      }
    } else {
      for (const scriptDiagnostic of scriptCheck.diagnostics) {
        if (scriptDiagnostic.severity === "error") errorsCount++;
        else warningsCount++;
        if (!options.silent) {
          const label = scriptDiagnostic.severity === "error" ? "ERROR" : "WARNING";
          console.log(
            `[${label}] TS${scriptDiagnostic.code} at ${scriptDiagnostic.file}:${scriptDiagnostic.line}:${scriptDiagnostic.column}: ${scriptDiagnostic.message}`
          );
        }
      }
    }
  }

  for (const diag of allDiagnostics) {
    if (diag.severity === "error") errorsCount++;
    else if (diag.severity === "warning") warningsCount++;

    if (!options.silent) {
      const source =
        fileSources.get(diag.span.file ?? "") ??
        fileSources.get(path.basename(diag.span.file ?? ""));
      console.log(formatCliDiagnostic(diag, source));
    }
  }

  return {
    success: errorsCount === 0,
    errorsCount,
    warningsCount,
    diagnostics: allDiagnostics,
  };
}
