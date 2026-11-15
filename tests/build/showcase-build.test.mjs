import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { build } from "../../packages/cli/dist/index.js";
import { listFiles, readImportMap, readModulePreloadHrefs } from "./build-project.mjs";

const showcaseDirectory = path.resolve("examples/showcase");
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-showcase-build-"));

test.after(() => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
});

test("the showcase production build", async (context) => {
  build({
    inDir: path.join(showcaseDirectory, "src"),
    outDir: outputDirectory,
    clean: true,
    silent: true
  });
  const emittedModules = listFiles(path.join(outputDirectory, "assets")).filter((filePath) =>
    filePath.endsWith(".js")
  );

  await context.test("node --check passes on every emitted module", () => {
    assert.ok(emittedModules.length > 0, "Expected emitted modules in dist/assets");
    const failures = [];
    for (const modulePath of emittedModules) {
      const check = spawnSync(process.execPath, ["--check", modulePath], { encoding: "utf-8" });
      if (check.status !== 0) failures.push(`${modulePath}\n${check.stderr}`);
    }
    assert.deepEqual(failures, []);
  });

  await context.test("the import map lists every emitted module", () => {
    const mappedTargets = new Set(Object.values(readImportMap(outputDirectory).imports));
    const unmapped = emittedModules
      .map((modulePath) => `/${path.relative(outputDirectory, modulePath).split(path.sep).join("/")}`)
      .filter((moduleUrl) => !mappedTargets.has(moduleUrl));
    assert.deepEqual(unmapped, []);
  });

  await context.test("every modulepreload href exists on disk", () => {
    const hrefs = readModulePreloadHrefs(outputDirectory);
    assert.ok(hrefs.length > 0, "Expected modulepreload links for the entry graph");
    const missing = hrefs.filter((href) => !fs.existsSync(path.join(outputDirectory, ...href.slice(1).split("/"))));
    assert.deepEqual(missing, []);
  });
});
