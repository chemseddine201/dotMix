#!/usr/bin/env node

/**
 * @mix/cli — Command Line Executable
 */

import fs from "node:fs";
import path from "node:path";
import { formatCliDiagnostic, MixDiagnosticError, type Diagnostic } from "@mix/diagnostics";
import { check } from "./check.js";
import { build } from "./build.js";
import { create } from "./create.js";
import { createDevServer } from "./dev.js";

const rawArgs = process.argv.slice(2);
const debug = rawArgs.includes("--debug");
const args = rawArgs.filter((a) => a !== "--debug");
const command = args[0] || "help";

function findSourceForDiagnostic(fileRef: string | undefined, searchDir: string): string | undefined {
  if (!fileRef) return undefined;
  if (fs.existsSync(fileRef) && fs.statSync(fileRef).isFile()) {
    return fs.readFileSync(fileRef, "utf-8");
  }
  const directInSearch = path.resolve(searchDir, fileRef);
  if (fs.existsSync(directInSearch) && fs.statSync(directInSearch).isFile()) {
    return fs.readFileSync(directInSearch, "utf-8");
  }
  if (fs.existsSync(searchDir) && fs.statSync(searchDir).isDirectory()) {
    const entries = fs.readdirSync(searchDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      const full = path.join(searchDir, entry.name);
      if (entry.isDirectory()) {
        const found = findSourceForDiagnostic(fileRef, full);
        if (found !== undefined) return found;
      } else if (entry.isFile() && entry.name === path.basename(fileRef)) {
        return fs.readFileSync(full, "utf-8");
      }
    }
  }
  return undefined;
}

try {
switch (command) {
  case "create":
  case "init": {
    let projectName = "my-mix-app";
    let targetDir: string | undefined;
    let typescript = true;
    let styleFormat: "scss" | "sass" | "less" | "pcss" | "css" = "scss";

    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--js" || arg === "--javascript") {
        typescript = false;
      } else if (arg === "--ts" || arg === "--typescript") {
        typescript = true;
      } else if (arg === "--scss") {
        styleFormat = "scss";
      } else if (arg === "--less") {
        styleFormat = "less";
      } else if (arg === "--css") {
        styleFormat = "css";
      } else if (arg === "--sass") {
        styleFormat = "sass";
      } else if (arg === "--pcss") {
        styleFormat = "pcss";
      } else if (arg === "--target" || arg === "-d") {
        targetDir = args[++i];
      } else if (!arg.startsWith("-")) {
        projectName = arg;
      }
    }

    const res = create({ projectName, targetDir, typescript, styleFormat });
    console.log(`\n✓ Created Mix project '${projectName}' in ${res.targetDir}`);
    console.log(`  Scaffolded ${res.createdFiles.length} files (${typescript ? "TypeScript .tix" : "JavaScript .mix"}, ${styleFormat.toUpperCase()}).`);
    console.log(`  Includes layouts, pages, components, stores, permissions, and tests.\n`);
    console.log(`Next steps:\n  cd ${projectName}\n  npm install\n  npm run dev\n`);
    break;
  }

  case "check": {
    const target = args[1];
    const checkOpts: Record<string, unknown> = { debug };
    if (target) {
      if (target.endsWith(".mix") || target.endsWith(".tix")) {
        checkOpts.files = [target];
      } else {
        checkOpts.dir = target;
      }
    }
    const res = check(checkOpts);
    if (!res.success) {
      process.exit(1);
    }
    console.log(`\n✓ Mix check passed with 0 errors (${res.warningsCount} warnings).`);
    break;
  }

  case "dev": {
    let rootDir = process.cwd();
    let port = 3000;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--port" || arg === "-p") {
        port = Number(args[++i] || 3000);
      } else if (!arg.startsWith("-")) {
        rootDir = arg;
      }
    }
    await createDevServer({ rootDir, port });
    break;
  }

  case "build": {
    const inDir = args[1] || "src";
    const outDir = args[2] || "dist";
    const res = build({ inDir, outDir });
    console.log(`\n✓ Mix build completed successfully. (${res.compiledFiles.length} files compiled)`);
    console.log(`\n${res.bundleReport.reportText}\n`);
    break;
  }

  case "version":
  case "-v":
  case "--version": {
    console.log("Mix/Tix Framework v0.1.0");
    break;
  }

  case "help":
  case "-h":
  case "--help":
  default: {
    console.log(`
Mix/Tix Framework CLI

Usage:
  mix create [name] [options]  Scaffold a React-inspired Mix application
                               Options: --ts (default) | --js
                                        --scss (default) | --less | --css
                                        --target <dir>
  mix check [dir/file]         Typecheck .tix and analyze .mix files
  mix dev [dir] [--port 3000]  Start development server with HMR
  mix build [src] [dist]       Ahead-of-time compile and bundle components
  mix version                  Display CLI version
`);
    break;
  }
}
} catch (err: unknown) {
  if (err instanceof MixDiagnosticError || (err && typeof err === "object" && "diagnostic" in err)) {
    const diag = (err as { diagnostic: Diagnostic }).diagnostic;
    const searchDir = args[1] ? path.resolve(args[1]) : process.cwd();
    const source = findSourceForDiagnostic(diag.span.file, searchDir);
    console.error(formatCliDiagnostic(diag, source));
    if (debug && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] ${msg}`);
    if (debug && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  }
  process.exit(1);
}
