/**
 * @dotmix/cli — `mix build` Command
 */

import path from "node:path";
import type { ParsedCliArgs } from "../args.js";
import { resolveCommandOptions } from "../config.js";
import { build as runBuild } from "../build.js";
import { prerenderRoutes } from "../prerender.js";
import { colors } from "../terminal.js";

export async function buildCommand(parsed: ParsedCliArgs): Promise<number> {
  if (parsed.values.target === "static") {
    console.error("--target static was removed; build with --target client and add --prerender <routes>.");
    return 2;
  }

  const options = await resolveCommandOptions(parsed, process.cwd());
  const inDir = options.build.inDir;
  const outDir = options.build.outDir;
  const target = options.build.target;
  const clean = options.build.clean;
  const sourcemap = options.build.sourcemap;
  const analyze = options.build.analyze;
  const mode = options.build.mode;
  const base = options.build.base;
  const prerenderPaths = options.build.prerenderRoutes;

  if (prerenderPaths.length > 0 && target === "ssr") {
    throw new Error("--prerender cannot be combined with --target ssr.");
  }

  const res = runBuild({ inDir, outDir, target, clean, sourcemap, analyze, mode, base });
  const prerenderedFiles = prerenderPaths.length > 0
    ? await prerenderRoutes({
        projectDirectory: path.dirname(path.resolve(inDir)),
        outputDirectory: path.resolve(outDir),
        routes: prerenderPaths,
        base
      })
    : [];

  if (parsed.values.json) {
    console.log(JSON.stringify({
      success: true,
      target,
      compiledFiles: res.compiledFiles.length,
      prerenderedFiles,
      manifestPath: res.manifestPath,
      bundleReport: res.bundleReport
    }));
    return 0;
  }

  if (!parsed.values.silent) {
    console.log(`\n${colors.green("✓")} Mix production build completed successfully. (${res.compiledFiles.length} files, target: ${target})`);
    if (prerenderedFiles.length > 0) {
      console.log(`  ${colors.dim("Prerendered:")} ${prerenderPaths.join(", ")}`);
    }
    if (res.manifestPath) {
      console.log(`  ${colors.dim("Manifest:")} ${res.manifestPath}`);
    }
    console.log(`\n${res.bundleReport.reportText}\n`);
  }
  return 0;
}
