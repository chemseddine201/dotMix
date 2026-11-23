# Decision Proposal D-182: Static Site Generation Without a Browser & Partial/Islands Hydration (P1)

**Status:** ACCEPTED & AMENDED (Gate 39 — Owner Amendment dated 2026-11-23 removes `client:*` and adopts Automatic Islands + `{hydrate}`/`<Hydrate>`)  
**Target Packages:** `@dotmix/runtime`, `@dotmix/ast`, `@dotmix/compiler-frontend`, `@dotmix/compiler-ssr`, `@dotmix/compiler-codegen`, `@dotmix/compiler-semantic`, `@dotmix/language-server`, `@dotmix/router`, `@dotmix/cli`  
**Related Decisions:** `D-116` (SSR & Hydration), `D-121` (Resilient Streaming Islands), `D-162` (Multi-target `mix build`)  

---

## 1. Problem Statement

1. **Gap G1 (`packages/runtime/src/dom/control-flow.ts:395`):** `mount()` detects `data-mix-prerendered` and calls `target.replaceChildren()`, discarding the entire prerendered DOM and re-creating it from scratch. This causes CLS/LCP degradation and forces full client JS execution even for static pages.
2. **Gap G2 (`packages/cli/src/prerender.ts` & `packages/cli/src/commands/build.ts:13`):** `--target static` was removed in favor of `--prerender`, which launches headless Chromium over CDP. CI runners and Cloudflare Pages build images do not include Chromium.

---

## 2. Options Considered

### 2.1 Static Build Execution
- **Option A:** Keep headless Chromium `--prerender` only.  
  *Rejected:* Fails in Cloudflare Pages and minimal CI images without Chromium.
- **Option B (Chosen):** Restore `--target static` (with `--static` flag alias on `mix build`) using pure Node.js SSR compilation (`@dotmix/compiler-ssr` + `createMemoryRouter`), requiring **zero browser binaries**. Keep the existing CDP prerenderer as an explicit opt-in `--prerender-browser` flag for client-only apps that cannot run in Node SSR.
- **Option C:** Remove Chromium `--prerender` entirely.  
  *Rejected:* Existing projects using client-only browser APIs during prerender would lose an escape hatch without migration time.

### 2.2 Client Adoption & Mismatch Recovery
- **Option A:** Keep `mount()` replacing DOM and require callers to switch to `hydrate()`.  
  *Rejected:* Existing templates and `mix create` scaffolds call `mount(...)`.
- **Option B (Chosen):** Extend `mount(ComponentFn, target, props?, options?)` with `MountOptions` (`hydrate?: boolean`, `onMismatch?: (mismatch: HydrationMismatch) => void`) and export `hydrateRoot(...)` as an explicit alias. When `target.hasAttribute("data-mix-ssr")` (and `options?.hydrate !== false`) or `options?.hydrate === true`, `mount()` adopts the existing DOM via `HydrationWalker` instead of clearing `target`. On hydration mismatch inside a boundary (`<!--mix:c:id-->`, `<!--mix:if:id-->`, `<!--mix:each:id-->`, `<!--mix:await:id-->`), emit a dev-mode `MIX_SSR_HYDRATION_MISMATCH` diagnostic and re-render **only that mismatched subtree** between its start/end markers, preserving all sibling/ancestor DOM nodes.

### 2.3 Zero-JS Static Pages & Partial Hydration (Islands)
- **Option A:** Always emit the full client router and app JS bundle on every static HTML page.  
  *Rejected:* Fails the 0 KB JS requirement for static-only routes and hurts Lighthouse Performance.
