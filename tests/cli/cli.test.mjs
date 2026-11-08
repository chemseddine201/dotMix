import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runCli, createMixPlugin } from "../../bin/mix.mjs";

test("Phase 5 Compiler CLI & Bundler Plugin Conformance", async (t) => {
  const tmpDir = resolve("tests/cli/__tmp__");
  mkdirSync(tmpDir, { recursive: true });

  t.after(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // 1. Version command
  await t.test("mix version returns 0", () => {
    const code = runCli(["version"]);
    assert.equal(code, 0);
  });

  // 2. Help command
  await t.test("mix --help returns 0", () => {
    const code = runCli(["--help"]);
    assert.equal(code, 0);
  });

  // 3. Compile command with --out
  await t.test("mix compile generates JS, CSS, and SourceMap", () => {
    const sampleMix = resolve(tmpDir, "Sample.mix");
    const source = `<script>
  let count = signal(0);
  function inc() { count.set(c => c + 1); }
</script>
<style>
  .btn { color: red; }
</style>
<button on:click={inc}>{count()}</button>`;

    writeFileSync(sampleMix, source, "utf8");

    const outDir = resolve(tmpDir, "dist");
    const exitCode = runCli(["compile", sampleMix, "--out", outDir]);
    assert.equal(exitCode, 0);

    const jsFile = resolve(outDir, "Sample.js");
    const cssFile = resolve(outDir, "Sample.css");
    const mapFile = resolve(outDir, "Sample.js.map");

    assert.ok(existsSync(jsFile), "Sample.js should exist");
    assert.ok(existsSync(cssFile), "Sample.css should exist");
    assert.ok(existsSync(mapFile), "Sample.js.map should exist");

    const jsContent = readFileSync(jsFile, "utf8");
    assert.ok(jsContent.includes("export function Sample"));
    assert.ok(jsContent.includes("__scope.inc = inc;"));

    const cssContent = readFileSync(cssFile, "utf8");
    assert.ok(cssContent.includes(".btn[data-mix-"));

    const mapContent = JSON.parse(readFileSync(mapFile, "utf8"));
    assert.equal(mapContent.version, 3);
    assert.equal(mapContent.file, "Sample.js");
  });

  // 4. Check command
  await t.test("mix check validates component syntax", () => {
    const validMix = resolve(tmpDir, "Valid.mix");
    writeFileSync(validMix, `<script>let x = signal(1);</script><span>{x()}</span>`, "utf8");
    const validExit = runCli(["check", validMix]);
    assert.equal(validExit, 0);

    const invalidMix = resolve(tmpDir, "Invalid.mix");
    writeFileSync(invalidMix, `<script>let y = 1;</script><div><span>Unclosed`, "utf8");
    const invalidExit = runCli(["check", invalidMix]);
    assert.equal(invalidExit, 1);
  });

  // 5. Bundler Plugin (Vite / Rollup)
  await t.test("createMixPlugin transforms .mix and .tix files", () => {
    const plugin = createMixPlugin();
    assert.equal(plugin.name, "mix-framework-plugin");

    // Non-mix file is ignored
    assert.equal(plugin.transform("const a = 1;", "index.js"), null);

    // .mix file is transformed
    const source = `<script>let v = signal(10);</script><span>{v()}</span>`;
    const transformed = plugin.transform(source, "Widget.mix");
    assert.ok(transformed);
    assert.ok(transformed.code.includes("export function Widget"));
    assert.ok(transformed.map);
    assert.equal(transformed.map.version, 3);
  });

});

