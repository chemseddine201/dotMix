#!/usr/bin/env node

/**
 * @dotmix/cli — Command Line Executable & Dispatcher
 */

import fs from "node:fs";
import path from "node:path";
import { formatCliDiagnostic, MixDiagnosticError, type Diagnostic } from "@dotmix/diagnostics";
import { parseCliArguments } from "./args.js";
import { colors, banner } from "./terminal.js";
import { createCommand } from "./commands/create.js";
import { devCommand } from "./commands/dev.js";
import { buildCommand } from "./commands/build.js";
import { checkCommand } from "./commands/check.js";
import { addCommand } from "./commands/add.js";
import { DOTMIX_VERSION } from "./version.js";

const parsed = parseCliArguments(process.argv.slice(2));

function printHelp(): void {
  console.log(banner("CLI", "Compiler-Native UI Framework with Surgical DOM Reactivity"));
  console.log(`
${colors.bold("USAGE:")}
  ${colors.cyan("mix")} <command> [options]

${colors.bold("CORE COMMANDS:")}
  ${colors.green("create, init")}     Scaffold a new Mix project (--ts/--js, --scss/--less/--css)
  ${colors.green("dev")}              Start development server with SSE HMR & SPA fallback
  ${colors.green("build")}            Ahead-of-time compile & bundle production assets
  ${colors.green("check")}            Typecheck .tix and analyze .mix components
  ${colors.green("preview")}          Serve production dist/ with gzip/brotli & SPA routing
  ${colors.green("test")}             Execute zero-dependency tests (logic, SSR, CDP browser)
  ${colors.green("lint")}             Audit unused imports, slots, and deprecated syntax
  ${colors.green("add, generate")}    Atomically scaffold components, pages, stores, layouts
  ${colors.green("info")}             Display environment and diagnostics info
  ${colors.green("doctor")}           Run 10 automated health checks on configuration
  ${colors.green("upgrade")}          Check and upgrade @dotmix/* packages safely

${colors.bold("GLOBAL OPTIONS:")}
  ${colors.yellow("-h, --help")}       Show this help message
  ${colors.yellow("-v, --version")}    Print dotMix version
  ${colors.yellow("--debug")}          Print full stack traces on error
  ${colors.yellow("--json")}           Output results as machine-readable JSON
  ${colors.yellow("--silent")}         Suppress non-essential terminal outputs
`);
}

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

export async function dispatch(): Promise<number> {
  if (parsed.values.help || parsed.command === "help") {
    printHelp();
    return 0;
  }

  if (parsed.values.version || parsed.command === "version") {
    if (parsed.values.json) {
      console.log(JSON.stringify({ name: "@dotmix/cli", version: DOTMIX_VERSION }));
    } else {
      console.log(`dotMix v${DOTMIX_VERSION}`);
    }
    return 0;
  }

  switch (parsed.command) {
    case "create":
    case "init":
      return await createCommand(parsed);

    case "dev":
      return await devCommand(parsed);

    case "build":
      return await buildCommand(parsed);

    case "check":
      return await checkCommand(parsed);

    case "add":
    case "generate":
      return await addCommand(parsed);

    case "preview":
      return await (await import("./commands/preview.js")).previewCommand(parsed);

    case "test":
      return await (await import("./commands/test.js")).testCommand(parsed);

    case "lint":
      return await (await import("./commands/lint.js")).lintCommand(parsed);

    case "info":
      return await (await import("./commands/info.js")).infoCommand(parsed);

    case "doctor":
      return await (await import("./commands/doctor.js")).doctorCommand(parsed);

    case "upgrade":
      return await (await import("./commands/upgrade.js")).upgradeCommand(parsed);

    default:
      console.error(colors.red(`Unknown command: '${parsed.command}'. Run 'mix --help' for usage.`));
      return 2;
  }
}

dispatch()
  .then((exitCode) => {
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  })
  .catch((err: unknown) => {
    if (err instanceof MixDiagnosticError || (err && typeof err === "object" && "diagnostic" in err)) {
      const diag = (err as { diagnostic: Diagnostic }).diagnostic;
      const searchDir = parsed.positional[0] ? path.resolve(parsed.positional[0]) : process.cwd();
      const source = findSourceForDiagnostic(diag.span.file, searchDir);
      console.error(formatCliDiagnostic(diag, source));
      if (parsed.values.debug && err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(colors.red(`[ERROR] ${msg}`));
      if (parsed.values.debug && err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    }
    process.exit(1);
  });
