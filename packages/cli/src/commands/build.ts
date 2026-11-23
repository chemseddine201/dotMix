/**
 * @dotmix/cli — `mix build` Command
 */

import path from "node:path";
import type { ParsedCliArgs } from "../args.js";
import { resolveCommandOptions } from "../config.js";
import { build as runBuild } from "../build.js";
import { prerenderRoutes } from "../prerender.js";
import { runStaticSiteBuild } from "../static-build.js";
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
  const isStatic = options.build.isStatic;
  const prerenderBrowser = options.build.prerenderBrowser;
  const clean = options.build.clean;
  const sourcemap = options.build.sourcemap;
  const analyze = options.build.analyze;
  const mode = options.build.mode;
  const base = options.build.base;
  const prerenderPaths = options.build.prerenderRoutes;

  if ((isStatic || prerenderPaths.length > 0) && target === "ssr") {
    throw new Error("--static / --prerender cannot be combined with --target ssr.");
  }

  if (isStatic && !prerenderBrowser) {
    const staticRes = await runStaticSiteBuild({
      inDir,
      outDir,
      clean,
      sourcemap,
      analyze,
      mode,
      base,
      config: options.config,
      filterRoutes: prerenderPaths
    });

    if (parsed.values.json) {
      console.log(JSON.stringify({
        success: true,
        target: "static",
        compiledFiles: staticRes.buildResult.compiledFiles.length,
        staticRoutes: staticRes.routes,
        sitemapPath: staticRes.sitemapPath,
        robotsPath: staticRes.robotsPath,
        cspManifestPath: staticRes.cspManifestPath,
        headersPath: staticRes.headersPath,
        manifestPath: staticRes.buildResult.manifestPath,
        bundleReport: staticRes.buildResult.bundleReport
      }));
      return 0;
    }

    if (!parsed.values.silent) {
      console.log(`\n${colors.green("✓")} Mix static site build completed (${staticRes.routes.length} routes, 0 Chromium required).`);
      for (const r of staticRes.routes) {
        console.log(`  ${colors.dim(r.route.padEnd(20))} ${r.mode.padEnd(8)} ${r.jsBytes} B JS -> ${r.file}`);
      }
      if (staticRes.sitemapPath) console.log(`  ${colors.dim("Sitemap:")} ${staticRes.sitemapPath}`);
      if (staticRes.robotsPath) console.log(`  ${colors.dim("Robots:")} ${staticRes.robotsPath}`);
      if (staticRes.cspManifestPath) console.log(`  ${colors.dim("CSP:")} ${staticRes.cspManifestPath}`);
      if (staticRes.headersPath) console.log(`  ${colors.dim("Headers:")} ${staticRes.headersPath}`);
      console.log("");
    }
    return 0;
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
