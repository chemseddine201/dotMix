# Draft Gate 39 Block for `governance/PHASE_GATES.md`

> **Status:** DRAFT (Phase A proposal — do not merge into `governance/PHASE_GATES.md` until the Human Architecture Authority states `"Gate 39 is approved"`).

---

```markdown
## Gate 39 — Static Site Generation, Partial Hydration & SEO Head (`D-182` through `D-187`)

Scope:
- `T-39.1` (`D-182`): Browserless Node static site generation (`mix build --static` / `--target static`) using `@dotmix/compiler-ssr` + `createMemoryRouter`, keeping CDP Chromium prerender as opt-in `--prerender-browser`;
- `T-39.2` (`D-182`): Surgical DOM adoption in `mount(..., { hydrate: true })` / `hydrateRoot()` with subtree-only mismatch recovery (`MIX_SSR_HYDRATION_MISMATCH`), zero-JS emission for static-only routes, automatic island detection (`idle` default for interactive components), and dual-mode `{hydrate <when>}…{endhydrate}` / `<Hydrate when="…">…</Hydrate>` directives (`load | idle | visible | media "<query>" | never`);
- `T-39.3` (`D-183`): Universal `useHead` in `@dotmix/runtime` (re-exported by `@dotmix/router`) supporting `title`, `titleTemplate`, `htmlAttrs`, `bodyAttrs`, `meta` (`name`/`property`/`http-equiv`/`charset`), `link` (`canonical`/`alternate`/`hreflang`/`preload`/`icon`/`fetchpriority`), and safe `jsonLd` escaping with deepest-wins deduplication and zero duplication after hydration;
- `T-39.4` (`D-184`): `i18n` config in `mix.config.ts`, `expandLocalizedRoutes()`, `useLocale()`, `localePath()`, per-locale `htmlAttrs.lang`/`dir`, and automatic reciprocal `<link rel="alternate" hreflang="...">` + `x-default`;
- `T-39.5` (`D-185`): `site.url` SEO outputs (`dist/sitemap.xml` with `xhtml:link` alternates and `lastmod`, `dist/robots.txt`, `dist/404.html`, and `noindex` route opt-out);
- `T-39.6` (`D-186`): Optional `@dotmix/image` package (`<Picture>` with AVIF/WebP/fallback, `srcset`, intrinsic `width`/`height`, `loading`/`decoding`/`fetchpriority`, zero-network placeholder mode, and optional `sharp` peer dependency for build optimization);
- `T-39.7` (`D-187`): Build-time SHA-256 CSP hash collection (`dist/mix-csp.json`) and Cloudflare Pages `dist/_headers` writer supporting inline theme bootstrap scripts without `'unsafe-inline'`;
- `T-39.8`: `examples/marketing-site` (ar/fr, 4 routes, 1 interactive island, 1 static-only 0-JS page, `<Picture>` placeholders, JSON-LD), docs (`docs/CLI.md`, `README.md`, `README.ar.md`, `FEATURES.md`, `FEATURES.ar.md`, `CHANGELOG.md`), and `0.3.0` version bump across workspace packages.

Acceptance:
- `mix build --static` completes with zero Chromium binary present (`MIX_BROWSER_PATH` unset);
- Real-browser CDP `MutationObserver` on `#app` records zero removal of prerendered nodes across all example routes during load, and interactive islands respond to user input;
- Static-only page loads 0 bytes of framework/app JS (JS byte report recorded per route);
- Lighthouse on `examples/marketing-site` (desktop + mobile): SEO = 100, Accessibility = 100, Best Practices = 100, Performance >= 95, CLS = 0;
- `dist/sitemap.xml` validates against Sitemap 0.9 XSD with reciprocal `hreflang` entries + `x-default`, `noindex` routes excluded, and zero duplicate `<head>` tags after hydration;
- JSON-LD escaping test passes with `</script><script>alert(1)</script>` payload;
- Zero `securitypolicyviolation` events when serving `dist/` with emitted `dist/_headers` CSP;
- Zero external dependencies in `@dotmix/runtime`, `@dotmix/router`, and `@dotmix/cli`; `sharp` isolated strictly as optional peer dependency of `@dotmix/image`;
- `npm run build && npm test && npm run test:golden` are 100% green with existing gate tests unchanged.
```

