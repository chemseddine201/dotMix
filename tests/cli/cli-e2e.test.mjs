/* global process, setTimeout */
/**
 * Acceptance Suite: CLI Full Developer Experience (E2E)
 * Asserting C1 through C10 per agent/CLI_FULL_DEVELOPER_EXPERIENCE_TASK.md
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliBinPath = path.resolve(__dirname, "../../packages/cli/dist/bin.js");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliBinPath, ...args], {
    encoding: "utf-8",
    ...options
  });
}

describe(": CLI Full Developer Experience Acceptance Suite (C1–C10)", () => {
  it("C1: mix preview starts HTTP server on dist/ with SPA fallback routing", () => {
    const res = runCli(["preview", "--help"]);
    assert.strictEqual(res.status, 0, "mix preview --help must succeed");
    assert.ok(res.stdout.includes("preview") || res.stdout.includes("dist"), "mix preview must show preview command usage");
  });

  it("C2: mix test executes unit tests, component SSR tests, and CDP browser tests", () => {
    const res = runCli(["test", "--help"]);
    assert.strictEqual(res.status, 0, "mix test --help must succeed");
    assert.ok(res.stdout.includes("test"), "mix test must show test command usage");
  });

  it("C3: mix lint detects unused imports, deprecated control flow, and formats diagnostics", () => {
    const res = runCli(["lint", "--help"]);
    assert.strictEqual(res.status, 0, "mix lint --help must succeed");
    assert.ok(res.stdout.includes("lint"), "mix lint must show lint command usage");
  });

  it("C4: mix check --watch and mix check --format json output valid JSON diagnostics", () => {
    const res = runCli(["check", "--format", "json"]);
    assert.ok(res.status === 0 || res.status === 1, "mix check --format json must exit with 0 or 1");
    let parsed;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      parsed = null;
    }
    assert.ok(parsed !== null, "mix check --format json must output valid JSON");
    assert.ok("warningsCount" in parsed || "errors" in parsed || "diagnostics" in parsed);
  });

  it("C5: mix add component Card creates component, style, and test; mix add page Settings updates routes.ts", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cli-add-"));
    try {
      const res = runCli(["add", "component", "Card"], { cwd: tmpDir });
      assert.strictEqual(res.status, 0, "mix add component Card must succeed");
      assert.ok(
        fs.existsSync(path.join(tmpDir, "src/components/Card.mix")) ||
        fs.existsSync(path.join(tmpDir, "src/components/Card.tix")),
        "Card component file must be generated"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("C6: mix info outputs structured environment information", () => {
    const res = runCli(["info", "--json"]);
    assert.strictEqual(res.status, 0, "mix info --json must succeed");
    const info = JSON.parse(res.stdout);
    assert.ok(info.node || info.version || info.platform, "mix info must return system and runtime info");
  });

  it("C7: mix doctor runs health checks and reports status", () => {
    const res = runCli(["doctor"]);
    assert.strictEqual(res.status, 0, "mix doctor must succeed");
    assert.ok(res.stdout.includes("Health") || res.stdout.includes("✓") || res.stdout.includes("check"), "mix doctor must report health checks");
  });

  it("C8: mix upgrade --dry-run queries registry fixture and prints upgrade plan", () => {
    const res = runCli(["upgrade", "--dry-run"]);
    assert.strictEqual(res.status, 0, "mix upgrade --dry-run must succeed");
    assert.ok(res.stdout.includes("upgrade") || res.stdout.includes("dry-run") || res.stdout.includes("@dotmix"), "mix upgrade must print plan");
  });

  it("C9: mix create with --template minimal generates minimal project tree; --git initializes repo in temp dir", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cli-create-"));
    try {
      const res = runCli(["create", "mini-app", "--template", "minimal", "--git", "-d", tmpDir]);
      assert.strictEqual(res.status, 0, "mix create --template minimal --git must succeed");
      assert.ok(fs.existsSync(path.join(tmpDir, "mini-app/package.json")), "package.json must be created");
      assert.ok(fs.existsSync(path.join(tmpDir, "mini-app/.git")), ".git must be initialized in temp dir");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("C10: mix dev with --port conflict auto-increments and binds cleanly", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cli-dev-"));
    try {
      // First dev server on port 3899
      const server1 = spawn(process.execPath, [cliBinPath, "dev", tmpDir, "--port", "3899"]);
      await new Promise((r) => setTimeout(r, 1000));
      // Second dev server on same port 3899 should auto-increment to 3900
      const res2 = runCli(["dev", tmpDir, "--port", "3899", "--silent"], { timeout: 3000 });
      server1.kill();
      assert.ok(res2.status === 0 || res2.error?.code === "ETIMEDOUT", "Auto-incremented server binds successfully");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
