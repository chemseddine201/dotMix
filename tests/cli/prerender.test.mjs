/* global document */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { build } from "@dotmix/cli";
import { createPreviewServer } from "../../packages/cli/dist/commands/preview.js";
import { findInstalledBrowser, launchBrowser } from "../../packages/cli/dist/browser/index.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const cliBinary = path.join(repositoryRoot, "packages/cli/dist/bin.js");
const installedBrowser = findInstalledBrowser();

function createRouterPrerenderFixture({ failRouteOnAbout = false } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mix-prerender-"));
  const projectDir = path.join(tempRoot, "prerender-app");
  const srcDir = path.join(projectDir, "src");
  const pagesDir = path.join(srcDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  fs.symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(projectDir, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );

  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "prerender-app", private: true, type: "module" }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(projectDir, "index.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Initial Shell</title></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
    "utf8"
  );
  fs.writeFileSync(
    path.join(pagesDir, "HomePage.mix"),
    [
      "<style>",
      "  .hero { color: navy; }",
      "</style>",
      'import { useHead } from "@dotmix/router";',
      "export default function HomePage() {",
      '  useHead({ title: "Home Route Title" });',
      "  return (",
      '    <section id="home-unique" class="hero">',
      "      <h1>Home Heading</h1>",
      "    </section>",
      "  );",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(pagesDir, "AboutPage.mix"),
    [
      "<style>",
      "  .about { color: teal; }",
      "</style>",
      'import { useHead } from "@dotmix/router";',
      "export default function AboutPage() {",
      '  useHead({ title: "About Route Title" });',
      failRouteOnAbout ? '  console.error("simulated-about-error");' : "",
      "  return (",
      '    <section id="about-unique" class="about">',
      "      <h1>About Heading</h1>",
      "    </section>",
      "  );",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(srcDir, "App.mix"),
    [
      'import { RouterProvider, Outlet } from "@dotmix/router";',
      "export default function App(props) {",
      "  return (",
      '    <main class="shell">',
      "      <RouterProvider router={props.router}>",
      "        <Outlet />",
      "      </RouterProvider>",
      "    </main>",
      "  );",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(srcDir, "main.ts"),
    [
      'import { mount } from "@dotmix/runtime";',
      'import { createBrowserRouter } from "@dotmix/router";',
      'import App from "./App.mix";',
      'import HomePage from "./pages/HomePage.mix";',
      'import AboutPage from "./pages/AboutPage.mix";',
      "const router = createBrowserRouter([",
      '  { path: "/", component: HomePage },',
      '  { path: "/about", component: AboutPage }',
      "]);",
      'const container = document.getElementById("root");',
      "if (container) mount(App, container, { router });",
      "// Client-only state an app writes on <html>/<body> (themes, cursor, motion); never part of static output.",
      'document.documentElement.classList.add("app-booted");',
      'document.body.setAttribute("data-app-state", "ready");',
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

describe("static route prerendering", () => {
  it("produces deterministic output without --prerender even when no browser is installed", () => {
    const fixture = createRouterPrerenderFixture();
    try {
      const distOne = path.join(fixture.projectDir, "dist-one");
      const distTwo = path.join(fixture.projectDir, "dist-two");

      const firstRun = spawnSync(process.execPath, [cliBinary, "build", "src", "dist-one"], {
        cwd: fixture.projectDir,
        env: { ...process.env, MIX_BROWSER_PATH: "none" },
        encoding: "utf8"
      });
      assert.equal(firstRun.status, 0, `${firstRun.stdout}\n${firstRun.stderr}`);

      const secondRun = spawnSync(process.execPath, [cliBinary, "build", "src", "dist-two"], {
        cwd: fixture.projectDir,
        env: { ...process.env, MIX_BROWSER_PATH: "none" },
        encoding: "utf8"
      });
      assert.equal(secondRun.status, 0, `${secondRun.stdout}\n${secondRun.stderr}`);

      const htmlOne = fs.readFileSync(path.join(distOne, "index.html"), "utf8");
      const htmlTwo = fs.readFileSync(path.join(distTwo, "index.html"), "utf8");
      assert.equal(htmlOne, htmlTwo);
      assert.equal(htmlOne.includes("data-mix-prerendered"), false);
      assert.equal(htmlOne.includes("Home Heading"), false);

      const directResult = build({ inDir: fixture.srcDir, outDir: path.join(fixture.projectDir, "dist-direct"), silent: true });
      assert.equal(directResult.success, true);
      assert.equal(
        fs.readFileSync(path.join(fixture.projectDir, "dist-direct", "index.html"), "utf8"),
        htmlOne
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("fails with exit code 1 and mentions MIX_BROWSER_PATH when --prerender has no browser", () => {
    const fixture = createRouterPrerenderFixture();
    try {
      const result = spawnSync(process.execPath, [cliBinary, "build", "src", "dist", "--prerender", "/"], {
        cwd: fixture.projectDir,
        env: { ...process.env, MIX_BROWSER_PATH: "none" },
        encoding: "utf8"
      });
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /MIX_BROWSER_PATH/);
    } finally {
      fixture.cleanup();
    }
  });

  it(
    "prerenders / and /about into static HTML and replaces markup cleanly on client boot",
    {
      skip: installedBrowser
        ? false
        : "No compatible Chromium browser found (set MIX_BROWSER_PATH); skipping prerender browser test"
    },
    async () => {
      const fixture = createRouterPrerenderFixture();
      let server = null;
      let browser = null;
      try {
        const buildRun = spawnSync(
          process.execPath,
          [cliBinary, "build", "src", "dist", "--prerender", "/,/about"],
          {
            cwd: fixture.projectDir,
            encoding: "utf8"
          }
        );
        assert.equal(buildRun.status, 0, `${buildRun.stdout}\n${buildRun.stderr}`);

        const homeHtmlPath = path.join(fixture.distDir, "index.html");
        const aboutHtmlPath = path.join(fixture.distDir, "about", "index.html");
        assert.equal(fs.existsSync(homeHtmlPath), true);
        assert.equal(fs.existsSync(aboutHtmlPath), true);

        const homeHtml = fs.readFileSync(homeHtmlPath, "utf8");
        const aboutHtml = fs.readFileSync(aboutHtmlPath, "utf8");

        assert.ok(homeHtml.includes("Home Heading"));
        assert.ok(homeHtml.includes("Home Route Title"));
        assert.ok(homeHtml.includes("data-mix-prerendered"));
        assert.ok(homeHtml.includes('type="importmap"'));
        assert.ok(homeHtml.includes('rel="modulepreload"'));
        assert.ok(homeHtml.includes('<script type="module"'));

        for (const pageHtml of [homeHtml, aboutHtml]) {
          const htmlTag = pageHtml.slice(pageHtml.indexOf("<html"), pageHtml.indexOf(">", pageHtml.indexOf("<html")) + 1);
          const bodyTag = pageHtml.slice(pageHtml.indexOf("<body"), pageHtml.indexOf(">", pageHtml.indexOf("<body")) + 1);
          assert.equal(htmlTag, '<html lang="en">', "the <html> attributes must be the shell's, not client state");
          assert.equal(bodyTag, "<body>", "the <body> attributes must be the shell's, not client state");
        }

        assert.ok(aboutHtml.includes("About Heading"));
        assert.ok(aboutHtml.includes("About Route Title"));
        assert.ok(aboutHtml.includes("data-mix-prerendered"));
        assert.ok(aboutHtml.includes('type="importmap"'));
        assert.ok(aboutHtml.includes('rel="modulepreload"'));

        server = await createPreviewServer({ dir: fixture.distDir, port: 0, host: "127.0.0.1", silent: true });
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 4173;
        browser = await launchBrowser();

        for (const [routePath, uniqueSelector, expectedHeading] of [
          ["/", "#home-unique", "Home Heading"],
          ["/about", "#about-unique", "About Heading"]
        ]) {
          const page = await browser.newPage();
          await page.goto(`http://127.0.0.1:${port}${routePath}`);
          await page.waitForCondition(
            (selector) => {
              const container = document.getElementById("root");
              return Boolean(
                container &&
                  !container.hasAttribute("data-mix-prerendered") &&
                  document.querySelector(selector)
              );
            },
            { timeout: 10000 },
            uniqueSelector
          );

          const verification = await page.evaluate((selector) => {
            const matches = document.querySelectorAll(selector);
            const styleTags = Array.from(document.head.querySelectorAll("style[data-mix-style]"));
            const styleIds = styleTags.map((el) => el.getAttribute("data-mix-style"));
            return {
              copyCount: matches.length,
              headingText: matches[0]?.textContent?.trim() ?? "",
              styleIds,
              uniqueStyleIdCount: new Set(styleIds).size
            };
          }, uniqueSelector);

          assert.equal(verification.copyCount, 1);
          assert.equal(verification.headingText, expectedHeading);
          assert.equal(verification.styleIds.length, verification.uniqueStyleIdCount);
          assert.deepEqual(page.getConsoleErrors(), []);
          await page.close();
        }
      } finally {
        if (browser) await browser.close();
        if (server) await new Promise((resolve) => server.close(resolve));
        fixture.cleanup();
      }
    }
  );

  it(
    "fails the build with the route and error message when a route logs a console error",
    {
      skip: installedBrowser
        ? false
        : "No compatible Chromium browser found (set MIX_BROWSER_PATH); skipping prerender console error test"
    },
    async () => {
      const fixture = createRouterPrerenderFixture({ failRouteOnAbout: true });
      try {
        const buildRun = spawnSync(
          process.execPath,
          [cliBinary, "build", "src", "dist", "--prerender", "/,/about"],
          {
            cwd: fixture.projectDir,
            encoding: "utf8"
          }
        );
        assert.equal(buildRun.status, 1);
        const combinedOutput = buildRun.stdout + buildRun.stderr;
        assert.ok(combinedOutput.includes("/about"), combinedOutput);
        assert.ok(combinedOutput.includes("simulated-about-error"), combinedOutput);
      } finally {
        fixture.cleanup();
      }
    }
  );
});
