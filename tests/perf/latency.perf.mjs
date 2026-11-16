/* global performance, console, setTimeout */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launchBrowser, browserSkipReason } from "../helpers/cdp-browser.mjs";
import { perfBudgetScale } from "./budget-scale.mjs";
import { createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../hmr/fixtures/test-app");

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

describe("HMR latency performance budgets", { skip: browserSkipReason }, () => {
  let browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    if (browser) await browser.close();
  });

  it("measures 30 component edits (budget <= 100ms) and 30 CSS edits (budget <= 50ms)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-hmr-latency-"));
    fs.cpSync(fixtureDir, tmpDir, { recursive: true });
    const server = await createDevServer({ rootDir: tmpDir, port: 0, silent: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.waitForSelector("#app-title", { timeout: 10000 });

    try {
      const cssFile = path.join(tmpDir, "src/StyledBox.mix");
      let baseCssSrc = fs.readFileSync(cssFile, "utf-8");

      // Warm up CSS edit
      for (let w = 1; w <= 3; w++) {
        const ackPromise = server.waitForClientAck();
        baseCssSrc = baseCssSrc.replace(/background-color:\s*rgb\([^)]+\);/, `background-color: rgb(${w}, 100, 150);`);
        fs.writeFileSync(cssFile, baseCssSrc, "utf-8");
        await ackPromise;
      }

      // 1. Measure 30 CSS-only edits
      const cssLatencies = [];
      for (let i = 0; i < 30; i++) {
        const newColor = `rgb(${i * 5}, 100, 150)`;
        const newSrc = baseCssSrc.replace(/background-color:\s*rgb\([^)]+\);/, `background-color: ${newColor};`);
        const ackPromise = server.waitForClientAck();
        const t0 = performance.now();
        fs.writeFileSync(cssFile, newSrc, "utf-8");
        await ackPromise;
        const elapsed = performance.now() - t0;
        cssLatencies.push(elapsed);
        baseCssSrc = newSrc;
        await new Promise((r) => setTimeout(r, 40));
      }

      const cssP50 = percentile(cssLatencies, 50);
      const cssP95 = percentile(cssLatencies, 95);
      console.log(`[Latency] CSS-only edit 30 saves: median = ${cssP50.toFixed(2)}ms, p95 = ${cssP95.toFixed(2)}ms`);

      // 2. Measure 30 Single-Component edits
      const compFile = path.join(tmpDir, "src/Counter.mix");
      let baseCompSrc = fs.readFileSync(compFile, "utf-8");

      // Warm up component edit
      for (let w = 1; w <= 3; w++) {
        const ackPromise = server.waitForClientAck();
        baseCompSrc = baseCompSrc.replace(/<button class="inc-btn"[^>]*>[^<]*<\/button>/, `<button class="inc-btn" onClick={inc}>Increment Warmup${w}</button>`);
        fs.writeFileSync(compFile, baseCompSrc, "utf-8");
        await ackPromise;
      }

      const compLatencies = [];
      for (let i = 0; i < 30; i++) {
        const targetText = `Increment ${i}`;
        const newSrc = baseCompSrc.replace(/<button class="inc-btn"[^>]*>[^<]*<\/button>/, `<button class="inc-btn" onClick={inc}>${targetText}</button>`);
        const ackPromise = server.waitForClientAck();
        const t0 = performance.now();
        fs.writeFileSync(compFile, newSrc, "utf-8");
        await ackPromise;
        const elapsed = performance.now() - t0;
        compLatencies.push(elapsed);
        baseCompSrc = newSrc;
        await new Promise((r) => setTimeout(r, 40));
      }

      const compP50 = percentile(compLatencies, 50);
      const compP95 = percentile(compLatencies, 95);
      console.log(`[Latency] Component edit 30 saves: median = ${compP50.toFixed(2)}ms, p95 = ${compP95.toFixed(2)}ms`);

      const cssBudgetMs = 50 * perfBudgetScale;
      const componentBudgetMs = 100 * perfBudgetScale;
      assert.ok(cssP95 <= cssBudgetMs, `CSS p95 must be <= ${cssBudgetMs}ms, got p50=${cssP50.toFixed(2)}ms, p95=${cssP95.toFixed(2)}ms`);
      assert.ok(compP95 <= componentBudgetMs, `Component p95 must be <= ${componentBudgetMs}ms, got p50=${compP50.toFixed(2)}ms, p95=${compP95.toFixed(2)}ms`);
    } finally {
      await page.close();
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
