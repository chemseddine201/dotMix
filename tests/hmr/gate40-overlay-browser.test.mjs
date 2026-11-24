/* global document, window, KeyboardEvent, requestAnimationFrame, fetch, Buffer, process */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchBrowser, browserSkipReason } from "../helpers/cdp-browser.mjs";
import { createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";
import { createPreviewServer } from "../../packages/cli/dist/commands/preview.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliBin = path.join(repoRoot, "packages/cli/dist/bin.js");
const evidenceDir = path.join(repoRoot, "reports/gate-40-evidence");

async function readOverlay(page) {
  return page.evaluate(() => {
    const el = document.querySelector("mix-error-overlay");
    if (!el || !el.shadowRoot) return null;
    const sr = el.shadowRoot;
    const dlg = sr.querySelector('[role="alertdialog"]');
    const activeRow = sr.querySelector(".frame-line.active");
    return {
      role: dlg?.getAttribute("role") ?? null,
      fileText: sr.querySelector(".file")?.textContent ?? "",
      activeLineNum: activeRow ? Number(activeRow.querySelector(".ln")?.textContent ?? "0") : 0,
      activeLineCode: activeRow?.querySelector(".code")?.textContent ?? "",
      text: sr.textContent ?? "",
      hasCodeFrame: Boolean(sr.querySelector(".frame")),
      hasStack: Boolean(sr.querySelector(".stack-box")),
      hasDocs: Boolean(sr.querySelector(".docs-link[href]")),
      hasCopy: Boolean(sr.querySelector(".btn-copy")),
      hasOpen: Boolean(sr.querySelector(".btn-open")),
      hasDismiss: Boolean(sr.querySelector(".dismiss"))
    };
  });
}

async function captureOverlayScreenshot(page, filename, theme) {
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: theme }]
  });
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    const ov = document.querySelector("mix-error-overlay");
    if (ov) ov.setAttribute("data-theme", t);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, theme);
  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  const base64 = shot?.result?.data ?? shot?.data;
  assert.ok(typeof base64 === "string" && base64.length > 100, "Screenshot must contain PNG data");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, filename), Buffer.from(base64, "base64"));
}

function lineNumberOf(src, needle) {
  const idx = src.split("\n").findIndex((l) => l.includes(needle));
  assert.ok(idx >= 0, `Needle not found in fixture: ${needle}`);
  return idx + 1;
}