- **Option B (Chosen):** Compiler-analyzed **Zero-JS Static Pages + Opt-in Interactive Islands**.
  - During `mix build --static`, static route discovery inspects each route's `ComponentDescriptor` graph (`signals`, `computeds`, `effects`, event bindings, `onMount`, `bind:*`, and explicit island markers).
  - If a route tree has **zero** client reactivity/handlers/islands, `mix build --static` omits `<script type="module">`, `<script type="importmap">`, and `<link rel="modulepreload">` for that route, shipping **0 bytes** of framework or app JS.
  - If a route embeds interactive components or explicit hydration boundaries:
    - **(1) Automatic islands by default (Owner Amendment 2026-11-23):** The compiler automatically marks any imported component call as an island when that component (or anything it renders) has event handlers, reactive state (`signal`/`createSignal`/`computed`/`createEffect`/`createResource`/`sync*`), or `onMount`, using default trigger `idle`. Everything else stays static HTML with **0 bytes** of JS.
    - **(2) Dual-mode `{hydrate <when>}…{endhydrate}` and `<Hydrate when="…">…</Hydrate>` (Owner Amendment 2026-11-23):** Built in the same style as Gate 38 (`DM-1`, byte-identical IR and client/SSR output), with `when = load | idle | visible | media "<query>" | never`. Wrapping a component with `{hydrate never}` / `<Hydrate when="never">` keeps it static HTML with **0 bytes** of JS even if it contains interactive constructs.
    - *(Superseded & Deleted 2026-11-23)* Astro-style `client:load`, `client:visible`, `client:idle`, and `client:media` attributes were completely removed per `AGENTS.md` §5 (no alias or deprecation path).
    - Each island renders inside `<mix-island data-island-id="..." data-component="..." data-hydrate="load|visible|idle|media" data-island-module="..." data-props="...">...</mix-island>` and hydrates lazily without loading page-shell or router JS.
  - Full-SPA interactive routes (no island boundaries, top-level client routing/state) continue to emit the module bundle and call `mount(..., { hydrate: true })`.

---

## 3. Why This Design

- Reuses existing `@dotmix/compiler-ssr` markers (`<!--mix:t:id-->`, `<!--mix:if:id-->`, `<!--mix:each:id-->`, `<!--mix:c:id-->`), `HydrationWalker`, and `createMemoryRouter`.
- Satisfies Cloudflare Pages build constraints (`MIX_BROWSER_PATH` unset).
- Guarantees **0 bytes** of JS on purely static marketing pages while supporting interactive islands (e.g., theme toggle) and full hydration without DOM node removal (`MutationObserver` clean).
- Maintains `@dotmix/runtime` at zero external dependencies (`AGENTS.md` §6).

---

## 4. Public API (Exact Signatures)

### 4.1 `@dotmix/runtime` (`packages/runtime/src/dom/hydration.ts` & `control-flow.ts`)

```ts
export interface HydrationMismatch {
  readonly expected: string;
  readonly actual: string;
  readonly node: Node | null;
  readonly component?: string | undefined;
}

export interface HydrateOptions {
  readonly onMismatch?: ((mismatch: HydrationMismatch) => void) | undefined;
  readonly dev?: boolean | undefined;
}

export interface MountOptions extends HydrateOptions {
  /**
   * When true, adopts SSR/SSG DOM in `target`.
   * When omitted, auto-hydrates if `target.hasAttribute("data-mix-ssr")`.
   * When false, clears `target` and mounts client-side from scratch.
   */
  readonly hydrate?: boolean | undefined;
}

export function mount(
  ComponentFn: (props: Record<string, unknown>) => Node | readonly Node[],
  target: Element,
  props?: Record<string, unknown>,
  options?: MountOptions
): MountedComponent;

export function hydrateRoot(
  ComponentFn: (props: Record<string, unknown>) => Node | readonly Node[],
  target: Element,
  props?: Record<string, unknown>,
  options?: HydrateOptions
): MountedComponent;

export interface IslandBootstrapEntry {
  readonly id: string;
  readonly component: string;
  readonly trigger: "load" | "visible" | "idle" | "media";
  readonly media?: string | undefined;
  readonly moduleUrl: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export function hydrateIslands(
  root?: ParentNode,
  options?: HydrateOptions
): Promise<readonly MountedComponent[]>;
```

