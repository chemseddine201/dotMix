/**
 * @dotmix/cli — `mix build` Command (Gate 37 / T-37.4 / D-162)
 */

import path from "node:path";
import type { ParsedCliArgs } from "../args.js";
import { build as runBuild } from "../build.js";
import { parsePrerenderRoutes, prerenderRoutes } from "../prerender.js";
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
  const prerenderOption = parsed.values.prerender;

  const prerenderPaths = prerenderOption !== undefined ? parsePrerenderRoutes(prerenderOption) : [];
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
