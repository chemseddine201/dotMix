// `mix dev` on a project from `mix create` serves the global stylesheet unscoped, with the design tokens
// it imports. Before the fix, main.mix's `import "./styles/global.scss"` was scoped like component CSS
// (`body[data-mix-…]`) and the imported tokens were dropped, so the page rendered unstyled.

/* global process, fetch */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const binPath = path.join(repoRoot, "packages/cli/dist/bin.js");

describe("mix dev global styles", () => {
  it("serves the entry's global stylesheet unscoped, tokens included, and keeps page styles scoped", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-dev-styles-"));
    const projectDir = path.join(workDir, "styled-app");
    let server;
    try {
      const created = spawnSync(process.execPath, [binPath, "create", "styled-app", "--ts", "--scss", "--silent"], { cwd: workDir, encoding: "utf-8" });
      assert.equal(created.status, 0, created.stderr);
      fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(projectDir, "node_modules"), process.platform === "win32" ? "junction" : "dir");

      server = await createDevServer({ rootDir: projectDir, port: 0, silent: true });
      const base = `http://127.0.0.1:${server.port}`;

      const entryStyles = await (await fetch(`${base}/src/main.mix?mix-css=1`)).text();
      assert.match(entryStyles, /:root\{--color-primary/, "tokens imported by global.scss must be present");
      assert.match(entryStyles, /(^|[^\w-])body\{/, "the body rule must be unscoped");
      assert.doesNotMatch(entryStyles, /body\[data-mix-/);

      const pageStyles = await (await fetch(`${base}/src/pages/HomePage.tix?mix-css=1`)).text();
      assert.match(pageStyles, /\.home-page\[data-mix-[a-z0-9]+\]/, "the page's own stylesheet stays scoped");
    } finally {
      if (server) await server.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
