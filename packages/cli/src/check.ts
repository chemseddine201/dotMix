/**
 * @mix/cli — `mix check` (Static type checking & diagnostic verification)
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@mix/compiler-frontend";
import { analyze, typecheckTix } from "@mix/compiler-semantic";
import {
  formatCliDiagnostic,
  MixDiagnosticError,
  type Diagnostic
} from "@mix/diagnostics";
import { scanInputDirectory } from "./scanner.js";

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
  const targetDir = options.dir ? path.resolve(options.dir) : process.cwd();
  const filePaths = options.files && options.files.length > 0 ? options.files : scanInputDirectory(targetDir).mixFiles;

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
          baseDir: path.dirname(filePath),
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
