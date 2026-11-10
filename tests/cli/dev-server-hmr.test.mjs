import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { create } from "../../packages/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

describe("Gate 29 (T-29.1): mix dev Server, @mix/vite-plugin Pipeline, HMR & SPA Fallback", () => {
  it("1. Starts mix dev on scaffolded TS+SCSS and JS+Less projects, serves SPA routes, and resolves bare @mix/* imports without import maps", async () => {
    const cliMod = await import("../../packages/cli/dist/index.js");
    assert.strictEqual(
      typeof cliMod.createDevServer,
      "function",
      "@mix/cli must export createDevServer()"
    );

    for (const variant of [
      { name: "ts-scss", typescript: true, styleFormat: "scss", ext: "tix" },
      { name: "js-less", typescript: false, styleFormat: "less", ext: "mix" }
    ]) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `mix-dev-${variant.name}-`));
      const appDir = path.join(tmpDir, "app");

      create({
        projectName: "app",
        targetDir: appDir,
        typescript: variant.typescript,
        styleFormat: variant.styleFormat
      });

      // Verify scaffolded package.json uses `mix dev`
      const pkgJson = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf-8"));
      assert.strictEqual(pkgJson.scripts.dev, "mix dev");

      const server = await cliMod.createDevServer({
        rootDir: appDir,
        port: 0,
        silent: true
      });

      try {
        assert.ok(server.port > 0, "Dev server must bind to an ephemeral port");
        const baseUrl = `http://127.0.0.1:${server.port}`;

        // 1. SPA fallback on / and /tasks
        const rootRes = await globalThis.fetch(`${baseUrl}/`, {
          headers: { Accept: "text/html" }
        });
        assert.strictEqual(rootRes.status, 200);
        const rootHtml = await rootRes.text();
        assert.ok(rootHtml.includes("/src/main.mix"), "Root HTML must load /src/main.mix");
        assert.ok(rootHtml.includes("/@mix/hmr-client.js"), "Root HTML must inject HMR client");

        const spaFallbackRes = await globalThis.fetch(`${baseUrl}/tasks`, {
          headers: { Accept: "text/html" }
        });
        assert.strictEqual(spaFallbackRes.status, 200);
        const spaHtml = await spaFallbackRes.text();
        assert.ok(spaHtml.includes("/src/main.mix"), "SPA fallback for /tasks must serve index HTML");

        // 2. Transform /src/pages/HomePage.{tix|mix} via @mix/vite-plugin with HMR and rewritten @mix/* specifiers
        const homeRes = await globalThis.fetch(`${baseUrl}/src/pages/HomePage.${variant.ext}`);
        assert.strictEqual(homeRes.status, 200);
        assert.ok(
          (homeRes.headers.get("content-type") ?? "").includes("javascript"),
          "Compiled component must be served as JavaScript"
        );
        const homeJs = await homeRes.text();
        assert.ok(
          homeJs.includes("/@modules/@mix/runtime"),
          `Expected bare @mix/runtime specifier to be rewritten to /@modules/@mix/runtime, got:\n${homeJs}`
        );
        assert.ok(
          homeJs.includes("import.meta.hot") || homeJs.includes("__mix_hmr"),
          "Expected HMR acceptance code in dev transform output"
        );

        // 3. Fetch resolved bare module /@modules/@mix/runtime
        const runtimeModRes = await globalThis.fetch(`${baseUrl}/@modules/@mix/runtime`);
        assert.strictEqual(runtimeModRes.status, 200);
        const runtimeModJs = await runtimeModRes.text();
        assert.ok(runtimeModJs.includes("signal"), "Resolved @mix/runtime module must export signal");
      } finally {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  it("2. File edit in scaffolded project triggers automated HMR update event and invalidates compiled module cache", async () => {
    const cliMod = await import("../../packages/cli/dist/index.js");
    assert.strictEqual(typeof cliMod.createDevServer, "function");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-dev-hmr-"));
    const appDir = path.join(tmpDir, "hmr-app");

    create({
      projectName: "hmr-app",
      targetDir: appDir,
      typescript: true,
      styleFormat: "scss"
    });

    const server = await cliMod.createDevServer({
      rootDir: appDir,
      port: 0,
      silent: true
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const homeFile = path.join(appDir, "src/pages/HomePage.tix");

      // Initial fetch to warm transform cache
      const initialRes = await globalThis.fetch(`${baseUrl}/src/pages/HomePage.tix`);
      assert.strictEqual(initialRes.status, 200);
      const initialJs = await initialRes.text();
      assert.strictEqual(initialJs.includes("HMR_UPDATED_HEADING_99"), false);

      // Subscribe to next HMR event and edit HomePage.tix on disk
      const hmrPromise = server.waitForHmrUpdate(5000);
      const originalSource = fs.readFileSync(homeFile, "utf-8");
      const updatedSource = originalSource.replace(
        "Enterprise Reactive Architecture",
        "HMR_UPDATED_HEADING_99"
      );
      fs.writeFileSync(homeFile, updatedSource, "utf-8");

      const hmrPayload = await hmrPromise;
      assert.strictEqual(hmrPayload.type, "update");
      assert.ok(
        hmrPayload.file.includes("HomePage.tix"),
        `Expected HMR payload for HomePage.tix, got: ${JSON.stringify(hmrPayload)}`
      );

      // Re-fetch and verify fresh compilation reflects edited source
      const nextRes = await globalThis.fetch(`${baseUrl}/src/pages/HomePage.tix?t=${Date.now()}`);
      assert.strictEqual(nextRes.status, 200);
      const nextJs = await nextRes.text();
      assert.ok(
        nextJs.includes("HMR_UPDATED_HEADING_99"),
        "Re-fetched module after HMR must contain updated source text"
      );
    } finally {
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("3. Showcase index.html and serve.mjs replace hand-maintained <script type='importmap'> with server-side bare specifier resolution", () => {
    const indexHtml = fs.readFileSync(path.join(repoRoot, "examples/showcase/index.html"), "utf-8");
    assert.strictEqual(
      indexHtml.includes('type="importmap"'),
      false,
      "examples/showcase/index.html must not rely on a hand-maintained importmap"
    );
  });
});
