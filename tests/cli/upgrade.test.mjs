/* global process */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const binPath = path.join(repoRoot, "packages/cli/dist/bin.js");

function runCli(args, env = {}, cwd = repoRoot) {
  const res = spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...env }
  });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || ""
  };
}

function runCliAsync(args, env = {}, cwd = repoRoot) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd,
      env: { ...process.env, ...env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

describe("Gate 37 Task T-37.10: mix upgrade (D-168 / A3 Contract)", () => {
  it("prints upgrade help message and exits 0", () => {
    const res = runCli(["upgrade", "--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Mix Framework/);
  });

  it("fails with exit code 1 when package.json does not exist in target dir", () => {
    const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), "mix-upgrade-empty-"));
    try {
      const res = runCli(["upgrade", tmpEmpty]);
      assert.equal(res.status, 1);
      assert.match(res.stderr + res.stdout, /No package\.json found/);
    } finally {
      fs.rmSync(tmpEmpty, { recursive: true, force: true });
    }
  });

  it("queries local registry fixture via node:http and respects --dry-run without touching package.json", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-upgrade-dryrun-"));
    const pkgJsonPath = path.join(tmpDir, "package.json");
    const initialPkg = {
      name: "test-app",
      version: "1.0.0",
      dependencies: {
        "@dotmix/runtime": "^0.1.0",
        "@dotmix/router": "~0.1.0"
      }
    };
    fs.writeFileSync(pkgJsonPath, JSON.stringify(initialPkg, null, 2), "utf-8");

    // Local HTTP registry fixture serving mock package manifests
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url || "");
      if (url.includes("@dotmix/runtime")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ "dist-tags": { latest: "0.2.0" } }));
      } else if (url.includes("@dotmix/router")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ "dist-tags": { latest: "0.1.5" } }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const mockPort = server.address().port;

    try {
      const res = await runCliAsync(
        ["upgrade", tmpDir, "--dry-run"],
        { MIX_REGISTRY_URL: `http://127.0.0.1:${mockPort}` },
        tmpDir
      );

      assert.equal(res.status, 0);
      assert.match(res.stdout, /Mix Upgrade Plan \(dry-run\)/);
      assert.match(res.stdout, /@dotmix\/runtime:\s+\^0\.1\.0\s+→\s+\^0\.2\.0/);
      assert.match(res.stdout, /@dotmix\/router:\s+~0\.1\.0\s+→\s+~0\.1\.5/);
      assert.match(res.stdout, /2 package\(s\) can be upgraded/);

      // Verify package.json is NOT modified in dry-run
      const postPkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      assert.equal(postPkg.dependencies["@dotmix/runtime"], "^0.1.0");
      assert.equal(postPkg.dependencies["@dotmix/router"], "~0.1.0");
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("updates package.json atomically when executed without --dry-run", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-upgrade-exec-"));
    const pkgJsonPath = path.join(tmpDir, "package.json");
    const initialPkg = {
      name: "test-app-upgrade",
      version: "1.0.0",
      dependencies: {
        "@dotmix/runtime": "^0.1.0"
      },
      devDependencies: {
        "@dotmix/router": "0.1.0"
      }
    };
    fs.writeFileSync(pkgJsonPath, JSON.stringify(initialPkg, null, 2), "utf-8");

    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url || "");
      if (url.includes("@dotmix/runtime")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ "dist-tags": { latest: "0.2.0" } }));
      } else if (url.includes("@dotmix/router")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ "dist-tags": { latest: "0.3.0" } }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const mockPort = server.address().port;

    try {
      // 1. First run: upgrades packages and updates package.json
      const res = await runCliAsync(
        ["upgrade", tmpDir],
        { MIX_REGISTRY_URL: `http://127.0.0.1:${mockPort}` },
        tmpDir
      );

      assert.equal(res.status, 0);
      assert.match(res.stdout, /Updated package\.json with 2 upgraded package\(s\)/);

      // Verify file written to disk
      const updatedPkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      assert.equal(updatedPkg.dependencies["@dotmix/runtime"], "^0.2.0");
      assert.equal(updatedPkg.devDependencies["@dotmix/router"], "0.3.0");

      // 2. Second run: now up to date
      const res2 = await runCliAsync(
        ["upgrade", tmpDir],
        { MIX_REGISTRY_URL: `http://127.0.0.1:${mockPort}` },
        tmpDir
      );
      assert.equal(res2.status, 0);
      assert.match(res2.stdout, /All packages are up to date/);
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("mix upgrade --json outputs parseable JSON structure", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-upgrade-json-"));
    const pkgJsonPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify({ name: "app", dependencies: { "@dotmix/runtime": "0.1.0" } }),
      "utf-8"
    );

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ "dist-tags": { latest: "0.2.0" } }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const mockPort = server.address().port;

    try {
      const res = await runCliAsync(
        ["upgrade", tmpDir, "--json", "--dry-run"],
        { MIX_REGISTRY_URL: `http://127.0.0.1:${mockPort}` },
        tmpDir
      );
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.success, true);
      assert.equal(parsed.dryRun, true);
      assert.equal(parsed.updated, false);
      assert.ok(Array.isArray(parsed.packages));
      assert.equal(parsed.packages[0].name, "@dotmix/runtime");
      assert.equal(parsed.packages[0].diff, "minor");
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("mix upgrade --codemod automatically migrates deprecated template syntax", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-upgrade-codemod-"));
    const pkgJsonPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify({ name: "app", dependencies: { "@dotmix/runtime": "0.1.0" } }),
      "utf-8"
    );

    const compFile = path.join(tmpDir, "Legacy.mix");
    fs.writeFileSync(
      compFile,
      `<div>{#if user}<span>Hello</span>{/if}</div>`,
      "utf-8"
    );

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ "dist-tags": { latest: "0.2.0" } }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const mockPort = server.address().port;

    try {
      const res = await runCliAsync(
        ["upgrade", tmpDir, "--codemod"],
        { MIX_REGISTRY_URL: `http://127.0.0.1:${mockPort}` },
        tmpDir
      );
      assert.equal(res.status, 0);
      assert.match(res.stdout, /Syntax codemods: 2 rewrite\(s\)/);

      const updatedComp = fs.readFileSync(compFile, "utf-8");
      assert.match(updatedComp, /\{if user\}/);
      assert.match(updatedComp, /\{endif\}/);
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
