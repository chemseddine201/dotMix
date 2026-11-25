/* global process, document */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build, createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";
import { launchBrowser, browserSkipReason } from "../helpers/cdp-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliBin = path.join(repoRoot, "packages/cli/dist/bin.js");

function createCssOrderFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mix-gate41-b1-"));
  const src = path.join(root, "src");
  fs.mkdirSync(path.join(src, "styles"), { recursive: true });
  fs.mkdirSync(path.join(src, "components"), { recursive: true });
  fs.mkdirSync(path.join(src, "pages"), { recursive: true });

  fs.symlinkSync(
    path.join(repoRoot, "node_modules"),
    path.join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "gate41-b1-css-order", private: true, type: "module" }, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(root, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><title>B1</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
    "utf-8"
  );
  fs.writeFileSync(
    path.join(root, "mix.config.ts"),
    'export default { build: { clean: true, static: true } };\n',
    "utf-8"
  );

  fs.writeFileSync(path.join(src, "styles/a.css"), ".order-a { --step: 2; color: rgb(2, 2, 2); }\n", "utf-8");
  fs.writeFileSync(path.join(src, "styles/z.css"), ".order-z { --step: 1; color: rgb(1, 1, 1); }\n", "utf-8");
  fs.writeFileSync(path.join(src, "styles/m.css"), ".order-m { --step: 3; color: rgb(3, 3, 3); }\n", "utf-8");

  // Duplicate import of a.css in a child module imported after m.css must keep a.css at its first position (between z and m).
  fs.writeFileSync(
    path.join(src, "components/Badge.tix"),
    [
      'import "../styles/a.css";',
      "export default function Badge() {",
      '  return <span class="order-z order-a order-m">badge</span>;',
      "}",
      ""
    ].join("\n"),
    "utf-8"
  );

  fs.writeFileSync(
    path.join(src, "components/PageShell.tix"),
    [
      'import "../styles/z.css";',
      'import "../styles/a.css";',
      'import "../styles/m.css";',
      'import Badge from "./Badge.tix";',
      "export default function PageShell() {",
      '  return <main class="shell"><Badge /></main>;',
      "}",
      ""
    ].join("\n"),
    "utf-8"
  );

  fs.writeFileSync(
    path.join(src, "pages/HomePage.tix"),
    [
      'import PageShell from "../components/PageShell.tix";',
      "export default function HomePage() {",
      "  return <PageShell />;",
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
      "void routes;",
      'const el = document.getElementById("app");',
      "if (el) mount(() => HomePage({}), el);",
      ""
    ].join("\n"),
    "utf-8"
  );

  return {
    root,
    src,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function readMergedCss(distDir) {
  const assetsDir = path.join(distDir, "assets");
  const cssFile = fs.readdirSync(assetsDir).find((f) => /^styles-[a-f0-9]+\.css$/.test(f));
  assert.ok(cssFile, `Expected styles-*.css in ${assetsDir}`);
  return fs.readFileSync(path.join(assetsDir, cssFile), "utf-8");
}

function assertZAMOrder(cssText, label) {
  const idxZ = cssText.indexOf(".order-z");
  const idxA = cssText.indexOf(".order-a");
  const idxM = cssText.indexOf(".order-m");
  assert.ok(idxZ >= 0, `${label}: missing .order-z in:\n${cssText}`);
  assert.ok(idxA >= 0, `${label}: missing .order-a in:\n${cssText}`);
  assert.ok(idxM >= 0, `${label}: missing .order-m in:\n${cssText}`);
  assert.ok(idxZ < idxA && idxA < idxM, `${label}: expected z < a < m, got z=${idxZ}, a=${idxA}, m=${idxM}\n${cssText}`);
  assert.equal(cssText.indexOf(".order-a", idxA + 1), -1, `${label}: duplicate .order-a must not be emitted twice`);
}

describe("Gate 41 B1: Global CSS emitted in DFS import order (build, build --static, dev)", () => {
  it("emits z.css, a.css, m.css in import order with duplicate a.css kept at first position in mix build and mix build --static", () => {
    const fixture = createCssOrderFixture();
    try {
      const clientDist = path.join(fixture.root, "dist-client");
      const res = build({ inDir: fixture.src, outDir: clientDist, clean: true, silent: true });
      assert.equal(res.success, true);
      assertZAMOrder(readMergedCss(clientDist), "mix build");

      const staticDist = path.join(fixture.root, "dist-static");
      const env = { ...process.env, MIX_BROWSER_PATH: "" };
      const staticRun = spawnSync(
        process.execPath,
        [cliBin, "build", "src", staticDist, "--static", "--clean"],
        { cwd: fixture.root, env, encoding: "utf-8" }
      );
      assert.equal(staticRun.status, 0, `${staticRun.stdout}\n${staticRun.stderr}`);
      assertZAMOrder(readMergedCss(staticDist), "mix build --static");
    } finally {
      fixture.cleanup();
    }
  });

  it("injects z.css, a.css, m.css in import order without duplicating a.css after m.css in mix dev", { skip: browserSkipReason }, async () => {
    const fixture = createCssOrderFixture();
    const server = await createDevServer({ rootDir: fixture.root, port: 0, silent: true });
    let browser;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.goto(`${server.url}/`);
      await page.waitForSelector(".order-m");
      const combinedStyleText = await page.evaluate(() =>
        Array.from(document.head.querySelectorAll("style"))
          .map((s) => s.textContent ?? "")
          .join("\n")
      );
      assertZAMOrder(combinedStyleText, "mix dev DOM <style> order");
    } finally {
      if (browser) await browser.close();
      await server.close();
      fixture.cleanup();
    }
  });
});

