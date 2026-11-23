# Decision Proposal D-183: Universal SEO Head API (`useHead`) (P2)

**Status:** PROPOSED (Gate 39, Phase A — addresses Gap G3)  
**Target Packages:** `@dotmix/runtime`, `@dotmix/router`, `@dotmix/server-node`, `@dotmix/cli`  
**Related Decisions:** `D-123` (Gate 20 `useHead`), `D-177` (Gate 38 `<Head>`/`<Title>`/`<Meta>`/`<Link>` & `<Json>`)  

---

## 1. Problem Statement

**Gap G3 (`packages/router/src/hooks.ts:205`):** The current `useHead` implementation:
1. Returns immediately when `typeof document === "undefined"` (does nothing in SSR or Node SSG).
2. Supports only `title` and `meta[name]` (missing `meta[property]` for Open Graph, `link` for `canonical`/`alternate`/`hreflang`/`preload`/`icon`, `htmlAttrs` for `lang`/`dir`/`class`, and safe JSON-LD `<script type="application/ld+json">`).
3. Lives inside `@dotmix/router`, forcing static-only pages that want head tags during SSG to import the router package.
4. Appends `<meta>` tags without adopting SSR-rendered tags, risking duplicates after hydration, and lacks deepest-component precedence and cleanup on unmount.

---

## 2. Options Considered

- **Option A:** Extend `useHead` only inside `@dotmix/router` and keep it client-only.  
  *Rejected:* Fails SSR/SSG and forces `@dotmix/router` onto static-only routes.
- **Option B (Chosen):** Define the canonical universal `useHead(input)` in `@dotmix/runtime` (built atop the Gate 38 `HeadCollector` / DOM head bucket manager in `packages/runtime/src/dom/directives/head.ts`), and re-export `useHead` unchanged in import path from `@dotmix/router` for backward compatibility.
- **Option C:** Introduce a separate `defineHead` API incompatible with `useHead`.  
  *Rejected:* Fragments documentation and breaks existing `useHead` callers; `useHead` can accept both static objects and reactive getter functions `() => HeadInput`.

---

## 3. Why This Design

- **Single Head Stack:** Both declarative `<Head>` / `<Title>` / `<Meta>` / `<Link>` (Gate 38) and imperative `useHead(...)` feed the exact same `HeadCollector` on the server/SSG and the same `HeadDomState` registry on the client.
- **Zero-Router Static Pages:** Static components can import `useHead` from `@dotmix/runtime` during SSG without pulling `@dotmix/router` into any client bundle.
- **Deepest Component Wins & Deduplication:** Entries are pushed into keyed buckets in mount/render order so child pages override layout defaults (`title`, `titleTemplate`, `htmlAttrs`, `meta[name]`, `meta[property]`, `link[rel="canonical"]`, `link[rel="alternate"][hreflang]`).
- **Safe JSON-LD Serialization:** Escapes `<` (`\u003c`), `>` (`\u003e`), `&` (`\u0026`), U+2028 (`\u2028`), and U+2029 (`\u2029`) so untrusted strings like `</script><script>alert(1)</script>` cannot break out of `<script type="application/ld+json">`.

---

## 4. Public API (Exact Signatures)

Exported from `@dotmix/runtime` (and re-exported from `@dotmix/router`):

