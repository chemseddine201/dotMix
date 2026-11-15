import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const cliBinary = path.join(repositoryRoot, "packages/cli/dist/bin.js");

function runCli(args, workingDirectory) {
  return spawnSync(process.execPath, [cliBinary, ...args], { cwd: workingDirectory, encoding: "utf-8" });
}

test("mix check reports TypeScript errors of .ts modules", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-check-ts-"));
  const projectDirectory = path.join(temporaryRoot, "check-ts-app");
  try {
    const created = runCli(["create", "check-ts-app", "--ts", "--css", "--target", projectDirectory], temporaryRoot);
    assert.equal(created.status, 0, created.stderr);
    fs.symlinkSync(
      path.join(repositoryRoot, "node_modules"),
      path.join(projectDirectory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir"
    );
    fs.writeFileSync(path.join(projectDirectory, "src/counter.ts"), 'export const count: number = "text";\n', "utf-8");

    const checked = runCli(["check", "src"], projectDirectory);
    assert.equal(checked.status, 1, `${checked.stdout}\n${checked.stderr}`);
    assert.match(checked.stdout, /\[ERROR\] TS2322 at .*counter\.ts:1:14: Type 'string' is not assignable to type 'number'\./);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("mix check skips .ts modules with one info line when there is no tsconfig.json", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-check-no-tsconfig-"));
  try {
    fs.mkdirSync(path.join(temporaryRoot, "src"));
    fs.writeFileSync(path.join(temporaryRoot, "src/counter.ts"), 'export const count: number = "text";\n', "utf-8");
    const checked = runCli(["check", "src"], temporaryRoot);
    assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
    assert.equal(checked.stdout.split("\n").filter((line) => line.includes("tsconfig.json")).length, 1, checked.stdout);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("mix check of the showcase passes, .ts modules included", () => {
  const showcaseDirectory = path.join(repositoryRoot, "examples/showcase");
  const checked = runCli(["check", "src"], showcaseDirectory);
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  assert.equal(checked.stdout.includes("[ERROR]"), false, checked.stdout);
});
