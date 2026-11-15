/**
 * @dotmix/cli — `mix build` Command (Gate 37 / T-37.4 / D-162)
 */

import type { ParsedCliArgs } from "../args.js";
import { build as runBuild } from "../build.js";
import { colors } from "../terminal.js";

export async function buildCommand(parsed: ParsedCliArgs): Promise<number> {
  const inDir = parsed.positional[0] || "src";
  const outDir = parsed.positional[1] || "dist";
  const target = (parsed.values.target as "client" | "ssr" | "static") || "client";
  const clean = Boolean(parsed.values.clean);
  const sourcemap = Boolean(parsed.values.sourcemap);
  const analyze = Boolean(parsed.values.analyze);
  const mode = parsed.values.mode || "production";
  const base = parsed.values.base;

  const res = runBuild({ inDir, outDir, target, clean, sourcemap, analyze, mode, base });

  if (parsed.values.json) {
    console.log(JSON.stringify({
      success: true,
      target,
      compiledFiles: res.compiledFiles.length,
      manifestPath: res.manifestPath,
      bundleReport: res.bundleReport
    }));
    return 0;
  }

  if (!parsed.values.silent) {
    console.log(`\n${colors.green("✓")} Mix production build completed successfully. (${res.compiledFiles.length} files, target: ${target})`);
    if (res.manifestPath) {
      console.log(`  ${colors.dim("Manifest:")} ${res.manifestPath}`);
    }
    console.log(`\n${res.bundleReport.reportText}\n`);
  }
  return 0;
}
