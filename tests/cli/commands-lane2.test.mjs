/* global process, fetch */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const binPath = path.join(repoRoot, "packages/cli/dist/bin.js");

function runCli(args, env = {}) {
  const res = spawnSync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

describe(" Task 2.2: Lane 2 Commands (preview, test, lint, info, doctor)", () => {
  // 1.: Preview Server
  describe(": mix preview", () => {
    it("fails with exit code 1 if dist directory does not exist", () => {
      const res = runCli(["preview", "definitely-nonexistent-dist-dir"]);
      assert.equal(res.status, 1);
      assert.match(res.stderr + res.stdout, /not found\. Run 'mix build'/);
    });

    it("serves static assets, SPA route fallbacks, and compression headers", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-preview-test-"));
      const assetsDir = path.join(tmpDir, "assets");
      fs.mkdirSync(assetsDir, { recursive: true });

      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        "<!DOCTYPE html><html><body><h1>Root SPA</h1></body></html>",
        "utf-8"
      );
      fs.writeFileSync(
        path.join(assetsDir, "app.js"),
        "console.log('App bundle content for compression test');",
        "utf-8"
      );

      const { createPreviewServer } = await import(
        "../../node_modules/@dotmix/cli/dist/commands/preview.js"
      );
      const port = 41730 + Math.floor(Math.random() * 500);
      const server = await createPreviewServer({
        dir: tmpDir,
        port,
        host: "127.0.0.1",
        silent: true,
      });

      try {
        // Request 1: Root / -> index.html
        const resRoot = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(resRoot.status, 200);
        assert.match(resRoot.headers.get("content-type") || "", /text\/html/);
        const html = await resRoot.text();
        assert.match(html, /Root SPA/);

        // Request 2: Existing asset /assets/app.js with gzip
        const resAsset = await fetch(`http://127.0.0.1:${port}/assets/app.js`, {
          headers: { "accept-encoding": "gzip" },
        });
        assert.equal(resAsset.status, 200);
        assert.match(resAsset.headers.get("content-type") || "", /javascript/);
        assert.equal(resAsset.headers.get("content-encoding"), "gzip");
        const jsText = await resAsset.text();
        assert.match(jsText, /App bundle content/);

        // Request 3: SPA deep route /dashboard/settings -> rewrites to index.html with 200
        const resSpa = await fetch(`http://127.0.0.1:${port}/dashboard/settings`);
        assert.equal(resSpa.status, 200);
        const spaHtml = await resSpa.text();
        assert.match(spaHtml, /Root SPA/);

        // Request 4: Missing static file with extension /missing.css -> returns 404
        const res404 = await fetch(`http://127.0.0.1:${port}/missing.css`);
        assert.equal(res404.status, 404);
      } finally {
        await new Promise((r) => server.close(r));
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // 2.: Test Runner
  describe(": mix test", () => {
    it("runs unit and logic tests via node:test with exit code 0", () => {
      const res = runCli(["test", "tests/cli/build-bundler.test.mjs"]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /dotMix — Test Runner/);
      assert.match(res.stdout, /Production Bundler/);
    });

    it("skips browser tests with exit code 2 when no browser is available", () => {
      const res = runCli(["test", "--browser"], { MIX_BROWSER_PATH: "none" });
      assert.equal(res.status, 2);
      assert.match(res.stdout + res.stderr, /\[SKIP\] No compatible Chromium browser found/);
    });
  });

  // 3.: Linter & Syntax Fixes
  describe(": mix lint", () => {
    it("audits clean showcase sources without errors", () => {
      const res = runCli(["lint", "examples/showcase/src"]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /0 lint errors, 0 warnings/);
    });

    it("detects deprecated syntax and automatically fixes it with --fix", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-lint-test-"));
      const testFile = path.join(tmpDir, "Legacy.mix");
      const legacyCode = `<div class="card">
  {#if condition}
    <span>Active</span>
  {:else}
    <span>Inactive</span>
  {/if}
  {#each items as item, idx}
    <p>{idx}: {item}</p>
  {/each}
</div>`;
      fs.writeFileSync(testFile, legacyCode, "utf-8");

      // Lint without fix: should report warnings
      const resWarn = runCli(["lint", tmpDir]);
      assert.equal(resWarn.status, 0); // warnings only
      assert.match(resWarn.stdout, /Deprecated '\{#if\}'/);
      assert.match(resWarn.stdout, /Deprecated '\{#each\}'/);

      // Lint with --fix: should automatically rewrite to canonical syntax
      const resFix = runCli(["lint", tmpDir, "--fix"]);
      assert.equal(resFix.status, 0);
      assert.match(resFix.stdout, /Automatically fixed/);

      const fixedCode = fs.readFileSync(testFile, "utf-8");
      assert.match(fixedCode, /\{if condition\}/);
      assert.match(fixedCode, /\{else\}/);
      assert.match(fixedCode, /\{endif\}/);
      assert.match(fixedCode, /\{each \(item, idx\) in items\}/);
      assert.match(fixedCode, /\{endeach\}/);
      assert.doesNotMatch(fixedCode, /\{#if/);
      assert.doesNotMatch(fixedCode, /\{#each/);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // 4.: Info & Doctor
  describe(": mix info & mix doctor", () => {
    it("mix info outputs system and node version details", () => {
      const res = runCli(["info"]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /dotMix — Environment Information/);
      // The CLI runs on the same Node binary as this test, whatever its major version.
      assert.ok(res.stdout.includes(process.version), `expected the running Node ${process.version} in:\n${res.stdout}`);
      assert.match(res.stdout, /Browser:/);
    });

    it("mix info --json outputs parseable JSON structure", () => {
      const res = runCli(["info", "--json"]);
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(typeof parsed.system.platform, "string");
      assert.equal(typeof parsed.node.version, "string");
      assert.equal(typeof parsed.mix.cliVersion, "string");
    });

    it("mix doctor runs 10 health checks and returns zero critical failures", () => {
      const res = runCli(["doctor"]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /Doctor & Project Health Audit/);
      assert.match(res.stdout, /Node\.js Engine Compatibility/);
      assert.match(res.stdout, /Control-Flow Syntax Health/);
      assert.match(res.stdout, /0 failures/);
    });

    it("mix doctor --json outputs array of 10 checks", () => {
      const res = runCli(["doctor", "--json"]);
      assert.equal(res.status, 0);
      const checks = JSON.parse(res.stdout);
      assert.ok(Array.isArray(checks));
      assert.equal(checks.length, 10);
      for (const check of checks) {
        assert.ok(check.id >= 1 && check.id <= 10);
        assert.ok(["pass", "warn", "fail"].includes(check.status));
      }
    });
  });
});
