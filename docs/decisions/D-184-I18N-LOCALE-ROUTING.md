# Decision Proposal D-184: Locale Routing & i18n Configuration (P3)

**Status:** PROPOSED (Gate 39, Phase A — addresses Gap G4)  
**Target Packages:** `@dotmix/router`, `@dotmix/cli`, `@dotmix/runtime`  
**Related Decisions:** `D-115` (Router), `D-161` (Config Loader), `D-183` (Universal Head API)  

---

## 1. Problem Statement

**Gap G4:** Applications with multiple locales (e.g., Arabic RTL default at `/`, French LTR at `/fr/`) currently must duplicate every route by hand in `src/routes.ts`, manually set `<html lang dir>` per route, and manually keep `<link rel="alternate" hreflang="...">` and `x-default` synchronized across all pages.

---

## 2. Options Considered

- **Option A:** Require manual per-locale route definitions and manual `hreflang` arrays in each page.  
  *Rejected:* Error-prone, violates single-source routes, and easy to break reciprocal `hreflang` SEO requirements.
- **Option B (Chosen):** Add first-class `i18n` configuration in `mix.config.ts` (`I18nConfig`), automatic route expansion via `expandLocalizedRoutes()` in `@dotmix/router`, reactive `useLocale()` / `localePath()` helpers, and automatic per-locale `htmlAttrs` (`lang`, `dir`) + reciprocal `<link rel="alternate" hreflang="...">` + `x-default` injection during SSG/SSR and client navigation.
- **Option C:** File-system-only route directories (`pages/[locale]/...`).  
  *Rejected:* dotMix uses declarative `src/routes.ts` (`D-115`, `D-166`).

---

## 3. Why This Design

- Preserves declarative `src/routes.ts` while eliminating route duplication.
- Supports `prefixDefault: false` (`ar` at `/`, `/about`; `fr` at `/fr`, `/fr/about`) as well as `prefixDefault: true` (`/ar/`, `/fr/`).
- Works identically during browserless Node SSG (`mix build --static`), SSR (`@dotmix/server-node`), and client navigation (`BrowserRouter` / `createBrowserRouter`), emitting reciprocal `hreflang` tags on every page.
- Zero external dependencies in `@dotmix/router` and `@dotmix/cli`.

---

## 4. Public API (Exact Signatures)

### 4.1 `mix.config.ts` Schema (`@dotmix/cli` & `@dotmix/router`)

```ts
export type TextDirection = "ltr" | "rtl" | "auto";

export interface I18nConfig {
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly prefixDefault?: boolean | undefined; // default: false
  readonly dir?: Readonly<Record<string, TextDirection>> | undefined;
  readonly hreflang?: Readonly<Record<string, string>> | undefined; // optional BCP-47 override
}
```

### 4.2 `@dotmix/router` (`packages/router/src/i18n.ts`)

```ts
export interface LocaleInfo {
  readonly locale: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly dir: TextDirection;
  readonly isDefault: boolean;
  switchLocalePath(targetLocale: string): string;
}

export interface RouteI18nMeta {
  /** Set `false` to disable localization on this route, or list allowed locales. */
  readonly i18n?: boolean | readonly string[] | undefined;
}

export function resolveLocaleFromPath(
  pathname: string,
  config: I18nConfig
): { readonly locale: string; readonly unprefixedPath: string };

export function localePath(
  path: string,
  locale?: string,
  config?: I18nConfig
): string;

export function expandLocalizedRoutes(
  routes: readonly (RouteRecord | RouteObject)[],
  config: I18nConfig
): RouteObject[];

export function useLocale(): () => LocaleInfo;
```

### 4.3 `RouterOptions` Extension (`packages/router/src/types.ts`)

```ts
export interface RouterOptions {
  // existing fields...
  i18n?: I18nConfig | undefined;
}
```

When `i18n` is passed to `createRouter` / `createMemoryRouter` / `createBrowserRouter` (or read from `mix.config.ts` during `mix build --static`):
1. `expandLocalizedRoutes(routes, i18n)` expands each localizable route for each configured locale (respecting `route.meta?.i18n`).
2. `useLocale()` reacts to `router.currentRoute()` and returns `{ locale, defaultLocale, locales, dir, isDefault, switchLocalePath }`.
3. `RouterProvider` (and static SSG shell) automatically applies `htmlAttrs: { lang, dir }` and `canonical` + reciprocal `alternate` (`hreflang` + `x-default`) `<link>` entries via `useHead` (`D-183`), using `site.url` when provided.

---

## 5. Verification Tests (Phase B)

1. **Route Expansion & Resolution Test (`tests/router/i18n.test.mjs`):** Given `locales: ["ar", "fr"]`, `defaultLocale: "ar"`, `prefixDefault: false`, `dir: { ar: "rtl", fr: "ltr" }`, assert `/` resolves to `ar` (`rtl`) and `/fr/about` resolves to `fr` (`ltr`, `unprefixedPath: "/about"`). Assert `localePath("/about", "fr")` -> `"/fr/about"` and `localePath("/fr/about", "ar")` -> `"/about"`.
2. **Route Opt-Out Test:** Assert a route with `meta: { i18n: false }` is emitted only once without locale prefixes and does not emit alternate `hreflang` links for disabled locales.
3. **Reciprocal `hreflang` & `htmlAttrs` SSG Test:** Build a 2-locale example with `mix build --static`; parse every emitted `.html` file and assert `<html lang="ar" dir="rtl">` on `/` vs `<html lang="fr" dir="ltr">` on `/fr/index.html`, plus exact reciprocal `<link rel="alternate" hreflang="ar">`, `<link rel="alternate" hreflang="fr">`, and `<link rel="alternate" hreflang="x-default">`.
4. **Client Switch Locale Test:** Using `createMemoryRouter` and `useLocale()`, navigate via `switchLocalePath("fr")` and verify `useLocale()().locale === "fr"` and `document.documentElement.dir === "ltr"`.

