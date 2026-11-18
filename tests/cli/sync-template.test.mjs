/* global process */
/**
 * deferral closed early (2026-11-13): `mix create --template sync-crdt` and `mix add sync`.
 * Both generate code on the public syncCollection API only, so they follow the default
 * engine.
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
const run = (args, cwd) => spawnSync(process.execPath, [cliBinPath, ...args], { encoding: "utf-8", cwd });

describe("sync-crdt template and mix add sync", () => {
  for (const lang of ["ts", "js"]) {
    it(`creates a ${lang} sync-crdt project that compiles with mix build`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "mix-sync-"));
      try {
        const flags = lang === "js" ? ["--js"] : [];
        const res = run(["create", "app", "--template", "sync-crdt", "--no-install", "--no-git", ...flags], root);
        assert.strictEqual(res.status, 0, res.stderr);
        const app = path.join(root, "app");
        const ext = lang === "ts" ? "ts" : "js";
        const comp = lang === "ts" ? "tix" : "mix";
        const pkg = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf-8"));
        assert.strictEqual(pkg.dependencies["@dotmix/sync"], cliVersion);
        assert.strictEqual(pkg.devDependencies["@dotmix/cli"], cliVersion);
        assert.ok(fs.readFileSync(path.join(app, `src/stores/tasks.${ext}`), "utf-8").includes("syncCollection"));
        assert.ok(fs.existsSync(path.join(app, `src/App.${comp}`)));
        const build = run(["build", "src", "dist"], app);
        assert.strictEqual(build.status, 0, build.stdout + build.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("mix add sync creates a collection module and refuses to overwrite it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mix-sync-"));
    try {
      assert.strictEqual(run(["create", "app", "--template", "minimal", "--no-install", "--no-git"], root).status, 0);
      const app = path.join(root, "app");
      const first = run(["add", "sync", "Notes"], app);
      assert.strictEqual(first.status, 0, first.stderr);
      const src = fs.readFileSync(path.join(app, "src/sync/NotesCollection.ts"), "utf-8");
      assert.ok(src.includes('syncCollection<NotesRecord>({ key: "notes" })'));
      assert.ok(first.stdout.includes("@dotmix/sync"), "must hint that @dotmix/sync is not a dependency yet");
      assert.strictEqual(run(["add", "sync", "Notes"], app).status, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
