import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { create } from "../../node_modules/@dotmix/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

describe(": mix dev Server, @dotmix/vite-plugin Pipeline, HMR & SPA Fallback", () => {
  it("1. Starts mix dev on scaffolded TS+SCSS and JS+Less projects, serves SPA routes, and resolves bare @dotmix/* imports without import maps", async () => {
    const cliMod = await import("../../node_modules/@dotmix/cli/dist/index.js");
    assert.strictEqual(
      typeof cliMod.createDevServer,
      "function",
      "@dotmix/cli must export createDevServer()"
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
        assert.ok(rootHtml.includes("/@dotmix/hmr-client.js"), "Root HTML must inject HMR client");

        const spaFallbackRes = await globalThis.fetch(`${baseUrl}/tasks`, {
          headers: { Accept: "text/html" }
        });
        assert.strictEqual(spaFallbackRes.status, 200);
        const spaHtml = await spaFallbackRes.text();
        assert.ok(spaHtml.includes("/src/main.mix"), "SPA fallback for /tasks must serve index HTML");

        const splatDotFallbackRes = await globalThis.fetch(`${baseUrl}/reports/2026/perf.log`, {
          headers: { Accept: "text/html,application/xhtml+xml" }
        });
        assert.strictEqual(splatDotFallbackRes.status, 200, "SPA fallback for /reports/2026/perf.log must return 200 on refresh");
        const splatDotHtml = await splatDotFallbackRes.text();
        assert.ok(splatDotHtml.includes("/src/main.mix"), "SPA fallback for /reports/2026/perf.log must serve index HTML");

        // 2. Transform /src/pages/HomePage.{tix|mix} via @dotmix/vite-plugin with HMR and rewritten @dotmix/* specifiers
        const homeRes = await globalThis.fetch(`${baseUrl}/src/pages/HomePage.${variant.ext}`);
        assert.strictEqual(homeRes.status, 200);
        assert.ok(
          (homeRes.headers.get("content-type") ?? "").includes("javascript"),
          "Compiled component must be served as JavaScript"
        );
        const homeJs = await homeRes.text();
        assert.ok(
          homeJs.includes("/@modules/@dotmix/runtime"),
          `Expected bare @dotmix/runtime specifier to be rewritten to /@modules/@dotmix/runtime, got:\n${homeJs}`
        );
        assert.ok(
          homeJs.includes("import.meta.hot") || homeJs.includes("__mix_hmr"),
          "Expected HMR acceptance code in dev transform output"
        );

        // 3. Fetch resolved bare module /@modules/@dotmix/runtime and /@modules/@dotmix/runtime/core/index.js
        const runtimeModRes = await globalThis.fetch(`${baseUrl}/@modules/@dotmix/runtime`);
        assert.strictEqual(runtimeModRes.status, 200);
        const runtimeModJs = await runtimeModRes.text();
        assert.ok(runtimeModJs.includes("./core/index.js"), "Resolved @dotmix/runtime module must re-export ./core/index.js");

        const coreModRes = await globalThis.fetch(`${baseUrl}/@modules/@dotmix/runtime/core/index.js`);
        assert.strictEqual(coreModRes.status, 200);
        const coreModJs = await coreModRes.text();
        assert.ok(coreModJs.includes("signal"), "Resolved @dotmix/runtime/core/index.js must export signal");
      } finally {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  it("2. File edit in scaffolded project triggers automated HMR update event and invalidates compiled module cache", async () => {
    const cliMod = await import("../../node_modules/@dotmix/cli/dist/index.js");
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
        "Compiler-Native Web Application",
        "HMR_UPDATED_HEADING_99"
      );
      assert.notStrictEqual(updatedSource, originalSource);
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

  it("4. Resolves NodeNext .js/.tix/.ts imports, public/ static files, and leaves string literals intact under mix dev", async () => {
    const cliMod = await import("../../node_modules/@dotmix/cli/dist/index.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-dev-nodenext-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "public/demo-sources"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        '<!DOCTYPE html><html><head><title>Test</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>',
        "utf-8"
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/routes.ts"),
        'import App from "./App.tix";\nexport const routes = [{ path: "/", component: App }];\n',
        "utf-8"
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/App.tix"),
        'const example = "import { x } from \\"@dotmix/runtime\\"";\nexport default function App() {\n  return <p>{example}</p>;\n}\n',
        "utf-8"
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/main.ts"),
        'import { mount } from "@dotmix/runtime";\nimport App from "./App.tix";\nimport { routes } from "./routes.js";\nconsole.log(routes.length, App);\nmount(App, document.body);\n',
        "utf-8"
      );
      fs.writeFileSync(path.join(tmpDir, "public/sample.json"), '{"project":"dotMix"}\n', "utf-8");
      fs.writeFileSync(path.join(tmpDir, "public/demo-sources/App.tix"), "export default function App() {}\n", "utf-8");

      const server = await cliMod.createDevServer({ rootDir: tmpDir, port: 0, silent: true });
      try {
        const baseUrl = `http://127.0.0.1:${server.port}`;

        const mainRes = await globalThis.fetch(`${baseUrl}/src/main.ts`);
        assert.strictEqual(mainRes.status, 200);
        const mainJs = await mainRes.text();
        assert.ok(mainJs.includes('"/src/App.tix"'), `Expected /src/App.tix rewrite, got:\n${mainJs}`);
        assert.ok(mainJs.includes('"/src/routes.ts"'), `Expected /src/routes.ts rewrite, got:\n${mainJs}`);

        const routesRes = await globalThis.fetch(`${baseUrl}/src/routes.js`);
        assert.strictEqual(routesRes.status, 200);
        const routesJs = await routesRes.text();
        assert.ok(routesJs.includes('"/src/App.tix"'), `Expected /src/App.tix in routes, got:\n${routesJs}`);

        const appRes = await globalThis.fetch(`${baseUrl}/src/App.tix`);
        assert.strictEqual(appRes.status, 200);
        const appJs = await appRes.text();
        assert.ok(
          !appJs.includes('/@modules/@dotmix/runtime/index.js\\"') &&
            appJs.includes('from \\"@dotmix/runtime\\"'),
          `String literal import snippet must not be rewritten, got:\n${appJs}`
        );

        const jsonRes = await globalThis.fetch(`${baseUrl}/sample.json`);
        assert.strictEqual(jsonRes.status, 200);
        assert.ok((jsonRes.headers.get("content-type") ?? "").includes("application/json"));
        assert.strictEqual((await jsonRes.json()).project, "dotMix");

        const rawTixRes = await globalThis.fetch(`${baseUrl}/demo-sources/App.tix`);
        assert.strictEqual(rawTixRes.status, 200);
        assert.strictEqual(await rawTixRes.text(), "export default function App() {}\n");
      } finally {
        await server.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