```ts
export type MaybeGetter<T> = T | (() => T);

export interface HeadHtmlAttrs {
  lang?: string | undefined;
  dir?: "ltr" | "rtl" | "auto" | undefined;
  class?: string | undefined;
  [attr: string]: string | undefined;
}

export interface HeadMetaEntry {
  key?: string | undefined;
  name?: string | undefined;
  property?: string | undefined;
  "http-equiv"?: string | undefined;
  charset?: string | undefined;
  content?: string | undefined;
}

export interface HeadLinkEntry {
  key?: string | undefined;
  rel: string;
  href?: string | undefined;
  hreflang?: string | undefined;
  as?: string | undefined;
  type?: string | undefined;
  media?: string | undefined;
  sizes?: string | undefined;
  crossorigin?: "anonymous" | "use-credentials" | "" | undefined;
  fetchpriority?: "high" | "low" | "auto" | undefined;
}

export interface HeadJsonLdEntry {
  key?: string | undefined;
  data: Record<string, unknown> | readonly Record<string, unknown>[];
}

export interface HeadInput {
  title?: string | undefined;
  titleTemplate?: string | ((title: string) => string) | undefined;
  htmlAttrs?: HeadHtmlAttrs | undefined;
  bodyAttrs?: Readonly<Record<string, string | undefined>> | undefined;
  meta?: readonly HeadMetaEntry[] | undefined;
  link?: readonly HeadLinkEntry[] | undefined;
  jsonLd?: Record<string, unknown> | readonly (Record<string, unknown> | HeadJsonLdEntry)[] | undefined;
}

export interface HeadCollector {
  // Extended from Gate 38 contract:
  addTitle(text: string): void;
  setTitleTemplate(template: string | ((title: string) => string)): void;
  addHtmlAttrs(attrs: Readonly<Record<string, string | undefined>>): void;
  addBodyAttrs(attrs: Readonly<Record<string, string | undefined>>): void;
  addMeta(attrs: Readonly<Record<string, string>>, key?: string): void;
  addLink(attrs: Readonly<Record<string, string>>, key?: string): void;
  addJsonLd(data: unknown, key?: string): void;
  getHtmlAttrs(): Readonly<Record<string, string>>;
  getBodyAttrs(): Readonly<Record<string, string>>;
  getTags(): readonly HeadTagRecord[];
  renderHtml(): string;
  renderToHeadHtml(): string;
}

export function useHead(input: MaybeGetter<HeadInput>): void;
export function runWithHeadCollector<T>(collector: HeadCollector, fn: () => T): T;
export function serializeSafeJsonLd(value: unknown): string;
```

### Deduplication Key Rules
- `title`: singleton `"title"`; `titleTemplate` applies from layout/parent unless overridden.
- `htmlAttrs` / `bodyAttrs`: merged per attribute name (`class` concatenated or overridden when explicit; `lang` and `dir` deepest-wins).
- `meta`: `entry.key ?? (name ? "name:" + name : property ? "property:" + property : httpEquiv ? "http-equiv:" + httpEquiv : charset ? "charset" : anon)`.
- `link`: `entry.key ?? (rel === "canonical" ? "rel:canonical" : rel === "alternate" && hreflang ? "rel:alternate:" + hreflang + ":" + (type ?? "") : "rel:" + rel + "\0" + (href ?? ""))`.
- `jsonLd`: `entry.key ?? ("jsonld:" + index)` with `data-mix-head` attribute for hydration adoption without duplicate `<script>` tags.

---

## 5. Verification Tests (Phase B)

1. **SSR & SSG Parity Test (`tests/head/universal-head.test.mjs`):** Render a layout + child page via `runWithHeadCollector` containing `titleTemplate`, `htmlAttrs`, `meta[name]`, `meta[property]`, `link[rel="canonical"]`, `link[rel="alternate"]`, and `jsonLd`. Verify deepest component overrides `title`, `meta[name="description"]`, and `link[rel="canonical"]`.
2. **Hydration Zero-Duplication Test:** Hydrate SSR-emitted `<head>` in real browser CDP (and DOM unit test); assert `document.head.querySelectorAll(...)` has count `1` for every deduped `meta`, `link[rel="canonical"]`, `link[rel="alternate"][hreflang]`, and `script[type="application/ld+json"]`, and that client navigation cleanup restores parent layout tags.
3. **JSON-LD XSS Escaping Test:** Pass `{ "@type": "WebSite", name: "</script><script>alert(1)</script>\u2028\u2029&" }` into `jsonLd`; assert raw HTML never contains literal `</script`, `<!--`, `<`, `>`, `&`, U+2028, or U+2029 inside the script body and `JSON.parse(script.textContent)` round-trips identically.

