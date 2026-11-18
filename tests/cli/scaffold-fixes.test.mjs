/* global process */
/**
 * reviewer fixes F1-F4 (2026-11-13):
 * F1/F2 scaffolded projects depend on @dotmix/cli and run `mix test`;
 * F3 `mix add page --route` reports a route it could not register;
 * F4 the scaffold message lists only styles that were actually created.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

/** New projects pin the version of the CLI that created them (all @dotmix packages are released together). */
const cliVersion = JSON.parse(fs.readFileSync(new URL("../../packages/cli/package.json", import.meta.url), "utf-8")).version;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliBinPath = path.resolve(__dirname, "../../packages/cli/dist/bin.js");

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliBinPath, ...args], { encoding: "utf-8", cwd });
}

function scaffold(template) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mix-fix-"));
  const res = runCli(["create", "app", "--template", template, "--no-install", "--no-git"], root);
  assert.strictEqual(res.status, 0, res.stderr);
  return { root, app: path.join(root, "app"), stdout: res.stdout };
}

describe(" fixes F1-F4", () => {
  for (const template of ["minimal", "standard"]) {
    it(`F1/F2: ${template} template depends on @dotmix/cli and uses mix test`, () => {
      const { root, app } = scaffold(template);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf-8"));
        assert.strictEqual(pkg.devDependencies?.["@dotmix/cli"], cliVersion);
        assert.strictEqual(pkg.scripts.test, "mix test");
        assert.strictEqual(pkg.scripts.dev, "mix dev");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("F3: add page --route without src/routes.ts warns and exits 1", () => {
    const { root, app } = scaffold("minimal");
    try {
      const res = runCli(["add", "page", "About", "--route", "/about"], app);
      assert.strictEqual(res.status, 1);
      assert.ok(res.stderr.includes("Route not registered"));
      assert.ok(fs.existsSync(path.join(app, "src/pages/AboutPage.tix")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("F3: add page --route registers the explicit path in src/routes.ts", () => {
    const { root, app } = scaffold("minimal");
    try {
      fs.writeFileSync(path.join(app, "src/routes.ts"), "export const routes = [\n];\n", "utf-8");
      const res = runCli(["add", "page", "Settings", "--route", "/account/settings"], app);
      assert.strictEqual(res.status, 0, res.stderr);
      const routes = fs.readFileSync(path.join(app, "src/routes.ts"), "utf-8");
      assert.ok(routes.includes('path: "/account/settings"'));
      assert.ok(routes.includes('import SettingsPage from "./pages/SettingsPage.tix"'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("F3: add page --route rejects a path without a leading slash", () => {
    const { root, app } = scaffold("minimal");
    try {
      const res = runCli(["add", "page", "Bad", "--route", "bad"], app);
      assert.strictEqual(res.status, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("F4: minimal scaffold message reports inline CSS, not a style format it did not create", () => {
    const { root, stdout } = scaffold("minimal");
    try {
      assert.ok(stdout.includes("inline CSS"));
      assert.ok(!stdout.includes("SCSS"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