### 4.2 `@dotmix/cli` (`packages/cli/src/args.ts`, `config.ts`, `build.ts`)

```ts
// CLI flags on `mix build`:
//   --static                  Alias for `--target static`
//   --target <client|ssr|static>
//   --prerender <routes>      Optional comma-separated route filter for static build
//   --prerender-browser       Opt-in legacy CDP Chromium prerenderer

export interface StaticBuildConfig {
  readonly routes?: readonly string[] | "auto" | undefined;
  readonly trailingSlash?: "never" | "always" | "preserve" | undefined;
  readonly islandMode?: "auto" | "explicit" | undefined;
}
```

### 4.3 Template Island Directives (`@dotmix/ast`, `@dotmix/compiler-frontend`, `@dotmix/compiler-semantic`, `@dotmix/compiler-ssr`, `@dotmix/compiler-codegen`, `@dotmix/runtime/directives`)

```tsx
{/* Automatic island (default strategy: idle) — no annotation needed */}
<ThemeToggle />

{/* Explicit dotMix dual-mode directive (block & component forms compile to identical HydrateNode IR) */}
{hydrate load}<ThemeToggle />{endhydrate}
{hydrate visible}<NewsletterForm initialTopic="news" />{endhydrate}
{hydrate media "(max-width: 768px)"}<MobileDrawer />{endhydrate}
{hydrate never}<InteractivePreview />{endhydrate}

import { Hydrate } from "@dotmix/runtime/directives";
<Hydrate when="load"><ThemeToggle /></Hydrate>
<Hydrate when="visible"><NewsletterForm initialTopic="news" /></Hydrate>
<Hydrate when='media "(max-width: 768px)"'><MobileDrawer /></Hydrate>
<Hydrate when="never"><InteractivePreview /></Hydrate>
```

---

## 4.4 Owner Amendment (2026-11-23)

- **Decision:** Delete `client:load`, `client:visible`, `client:idle`, and `client:media` completely across parser, semantic analysis, SSR/client codegen, language server, docs, and examples (no alias, no deprecation path), as Astro-style colon attributes violate `AGENTS.md` §5.
- **Replacement:**
  1. Automatic island detection when a component or anything it renders has event handlers, reactive state, or `onMount` (default `idle`; everything else stays static with 0 JS).
  2. Dual-mode Gate 38 directive `{hydrate <when>}…{endhydrate}` / `<Hydrate when="…">…</Hydrate>` (`when = load | idle | visible | media "<query>" | never`).

---

## 5. Verification Tests (Phase B)

1. **Browserless Build Test (`tests/static/static-build.test.mjs`):** Run `mix build --static` in a child process with `MIX_BROWSER_PATH=""` and `PATH` stripped of browser binaries; assert `dist/index.html`, localized routes, and `data-mix-ssr="1"` markers emit cleanly with exit code `0`.
2. **Zero-JS Static Route Test:** Assert a static-only route HTML file contains **0** `<script type="module">`, **0** `<script type="importmap">`, and **0** `modulepreload` tags (0 bytes framework/app JS).
3. **Subtree-Only Mismatch Recovery Test:** Construct SSR HTML where one child component/if-block intentionally diverges from client props; run `mount(..., { hydrate: true })` and assert:
   - `onMismatch` fires with `MIX_SSR_HYDRATION_MISMATCH`;
   - sibling and parent DOM node references (`===`) are preserved;
   - only the mismatched subtree's nodes are replaced.
4. **Real-Browser CDP Mutation & Island Test (`tests/static/static-browser.test.mjs`):** Load each prerendered route in headless Chrome/Edge via `@dotmix/cli/browser` with a `MutationObserver` on `#app`; assert zero removed prerendered nodes during hydration and verify the interactive island (`ThemeToggle`) responds to clicks.

