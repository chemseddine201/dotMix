#!/usr/bin/env node

/**
 * @mix/cli — Command Line Executable
 */

import { check } from "./check.js";
import { build } from "./build.js";
import { create } from "./create.js";

const args = process.argv.slice(2);
const command = args[0] || "help";

switch (command) {
  case "create":
  case "init": {
    const projectName = args[1] || "my-mix-app";
    const res = create({ projectName });
    console.log(`\n✓ Created Mix project '${projectName}' in ${res.targetDir}`);
    console.log(`  Scaffolded ${res.createdFiles.length} files (layouts, pages, components, stores, permissions).`);
    break;
  }

  case "check": {
    const target = args[1];
    const checkOpts: Record<string, unknown> = {};
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

  case "build": {
    const inDir = args[1] || "src";
    const outDir = args[2] || "dist";
    const res = build({ inDir, outDir });
    console.log(`\n✓ Mix build completed successfully. (${res.compiledFiles.length} files compiled)`);
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
  mix create [name]      Scaffold a React-inspired Mix application
  mix check [dir/file]   Typecheck .tix and analyze .mix files
  mix build [src] [dist] Ahead-of-time compile components
  mix version            Display CLI version
`);
    break;
  }
}
