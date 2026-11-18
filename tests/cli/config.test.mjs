/* global process, setTimeout, clearTimeout */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");
const cliBinary = path.join(repositoryRoot, "packages/cli/dist/bin.js");

function executeCli(args, workingDirectory) {
  const processResult = spawnSync(process.execPath, [cliBinary, ...args], {
    cwd: workingDirectory ?? repositoryRoot,
    encoding: "utf-8",
    timeout: 30000
  });
  return {
    status: processResult.status,
    stdout: processResult.stdout ?? "",
    stderr: processResult.stderr ?? ""
  };
}

async function removeDirectoryResiliently(directoryPath) {
  // The dev server's file watcher can hold the directory open on Windows for a moment after the
  // process is killed, so retry the removal a few times before giving up.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(directoryPath, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

function runDevAndCaptureStartup(workingDirectory) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliBinary, "dev", "--port", "4999"], {
      cwd: workingDirectory,
      stdio: "pipe"
    });
    let output = "";
    let settled = false;
    // Kill the server and resolve only once it has fully exited, so its watcher releases the directory.
    const finish = () => {
      if (settled) return;
      settled = true;
      child.once("close", () => resolve(output));
      child.kill();
      setTimeout(() => resolve(output), 2000);
    };
    const timer = setTimeout(finish, 7500);

    child.stdout.on("data", (data) => {
      output += data.toString();
      if (output.includes("Loaded config from") || output.includes("Dev Server") || output.includes("ERROR")) {
        clearTimeout(timer);
        finish();
      }
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(output);
      }
    });
  });
}

describe("mix.config discovery, loading, validation and precedence", () => {
  it("discovers and loads mix.config.js, mix.config.mjs, and mix.config.ts", async () => {
    for (const extension of ["js", "mjs", "ts"]) {
      const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `mix-cfg-${extension}-`));
      try {
        const configFilename = `mix.config.${extension}`;
        const configContent = extension === "ts"
          ? 'import type { MixConfig } from "@dotmix/cli";\nexport default { dev: { port: 3456 } } satisfies MixConfig;\n'
          : 'export default { dev: { port: 3456 } };\n';
        fs.writeFileSync(path.join(projectDirectory, configFilename), configContent, "utf-8");

        const checkRun = executeCli(["check"], projectDirectory);
        assert.equal(checkRun.status, 0);
      } finally {
        await removeDirectoryResiliently(projectDirectory);
      }
    }
  });

  it("fails with MIX_ERR_CONFIG_INVALID when multiple config files exist", async () => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cfg-conflict-"));
    try {
      fs.writeFileSync(path.join(projectDirectory, "mix.config.ts"), "export default {};\n", "utf-8");
      fs.writeFileSync(path.join(projectDirectory, "mix.config.js"), "export default {};\n", "utf-8");

      const checkRun = executeCli(["check"], projectDirectory);
      assert.equal(checkRun.status, 1);
      assert.match(checkRun.stderr + checkRun.stdout, /MIX_ERR_CONFIG_INVALID/);
      assert.match(checkRun.stderr + checkRun.stdout, /Multiple configuration files found/);
    } finally {
      await removeDirectoryResiliently(projectDirectory);
    }
  });

  it("removes temporary sibling transpiled mjs file even if ts config throws", async () => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cfg-throwing-"));
    try {
      fs.writeFileSync(
        path.join(projectDirectory, "mix.config.ts"),
        'throw new Error("Deliberate failure during config evaluation");\n',
        "utf-8"
      );

      const runResult = executeCli(["check"], projectDirectory);
      assert.equal(runResult.status, 1);
      assert.match(runResult.stderr + runResult.stdout, /Deliberate failure during config evaluation/);

      const leftoverFiles = fs.readdirSync(projectDirectory).filter((name) => name.endsWith(".mjs"));
      assert.equal(leftoverFiles.length, 0, `Expected 0 temporary files, found: ${leftoverFiles.join(", ")}`);
    } finally {
      await removeDirectoryResiliently(projectDirectory);
    }
  });

  it("validates schema and reports MIX_ERR_CONFIG_INVALID with path and reason", async () => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cfg-invalid-"));
    try {
      fs.writeFileSync(
        path.join(projectDirectory, "mix.config.js"),
        'export default { build: { prerender: ["/valid", 123] } };\n',
        "utf-8"
      );

      const runResult = executeCli(["build"], projectDirectory);
      assert.equal(runResult.status, 1);
      assert.match(runResult.stderr + runResult.stdout, /MIX_ERR_CONFIG_INVALID/);
      assert.match(runResult.stderr + runResult.stdout, /build\.prerender\[1\]: expected a string/);
    } finally {
      await removeDirectoryResiliently(projectDirectory);
    }
  });

  it("respects precedence: CLI flag beats config, and --no-clean beats clean: true", async () => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cfg-precedence-"));
    try {
      fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectory, "src", "App.mix"),
        'export default function App() { return <p>Precedence</p>; }\n',
        "utf-8"
      );
      fs.writeFileSync(
        path.join(projectDirectory, "mix.config.js"),
        'export default { outDir: "custom-out", build: { clean: true } };\n',
        "utf-8"
      );

      fs.mkdirSync(path.join(projectDirectory, "custom-out"), { recursive: true });
      const markerPath = path.join(projectDirectory, "custom-out", "preserve-me.txt");
      fs.writeFileSync(markerPath, "must-remain", "utf-8");

      const buildResult = executeCli(["build", "--no-clean"], projectDirectory);
      assert.equal(buildResult.status, 0);
      assert.ok(fs.existsSync(markerPath), "File in outDir should be preserved when --no-clean beats clean: true");
    } finally {
      await removeDirectoryResiliently(projectDirectory);
    }
  });

  it("builds into outDir specified in mix.config when positional outDir is omitted", async () => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cfg-build-out-"));
    try {
      fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectory, "src", "App.mix"),
        'export default function App() { return <p>Custom OutDir</p>; }\n',
        "utf-8"
      );
      fs.writeFileSync(
        path.join(projectDirectory, "mix.config.js"),
        'export default { outDir: "configured-dist" };\n',
        "utf-8"
      );

      const buildResult = executeCli(["build"], projectDirectory);
      assert.equal(buildResult.status, 0);
      assert.ok(fs.existsSync(path.join(projectDirectory, "configured-dist", "index.html")));
    } finally {
      await removeDirectoryResiliently(projectDirectory);
    }
  });

  it("prints Loaded config only when a config file is present, and suppresses it when absent", async () => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cfg-banner-"));
    try {
      // 1. Without config
      const withoutConfigOutput = await runDevAndCaptureStartup(projectDirectory);
      assert.doesNotMatch(withoutConfigOutput, /Loaded config from/);

      // 2. With config
      fs.writeFileSync(path.join(projectDirectory, "mix.config.js"), "export default { dev: { port: 4999 } };\n", "utf-8");
      const withConfigOutput = await runDevAndCaptureStartup(projectDirectory);
      assert.match(withConfigOutput, /Loaded config from mix\.config\.js/);
    } finally {
      await removeDirectoryResiliently(projectDirectory);
    }
  });
});
