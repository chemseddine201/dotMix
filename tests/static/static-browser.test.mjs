/* global process, window, document, performance */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../../packages/cli/dist/commands/preview.js";
import { findInstalledBrowser, launchBrowser } from "../../packages/cli/dist/browser/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliBin = path.join(repoRoot, "packages/cli/dist/bin.js");
const exampleDir = path.join(repoRoot, "examples/marketing-site");
const distDir = path.join(exampleDir, "dist");
const installedBrowser = findInstalledBrowser();

const ROUTES_TO_CHECK = [
  { path: "/", lang: "ar", dir: "rtl", hasIsland: true },
  { path: "/fr/", lang: "fr", dir: "ltr", hasIsland: true },
  { path: "/features", lang: "ar", dir: "rtl", hasIsland: false },
  { path: "/fr/features", lang: "fr", dir: "ltr", hasIsland: false },
  { path: "/pricing", lang: "ar", dir: "rtl", hasIsland: true },
  { path: "/fr/pricing", lang: "fr", dir: "ltr", hasIsland: true },
  { path: "/about", lang: "ar", dir: "rtl", hasIsland: true },
  { path: "/fr/about", lang: "fr", dir: "ltr", hasIsland: true }
];

describe("Gate 39 Real-Browser CDP Verification (examples/marketing-site)", () => {
  before(() => {
    const res = spawnSync(process.execPath, [cliBin, "build", "src", "dist", "--static", "--clean"], {
      cwd: exampleDir,
      encoding: "utf-8"
    });
    assert.equal(res.status, 0, `Marketing site static build failed:\n${res.stdout}\n${res.stderr}`);
  });

  it(
    "preserves all prerendered nodes (MutationObserver), enforces CSP, avoids head duplicates, ships 0 JS on static routes, and hydrates islands",
    {
      skip: installedBrowser
        ? false
        : "No compatible Chromium browser found; skipping real-browser static site test"
    },
    async () => {
      const server = await createPreviewServer({ dir: distDir, port: 0, host: "127.0.0.1", silent: true });
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 4173;
      const browser = await launchBrowser();

      try {
        for (const route of ROUTES_TO_CHECK) {
          const page = await browser.newPage();
          await page.send("Page.addScriptToEvaluateOnNewDocument", {
            source: `
              window.__mixRemovedNodes = [];
              window.__mixCspViolations = [];
              window.__mixCls = 0;
              try {
                new PerformanceObserver((list) => {
                  for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput) window.__mixCls += entry.value;
                  }
                }).observe({ type: "layout-shift", buffered: true });
              } catch {
                // Ignore if PerformanceObserver layout-shift unavailable
              }
              document.addEventListener("securitypolicyviolation", (ev) => {
                window.__mixCspViolations.push({
                  directive: ev.violatedDirective,
                  blockedURI: ev.blockedURI
                });
              });
              const attach = () => {
                const root = document.getElementById("app");
                if (!root) return requestAnimationFrame(attach);
                const obs = new MutationObserver((records) => {
                  for (const rec of records) {
                    for (const node of rec.removedNodes) {
                      window.__mixRemovedNodes.push(node.nodeName);
                    }
                  }
                });
                obs.observe(root, { childList: true, subtree: true });
              };
              attach();
            `
          });

          await page.goto(`http://127.0.0.1:${port}${route.path}`);

          if (route.hasIsland) {
            await page.waitForCondition(
              () => Boolean(document.querySelector("mix-island[data-hydrated='true']")),
              { timeout: 10000 }
            );
          }

          const inspection = await page.evaluate(() => {
            const jsResources = performance
              .getEntriesByType("resource")
              .filter((r) => r.name.endsWith(".js"))
              .map((r) => r.name);
            return {
              lang: document.documentElement.getAttribute("lang"),
              dir: document.documentElement.getAttribute("dir"),
              removedNodes: window.__mixRemovedNodes,
              cspViolations: window.__mixCspViolations,
              cls: window.__mixCls,
              hasMain: Boolean(document.querySelector("main")),
              hasH1: Boolean(document.querySelector("h1")),
              titleCount: document.head.querySelectorAll("title").length,
              descCount: document.head.querySelectorAll('meta[name="description"]').length,
              canonicalCount: document.head.querySelectorAll('link[rel="canonical"]').length,
              hreflangArCount: document.head.querySelectorAll('link[rel="alternate"][hreflang="ar"]').length,
              hreflangFrCount: document.head.querySelectorAll('link[rel="alternate"][hreflang="fr"]').length,
              hreflangDefaultCount: document.head.querySelectorAll('link[rel="alternate"][hreflang="x-default"]').length,
              jsResources
            };
          });

          assert.equal(inspection.lang, route.lang);
          assert.equal(inspection.dir, route.dir);
          assert.deepEqual(inspection.removedNodes, [], `Route ${route.path} removed prerendered DOM nodes`);
          assert.deepEqual(inspection.cspViolations, [], `Route ${route.path} triggered CSP violations`);
          assert.ok(inspection.cls < 0.01, `Route ${route.path} CLS must be < 0.01 (got ${inspection.cls})`);
          assert.equal(inspection.hasMain, true);
          assert.equal(inspection.hasH1, true);
          assert.equal(inspection.titleCount, 1);
          assert.equal(inspection.descCount, 1);
          assert.equal(inspection.canonicalCount, 1);
          assert.equal(inspection.hreflangArCount, 1);
          assert.equal(inspection.hreflangFrCount, 1);
          assert.equal(inspection.hreflangDefaultCount, 1);
          assert.deepEqual(page.getConsoleErrors(), []);

          if (!route.hasIsland) {
            assert.deepEqual(inspection.jsResources, [], `Static-only route ${route.path} must load 0 JS files`);
          } else {
            // Verify island button interactivity
            const beforePressed = await page.evaluate(() =>
              document.querySelector(".theme-toggle-btn")?.getAttribute("aria-pressed")
            );
            await page.click(".theme-toggle-btn");
            const afterState = await page.evaluate(() => ({
              pressed: document.querySelector(".theme-toggle-btn")?.getAttribute("aria-pressed"),
              theme: document.documentElement.getAttribute("data-theme")
            }));
            assert.notEqual(afterState.pressed, beforePressed);
            assert.equal(afterState.theme, afterState.pressed === "true" ? "dark" : null);
          }

          await page.close();
        }
      } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );

  it(
    "renders examples/marketing-site cleanly in full client CSR mode without reconciler key errors",
    {
      skip: installedBrowser
        ? false
        : "No compatible Chromium browser found; skipping real-browser CSR test"
    },
    async () => {
      const csrDist = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-csr-browser-"));
      const buildRes = spawnSync(process.execPath, [cliBin, "build", "src", csrDist, "--target", "client", "--clean"], {
        cwd: exampleDir,
        encoding: "utf-8"
      });
      assert.equal(buildRes.status, 0, `Marketing site CSR build failed:\n${buildRes.stdout}\n${buildRes.stderr}`);

      const server = await createPreviewServer({ dir: csrDist, port: 0, host: "127.0.0.1", silent: true });
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 4174;
      const browser = await launchBrowser();

      try {
        for (const p of ["/", "/features", "/fr/pricing", "/fr/about"]) {
          const page = await browser.newPage();
          await page.goto(`http://127.0.0.1:${port}${p}`);
          await page.waitForCondition(() => Boolean(document.querySelector("main h1")), { timeout: 10000 });
          const errors = page.getConsoleErrors();
          assert.deepEqual(errors, [], `CSR route ${p} produced console errors: ${errors.join("; ")}`);
          await page.close();
        }
      } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(csrDist, { recursive: true, force: true });
      }
    }
  );
});
