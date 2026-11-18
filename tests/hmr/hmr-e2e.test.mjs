/* global document, window, sessionStorage, setTimeout */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launchBrowser, browserSkipReason } from "../helpers/cdp-browser.mjs";
import { createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures/test-app");

describe("Instant hot updates in a real browser (E1-E11)", { skip: browserSkipReason }, () => {
  let browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    if (browser) await browser.close();
  });

  async function setupApp() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-hmr-e2e-"));
    fs.cpSync(fixtureDir, tmpDir, { recursive: true });
    const server = await createDevServer({ rootDir: tmpDir, port: 0, silent: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.waitForSelector("#app-title", { timeout: 10000 });
    return {
      tmpDir,
      server,
      page,
      async cleanup() {
        await page.close();
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    };
  }

  it("E1: template text edit shows in DOM and signal state is kept", async () => {
    const env = await setupApp();
    try {
      await env.page.click("#counter-1 .inc-btn");
      const beforeCount = await env.page.getText("#counter-1 .count-value");
      assert.strictEqual(beforeCount, "Count: 1");

      const counterFile = path.join(env.tmpDir, "src/Counter.mix");
      const src = fs.readFileSync(counterFile, "utf-8");
      fs.writeFileSync(counterFile, src.replace("Count: {count()}", "Total: {count()}"), "utf-8");

      await env.page.waitForCondition(
        () => document.querySelector("#counter-1 .count-value")?.textContent?.includes("Total:"),
        { timeout: 3500 }
      );
      const afterText = await env.page.getText("#counter-1 .count-value");
      assert.strictEqual(afterText, "Total: 1", "Counter signal must retain live state after template edit");
    } finally {
      await env.cleanup();
    }
  });

  it("E2: two component instances route event handlers independently before and after edit", async () => {
    const env = await setupApp();
    try {
      await env.page.click("#counter-1 .inc-btn");
      assert.strictEqual(await env.page.getText("#counter-1 .count-value"), "Count: 1");
      assert.strictEqual(await env.page.getText("#counter-2 .count-value"), "Count: 0");

      const counterFile = path.join(env.tmpDir, "src/Counter.mix");
      const src = fs.readFileSync(counterFile, "utf-8");
      fs.writeFileSync(counterFile, src.replace("Increment", "Add +1"), "utf-8");

      await env.page.waitForCondition(
        () => document.querySelector("#counter-1 .inc-btn")?.textContent?.includes("Add +1"),
        { timeout: 3500 }
      );

      const aValBefore = parseInt((await env.page.getText("#counter-1 .count-value")).replace(/\D/g, ""), 10);
      const bValBefore = parseInt((await env.page.getText("#counter-2 .count-value")).replace(/\D/g, ""), 10);

      await env.page.click("#counter-1 .inc-btn");
      const aValAfter = parseInt((await env.page.getText("#counter-1 .count-value")).replace(/\D/g, ""), 10);
      const bValAfter = parseInt((await env.page.getText("#counter-2 .count-value")).replace(/\D/g, ""), 10);

      assert.strictEqual(aValAfter, aValBefore + 1, "Clicking A must increment A");
      assert.strictEqual(bValAfter, bValBefore, "Clicking A must NOT increment B");

      await env.page.click("#counter-2 .inc-btn");
      const aValFinal = parseInt((await env.page.getText("#counter-1 .count-value")).replace(/\D/g, ""), 10);
      const bValFinal = parseInt((await env.page.getText("#counter-2 .count-value")).replace(/\D/g, ""), 10);

      assert.strictEqual(aValFinal, aValAfter, "Clicking B must NOT increment A");
      assert.strictEqual(bValFinal, bValAfter + 1, "Clicking B must increment B");
    } finally {
      await env.cleanup();
    }
  });

  it("E3: CSS-only edit updates getComputedStyle with stable scope attribute and single style tag", async () => {
    const env = await setupApp();
    try {
      const initialBg = await env.page.evaluate(() =>
        window.getComputedStyle(document.getElementById("styled-box")).backgroundColor
      );
      assert.strictEqual(initialBg, "rgb(255, 0, 0)");

      const initialScopeAttr = await env.page.evaluate(() => {
        const el = document.getElementById("styled-box");
        for (const attr of el.attributes) {
          if (attr.name.startsWith("data-mix-")) return attr.name;
        }
        return null;
      });
      assert.ok(initialScopeAttr, "Element must have data-mix-* scope attribute");

      const styleFile = path.join(env.tmpDir, "src/StyledBox.mix");
      const src = fs.readFileSync(styleFile, "utf-8");
      fs.writeFileSync(styleFile, src.replace("rgb(255, 0, 0)", "rgb(0, 255, 0)"), "utf-8");

      await env.page.waitForCondition(() => {
        const bg = window.getComputedStyle(document.getElementById("styled-box")).backgroundColor;
        return bg === "rgb(0, 255, 0)";
      }, { timeout: 8000 });

      const nextScopeAttr = await env.page.evaluate(() => {
        const el = document.getElementById("styled-box");
        for (const attr of el.attributes) {
          if (attr.name.startsWith("data-mix-")) return attr.name;
        }
        return null;
      });
      assert.strictEqual(nextScopeAttr, initialScopeAttr, "Scope attribute must remain stable across CSS edit");

      const styleCount = await env.page.evaluate(() =>
        document.querySelectorAll("style[data-mix-file*='StyledBox']").length
      );
      assert.strictEqual(styleCount, 1, "Exactly one style element must exist for the component in dev");
    } finally {
      await env.cleanup();
    }
  });

  it("E4: editing imported JS helper updates component; editing entry helper causes full reload", async () => {
    const env = await setupApp();
    try {
      await env.page.evaluate(() => { window.__marker = 42; });
      const helperFile = path.join(env.tmpDir, "src/helper.js");
      fs.writeFileSync(helperFile, 'export function getGreeting() { return "Greeting: Hello v2"; }', "utf-8");

      await env.page.waitForCondition(
        () => document.querySelector("#helper-msg")?.textContent?.includes("Hello v2"),
        { timeout: 3500 }
      );
      const marker = await env.page.evaluate(() => window.__marker);
      assert.strictEqual(marker, 42, "Module update must be contained without full reload");

      const entryHelperFile = path.join(env.tmpDir, "src/entry-helper.js");
      fs.writeFileSync(entryHelperFile, 'export const entryVersion = "entry-v2";', "utf-8");

      await env.page.waitForCondition(
        () => window.__entryVersion === "entry-v2",
        { timeout: 3500 }
      );
      const markerAfterEntry = await env.page.evaluate(() => window.__marker);
      assert.strictEqual(markerAfterEntry, undefined, "Editing entry dependency must trigger full reload");
    } finally {
      await env.cleanup();
    }
  });

  it("E5: syntax error shows overlay while keeping state; fix clears overlay", async () => {
    const env = await setupApp();
    try {
      await env.page.click("#counter-1 .inc-btn");
      assert.strictEqual(await env.page.getText("#counter-1 .count-value"), "Count: 1");

      const counterFile = path.join(env.tmpDir, "src/Counter.mix");
      const validSrc = fs.readFileSync(counterFile, "utf-8");
      fs.writeFileSync(counterFile, validSrc.replace("<div class=", "<div class=<<>>"), "utf-8");

      await env.page.waitForCondition(() => {
        const overlay = document.querySelector("mix-error-overlay");
        return overlay !== null && overlay.shadowRoot !== null;
      }, { timeout: 8000 });

      assert.strictEqual(await env.page.getText("#counter-1 .count-value"), "Count: 1");

      fs.writeFileSync(counterFile, validSrc.replace("Count: {count()}", "Recovered: {count()}"), "utf-8");

      await env.page.waitForCondition(
        () => document.querySelector("mix-error-overlay") === null &&
              document.querySelector("#counter-1 .count-value")?.textContent?.includes("Recovered:"),
        { timeout: 5000 }
      );
      assert.strictEqual(await env.page.getText("#counter-1 .count-value"), "Recovered: 1");
    } finally {
      await env.cleanup();
    }
  });

  it("E6: runtime mount exception keeps prior DOM/state and shows overlay", async () => {
    const env = await setupApp();
    try {
      assert.strictEqual((await env.page.getText("#crashable-box")).trim(), "Crashable OK");

      const crashFile = path.join(env.tmpDir, "src/Crashable.mix");
      fs.writeFileSync(
        crashFile,
        'export default function Crashable() { throw new Error("CRASH_IN_SETUP"); return (<div class="crashable-box" id="crashable-box">Crashable OK</div>); }',
        "utf-8"
      );

      await env.page.waitForCondition(
        () => document.querySelector("mix-error-overlay") !== null,
        { timeout: 3500 }
      );
      assert.strictEqual((await env.page.getText("#crashable-box")).trim(), "Crashable OK");
    } finally {
      await env.cleanup();
    }
  });

  it("E7: added file resolves; deleted file returns 404 and does not serve stale content", async () => {
    const env = await setupApp();
    try {
      const extraFile = path.join(env.tmpDir, "src/extra.js");
      fs.writeFileSync(extraFile, 'export const extraVal = "ACTIVE";', "utf-8");

      const res = await globalThis.fetch(`http://127.0.0.1:${env.server.port}/src/extra.js`);
      assert.strictEqual(res.status, 200);

      fs.rmSync(extraFile);
      // Let watcher notice deletion
      await new Promise((r) => setTimeout(r, 200));

      const deletedRes = await globalThis.fetch(`http://127.0.0.1:${env.server.port}/src/extra.js`);
      assert.strictEqual(deletedRes.status, 404, "Server must not serve stale deleted content");
    } finally {
      await env.cleanup();
    }
  });

  it("E8: rapid bursts of 10 saves within 30ms coalesce into a single update", async () => {
    const env = await setupApp();
    try {
      await env.page.evaluate(() => {
        sessionStorage.removeItem("__mix_update_count");
      });

      const counterFile = path.join(env.tmpDir, "src/Counter.mix");
      const baseSrc = fs.readFileSync(counterFile, "utf-8");

      for (let i = 1; i <= 10; i++) {
        fs.writeFileSync(counterFile, baseSrc.replace("Count: {count()}", `Burst${i}: {count()}`), "utf-8");
        await new Promise((r) => setTimeout(r, 2));
      }

      await env.page.waitForCondition(
        () => document.querySelector("#counter-1 .count-value")?.textContent?.includes("Burst10:"),
        { timeout: 3500 }
      );
      assert.strictEqual(await env.page.getText("#counter-1 .count-value"), "Burst10: 0");

      await new Promise((r) => setTimeout(r, 150));
      const updateCount = await env.page.evaluate(() => {
        return parseInt(sessionStorage.getItem("__mix_update_count") || "0", 10);
      });
      assert.strictEqual(
        updateCount,
        1,
        `Expected exactly 1 coalesced update event received by browser, but received ${updateCount}`
      );
    } finally {
      await env.cleanup();
    }
  });

  it("E9: server restart causes client to detect new serverId and full reload once", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-hmr-restart-"));
    fs.cpSync(fixtureDir, tmpDir, { recursive: true });
    let server = await createDevServer({ rootDir: tmpDir, port: 0, silent: true });
    const port = server.port;
    const page = await browser.newPage();

    try {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.waitForSelector("#app-title", { timeout: 10000 });
      await page.evaluate(() => { window.__restartSessionMarker = "before-restart"; });

      await server.close();
      server = await createDevServer({ rootDir: tmpDir, port, silent: true });

      await page.waitForCondition(
        () => window.__restartSessionMarker === undefined,
        { timeout: 12000 }
      );
      assert.strictEqual(await page.evaluate(() => window.__restartSessionMarker), undefined);
    } finally {
      await page.close();
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("E10: parent template edit preserves child state for both keyed and unkeyed children", async () => {
    const env = await setupApp();
    try {
      await env.page.click("#unkeyed-child .child-btn");
      await env.page.click("#item-1 .child-btn");
      await env.page.click("#item-2 .child-btn");

      assert.strictEqual(await env.page.getText("#unkeyed-child .child-label"), "StaticChild: 6");
      assert.strictEqual(await env.page.getText("#item-1 .child-label"), "Alpha: 11");
      assert.strictEqual(await env.page.getText("#item-2 .child-label"), "Beta: 21");

      const parentFile = path.join(env.tmpDir, "src/ChildList.mix");
      const src = fs.readFileSync(parentFile, "utf-8");
      fs.writeFileSync(parentFile, src.replace("Children Section", "Updated Children List"), "utf-8");

      await env.page.waitForCondition(
        () => document.querySelector(".list-title")?.textContent?.includes("Updated Children List"),
        { timeout: 3500 }
      );

      assert.strictEqual(await env.page.getText("#unkeyed-child .child-label"), "StaticChild: 6");
      assert.strictEqual(await env.page.getText("#item-1 .child-label"), "Alpha: 11");
      assert.strictEqual(await env.page.getText("#item-2 .child-label"), "Beta: 21");
    } finally {
      await env.cleanup();
    }
  });

  it("E11: updated component does not disappear from UI on hot update", async () => {
    const environment = await setupApp();
    try {
      const initialCounterExists = await environment.page.evaluate(() => !!document.querySelector("#counter-1"));
      assert.strictEqual(initialCounterExists, true, "Counter-1 must be present before hot update");

      // Detach endMarker to reproduce boundary perturbation defect
      await environment.page.evaluate(() => {
        const rootContainer = document.querySelector(".app-root");
        if (rootContainer) {
          for (const node of Array.from(rootContainer.childNodes)) {
            if (node.nodeType === 8 && node.data.includes("mix:hmr-end:") && node.data.includes("Counter")) {
              node.remove();
              break;
            }
          }
        }
      });

      const counterFilePath = path.join(environment.tmpDir, "src/Counter.mix");
      const sourceContent = fs.readFileSync(counterFilePath, "utf-8");
      fs.writeFileSync(counterFilePath, sourceContent.replace("Count: {count()}", "Refreshed: {count()}"), "utf-8");

      await environment.page.waitForCondition(
        () => document.querySelector("#counter-1 .count-value")?.textContent?.includes("Refreshed:"),
        { timeout: 3500 }
      );

      const updatedCounterExists = await environment.page.evaluate(() => !!document.querySelector("#counter-1"));
      assert.strictEqual(updatedCounterExists, true, "Counter-1 must remain in the DOM after hot update");
      const updatedCounterText = await environment.page.getText("#counter-1 .count-value");
      assert.strictEqual(updatedCounterText, "Refreshed: 0");
    } finally {
      await environment.cleanup();
    }
  });
});
