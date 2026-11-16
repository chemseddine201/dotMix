import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { build, createDevServer } from "@dotmix/cli";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const cliBinary = path.join(repositoryRoot, "packages/cli/dist/bin.js");

function collectFilesRecursively(dirPath) {
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function createEnvFixtureProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mix-import-meta-env-"));
  const projectDir = path.join(tempRoot, "env-app");
  const srcDir = path.join(projectDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  fs.symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(projectDir, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );

  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "env-app", private: true, type: "module" }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          jsx: "preserve",
          skipLibCheck: true
        },
        include: ["src/**/*"]
      },
      null,
      2
    ),
    "utf8"
  );
  fs.writeFileSync(
    path.join(projectDir, "index.html"),
    '<!doctype html><html><head><title>Env App</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
    "utf8"
  );
  fs.writeFileSync(
    path.join(projectDir, ".env"),
    "MIX_PUBLIC_GREETING=hi\nSECRET_TOKEN=do-not-ship\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(srcDir, "env.d.ts"),
    '/// <reference types="@dotmix/runtime/client" />\n',
    "utf8"
  );
  fs.writeFileSync(
    path.join(srcDir, "config.ts"),
    [
      "export const envSnapshot = {",
      "  greeting: import.meta.env.MIX_PUBLIC_GREETING,",
      "  missing: import.meta.env.MIX_PUBLIC_UNSET,",
      "  mode: import.meta.env.MODE,",
      "  isDev: import.meta.env.DEV,",
      "  isProd: import.meta.env.PROD,",
      "  allEnv: import.meta.env,",
      '  literalLabel: "import.meta.env"',
      "};",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(srcDir, "Banner.tix"),
    [
      "export default function Banner() {",
      '  const greeting: string = import.meta.env.MIX_PUBLIC_GREETING ?? "fallback";',
      "  return <p id=\"banner-greeting\">{greeting}</p>;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(srcDir, "main.ts"),
    [
      'import { mount } from "@dotmix/runtime";',
      'import Banner from "./Banner.tix";',
      'import { envSnapshot } from "./config.js";',
      'const target = document.getElementById("app");',
      "if (target) mount(() => Banner({}), target);",
      "export { envSnapshot };",
      ""
    ].join("\n"),
    "utf8"
  );

  return {
    projectDir,
    srcDir,
    distDir: path.join(projectDir, "dist"),
    cleanup() {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  };
}

describe("build-time import.meta.env replacement", () => {
  it("replaces MIX_PUBLIC_* values in mix build, excludes secrets, preserves literal strings, and passes mix check", () => {
    const fixture = createEnvFixtureProject();
    try {
      const checkRun = spawnSync(process.execPath, [cliBinary, "check", "src"], {
        cwd: fixture.projectDir,
        encoding: "utf8"
      });
      assert.equal(checkRun.status, 0, `${checkRun.stdout}\n${checkRun.stderr}`);

      const buildResult = build({
        inDir: fixture.srcDir,
        outDir: fixture.distDir,
        silent: true
      });
      assert.equal(buildResult.success, true);

      const emittedFiles = collectFilesRecursively(fixture.distDir);
      let combinedAssetsText = "";
      for (const filePath of emittedFiles) {
        const contents = fs.readFileSync(filePath, "utf8");
        assert.equal(
          contents.includes("do-not-ship"),
          false,
          `Secret value leaked into ${filePath}`
        );
        assert.equal(
          contents.includes("SECRET_TOKEN"),
          false,
          `Secret key leaked into ${filePath}`
        );
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          combinedAssetsText += contents + "\n";
        }
      }

      assert.ok(combinedAssetsText.includes('"hi"'));
      assert.ok(combinedAssetsText.includes('"production"'));
      assert.ok(combinedAssetsText.includes('"import.meta.env"'));
      assert.equal(combinedAssetsText.includes("import.meta.env.MIX_PUBLIC_"), false);
      assert.equal(combinedAssetsText.includes("import.meta.env.MODE"), false);
    } finally {
      fixture.cleanup();
    }
  });

  it("serves replaced import.meta.env values in mix dev modules", async () => {
    const fixture = createEnvFixtureProject();
    const server = await createDevServer({
      rootDir: fixture.projectDir,
      port: 0,
      silent: true
    });
    try {
      const configResponse = await globalThis.fetch(`${server.url}/src/config.ts`);
      assert.equal(configResponse.status, 200);
      const configCode = await configResponse.text();
      assert.ok(configCode.includes('"hi"'));
      assert.ok(configCode.includes('"development"'));
      assert.ok(configCode.includes('"import.meta.env"'));
      assert.equal(configCode.includes("do-not-ship"), false);
      assert.equal(configCode.includes("SECRET_TOKEN"), false);
      assert.equal(configCode.includes("import.meta.env.MIX_PUBLIC_"), false);

      const bannerResponse = await globalThis.fetch(`${server.url}/src/Banner.tix`);
      assert.equal(bannerResponse.status, 200);
      const bannerCode = await bannerResponse.text();
      assert.ok(bannerCode.includes('"hi"'));
      assert.equal(bannerCode.includes("import.meta.env.MIX_PUBLIC_"), false);
    } finally {
      await server.close();
      fixture.cleanup();
    }
  });
});

