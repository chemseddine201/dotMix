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

function createLinkedProject(projectName, flags) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-add-style-"));
  const projectDirectory = path.join(temporaryRoot, projectName);
  const created = runCli(["create", projectName, ...flags, "--target", projectDirectory], temporaryRoot);
  assert.equal(created.status, 0, created.stderr);
  fs.symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(projectDirectory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
  return { temporaryRoot, projectDirectory };
}

test("mix add component writes a sibling stylesheet imported first, and mix check passes", () => {
  const { temporaryRoot, projectDirectory } = createLinkedProject("add-style-app", ["--ts", "--css"]);
  try {
    const added = runCli(["add", "component", "UserCard"], projectDirectory);
    assert.equal(added.status, 0, added.stderr);

    const componentPath = path.join(projectDirectory, "src/components/UserCard.tix");
    const stylesheetPath = path.join(projectDirectory, "src/components/UserCard.css");
    assert.ok(fs.existsSync(componentPath), "UserCard.tix must exist");
    assert.ok(fs.existsSync(stylesheetPath), "UserCard.css must exist");
    const componentSource = fs.readFileSync(componentPath, "utf-8");
    assert.equal(componentSource.includes("<style"), false, "The component must not contain a <style> block");
    assert.ok(componentSource.startsWith('import "./UserCard.css";\n'), componentSource);
    assert.ok(fs.readFileSync(stylesheetPath, "utf-8").includes(".user-card {"));

    const checked = runCli(["check", "src"], projectDirectory);
    assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
    assert.equal(checked.stdout.includes("[ERROR]"), false, checked.stdout);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("the style flag picks the sibling stylesheet extension for pages and layouts", () => {
  const { temporaryRoot, projectDirectory } = createLinkedProject("add-style-flags", ["--ts", "--css"]);
  try {
    assert.equal(runCli(["add", "page", "Billing", "--scss"], projectDirectory).status, 0);
    assert.equal(runCli(["add", "layout", "Admin", "--sass"], projectDirectory).status, 0);

    const pageSource = fs.readFileSync(path.join(projectDirectory, "src/pages/BillingPage.tix"), "utf-8");
    assert.ok(pageSource.startsWith('import "./BillingPage.scss";\n'), pageSource);
    assert.equal(pageSource.includes("<style"), false);
    assert.ok(fs.existsSync(path.join(projectDirectory, "src/pages/BillingPage.scss")));

    const layoutSource = fs.readFileSync(path.join(projectDirectory, "src/layouts/AdminLayout.tix"), "utf-8");
    assert.ok(layoutSource.startsWith('import "./AdminLayout.sass";\n'), layoutSource);
    assert.equal(
      fs.readFileSync(path.join(projectDirectory, "src/layouts/AdminLayout.sass"), "utf-8"),
      ".admin-layout\n  display: flex\n  flex-direction: column\n  min-height: 100vh\n"
    );

    const built = runCli(["build", "src", "dist", "--clean"], projectDirectory);
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("mix create minimal and sync-crdt templates write the App stylesheet as a sibling file", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-create-style-"));
  try {
    for (const [template, stylesheetName] of [["minimal", "App.less"], ["sync-crdt", "App.css"]]) {
      const projectDirectory = path.join(temporaryRoot, template);
      const created = runCli(["create", template, "--ts", "--less", "--template", template, "--target", projectDirectory], temporaryRoot);
      assert.equal(created.status, 0, created.stderr);
      const appSource = fs.readFileSync(path.join(projectDirectory, "src/App.tix"), "utf-8");
      assert.equal(appSource.includes("<style"), false, `${template}: App.tix must not contain a <style> block`);
      assert.ok(appSource.startsWith(`import "./${stylesheetName}";\n`), appSource);
      assert.ok(fs.existsSync(path.join(projectDirectory, "src", stylesheetName)), `${template}: ${stylesheetName} must exist`);
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
