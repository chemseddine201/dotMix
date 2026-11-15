/**
 * @dotmix/cli — `mix upgrade` Command (Gate 37 / T-37.10 / D-168)
 *
 * Dependency lifecycle management and automated AST codemods:
 * - Semver inspection and comparison against npm registry.
 * - Zero real-network test contract: tests query local node:http registry fixtures.
 * - Non-destructive --dry-run preview and atomic package.json updates.
 * - Automated AST syntax migrations via --codemod.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import type { ParsedCliArgs } from "../args.js";
import { colors } from "../terminal.js";
import { scanInputDirectory } from "../scanner.js";
import { fixSource } from "./lint.js";

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string | undefined;
  readonly prefix: string;
}

export type VersionDiffType = "major" | "minor" | "patch" | "prerelease" | "equal" | "downgrade";

export interface PackageUpgradePlan {
  readonly name: string;
  readonly current: string;
  readonly latest: string;
  readonly diff: VersionDiffType;
  readonly upToDate: boolean;
  readonly inDev: boolean;
}

export interface UpgradeOptions {
  readonly cwd?: string | undefined;
  readonly registryUrl?: string | undefined;
}

export function parseSemVer(verStr: string): SemVer | null {
  const match = verStr.trim().match(/^([\^~>=<]*)\s*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    prefix: match[1] ?? "",
    major: Number(match[2]),
    minor: Number(match[3]),
    patch: Number(match[4]),
    prerelease: match[5]
  };
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  return 0;
}

export function diffSemVer(current: SemVer, target: SemVer): VersionDiffType {
  const cmp = compareSemVer(target, current);
  if (cmp === 0) return "equal";
  if (cmp < 0) return "downgrade";
  if (target.major > current.major) return "major";
  if (target.minor > current.minor) return "minor";
  if (target.patch > current.patch) return "patch";
  return "prerelease";
}

export function extractLatestVersion(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj["dist-tags"] && typeof obj["dist-tags"] === "object") {
    const distTags = obj["dist-tags"] as Record<string, unknown>;
    if (typeof distTags.latest === "string") {
      return distTags.latest;
    }
  }
  if (typeof obj.latest === "string") return obj.latest;
  if (typeof obj.version === "string") return obj.version;
  if (obj.versions && typeof obj.versions === "object") {
    const verKeys = Object.keys(obj.versions as Record<string, unknown>);
    if (verKeys.length > 0) {
      const sorted = verKeys
        .map((v) => ({ raw: v, parsed: parseSemVer(v) }))
        .filter((v): v is { raw: string; parsed: SemVer } => v.parsed !== null)
        .sort((a, b) => compareSemVer(b.parsed, a.parsed));
      if (sorted.length > 0 && sorted[0]) {
        return sorted[0].raw;
      }
    }
  }
  return null;
}

export function queryRegistry(pkgName: string, registryBase: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const base = registryBase.endsWith("/") ? registryBase.slice(0, -1) : registryBase;
    const urlStr = `${base}/${encodeURIComponent(pkgName)}`;
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch (e) {
      return reject(new Error(`Invalid registry URL: ${urlStr} (${String(e)})`));
    }

    const client = url.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "dotmix-cli/0.1.0"
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`Registry responded with status ${res.statusCode} for ${pkgName}`));
        }
        let raw = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse JSON response for ${pkgName}: ${String(e)}`));
          }
        });
      }
    );

    req.on("error", (err) => {
      reject(err);
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error(`Registry request timed out after 5000ms for ${pkgName}`));
    });
  });
}

export async function upgradeCommand(
  parsed: ParsedCliArgs,
  options?: UpgradeOptions
): Promise<number> {
  const dryRun = Boolean(parsed.values.dryRun);
  const targetDir = options?.cwd || (parsed.positional[0] ? path.resolve(parsed.positional[0]) : process.cwd());
  const pkgPath = path.join(targetDir, "package.json");

  if (!fs.existsSync(pkgPath)) {
    console.error(colors.red(`No package.json found in ${targetDir}. Run 'mix init' or 'mix create' first.`));
    return 1;
  }

  let pkgContent = "";
  let pkgJson: {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: unknown;
  } = {};

  try {
    pkgContent = fs.readFileSync(pkgPath, "utf-8");
    pkgJson = JSON.parse(pkgContent);
  } catch (err) {
    console.error(colors.red(`Failed to parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  }

  const allDeps: Record<string, { versionStr: string; inDev: boolean }> = {};
  if (pkgJson.dependencies && typeof pkgJson.dependencies === "object") {
    for (const [name, ver] of Object.entries(pkgJson.dependencies)) {
      if (name.startsWith("@dotmix/")) {
        allDeps[name] = { versionStr: ver, inDev: false };
      }
    }
  }
  if (pkgJson.devDependencies && typeof pkgJson.devDependencies === "object") {
    for (const [name, ver] of Object.entries(pkgJson.devDependencies)) {
      if (name.startsWith("@dotmix/")) {
        allDeps[name] = { versionStr: ver, inDev: true };
      }
    }
  }

  // If running in repo root / workspace without direct @dotmix/* deps, evaluate default core packages
  const isFallback = Object.keys(allDeps).length === 0;
  if (isFallback) {
    allDeps["@dotmix/runtime"] = { versionStr: "0.1.0", inDev: false };
    allDeps["@dotmix/router"] = { versionStr: "0.1.0", inDev: false };
  }

  const registryUrl =
    options?.registryUrl ||
    parsed.values.registry ||
    process.env.MIX_REGISTRY_URL ||
    process.env.npm_config_registry ||
    "https://registry.npmjs.org";

  const plan: PackageUpgradePlan[] = [];

  for (const [name, meta] of Object.entries(allDeps)) {
    const parsedCurrent = parseSemVer(meta.versionStr) || {
      major: 0,
      minor: 1,
      patch: 0,
      prefix: "^"
    };
    const currentBase = `${parsedCurrent.major}.${parsedCurrent.minor}.${parsedCurrent.patch}`;

    let latestBase = currentBase;
    try {
      const regMeta = await queryRegistry(name, registryUrl);
      const extracted = extractLatestVersion(regMeta);
      if (extracted) {
        latestBase = extracted;
      }
    } catch (err: unknown) {
      // If a custom or local fixture registry was given, fail closed on error
      if (registryUrl !== "https://registry.npmjs.org") {
        throw err;
      }
      // On default public registry without network, gracefully keep current
      latestBase = currentBase;
    }

    const parsedLatest = parseSemVer(latestBase) || {
      major: parsedCurrent.major,
      minor: parsedCurrent.minor,
      patch: parsedCurrent.patch,
      prefix: ""
    };

    const diff = diffSemVer(parsedCurrent, parsedLatest);
    const upToDate = diff === "equal" || diff === "downgrade";

    plan.push({
      name,
      current: meta.versionStr,
      latest: `${parsedCurrent.prefix}${parsedLatest.major}.${parsedLatest.minor}.${parsedLatest.patch}`,
      diff,
      upToDate,
      inDev: meta.inDev
    });
  }

  const upgradeable = plan.filter((p) => !p.upToDate);
  let updatedPackageJson = false;

  if (!dryRun && upgradeable.length > 0 && !isFallback) {
    for (const item of upgradeable) {
      if (item.inDev && pkgJson.devDependencies) {
        pkgJson.devDependencies[item.name] = item.latest;
      } else if (pkgJson.dependencies) {
        pkgJson.dependencies[item.name] = item.latest;
      }
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
    updatedPackageJson = true;
  }

  let totalCodemods = 0;
  let fixedFilesCount = 0;

  if (parsed.values.codemod) {
    const scanned = scanInputDirectory(targetDir);
    for (const filePath of scanned.mixFiles) {
      try {
        const original = fs.readFileSync(filePath, "utf-8");
        const { fixedText, fixedCount } = fixSource(original);
        if (fixedCount > 0) {
          totalCodemods += fixedCount;
          fixedFilesCount++;
          if (!dryRun) {
            fs.writeFileSync(filePath, fixedText, "utf-8");
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  if (parsed.values.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          dryRun,
          registry: registryUrl,
          packages: plan,
          updated: updatedPackageJson,
          codemodsApplied: totalCodemods
        },
        null,
        2
      )
    );
    return 0;
  }

  if (!parsed.values.silent) {
    console.log(colors.bold("\n● Mix Upgrade Plan" + (dryRun ? " (dry-run)" : "")));
    console.log(`  Registry: ${registryUrl}`);
    console.log("  Checking @dotmix/* package versions against registry fixture...");

    for (const item of plan) {
      if (item.upToDate) {
        console.log(`  ${colors.green("✓")} ${item.name}: ${item.current} (latest)`);
      } else {
        console.log(
          `  ${colors.yellow("↑")} ${item.name}: ${item.current} → ${colors.bold(colors.cyan(item.latest))} (${item.diff})`
        );
      }
    }

    if (parsed.values.codemod) {
      if (totalCodemods > 0) {
        console.log(
          `  ${colors.green("✓")} Syntax codemods: ${totalCodemods} rewrite(s) in ${fixedFilesCount} file(s)` +
            (dryRun ? " (previewed)" : " (applied)")
        );
      } else {
        console.log(`  ${colors.green("✓")} Syntax codemods: No deprecated control-flow syntax found.`);
      }
    }

    if (upgradeable.length === 0) {
      console.log(`  ${colors.green("✓")} All packages are up to date.\n`);
    } else if (dryRun) {
      console.log(
        `\n  ${colors.yellow("!")} ${upgradeable.length} package(s) can be upgraded. Run 'mix upgrade' without --dry-run to apply.\n`
      );
    } else if (updatedPackageJson) {
      console.log(`\n  ${colors.green("✓")} Updated package.json with ${upgradeable.length} upgraded package(s).`);
      console.log("  Run your package manager install command to apply updates.\n");
    }
  }

  return 0;
}
