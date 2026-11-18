/* global process */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testFileDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testFileDirectory, "../..");
const cliBinaryPath = path.join(repositoryRoot, "packages/cli/dist/bin.js");

function executeCli(args) {
  const result = spawnSync(process.execPath, [cliBinaryPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf-8"
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

describe("CLI branding and VS Code extension publisher identifier", () => {
  it("prints dotMix version without Mix Framework string", () => {
    const cliRun = executeCli(["--version"]);
    assert.equal(cliRun.status, 0);
    assert.match(cliRun.stdout, /^dotMix v/);
    assert.doesNotMatch(cliRun.stdout, /Mix Framework/);
  });

  it("prints dotMix version help line in global options", () => {
    const cliRun = executeCli(["--help"]);
    assert.equal(cliRun.status, 0);
    assert.match(cliRun.stdout, /Print dotMix version/);
    assert.doesNotMatch(cliRun.stdout, /Print Mix Framework version/);
  });

  it("sets publisher identifier to dotmix in vscode-mix package.json", () => {
    const manifestPath = path.join(repositoryRoot, "editors/vscode-mix/package.json");
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    assert.equal(manifestContent.publisher, "dotmix");
  });
});

