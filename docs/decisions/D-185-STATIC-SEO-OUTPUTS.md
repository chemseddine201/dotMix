# Decision Proposal D-185: Static SEO Outputs — `sitemap.xml`, `robots.txt`, and `404.html` (P4)

**Status:** PROPOSED (Gate 39, Phase A — addresses Gap G5)  
**Target Packages:** `@dotmix/cli`, `@dotmix/router`  
**Related Decisions:** `D-162` (`mix build`), `D-182` (Node SSG), `D-184` (Locale Routing)  

---

## 1. Problem Statement

**Gap G5:** `mix build` produces no `sitemap.xml`, `robots.txt`, or static `404.html`. Marketing sites hosted on Cloudflare Pages or static CDNs require valid XML sitemaps with `<xhtml:link rel="alternate">` locale entries, a `robots.txt` referencing the sitemap, a `noindex` opt-out mechanism, and a static `404.html` page.

---

## 2. Options Considered

- **Option A:** Require external third-party scripts or manual files in `public/`.  
  *Rejected:* Manual sitemaps drift out of sync with `src/routes.ts` and localized expansions (`D-184`).
- **Option B (Chosen):** Built-in zero-dependency SEO artifact emitter in `@dotmix/cli` triggered during `mix build --static` when `site.url` is configured (with `404.html` generated whenever a `/404` or `*` route exists, or from a minimal fallback if configured).
- **Option C:** Emit `sitemap.xml` on client-only SPA builds too.  
  *Rejected:* Client-only SPAs without static route enumeration have no reliable pre-rendered URL inventory unless routes are explicitly configured.

---

## 3. Why This Design

- Zero external XML library needed; deterministic canonical XML serialization with strict escaping (`&`, `<`, `>`, `"`, `'`).
- Automatically integrates `D-184` localized routes into `<xhtml:link rel="alternate" hreflang="..." href="..." />` + `x-default`.
- Honors per-route `noindex` opt-out (`meta.noindex: true` or `route.noindex: true`) by injecting `<meta name="robots" content="noindex" />` AND excluding the route from `sitemap.xml`.
- Preserves user-authored `public/robots.txt` if present (emitting an informational note) unless `seo.robots` explicitly overrides or disables it.

---

## 4. Public API (Exact Signatures)

### 4.1 `mix.config.ts` Schema (`@dotmix/cli`)

```ts
export interface SiteConfig {
  /** Canonical origin, e.g. "https://vitedz.com" (no trailing slash). */
  readonly url: string;
  readonly trailingSlash?: "never" | "always" | "preserve" | undefined;
}

export interface SitemapConfig {
  readonly enabled?: boolean | undefined; // default: true when site.url is set
  readonly lastmod?: string | Date | "build-time" | undefined; // default: "build-time" (ISO 8601 UTC)
  readonly exclude?: readonly string[] | undefined;
}

export interface RobotsConfig {
  readonly enabled?: boolean | undefined; // default: true when site.url is set
  readonly allow?: readonly string[] | undefined; // default: ["/"]
  readonly disallow?: readonly string[] | undefined;
  readonly extraLines?: readonly string[] | undefined;
}

export interface SeoConfig {
  readonly sitemap?: boolean | SitemapConfig | undefined;
  readonly robots?: boolean | RobotsConfig | undefined;
  readonly notFound?: boolean | string | undefined; // default: true (renders "/404" or "*" route to dist/404.html)
}
```

### 4.2 Route Metadata Opt-Out (`@dotmix/router`)

```ts
export interface RouteSeoMeta {
  readonly noindex?: boolean | undefined;
  readonly sitemap?:
    | boolean
    | {
        readonly changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never" | undefined;
        readonly priority?: number | undefined;
        readonly lastmod?: string | undefined;
      }
    | undefined;
}
```

### 4.3 Programmatic Emitter (`@dotmix/cli`, `packages/cli/src/seo-files.ts`)

```ts
export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod?: string | undefined;
  readonly changefreq?: string | undefined;
  readonly priority?: number | undefined;
  readonly alternates?: readonly { readonly hreflang: string; readonly href: string }[] | undefined;
}

export function generateSitemapXml(entries: readonly SitemapEntry[]): string;
export function generateRobotsTxt(siteUrl: string, config?: RobotsConfig): string;
```

### Generated Output Rules
1. **`dist/sitemap.xml`:**
   - Root element `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`.
   - Excludes `/404`, wildcard `*`, parameterized routes without static param lists, and any route with `meta.noindex === true` or `meta.sitemap === false`.
   - `lastmod` defaults to the build timestamp in W3C Datetime (`YYYY-MM-DDTHH:mm:ssZ`).
2. **`dist/robots.txt`:**
   - Emits `User-agent: *`, `Allow:`/`Disallow:` rules, and `Sitemap: <site.url>/sitemap.xml` (respecting `base`).
3. **`dist/404.html`:**
   - Rendered statically from the `/404` route (or `*` fallback route) with `<meta name="robots" content="noindex" />`, automatically omitted from `sitemap.xml`.

---

## 5. Verification Tests (Phase B)

1. **Sitemap XSD & Alternate Validation Test (`tests/static/seo-outputs.test.mjs`):** Build the 2-locale example with `site.url = "https://vitedz.com"`, validate `dist/sitemap.xml` against the official Sitemap 0.9 + `xhtml:link` schema rules (well-formed XML, valid `<lastmod>`, `<loc>` prefix match, every `<url>` carries reciprocal `<xhtml:link rel="alternate">` for all locales + `x-default`).
2. **`noindex` Exclusion Test:** Mark a `/draft` route with `meta: { noindex: true }`; assert `dist/draft/index.html` contains `<meta name="robots" content="noindex"` and `/draft` is absent from `dist/sitemap.xml`.
3. **`robots.txt` & `404.html` Test:** Assert `dist/robots.txt` contains `Sitemap: https://vitedz.com/sitemap.xml`, and `dist/404.html` exists, has `noindex`, and is excluded from `dist/sitemap.xml`.

