import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { create, build } from "../../node_modules/@dotmix/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliBinPath = path.resolve(__dirname, "../../packages/cli/dist/bin.js");

describe(": Production Bundler, Lazy Route Code-Splitting, Minification, Hashed Assets & Bundle Report", () => {
  it("1. build() emits one content-hashed module per source module, an import map with modulepreload, the hashed stylesheet and bundle-report.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-build-bundle-"));
    const appDir = path.join(tmpDir, "bundle-app");

    try {
      create({
        projectName: "bundle-app",
        targetDir: appDir,
        typescript: true,
        styleFormat: "scss"
      });

      const inDir = path.join(appDir, "src");
      const outDir = path.join(appDir, "dist");
      const res = build({ inDir, outDir });

      assert.strictEqual(res.success, true);
      assert.ok(res.bundleReport, "build() must return a bundleReport object");
      assert.ok(Array.isArray(res.bundleReport.chunks), "bundleReport.chunks must be an array");
      assert.ok(Array.isArray(res.bundleReport.assets), "bundleReport.assets must be an array");
      assert.ok(res.bundleReport.totalBytes > 0, "bundleReport.totalBytes must be > 0");
      assert.ok(res.bundleReport.totalGzipBytes > 0, "bundleReport.totalGzipBytes must be > 0");
      assert.ok(
        typeof res.bundleReport.reportText === "string" && res.bundleReport.reportText.includes("gzip"),
        "bundleReport.reportText must contain a formatted size table with gzip sizes"
      );

      // Verify dist/bundle-report.json exists on disk
      const reportJsonPath = path.join(outDir, "bundle-report.json");
      assert.ok(fs.existsSync(reportJsonPath), "dist/bundle-report.json must be emitted");

      // Verify hashed entry chunk and lazy route chunks in dist/assets/
      const assetsDir = path.join(outDir, "assets");
      assert.ok(fs.existsSync(assetsDir), "dist/assets/ directory must exist");
      const assetFiles = fs.readdirSync(assetsDir);

      const mainChunk = assetFiles.find((f) => /^main-[a-f0-9]{8}\.js$/.test(f));
      assert.ok(mainChunk, `Expected hashed main-<hash>.js chunk in dist/assets/, got: ${assetFiles.join(", ")}`);

      const pagesDirectory = path.join(assetsDir, "pages");
      const pageFiles = fs.existsSync(pagesDirectory) ? fs.readdirSync(pagesDirectory) : [];
      const tasksChunks = pageFiles.filter((f) => /^TasksPage-[a-f0-9]{8}\.js$/.test(f));
      const formsChunks = pageFiles.filter((f) => /^FormsPage-[a-f0-9]{8}\.js$/.test(f));
      assert.strictEqual(tasksChunks.length, 1, `Expected one module assets/pages/TasksPage-<hash>.js, got: ${pageFiles.join(", ")}`);
      assert.strictEqual(formsChunks.length, 1, `Expected one module assets/pages/FormsPage-<hash>.js, got: ${pageFiles.join(", ")}`);
      const tasksChunk = tasksChunks[0];
      const formsChunk = formsChunks[0];

      const cssAsset = assetFiles.find((f) => /^styles-[a-f0-9]{8}\.css$/.test(f));
      assert.ok(cssAsset, `Expected hashed CSS bundle styles-<hash>.css, got: ${assetFiles.join(", ")}`);

      // The import map of index.html maps every unhashed module URL to its hashed file, and the
      // entry's static graph (which reaches both pages) is preloaded.
      const indexHtml = fs.readFileSync(path.join(outDir, "index.html"), "utf-8");
      const importMapStart = indexHtml.indexOf('<script type="importmap">') + '<script type="importmap">'.length;
      const importMap = JSON.parse(indexHtml.slice(importMapStart, indexHtml.indexOf("</script>", importMapStart)));
      assert.strictEqual(importMap.imports["/assets/main.js"], `/assets/${mainChunk}`);
      assert.strictEqual(importMap.imports["/assets/pages/TasksPage.js"], `/assets/pages/${tasksChunk}`);
      assert.strictEqual(importMap.imports["/assets/pages/FormsPage.js"], `/assets/pages/${formsChunk}`);
      assert.ok(indexHtml.includes(`<link rel="modulepreload" href="/assets/pages/${tasksChunk}">`), "TasksPage must be preloaded");
      assert.ok(indexHtml.includes(`<link rel="modulepreload" href="/assets/pages/${formsChunk}">`), "FormsPage must be preloaded");
      assert.ok(indexHtml.includes(`<script type="module" src="/assets/${mainChunk}"></script>`), "index.html must load the hashed entry");

      // No emitted module contains file:// specifiers, and the report lists every emitted module
      const emittedModules = fs
        .readdirSync(assetsDir, { recursive: true })
        .filter((f) => String(f).endsWith(".js"))
        .map((f) => String(f).split(path.sep).join("/"));
      for (const emittedModule of emittedModules) {
        const moduleCode = fs.readFileSync(path.join(assetsDir, emittedModule), "utf-8");
        assert.strictEqual(moduleCode.includes("file://"), false, `${emittedModule} must not contain file:// specifiers`);
      }
      const reportedFiles = res.bundleReport.chunks.map((chunk) => chunk.file).sort();
      assert.deepStrictEqual(reportedFiles, emittedModules.map((f) => `assets/${f}`).sort());
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("2. CLI `mix build src dist` prints the bundle-size report to stdout", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cli-build-report-"));
    const appDir = path.join(tmpDir, "cli-app");

    try {
      create({
        projectName: "cli-app",
        targetDir: appDir,
        typescript: false,
        styleFormat: "css"
      });

      const proc = spawnSync(
        globalThis.process.execPath,
        [cliBinPath, "build", "src", "dist"],
        { cwd: appDir, encoding: "utf-8" }
      );

      assert.strictEqual(proc.status, 0, `mix build exited with ${proc.status}: ${proc.stderr}`);
      assert.ok(
        proc.stdout.includes("Bundle Size Report") && proc.stdout.includes("gzip"),
        `Expected CLI stdout to print Bundle Size Report with gzip metrics, got:\n${proc.stdout}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
