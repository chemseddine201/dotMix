/* global process, fetch */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliBin = path.join(repoRoot, "packages/cli/dist/bin.js");

function createStaticDevBranchFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mix-gate41-b5-"));
  const src = path.join(root, "src");
  fs.mkdirSync(path.join(src, "dev"), { recursive: true });
  fs.mkdirSync(path.join(src, "pages"), { recursive: true });

  fs.symlinkSync(
    path.join(repoRoot, "node_modules"),
    path.join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "gate41-b5-dev-branch", private: true, type: "module" }, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(root, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><title>B5</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
    "utf-8"
  );
  fs.writeFileSync(
    path.join(root, "mix.config.ts"),
    'export default { build: { clean: true, static: true } };\n',
    "utf-8"
  );

  fs.writeFileSync(
    path.join(src, "dev/x.ts"),
    'export const DEV_ONLY_SENTINEL = "GATE41_B5_DEV_ONLY_MODULE";\n',
    "utf-8"
  );

  fs.writeFileSync(
    path.join(src, "pages/HomePage.tix"),
    [
      "export default function HomePage() {",
      '  return <main><h1>Home</h1></main>;',
      "}",
      ""
    ].join("\n"),
    "utf-8"
  );

  fs.writeFileSync(
    path.join(src, "routes.ts"),
    [
      'import HomePage from "./pages/HomePage.tix";',
      'export const routes = [{ path: "/", component: HomePage }];',
      ""
    ].join("\n"),
    "utf-8"
  );

  fs.writeFileSync(
    path.join(src, "main.ts"),
    [
      'import { mount } from "@dotmix/runtime";',
      'import HomePage from "./pages/HomePage.tix";',
      'import { routes } from "./routes.js";',
      "export const isProd = import.meta.env.PROD;",
      "void routes;",
      'if (import.meta.env.DEV) void import("./dev/x.js");',
      'const el = document.getElementById("app");',
      "if (el) mount(() => HomePage({}), el);",
      ""
    ].join("\n"),
    "utf-8"
  );

  return {
    root,
    dist: path.join(root, "dist"),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function listAllRelativeFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      out.push(path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
    }
  }
  return out;
}

describe("Gate 41 B5: import.meta.env.DEV dead branches and unreachable dynamic import() targets", () => {
  it("omits dev/x module and its import-map entry from mix build --static, while mix dev still loads it", async () => {
    const fixture = createStaticDevBranchFixture();
    let server;
    try {
      const env = { ...process.env, MIX_BROWSER_PATH: "" };
      const res = spawnSync(
        process.execPath,
        [cliBin, "build", "src", fixture.dist, "--static", "--clean"],
        { cwd: fixture.root, env, encoding: "utf-8" }
      );
      assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

      const distFiles = listAllRelativeFiles(fixture.dist);
      assert.equal(
        distFiles.some((f) => f.includes("dev/x")),
        false,
        `Unreachable dev/x module must not be emitted in dist/: ${distFiles.join(", ")}`
      );

      const indexHtml = fs.readFileSync(path.join(fixture.dist, "index.html"), "utf-8");
      assert.equal(indexHtml.includes("dev/x"), false, "index.html import map must not reference dev/x");

      const manifest = fs.readFileSync(path.join(fixture.dist, "mix-manifest.json"), "utf-8");
      assert.equal(manifest.includes("dev/x"), false, "mix-manifest.json must not reference dev/x");

      for (const rel of distFiles) {
        if (!rel.endsWith(".js")) continue;
        const content = fs.readFileSync(path.join(fixture.dist, rel), "utf-8");
        assert.equal(content.includes("GATE41_B5_DEV_ONLY_MODULE"), false, `${rel} must not contain dev-only sentinel`);
        assert.equal(content.includes("dev/x"), false, `${rel} must not contain dead dynamic import("./dev/x.js")`);
        assert.equal(content.includes("import.meta.env.DEV"), false, `${rel} must replace import.meta.env.DEV`);
        assert.equal(content.includes("import.meta.env.PROD"), false, `${rel} must replace import.meta.env.PROD`);
      }

      // mix dev must still load src/dev/x.ts
      server = await createDevServer({ rootDir: fixture.root, port: 0, silent: true });
      const mainRes = await fetch(`${server.url}/src/main.ts`);
      assert.equal(mainRes.status, 200);
      const mainJs = await mainRes.text();
      assert.ok(mainJs.includes("/src/dev/x.ts"), `mix dev main.ts must still import /src/dev/x.ts:\n${mainJs}`);

      const devModRes = await fetch(`${server.url}/src/dev/x.ts`);
      assert.equal(devModRes.status, 200);
      const devModJs = await devModRes.text();
      assert.ok(devModJs.includes("GATE41_B5_DEV_ONLY_MODULE"));
    } finally {
      if (server) await server.close();
      fixture.cleanup();
    }
  });
});

