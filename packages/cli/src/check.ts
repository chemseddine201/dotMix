/**
 * @mix/cli — `mix check` (Static type checking & diagnostic verification)
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@mix/compiler-frontend";
import { analyze, typecheckTix } from "@mix/compiler-semantic";
import type { Diagnostic } from "@mix/diagnostics";

export interface CheckOptions {
  files?: string[] | undefined;
  dir?: string | undefined;
  silent?: boolean | undefined;
}

export interface CheckResult {
  success: boolean;
  errorsCount: number;
  warningsCount: number;
  diagnostics: Diagnostic[];
}

function findMixFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMixFiles(fullPath));
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".mix") || entry.name.endsWith(".tix")) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export function check(options: CheckOptions = {}): CheckResult {
  const targetDir = options.dir ? path.resolve(options.dir) : process.cwd();
  const filePaths = options.files && options.files.length > 0 ? options.files : findMixFiles(targetDir);

  const allDiagnostics: Diagnostic[] = [];
  let errorsCount = 0;
  let warningsCount = 0;

  for (const filePath of filePaths) {
    const filename = path.basename(filePath);
    try {
      const source = fs.readFileSync(filePath, "utf-8");
      const ast = parse(source, { filename });
      const desc = analyze(ast, { filename, source, throwOnError: false });

      if (desc.diagnostics && desc.diagnostics.length > 0) {
        allDiagnostics.push(...desc.diagnostics);
      }

      if (filename.endsWith(".tix")) {
        const typecheckResult = typecheckTix(desc, source, { filename, throwOnError: false });
        if (typecheckResult.diagnostics && typecheckResult.diagnostics.length > 0) {
          allDiagnostics.push(...typecheckResult.diagnostics);
        }
      }
    } catch (err: unknown) {
      errorsCount++;
      if (!options.silent) {
        console.error(`Error processing ${filePath}:`, err);
      }
    }
  }

  for (const diag of allDiagnostics) {
    if (diag.severity === "error") errorsCount++;
    else if (diag.severity === "warning") warningsCount++;

    if (!options.silent) {
      const loc = `${diag.span.file || ""}:${diag.span.start.line}:${diag.span.start.column}`;
      const prefix = diag.severity === "error" ? "ERROR" : "WARN";
      console.log(`[${prefix}] ${diag.code} at ${loc}: ${diag.message}`);
    }
  }

  return {
    success: errorsCount === 0,
    errorsCount,
    warningsCount,
    diagnostics: allDiagnostics,
  };
}
