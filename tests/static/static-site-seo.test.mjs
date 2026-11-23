/* global process */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliBin = path.join(repoRoot, "packages/cli/dist/bin.js");
const exampleDir = path.join(repoRoot, "examples/marketing-site");
const isolatedDist = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-static-test-dist-"));

after(() => {
  fs.rmSync(isolatedDist, { recursive: true, force: true });
});

describe("Gate 39: Static Site Generation, Hydration, i18n, SEO, Images, and CSP", () => {
  it("builds examples/marketing-site with mix build --static and zero Chromium (MIX_BROWSER_PATH unset)", () => {
    const env = { ...process.env };
    delete env.MIX_BROWSER_PATH;
    env.MIX_BROWSER_PATH = "";

    const res = spawnSync(process.execPath, [cliBin, "build", "src", isolatedDist, "--static", "--clean", "--json"], {
      cwd: exampleDir,
      env,
      encoding: "utf-8"
    });
    assert.equal(res.status, 0, `Static build failed:\n${res.stdout}\n${res.stderr}`);

    const summary = JSON.parse(res.stdout);
    assert.equal(summary.success, true);
    assert.equal(summary.target, "static");
    assert.equal(summary.staticRoutes.length, 9);

    const byRoute = new Map(summary.staticRoutes.map((r) => [r.route, r]));
    assert.equal(byRoute.get("/features")?.jsBytes, 0);
    assert.equal(byRoute.get("/features")?.mode, "zero-js");
    assert.equal(byRoute.get("/fr/features")?.jsBytes, 0);
    assert.equal(byRoute.get("/fr/features")?.mode, "zero-js");
    assert.equal(byRoute.get("/404")?.jsBytes, 0);
    assert.equal(byRoute.get("/")?.mode, "islands");
    assert.ok((byRoute.get("/")?.jsBytes ?? 0) > 0);
  });

  it("emits 0-JS HTML for static-only routes and islands-only HTML for island routes", () => {
    const featuresHtml = fs.readFileSync(path.join(isolatedDist, "features/index.html"), "utf-8");
    assert.equal(featuresHtml.includes('<script type="module"'), false, "Static-only page must have no module scripts");
    assert.equal(featuresHtml.includes('<script type="importmap"'), false, "Static-only page must have no importmap");
    assert.equal(featuresHtml.includes('rel="modulepreload"'), false, "Static-only page must have no modulepreload");
    assert.equal(featuresHtml.includes('data-mix-placeholder="true"'), true);

    const homeHtml = fs.readFileSync(path.join(isolatedDist, "index.html"), "utf-8");
    assert.equal(homeHtml.includes("<mix-island"), true);
    assert.equal(homeHtml.includes('data-hydrate="idle"'), true, "Unannotated interactive component defaults to idle island hydration");
    assert.equal(homeHtml.includes("data-client="), false, "Astro-style data-client attribute must not be emitted");
    assert.equal(homeHtml.includes('data-island-module="/assets/components/ThemeToggle-'), true);

    const mapOpen = '<script type="importmap">';
    const mapStart = homeHtml.indexOf(mapOpen);
    assert.ok(mapStart !== -1);
    const importMap = JSON.parse(homeHtml.slice(mapStart + mapOpen.length, homeHtml.indexOf("</script>", mapStart)));
    assert.ok(importMap.imports["@dotmix/runtime"]);
    assert.match(
      importMap.imports["@dotmix/runtime"],
      /^\/vendor\/[a-f0-9]{8}\/@dotmix\/runtime\//,
      "Vendor URLs must be content-hashed so immutable Cache-Control never serves stale runtime releases (V1)"
    );
    assert.equal(Boolean(importMap.imports["@dotmix/router"]), false, "Islands page importmap must not pull @dotmix/router");
  });

  it("emits localized htmlAttrs, canonical, reciprocal hreflang, x-default, sitemap.xml, robots.txt, and 404.html", () => {
    const arHtml = fs.readFileSync(path.join(isolatedDist, "index.html"), "utf-8");
    const frHtml = fs.readFileSync(path.join(isolatedDist, "fr/index.html"), "utf-8");
    assert.ok(arHtml.includes('<html lang="ar" dir="rtl">'));
    assert.ok(frHtml.includes('<html lang="fr" dir="ltr">'));

    for (const html of [arHtml, frHtml]) {
      assert.ok(html.includes('rel="canonical"'));
      assert.ok(html.includes('rel="alternate" hreflang="ar" href="https://example.dotmix.dev/"'));
      assert.ok(html.includes('rel="alternate" hreflang="fr" href="https://example.dotmix.dev/fr/"'));
      assert.ok(html.includes('rel="alternate" hreflang="x-default" href="https://example.dotmix.dev/"'));
    }

    const sitemap = fs.readFileSync(path.join(isolatedDist, "sitemap.xml"), "utf-8");
    assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(sitemap.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
    assert.ok(sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
    assert.ok(sitemap.includes("<lastmod>"));
    assert.ok(sitemap.includes("<loc>https://example.dotmix.dev/</loc>"));
    assert.ok(sitemap.includes("<loc>https://example.dotmix.dev/fr/</loc>"));
    assert.ok(sitemap.includes("<loc>https://example.dotmix.dev/features</loc>"));
    assert.equal(sitemap.includes("/404"), false, "noindex /404 must be excluded from sitemap.xml");

    const robots = fs.readFileSync(path.join(isolatedDist, "robots.txt"), "utf-8");
    assert.ok(robots.includes("User-agent: *"));
    assert.ok(robots.includes("Sitemap: https://example.dotmix.dev/sitemap.xml"));

    const notFoundHtml = fs.readFileSync(path.join(isolatedDist, "404.html"), "utf-8");
    assert.ok(notFoundHtml.includes('name="robots" content="noindex"'));
  });

  it("emits dist/mix-csp.json and Cloudflare dist/_headers without unsafe-inline or JSON-LD hashing", () => {
    const cspJson = JSON.parse(fs.readFileSync(path.join(isolatedDist, "mix-csp.json"), "utf-8"));
    assert.equal(cspJson.version, "1.0");
    assert.equal(cspJson.algorithm, "sha256");
    assert.ok(cspJson.globalScriptHashes.length >= 2);
    assert.equal(cspJson.globalPolicy.includes("'unsafe-inline'"), false);
    assert.equal(cspJson.routes["/features"].scriptHashes.length, 1, "Only inline theme bootstrap script hashed on zero-js route");

    const headers = fs.readFileSync(path.join(isolatedDist, "_headers"), "utf-8");
    assert.ok(headers.includes("Content-Security-Policy:"));
    assert.ok(headers.includes("Strict-Transport-Security:"));
    assert.ok(headers.includes("X-Content-Type-Options: nosniff"));
    assert.ok(headers.includes("Referrer-Policy:"));
    assert.ok(headers.includes("Permissions-Policy:"));
    assert.ok(headers.includes("Cache-Control: public, max-age=31536000, immutable"));
  });

  it("universal useHead supports deepest-wins, htmlAttrs, meta, link, and XSS-safe JSON-LD", async () => {
    const runtime = await import("@dotmix/runtime");
    const collector = runtime.createUniversalHeadCollector();
    const evilPayload = "</script><script>alert(1)</script>\u2028\u2029&";

    runtime.runWithHeadCollector(collector, () => {
      runtime.useHead({
        titleTemplate: "%s | viteDz",
        title: "Layout Default",
        htmlAttrs: { lang: "ar", dir: "rtl" },
        meta: [{ name: "description", content: "Default desc" }],
        link: [{ rel: "canonical", href: "https://vitedz.com/" }]
      });
      runtime.useHead({
        title: "Home",
        meta: [
          { name: "description", content: "Deepest desc" },
          { property: "og:title", content: "Home OG" }
        ],
        link: [{ rel: "canonical", href: "https://vitedz.com/home" }],
        jsonLd: { "@context": "https://schema.org", "@type": "Organization", name: evilPayload }
      });
    });

    const html = collector.renderToHeadHtml();
    assert.ok(html.includes("<title>Home | viteDz</title>"));
    assert.ok(html.includes('content="Deepest desc"'));
    assert.equal(html.includes("Default desc"), false);
    assert.ok(html.includes('property="og:title" content="Home OG"'));
    assert.ok(html.includes('href="https://vitedz.com/home"'));
    assert.equal(html.includes("https://vitedz.com/\" "), false);
    assert.equal(html.includes("</script><script>"), false, "Raw </script> must be escaped");
    assert.equal(collector.getHtmlAttrs().dir, "rtl");

    const ldStart = html.indexOf('type="application/ld+json"');
    const bodyStart = html.indexOf(">", ldStart) + 1;
    const bodyEnd = html.indexOf("</script>", bodyStart);
    const parsed = JSON.parse(html.slice(bodyStart, bodyEnd));
    assert.equal(parsed.name, evilPayload);
  });

  it("hydrates matching subtrees without removing nodes and recovers mismatched subtrees locally", async () => {
    const runtime = await import("@dotmix/runtime");
    const win = new Window();
    globalThis.window = win;
    globalThis.document = win.document;

    try {
      const container = win.document.createElement("div");
      container.setAttribute("data-mix-ssr", "1");
      container.innerHTML =
        '<section id="stable">Keep Me</section><!--mix:if:0--><span id="wrong">Old</span><!--/mix:if:0-->';
      const stableBefore = container.querySelector("#stable");
      const mismatches = [];

      const App = () => {
        const frag = win.document.createDocumentFragment();
        const sec = runtime.createElement("section");
        runtime.setAttribute(sec, "id", "stable");
        const txt = runtime.createTextNode("Keep Me");
        runtime.insertNode(sec, txt);
        runtime.insertNode(frag, sec);

        runtime.createConditional(
          frag,
          [
            {
              condition: () => true,
              render: () => {
                const p = runtime.createElement("p");
                runtime.setAttribute(p, "id", "recovered");
                runtime.insertNode(p, runtime.createTextNode("Recovered"));
                return p;
              }
            }
          ],
          null
        );
        return [...frag.childNodes];
      };

      const handle = runtime.mount(App, container, {}, {
        hydrate: true,
        onMismatch: (m) => mismatches.push(m)
      });

      assert.equal(mismatches.length >= 1, true);
      assert.ok(container.querySelector("#stable") === stableBefore, "Sibling DOM node must be preserved");
      assert.equal(container.querySelector("#wrong"), null);
      assert.equal(container.querySelector("#recovered")?.textContent, "Recovered");
      handle.unmount();
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
  });

  it("@dotmix/image renders zero-network placeholders, AVIF/WebP srcset, and throws cleanly without sharp", async () => {
    const imageMod = await import("@dotmix/image");
    const imageBuild = await import("@dotmix/image/build");
    const runtime = await import("@dotmix/runtime");

    const placeholderHtml = imageMod.Picture({
      src: "/missing.jpg",
      alt: "Team",
      width: 800,
      height: 450,
      placeholder: true
    });
    assert.equal(typeof placeholderHtml, "string");
    assert.equal(placeholderHtml.includes("<img"), false);
    assert.ok(placeholderHtml.includes('role="img"'));
    assert.ok(placeholderHtml.includes('aria-label="Team"'));
    assert.ok(placeholderHtml.includes('viewBox="0 0 800 450"'));
    assert.ok(placeholderHtml.includes('width="800" height="450"'));

    imageMod.setImageManifest({
      "/hero.jpg": {
        src: "/hero.jpg",
        intrinsicWidth: 1200,
        intrinsicHeight: 600,
        fallbackSrc: "/assets/img/hero-800w.jpg",
        sources: [
          { format: "avif", type: "image/avif", srcset: "/assets/img/hero-800w.avif 800w" },
          { format: "webp", type: "image/webp", srcset: "/assets/img/hero-800w.webp 800w" }
        ]
      }
    });
    const pictureHtml = imageMod.Picture({
      src: "/hero.jpg",
      alt: "Hero",
      width: 1200,
      height: 600,
      fetchpriority: "high"
    });
    assert.ok(pictureHtml.includes('<source type="image/avif"'));
    assert.ok(pictureHtml.includes('<source type="image/webp"'));
    assert.ok(pictureHtml.includes('width="1200" height="600"'));
    assert.ok(pictureHtml.includes('fetchpriority="high"'));

    assert.throws(
      () => imageMod.Picture({ src: "javascript:alert(1)", alt: "Bad", width: 100, height: 100 }),
      /MIX_SEC_UNSAFE_URL/
    );

    await assert.rejects(
      () =>
        imageBuild.optimizeProjectImages([{ src: "/hero.jpg" }], {
          projectDirectory: exampleDir,
          outDir: path.join(exampleDir, "dist")
        }),
      (err) => err instanceof runtime.MixError && err.code === runtime.DiagnosticCodes.MIX_ERR_IMAGE_PROCESSOR_MISSING
    );
  });

  it("router i18n expands localized routes and switches locales cleanly", async () => {
    const routerMod = await import("@dotmix/router");
    const i18n = {
      locales: ["ar", "fr"],
      defaultLocale: "ar",
      prefixDefault: false,
      dir: { ar: "rtl", fr: "ltr" }
    };
    const expanded = routerMod.expandLocalizedRoutes(
      [
        { path: "/", component: () => "home" },
        { path: "/about", component: () => "about" },
        { path: "/404", component: () => "404", meta: { i18n: false } }
      ],
      i18n
    );
    assert.equal(expanded.length, 5);
    assert.deepEqual(
      routerMod.resolveLocaleFromPath("/fr/about", i18n),
      { locale: "fr", unprefixedPath: "/about" }
    );
    assert.equal(routerMod.formatLocalePath("/about", "fr", i18n), "/fr/about");
    assert.equal(routerMod.formatLocalePath("/fr/about", "ar", i18n), "/about");
  });

  it("auto-detects interactive islands (events, reactive state, onMount -> idle), keeps static components at 0 B JS, and honors {hydrate}/<Hydrate> and removes client:*", async () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-auto-hydrate-"));
    try {
      const srcDir = path.join(tmpProject, "src");
      const compDir = path.join(srcDir, "components");
      const pageDir = path.join(srcDir, "pages");
      const outDir = path.join(tmpProject, "dist");
      fs.mkdirSync(compDir, { recursive: true });
      fs.mkdirSync(pageDir, { recursive: true });

      fs.writeFileSync(
        path.join(tmpProject, "package.json"),
        JSON.stringify({ name: "hydrate-fixture", private: true, type: "module" }),
        "utf-8"
      );
      fs.writeFileSync(
        path.join(tmpProject, "mix.config.ts"),
        `export default { site: { url: "https://test.dotmix.dev" }, csp: { target: "cloudflare-pages" }, build: { clean: true, static: true } };`,
        "utf-8"
      );

      // 1. Event-handler-only component -> automatic idle island
      fs.writeFileSync(
        path.join(compDir, "EventBox.tix"),
        `export default function EventBox() { return <button type="button" onClick={() => {}}>Tap</button>; }`,
        "utf-8"
      );
      // 2. Reactive-state-only component -> automatic idle island
      fs.writeFileSync(
        path.join(compDir, "SignalBox.tix"),
        `import { createSignal } from "@dotmix/runtime";\nexport default function SignalBox() { const n = createSignal(1); return <span>{n()}</span>; }`,
        "utf-8"
      );
      // 3. onMount-only component -> automatic idle island
      fs.writeFileSync(
        path.join(compDir, "MountBox.tix"),
        `import { onMount } from "@dotmix/runtime";\nexport default function MountBox() { onMount(() => {}); return <div>Mounted</div>; }`,
        "utf-8"
      );
      // 4. Static-only component -> stays 0 B JS
      fs.writeFileSync(
        path.join(compDir, "StaticCard.tix"),
        `export interface StaticCardProps { readonly title: string; }\nexport default function StaticCard(props: StaticCardProps) { return <article><h2>{props.title}</h2><p>Pure HTML</p></article>; }`,
        "utf-8"
      );

      fs.writeFileSync(
        path.join(pageDir, "AutoPage.tix"),
        [
          `import EventBox from "../components/EventBox.tix";`,
          `import SignalBox from "../components/SignalBox.tix";`,
          `import MountBox from "../components/MountBox.tix";`,
          `import StaticCard from "../components/StaticCard.tix";`,
          `export default function AutoPage() {`,
          `  return <main><EventBox /><SignalBox /><MountBox /><StaticCard title="Static" /></main>;`,
          `}`
        ].join("\n"),
        "utf-8"
      );

      fs.writeFileSync(
        path.join(pageDir, "DirectivesPage.tix"),
        [
          `import { Hydrate } from "@dotmix/runtime/directives";`,
          `import EventBox from "../components/EventBox.tix";`,
          `import StaticCard from "../components/StaticCard.tix";`,
          `export default function DirectivesPage() {`,
          `  return (`,
          `    <main>`,
          `      {hydrate load}<EventBox />{endhydrate}`,
          `      <Hydrate when="visible"><EventBox /></Hydrate>`,
          `      {hydrate media "(max-width: 768px)"}<EventBox />{endhydrate}`,
          `      <Hydrate when='media "(min-width: 1024px)"'><StaticCard title="Desktop" /></Hydrate>`,
          `      {hydrate never}<EventBox />{endhydrate}`,
          `    </main>`,
          `  );`,
          `}`
        ].join("\n"),
        "utf-8"
      );

      fs.writeFileSync(
        path.join(pageDir, "ZeroOnlyPage.tix"),
        [
          `import { Hydrate } from "@dotmix/runtime/directives";`,
          `import EventBox from "../components/EventBox.tix";`,
          `import StaticCard from "../components/StaticCard.tix";`,
          `export default function ZeroOnlyPage() {`,
          `  return <main><StaticCard title="Zero" /><Hydrate when="never"><EventBox /></Hydrate></main>;`,
          `}`
        ].join("\n"),
        "utf-8"
      );

      fs.writeFileSync(
        path.join(srcDir, "routes.ts"),
        [
          `import AutoPage from "./pages/AutoPage.tix";`,
          `import DirectivesPage from "./pages/DirectivesPage.tix";`,
          `import ZeroOnlyPage from "./pages/ZeroOnlyPage.tix";`,
          `export const routes = [`,
          `  { path: "/", component: AutoPage },`,
          `  { path: "/directives", component: DirectivesPage },`,
          `  { path: "/zero", component: ZeroOnlyPage }`,
          `];`
        ].join("\n"),
        "utf-8"
      );

      const env = { ...process.env };
      delete env.MIX_BROWSER_PATH;
      env.MIX_BROWSER_PATH = "";

      const res = spawnSync(process.execPath, [cliBin, "build", "src", outDir, "--static", "--clean", "--json"], {
        cwd: tmpProject,
        env,
        encoding: "utf-8"
      });
      assert.equal(res.status, 0, `Fixture static build failed:\n${res.stdout}\n${res.stderr}`);
      const summary = JSON.parse(res.stdout);
      const byRoute = new Map(summary.staticRoutes.map((r) => [r.route, r]));

      assert.equal(byRoute.get("/")?.mode, "islands");
      assert.equal(byRoute.get("/directives")?.mode, "islands");
      assert.equal(byRoute.get("/zero")?.mode, "zero-js", "StaticCard + <Hydrate when=\"never\"><EventBox /></Hydrate> must stay zero-js");
      assert.equal(byRoute.get("/zero")?.jsBytes, 0);

      const autoHtml = fs.readFileSync(path.join(outDir, "index.html"), "utf-8");
      assert.equal(autoHtml.includes('data-component="EventBox" data-hydrate="idle"'), true);
      assert.equal(autoHtml.includes('data-component="SignalBox" data-hydrate="idle"'), true);
      assert.equal(autoHtml.includes('data-component="MountBox" data-hydrate="idle"'), true);
      assert.equal(autoHtml.includes('data-component="StaticCard"'), false, "StaticCard must not become an island");
      assert.equal(autoHtml.includes("Pure HTML"), true);

      const dirHtml = fs.readFileSync(path.join(outDir, "directives/index.html"), "utf-8");
      assert.equal(dirHtml.includes('data-component="EventBox" data-hydrate="load"'), true);
      assert.equal(dirHtml.includes('data-component="EventBox" data-hydrate="visible"'), true);
      assert.equal(dirHtml.includes('data-hydrate="media" data-media="(max-width: 768px)"'), true);
      assert.equal(dirHtml.includes('data-hydrate="media" data-media="(min-width: 1024px)"'), true);

      const zeroHtml = fs.readFileSync(path.join(outDir, "zero/index.html"), "utf-8");
      assert.equal(zeroHtml.includes("<mix-island"), false, "<Hydrate when=\"never\"> must emit 0 <mix-island> wrappers");
      assert.equal(zeroHtml.includes('<script type="module"'), false);

      // Confirm client:* syntax is completely gone (no special stripping in projection or SSR)
      const frontend = await import("@dotmix/compiler-frontend");
      const semantic = await import("@dotmix/compiler-semantic");
      const ssrComp = await import("@dotmix/compiler-ssr");
      const astroSource = [
        `import StaticCard from "./StaticCard.tix";`,
        `export default function LegacyTry() { return <StaticCard client:load title="Hi" />; }`
      ].join("\n");
      const ast = frontend.parse(astroSource, { filename: "LegacyTry.tix" });
      const proj = semantic.projectTypeScript(ast, astroSource, "LegacyTry.tix");
      assert.ok(proj.code.includes("client:load"), "Removed client:* attribute must not be stripped by projection");
      const desc = semantic.analyze(ast, { filename: "LegacyTry.tix", source: astroSource });
      const ssr = ssrComp.compileToSsr(desc);
      assert.equal(ssr.code.includes("data-client="), false);
    } finally {
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });
});