describe("Gate 40 — Real-Browser Dev Overlay, Boundaries & Production Safety Net (CDP)", { skip: browserSkipReason }, () => {
  let browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    if (browser) await browser.close();
  });

  function createFixtureApp(files) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-gate40-cdp-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "gate40-cdp-app", type: "module", dependencies: { "@dotmix/runtime": "0.4.0" } })
    );
    fs.writeFileSync(
      path.join(tmpDir, "index.html"),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gate 40 Test</title></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>`
    );
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf-8");
    }
    return tmpDir;
  }

  it("E1/F1: shows overlay with EXACT source-mapped lines, component stack, dismiss/Escape, warning badge, HMR clear, and 4 screenshots", async () => {
    const appTix = `import { signal, createEffect, onMount } from "@dotmix/runtime";

export default function App() {
  const count = signal(0);
  const triggerEffect = signal(false);
  const user = signal({ profile: { name: "Ada" } });
  const items = signal([{ href: "/pro", label: "Pro" }, { href: "/docs", label: "Docs" }]);
  const dupList = signal(["same", "same"]);
  const badKeyActive = signal(false);

  createEffect(() => {
    if (triggerEffect()) {
      throw new Error("Effect exploded in App");
    }
  });

  onMount(() => {
    if (window.location.search.includes("mountErr=1")) {
      throw new Error("onMount exploded in App");
    }
  });

  function boomHandler() {
    throw new Error("Button click handler failed");
  }

  function boomPromise() {
    Promise.reject(new Error("Unhandled promise boom"));
  }

  return (
    <main id="app-shell">
      <h1 id="title">Gate 40 Demo</h1>
      <span id="counter">{count()}</span>
      <p id="user-name">{user().profile.name}</p>
      <button id="inc-btn" onClick={() => count.set(count() + 1)}>Inc</button>
      <button id="handler-btn" onClick={boomHandler}>Throw Handler</button>
      <button id="tmpl-crash-btn" onClick={() => user.set({} as { profile: { name: string } })}>Crash Template</button>
      <button id="effect-btn" onClick={() => triggerEffect.set(true)}>Throw Effect</button>
      <button id="promise-btn" onClick={boomPromise}>Reject Promise</button>
      <button id="key-btn" onClick={() => badKeyActive.set(true)}>Trigger Key Error</button>
      <ul id="dup-list">{each d in dupList()}<li>{d}</li>{endeach}</ul>
      {if badKeyActive()}
        <ul id="bad-key-list">{each (item, idx, item) in items()}<li>{item.label}</li>{endeach}</ul>
      {endif}
    </main>
  );
}
`;
    const EXPECTED = {
      effect: lineNumberOf(appTix, 'throw new Error("Effect exploded in App")'),
      onMount: lineNumberOf(appTix, 'throw new Error("onMount exploded in App")'),
      handler: lineNumberOf(appTix, 'throw new Error("Button click handler failed")'),
      promise: lineNumberOf(appTix, 'Promise.reject(new Error("Unhandled promise boom"))'),
      tmplExpr: lineNumberOf(appTix, "user().profile.name"),
      keyErr: lineNumberOf(appTix, "{each (item, idx, item) in items()}")
    };

    const tmpDir = createFixtureApp({
      "src/main.ts": `import { mount } from "@dotmix/runtime";\nimport App from "./App.tix";\nmount(App, document.getElementById("root")!);\n`,
      "src/App.tix": appTix
    });

    const server = await createDevServer({ rootDir: tmpDir, port: 0, silent: true });
    const page = await browser.newPage();
    try {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1120,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false
      });

      // Verify dev module includes inline sourceMappingURL with sourcesContent and project-relative file (G2)
      const servedApp = await fetch(`http://127.0.0.1:${server.port}/src/App.tix`).then((r) => r.text());
      const mapMatch = /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/.exec(servedApp);
      assert.ok(mapMatch, "Dev module must include inline base64 sourceMappingURL");
      const decodedMap = JSON.parse(Buffer.from(mapMatch[1], "base64").toString("utf-8"));
      assert.equal(decodedMap.file, "src/App.tix.js", "G2: inline map file must be project-relative");
      assert.ok(!/^[a-zA-Z]:/.test(decodedMap.file), "G2: inline map file must not contain disk path");
      assert.ok(Array.isArray(decodedMap.sourcesContent) && decodedMap.sourcesContent[0].includes("Button click handler failed"));

      // Verify /__mix/frame security + 7-line response + unavailable on unmapped generated line
      const frameOk = await fetch(`http://127.0.0.1:${server.port}/__mix/frame?file=src/App.tix&line=${EXPECTED.handler}&col=5`).then((r) => r.json());
      assert.equal(frameOk.lines.length, 7, "Frame endpoint must return 7 lines");
      const frameUnmapped = await fetch(`http://127.0.0.1:${server.port}/__mix/frame?file=src/App.tix&generated=1&line=1&col=1`).then((r) => r.json());
      assert.equal(frameUnmapped.unavailable, true);
      assert.deepEqual(frameUnmapped.lines, []);
      const frameTraversal = await fetch(`http://127.0.0.1:${server.port}/__mix/frame?file=../../package.json&line=1&col=1`);
      assert.equal(frameTraversal.status, 403, "Path traversal must be blocked");

      await page.goto(`http://127.0.0.1:${server.port}/`);
      await page.waitForSelector("#app-shell", { timeout: 10000 });
      await page.click("#inc-btn");
      assert.equal(await page.getText("#counter"), "1");

      // K4 implicit duplicate warning badge appears non-blocking; clicking opens warning details
      await page.waitForCondition(() => Boolean(document.querySelector("mix-warning-badge")), { timeout: 5000 });
      await page.evaluate(() => document.querySelector("mix-warning-badge")?.shadowRoot?.querySelector(".warn-pill")?.click());
      const badgeText = await page.evaluate(() => document.querySelector("mix-warning-badge")?.shadowRoot?.textContent ?? "");
      assert.ok(badgeText.includes("MIX_WARN_IMPLICIT_DUPLICATE_KEY"), badgeText);

      // 1. Event handler error -> exact line + active text + dark & light screenshots
      await page.click("#handler-btn");
      await page.waitForCondition(() => Boolean(document.querySelector("mix-error-overlay")?.shadowRoot?.querySelector(".frame-line.active")), { timeout: 5000 });
      const hOv = await readOverlay(page);
      assert.equal(hOv.role, "alertdialog");
      assert.ok(hOv.fileText.startsWith(`src/App.tix:${EXPECTED.handler}:`), `Expected handler line ${EXPECTED.handler}, got ${hOv.fileText}`);
      assert.equal(hOv.activeLineNum, EXPECTED.handler);
      assert.ok(hOv.activeLineCode.includes("Button click handler failed"), hOv.activeLineCode);
      assert.ok(hOv.hasCodeFrame && hOv.hasStack && hOv.hasDocs && hOv.hasCopy && hOv.hasOpen && hOv.hasDismiss);
      await captureOverlayScreenshot(page, "handler-error-dark.png", "dark");
      await captureOverlayScreenshot(page, "handler-error-light.png", "light");

      // Dismiss via Escape key; live app counter state preserved
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await page.waitForCondition(() => !document.querySelector("mix-error-overlay"), { timeout: 3000 });
      assert.equal(await page.getText("#counter"), "1", "App state must not be torn down");

      // 2. Explicit key error -> exact {each} line + active text + dark & light screenshots
      await page.click("#key-btn");
      await page.waitForCondition(() => Boolean(document.querySelector("mix-error-overlay")?.shadowRoot?.querySelector(".frame-line.active")), { timeout: 5000 });
      const kOv = await readOverlay(page);
      assert.ok(kOv.text.includes("MIX_ERR_INVALID_KEY"), kOv.text);
      assert.ok(kOv.fileText.startsWith(`src/App.tix:${EXPECTED.keyErr}:`), `Expected key line ${EXPECTED.keyErr}, got ${kOv.fileText}`);
      assert.equal(kOv.activeLineNum, EXPECTED.keyErr);
      assert.ok(kOv.activeLineCode.includes("{each (item, idx, item) in items()}"), kOv.activeLineCode);
      assert.ok(kOv.hasStack, "Must include component stack");
      await captureOverlayScreenshot(page, "key-error-dark.png", "dark");
      await captureOverlayScreenshot(page, "key-error-light.png", "light");

      // Dismiss button works
      await page.evaluate(() => document.querySelector("mix-error-overlay")?.shadowRoot?.querySelector(".dismiss")?.click());
      await page.waitForCondition(() => !document.querySelector("mix-error-overlay"), { timeout: 3000 });

      // 2b. G1: Template expression crash ({user().profile.name} when profile is undefined) + light screenshot
      await page.click("#tmpl-crash-btn");
      await page.waitForCondition(() => Boolean(document.querySelector("mix-error-overlay")?.shadowRoot?.querySelector(".frame-line.active")), { timeout: 5000 });
      const tOv = await readOverlay(page);
      assert.ok(tOv.fileText.startsWith(`src/App.tix:${EXPECTED.tmplExpr}:`), `Expected template line ${EXPECTED.tmplExpr}, got ${tOv.fileText}`);
      assert.equal(tOv.activeLineNum, EXPECTED.tmplExpr);
      assert.ok(tOv.activeLineCode.includes("user().profile.name"), tOv.activeLineCode);
      await captureOverlayScreenshot(page, "template-error-light.png", "light");
      await page.evaluate(() => document.querySelector("mix-error-overlay")?.shadowRoot?.querySelector(".dismiss")?.click());
      await page.waitForCondition(() => !document.querySelector("mix-error-overlay"), { timeout: 3000 });

      // 3. Reactive effect error -> exact createEffect throw line
      await page.click("#effect-btn");
      await page.waitForCondition(() => Boolean(document.querySelector("mix-error-overlay")?.shadowRoot?.querySelector(".frame-line.active")), { timeout: 5000 });
      const eOv = await readOverlay(page);
      assert.ok(eOv.fileText.startsWith(`src/App.tix:${EXPECTED.effect}:`), `Expected effect line ${EXPECTED.effect}, got ${eOv.fileText}`);
      assert.equal(eOv.activeLineNum, EXPECTED.effect);
      assert.ok(eOv.activeLineCode.includes("Effect exploded in App"), eOv.activeLineCode);

      // 4. Unhandled promise rejection -> exact Promise.reject line + multi-error pager (2 / 2)
      await page.click("#promise-btn");
      await page.waitForCondition(
        () => {
          const sr = document.querySelector("mix-error-overlay")?.shadowRoot;
          return Boolean(sr?.textContent?.includes("2 / 2") && sr?.querySelector(".frame-line.active .code")?.textContent?.includes("Unhandled promise boom"));
        },
        { timeout: 5000 }
      );
      const pOv = await readOverlay(page);
      assert.ok(pOv.fileText.startsWith(`src/App.tix:${EXPECTED.promise}:`), `Expected promise line ${EXPECTED.promise}, got ${pOv.fileText}`);
      assert.equal(pOv.activeLineNum, EXPECTED.promise);
      assert.ok(pOv.activeLineCode.includes("Unhandled promise boom"), pOv.activeLineCode);

      // 5. HMR edit fixing the file clears the overlay automatically
      const appPath = path.join(tmpDir, "src/App.tix");
      const updated = fs.readFileSync(appPath, "utf-8").replace("Gate 40 Demo", "Gate 40 Fixed");
      fs.writeFileSync(appPath, updated, "utf-8");
      await page.waitForCondition(
        () => !document.querySelector("mix-error-overlay") && document.querySelector("#title")?.textContent === "Gate 40 Fixed",
        { timeout: 6000 }
      );

      // 6. onMount error -> exact onMount throw line
      await page.goto(`http://127.0.0.1:${server.port}/?mountErr=1`);
      await page.waitForCondition(() => Boolean(document.querySelector("mix-error-overlay")?.shadowRoot?.querySelector(".frame-line.active")), { timeout: 5000 });
      const mOv = await readOverlay(page);
      assert.ok(mOv.fileText.startsWith(`src/App.tix:${EXPECTED.onMount}:`), `Expected onMount line ${EXPECTED.onMount}, got ${mOv.fileText}`);
      assert.equal(mOv.activeLineNum, EXPECTED.onMount);
      assert.ok(mOv.activeLineCode.includes("onMount exploded in App"), mOv.activeLineCode);

      // 7. Unmapped generated line -> shows "original position unavailable" and NO code frame
      await page.evaluate(() => {
        window.__mix_clear_error();
        window.__mix_show_error({ code: "MIX_RUNTIME_ERROR", message: "Unmapped line test", file: "src/App.tix", line: 1, column: 1, _generated: true });
      });
      await page.waitForCondition(
        () => (document.querySelector("mix-error-overlay")?.shadowRoot?.querySelector(".file")?.textContent ?? "").includes("original position unavailable"),
        { timeout: 5000 }
      );
      const uOv = await readOverlay(page);
      assert.equal(uOv.hasCodeFrame, false, "Unmapped generated line must render NO code frame");
      assert.ok(uOv.fileText.includes("src/App.tix:1:1"), uOv.fileText);
    } finally {
      await page.close();
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("E3/E5: production build renders root fallback & invokes onError in real browser with zero overlay code", async () => {
    const tmpDir = createFixtureApp({
      "mix.config.ts": `export default { errors: { report: "src/report.ts" } };\n`,
      "src/report.ts": `export default function report(err: unknown, info: { source: string }) {\n  (window as unknown as Record<string, unknown>).__prodReport = { msg: String(err), source: info.source };\n}\n`,
      "src/App.tix": `export default function App() {\n  throw new Error("Prod boom");\n  return (<main>never</main>);\n}\n`,
      "src/main.ts": `import { mount } from "@dotmix/runtime";\nimport App from "./App.tix";\nmount(App, document.getElementById("root")!);\n`
    });

    const buildRes = spawnSync(process.execPath, [cliBin, "build", "src", "dist", "--clean"], {
      cwd: tmpDir,
      encoding: "utf-8"
    });
    assert.equal(buildRes.status, 0, `mix build failed:\n${buildRes.stdout}\n${buildRes.stderr}`);

    const server = await createPreviewServer({ dir: path.join(tmpDir, "dist"), port: 0, host: "127.0.0.1", silent: true });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 4173;
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForSelector('[role="alert"]', { timeout: 10000 });
      const state = await page.evaluate(() => ({
        alertText: document.querySelector('[role="alert"]')?.textContent ?? "",
        hasReloadBtn: Boolean(document.querySelector('[role="alert"] button')),
        hasOverlay: Boolean(document.querySelector("mix-error-overlay")),
        report: window.__prodReport ?? null
      }));
      assert.ok(state.alertText.includes("Something went wrong"), state.alertText);
      assert.equal(state.hasReloadBtn, true);
      assert.equal(state.hasOverlay, false);
      assert.ok(state.report && state.report.msg.includes("Prod boom"));
    } finally {
      await page.close();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
