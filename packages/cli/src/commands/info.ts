/**
 * @dotmix/cli — `mix info` Command (Gate 37 / T-37.9 / D-167)
 * System environment and toolchain diagnostic reporting.
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { ParsedCliArgs } from "../args.js";
import { colors, banner } from "../terminal.js";
import { findInstalledBrowser } from "../browser/index.js";
import { DOTMIX_VERSION } from "../version.js";

function getToolVersion(cmd: string): string | null {
  try {
    return execSync(`${cmd} --version`, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function getPackageVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  const currentPkgPath = path.resolve(process.cwd(), "package.json");
  if (fs.existsSync(currentPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(currentPkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [k, v] of Object.entries(allDeps)) {
        if (k.startsWith("@dotmix/")) {
          versions[k] = v;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }
  return versions;
}

function checkPreprocessor(name: string): boolean {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const all = { ...pkg.dependencies, ...pkg.devDependencies };
      if (all[name]) return true;
    }
    // Also check if require resolves it
    import.meta.resolve(name);
    return true;
  } catch {
    return false;
  }
}

export interface EnvironmentInfo {
  system: {
    platform: string;
    arch: string;
    release: string;
    cpus: number;
    memoryGB: string;
  };
  node: {
    version: string;
    v8: string;
  };
  packageManagers: {
    npm: string | null;
    pnpm: string | null;
    yarn: string | null;
    bun: string | null;
  };
  mix: {
    cliVersion: string;
    installedPackages: Record<string, string>;
  };
  toolchain: {
    typescript: string | null;
    sass: boolean;
    less: boolean;
    postcss: boolean;
    browserExecutable: string | null;
  };
}

export function collectEnvironmentInfo(): EnvironmentInfo {
  const cpus = os.cpus();
  return {
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpus: cpus ? cpus.length : 1,
      memoryGB: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1),
    },
    node: {
      version: process.version,
      v8: process.versions.v8,
    },
    packageManagers: {
      npm: getToolVersion("npm"),
      pnpm: getToolVersion("pnpm"),
      yarn: getToolVersion("yarn"),
      bun: getToolVersion("bun"),
    },
    mix: {
      cliVersion: DOTMIX_VERSION,
      installedPackages: getPackageVersions(),
    },
    toolchain: {
      typescript: getToolVersion("tsc") || (process.versions as Record<string, string>)["typescript"] || null,
      sass: checkPreprocessor("sass"),
      less: checkPreprocessor("less"),
      postcss: checkPreprocessor("postcss"),
      browserExecutable: findInstalledBrowser(),
    },
  };
}

export async function infoCommand(parsed: ParsedCliArgs): Promise<number> {
  const info = collectEnvironmentInfo();

  if (parsed.values.json) {
    console.log(JSON.stringify(info, null, 2));
    return 0;
  }

  if (!parsed.values.silent) {
    console.log(banner("Environment Information", "dotMix Toolchain & Host Diagnostics"));

    console.log(colors.bold("System:"));
    console.log(`  OS:      ${info.system.platform} (${info.system.arch}) ${info.system.release}`);
    console.log(`  CPU:     ${info.system.cpus} cores`);
    console.log(`  Memory:  ${info.system.memoryGB} GB\n`);

    console.log(colors.bold("Node & Toolchain:"));
    console.log(`  Node.js:    ${colors.cyan(info.node.version)}`);
    console.log(`  V8:         ${info.node.v8}`);
    console.log(`  npm:        ${info.packageManagers.npm ?? "Not installed"}`);
    if (info.packageManagers.pnpm) console.log(`  pnpm:       ${info.packageManagers.pnpm}`);
    if (info.packageManagers.yarn) console.log(`  yarn:       ${info.packageManagers.yarn}`);
    if (info.packageManagers.bun) console.log(`  bun:        ${info.packageManagers.bun}`);
    console.log(`  TypeScript: ${info.toolchain.typescript ?? "Available via workspace"}\n`);

    console.log(colors.bold("Preprocessors & Browser:"));
    console.log(`  Sass:       ${info.toolchain.sass ? colors.green("Available") : colors.dim("Not detected")}`);
    console.log(`  Less:       ${info.toolchain.less ? colors.green("Available") : colors.dim("Not detected")}`);
    console.log(`  PostCSS:    ${info.toolchain.postcss ? colors.green("Available") : colors.dim("Not detected")}`);
    console.log(
      `  Browser:    ${
        info.toolchain.browserExecutable
          ? colors.green(info.toolchain.browserExecutable)
          : colors.yellow("No compatible Chromium browser found")
      }\n`
    );

    console.log(colors.bold("dotMix Packages:"));
    console.log(`  @dotmix/cli:   ${colors.cyan(info.mix.cliVersion)}`);
    const pkgs = Object.entries(info.mix.installedPackages);
    if (pkgs.length > 0) {
      for (const [name, ver] of pkgs) {
        console.log(`  ${name.padEnd(25)} ${colors.cyan(ver)}`);
      }
    } else {
      console.log(`  ${colors.dim("(Running outside an initialized project)")}`);
    }
    console.log("");
  }

  return 0;
}
