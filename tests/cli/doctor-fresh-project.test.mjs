// A project created by `mix create` must pass `mix doctor` without failures: the TypeScript settings
// the template writes are accepted, and preprocessor stylesheets need no sass/less/postcss package.

/* global process */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const binPath = path.join(repoRoot, "packages/cli/dist/bin.js");

function runMix(args, cwd) {
  const result = spawnSync(process.execPath, [binPath, ...args], { cwd, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("mix doctor on a newly created project", () => {
  for (const flags of [["--ts", "--scss"], ["--js", "--less"]]) {
    it(`reports no failed checks for mix create ${flags.join(" ")}`, () => {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-doctor-fresh-"));
      try {
        const created = runMix(["create", "fresh-app", ...flags, "--silent"], workDir);
        assert.equal(created.status, 0, created.stderr);
        const projectDir = path.join(workDir, "fresh-app");

        const doctor = runMix(["doctor", "--json"], projectDir);
        const checks = JSON.parse(doctor.stdout);
        const failed = checks.filter((check) => check.status === "fail");
        assert.deepEqual(failed.map((check) => `${check.name}: ${check.message}`), []);
        assert.equal(doctor.status, 0);

        const byName = new Map(checks.map((check) => [check.name, check.status]));
        assert.equal(byName.get("TypeScript Configuration"), "pass");
        assert.equal(byName.get("Stylesheet Formats"), "pass");
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    });
  }

  it("fails the stylesheet check for Stylus files", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-doctor-stylus-"));
    try {
      runMix(["create", "stylus-app", "--ts", "--css", "--silent"], workDir);
      const projectDir = path.join(workDir, "stylus-app");
      fs.writeFileSync(path.join(projectDir, "src", "theme.styl"), "body\n  color red\n", "utf-8");

      const doctor = runMix(["doctor", "--json"], projectDir);
      const stylesheetCheck = JSON.parse(doctor.stdout).find((check) => check.name === "Stylesheet Formats");
      assert.equal(stylesheetCheck.status, "fail");
      assert.match(stylesheetCheck.message, /theme\.styl/);
      assert.equal(doctor.status, 1);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
