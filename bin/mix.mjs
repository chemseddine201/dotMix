#!/usr/bin/env node

/**
 * Mix / Tix Framework Compiler CLI & Bundler Plugin (Phase 5)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parse } from "../packages/compiler-frontend/dist/index.js";
import { analyze, formatDiagnostic } from "../packages/compiler-semantic/dist/index.js";
import { generate } from "../packages/compiler-codegen/dist/index.js";

/**
 * Executes CLI commands programmatically.
 */
export function runCli(argv = process.argv.slice(2)) {
  const [command, file, ...flags] = argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(`Mix / Tix Framework Compiler CLI
Usage:
  mix compile <file> [--out <dir>]   Compile a .mix or .tix component
  mix check <file>                   Check diagnostics with rich source frames
  mix version                        Display current framework version
`);
    return 0;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log("mix-framework v0.5.0");
    return 0;
  }

  if (command === "check") {
    if (!file) {
      console.error("Error: Please specify a file to check.");
      return 1;
    }
    const fullPath = resolve(file);
    const content = readFileSync(fullPath, "utf8");
    const filename = basename(fullPath);

    let ast;
    try {
      ast = parse(content, filename);
    } catch (err) {
      console.error(`error[MIX_ERR_PARSE_SYNTAX]: ${err.message}`);
      return 1;
    }

    const descriptor = analyze(ast);

    if (descriptor.diagnostics.length === 0) {
      console.log(`✓ No diagnostics for ${filename}`);
      return 0;
    }

    for (const diag of descriptor.diagnostics) {
      console.log(formatDiagnostic(content, diag, filename));
    }

    const hasErrors = descriptor.diagnostics.some((d) => d.severity === "error");
    return hasErrors ? 1 : 0;
  }

  if (command === "compile") {
    if (!file) {
      console.error("Error: Please specify a file to compile.");
      return 1;
    }
    const fullPath = resolve(file);
    const content = readFileSync(fullPath, "utf8");
    const filename = basename(fullPath);
    const componentName = filename.replace(/\.(mix|tix)$/, "");

    let ast;
    try {
      ast = parse(content, filename);
    } catch (err) {
      console.error(`error[MIX_ERR_PARSE_SYNTAX]: ${err.message}`);
      return 1;
    }

    const descriptor = analyze(ast);

    for (const diag of descriptor.diagnostics) {
      console.warn(formatDiagnostic(content, diag, filename));
    }

    const result = generate(descriptor, {
      componentName,
      filename,
      source: content
    });

    const outFlagIdx = flags.indexOf("--out");
    if (outFlagIdx !== -1 && flags[outFlagIdx + 1]) {
      const outDir = resolve(flags[outFlagIdx + 1]);
      mkdirSync(outDir, { recursive: true });

      const jsPath = resolve(outDir, `${componentName}.js`);
      writeFileSync(jsPath, result.code, "utf8");

      if (result.css) {
        const cssPath = resolve(outDir, `${componentName}.css`);
        writeFileSync(cssPath, result.css, "utf8");
      }

      if (result.sourceMap) {
        const mapPath = resolve(outDir, `${componentName}.js.map`);
        writeFileSync(mapPath, JSON.stringify(result.sourceMap, null, 2), "utf8");
      }

      console.log(`✓ Compiled ${filename} -> ${outDir}`);
    } else {
      process.stdout.write(result.code);
    }
    return 0;
  }

  console.error(`Unknown command: "${command}". Run 'mix --help' for usage.`);
  return 1;
}

/**
 * Lightweight bundler transform plugin for Vite / Rollup.
 */
export function createMixPlugin(_options = {}) {
  return {
    name: "mix-framework-plugin",
    transform(source, id) {
      if (!/\.(mix|tix)$/.test(id)) return null;

      const filename = basename(id);
      const componentName = filename.replace(/\.(mix|tix)$/, "");

      const ast = parse(source, filename);
      const descriptor = analyze(ast);
      const result = generate(descriptor, {
        componentName,
        filename,
        source
      });

      return {
        code: result.code,
        map: result.sourceMap
      };
    }
  };
}

// Direct execution from CLI
const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith("mix.mjs") ||
  process.argv[1].endsWith("mix")
);

if (isDirectExecution) {
  const exitCode = runCli();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
