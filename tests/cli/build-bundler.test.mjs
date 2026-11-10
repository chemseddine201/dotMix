import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { create, build } from "../../packages/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliBinPath = path.resolve(__dirname, "../../packages/cli/dist/bin.js");

describe("Gate 29 (T-29.2): Production Bundler, Lazy Route Code-Splitting, Minification, Hashed Assets & Bundle Report", () => {
  it("1. build() bundles entry, splits lazy routes into content-hashed chunks, minifies output, and emits bundle-report.json", () => {
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

      const tasksChunk = assetFiles.find((f) => /^TasksPage-[a-f0-9]{8}\.js$/.test(f));
      const formsChunk = assetFiles.find((f) => /^FormsPage-[a-f0-9]{8}\.js$/.test(f));
      assert.ok(tasksChunk, `Expected code-split lazy route chunk TasksPage-<hash>.js, got: ${assetFiles.join(", ")}`);
      assert.ok(formsChunk, `Expected code-split lazy route chunk FormsPage-<hash>.js, got: ${assetFiles.join(", ")}`);

      const cssAsset = assetFiles.find((f) => /^styles-[a-f0-9]{8}\.css$/.test(f));
      assert.ok(cssAsset, `Expected hashed CSS bundle styles-<hash>.css, got: ${assetFiles.join(", ")}`);

      // Verify main bundle references the hashed lazy route chunks and contains no file:/// specifiers
      const mainCode = fs.readFileSync(path.join(assetsDir, mainChunk), "utf-8");
      assert.ok(
        mainCode.includes(`./${tasksChunk}`),
        `Main bundle must dynamically import ./${tasksChunk}`
      );
      assert.ok(
        mainCode.includes(`./${formsChunk}`),
        `Main bundle must dynamically import ./${formsChunk}`
      );
      assert.strictEqual(mainCode.includes("file://"), false, "Bundled JS must not contain file:// specifiers");
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
