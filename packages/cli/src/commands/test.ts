/**
 * @dotmix/cli — `mix test` Command (Gate 37 / T-37.6 / D-164 / D-169 / A1)
 * Zero-dependency native test runner integrating node:test + node:assert.
 * Component tests render through SSR; interactive DOM tests run via CDP in real Chrome/Edge.
 * Strict prohibition of happy-dom/jsdom.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ParsedCliArgs } from "../args.js";
import { colors, banner } from "../terminal.js";
import { findInstalledBrowser } from "../browser/index.js";

function collectTestFiles(dir: string, browserMode: boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const stat = fs.statSync(dir);
  if (stat.isFile()) return [dir];

  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(full, browserMode));
    } else if (entry.isFile()) {
      const isTestFile = /\.(test|spec)\.(ts|js|mjs|cjs)$/i.test(entry.name);
      if (isTestFile) {
        const isBrowserTest = /browser|e2e|dom/i.test(entry.name);
        if (browserMode ? isBrowserTest : !isBrowserTest) {
          results.push(full);
        }
      }
    }
  }

  return results;
}

export async function testCommand(parsed: ParsedCliArgs): Promise<number> {
  const browserRequested = parsed.values.browser ?? false;
  const isWatch = parsed.values.watch ?? false;
  const isCoverage = parsed.values.coverage ?? false;
  const reporter = parsed.values.format || (parsed.values.json ? "tap" : undefined);
  const positionalTargets = parsed.positional;

  if (browserRequested) {
    const installed = findInstalledBrowser();
    if (!installed) {
      console.warn(
        colors.yellow(
          "[SKIP] No compatible Chromium browser found (checked standard paths and MIX_BROWSER_PATH). Skipping browser DOM tests."
        )
      );
      // Per HAA directive A1 and D-169: exit code 2 when browser is not found
      return 2;
    }
  }

  const targetDirs = positionalTargets.length > 0 ? positionalTargets : ["tests"];
  let testFiles: string[] = [];

  for (const target of targetDirs) {
    const resolved = path.resolve(target);
    testFiles.push(...collectTestFiles(resolved, browserRequested));
  }

  // Fallback: if browserRequested is false and no test files found in tests/, check src/
  if (testFiles.length === 0 && positionalTargets.length === 0) {
    testFiles = collectTestFiles(path.resolve("src"), browserRequested);
  }

  if (testFiles.length === 0) {
    if (!parsed.values.silent) {
      console.log(colors.yellow(`No matching ${browserRequested ? "browser" : "unit/SSR"} test files found.`));
    }
    return 0;
  }

  if (!parsed.values.silent && !parsed.values.json) {
    const modeDesc = browserRequested
      ? `Real-Browser CDP Tests (Executable: ${findInstalledBrowser()})`
      : "Logic & SSR Component Tests (node:test + node:assert, zero external DOM shims)";
    console.log(banner("Test Runner", modeDesc));
    console.log(`  Running ${colors.bold(String(testFiles.length))} test file(s)...\n`);
  }

  const nodeArgs = ["--test"];

  if (isWatch) {
    nodeArgs.push("--watch");
  }
  if (isCoverage) {
    nodeArgs.push("--experimental-test-coverage");
  }
  if (reporter) {
    nodeArgs.push(`--test-reporter=${reporter}`);
  }

  nodeArgs.push(...testFiles);

  return new Promise((resolve) => {
    const testEnv = { ...process.env };
    for (const key of Object.keys(testEnv)) {
      if (key.startsWith("NODE_TEST")) {
        delete testEnv[key];
      }
    }

    const proc = spawn(process.execPath, nodeArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...testEnv,
        MIX_TEST_RUNNER: "1",
        ...(browserRequested ? { MIX_BROWSER_TESTS: "1" } : {}),
      },
    });

    if (proc.stdout) {
      proc.stdout.pipe(process.stdout, { end: false });
    }
    if (proc.stderr) {
      proc.stderr.pipe(process.stderr, { end: false });
    }

    proc.on("error", (err) => {
      console.error(colors.red(`[ERROR] Failed to spawn node test runner: ${err.message}`));
      resolve(1);
    });

    proc.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}
