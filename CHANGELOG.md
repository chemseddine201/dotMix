# Changelog — dotMix Framework

All notable changes to the dotMix compiler-native web framework will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] — 2026-11-23

All `@dotmix/*` packages move to 0.3.0 together.

### Added
- **Browserless Static Site Generation (`mix build --static`):** Renders static and localized routes directly in Node.js using `@dotmix/compiler-ssr` and `createMemoryRouter` with zero Chromium requirement (legacy CDP prerendering remains available via `--prerender` / `--prerender-browser`).
- **Surgical Hydration, Automatic Islands & `{hydrate}`/`<Hydrate>` Directive:** `mount(..., { hydrate })` and `hydrateRoot()` adopt `data-mix-ssr` DOM nodes without clearing prerendered markup, isolate hydration mismatches to subtrees only (`MIX_SSR_HYDRATION_MISMATCH`), emit **0 bytes of JS** for static-only routes, automatically mark component calls with event handlers, reactive state, or `onMount` as islands (default strategy `idle`), and provide the Gate 38-style dual-mode directive `{hydrate <when>}…{endhydrate}` / `<Hydrate when="…">` (`load | idle | visible | media "<query>" | never`). Astro-style `client:*` attributes are removed with no alias.
- **Content-Hashed Vendor Assets (`_headers`):** `mix build` writes vendored runtime packages under content-hashed `/vendor/<hash>/...` paths so immutable cache headers never serve stale runtime code across updates.
- **Universal SEO Head (`useHead`):** Moved canonical `useHead` into `@dotmix/runtime` (re-exported by `@dotmix/router`) with full SSR/SSG and client DOM parity for `title`, `titleTemplate`, `htmlAttrs` (`lang`, `dir`), `bodyAttrs`, `meta` (`name`, `property`, `http-equiv`, `charset`), `link` (`canonical`, `alternate` `hreflang`, `preload`, `icon`, `fetchpriority`), and XSS-safe `jsonLd` serialization with deepest-wins deduplication and zero duplication after hydration.
- **Locale Routing (`i18n`):** Added `i18n` configuration in `mix.config.ts`, `expandLocalizedRoutes()`, `useLocale()`, and `localePath()` in `@dotmix/router`, automatically setting `<html lang dir>` and reciprocal `hreflang` + `x-default` links.
- **Static SEO Artifacts:** Added `site.url` and `seo` config emitting `dist/sitemap.xml` (Sitemap 0.9 + `xhtml:link` alternates), `dist/robots.txt`, and `dist/404.html`, with `noindex` route opt-out.
- **Optional Image Package (`@dotmix/image`):** Added `<Picture>` component (intrinsic `width`/`height`, safe `srcset`, `fetchpriority`, zero-network `placeholder` mode) and optional `sharp`-backed AVIF/WebP build optimizer (`@dotmix/image/build`), keeping `@dotmix/runtime` and `@dotmix/cli` at zero external dependencies.
- **Hash-Based Static CSP:** Build-time SHA-256 hash collection for inline scripts, `<script type="importmap">`, and inline styles (`dist/mix-csp.json`), plus Cloudflare Pages `dist/_headers` generation without `'unsafe-inline'`.

### Changes from 0.2.0
- `--target static` remains deprecated with exit code 2 as in 0.2.0; use `--static` (`mix build --static`) for browserless Node static site generation.
- The Chromium CDP `--prerender` path is preserved (alongside explicit `--prerender-browser`) for client-only prerendering workflows.

---

## [0.2.0] — 2026-11-18

All `@dotmix/*` packages move to 0.2.0 together.

### Added
- `mix dev` dispatches a `mix:hmr-applied` event on `window` after a hot update has put the new DOM in place; `event.detail.nodes` lists the inserted nodes, so code that enhances the page once (scroll reveals, tooltips) can enhance them too.
- Configuration file loading: `mix.config.ts`, `mix.config.mjs`, and `mix.config.js` with CLI-flag precedence.
- Real source maps support for client and SSR builds via `mix build --sourcemap`.

### Changed
- **Breaking:** `mix build --target` now accepts only `client` or `ssr`. The legacy `static` target was removed (use `--prerender`).
- **Breaking:** The sync engine's public names were renamed from the development codename `d137` to `replicated` / `SYNC_*` / `ReplicationEngine` / `createReplicated*` / `SYNC_PROTOCOL_LIMITS`. Backward-compatible deprecated aliases are preserved for previous export names, and the `"d137"` engine configuration string remains accepted.
- **Breaking:** Local sync storage names for IndexedDB and BroadcastChannel were updated (`dotmix_sync_*` / `dotmix:sync:*`). Existing local sync databases start clean.
- VS Code extension publisher identifier updated to `dotmix` (extension ID `dotmix.vscode-mix`).

### Fixed
- CLI banner and help output branded to "dotMix" without legacy strings.
- Internal planning codes removed from comments, error messages, and documentation.
- Hot module replacement (HMR): fixed issue where edited components could disappear from the DOM on hot update due to detached boundary markers or unhandled swap errors.

## [0.1.1] — 2026-11-16

All `@dotmix/*` packages move to 0.1.1 together.

### Fixed
- `mix dev` styles new projects correctly. A stylesheet that a component imports from another folder (such as `./styles/global.scss` in `main.mix`) is now global instead of scoped, while stylesheets in the component's own folder stay scoped, so its `:root` tokens and `body` rules apply. A stylesheet's own `@import`s (such as `./tokens.scss`) are no longer dropped.
- `mix test` runs tests that import the project's TypeScript modules with `.js` specifiers (`../src/x.js` for `src/x.ts`). The unit test that `mix create` writes now passes.
- `mix doctor` reports no failure on a newly created project. The stylesheet check no longer asks for `sass`, `less` or `postcss`, because the compiler handles those formats itself; it fails only on Stylus files. The TypeScript check accepts the `NodeNext` settings the template writes.
- `@dotmix/cli` no longer declares `sass`, `less` and `postcss` as optional peer dependencies.
- A Stylus stylesheet reports that the format is unsupported, instead of suggesting an install that would not help.
- `mix --version`, `mix info` and the dependency versions of new projects come from the installed CLI instead of a hard-coded number.

## [0.1.0] — 2026-11-16

### Added
- **Compiler Core (`@dotmix/compiler-frontend`, `@dotmix/compiler-semantic`, `@dotmix/compiler-codegen`):**
  - Compiler-native ahead-of-time (AOT) pipeline compiling declarative `.mix` (JavaScript) and `.tix` (TypeScript) templates to JavaScript that creates and updates real DOM nodes directly.
  - No virtual DOM and no runtime tree diffing.
  - Strict static verification for `.tix` components via official TypeScript 6 Compiler API (`typecheckTix`) resolving against real package `.d.ts` declarations.
  - AST construction with accurate source spans, expression boundary extraction, and deterministic code generation.

- **Reactive Runtime (`@dotmix/runtime`):**
  - Push-Pull fine-grained reactivity kernel featuring signals (`signal` / `createSignal`), computeds (`computed` / `createMemo`), and effects (`createEffect`).
  - Explicit ownership tree and deterministic disposal lifecycles (`createRoot`, `onCleanup`, owner hierarchy).
  - DOM adapter that keeps persistent text nodes and attribute bindings, with no runtime dependencies.
  - Atomic keyed collection reconciler rejecting duplicate keys upfront without DOM corruption.
  - Component lifecycle and placement primitives (`onMount`, `onCleanup`, `KeepAlive`, `createPortal` / `Teleport`).
  - `onMount(callback)` runs once in a microtask after synchronous node insertion, registers any returned function with `onCleanup`, skips if the owner is disposed beforehand, and is a no-op under SSR.
  - Isomorphic RBAC/ABAC permissions engine (`<Can>`, `defineAbility`, `createAbility`, reactive capability checks, asynchronous permission cancellation).

- **Radix-Trie Router (`@dotmix/router`):**
  - Zero-dependency client-side router with radix-trie route matching and nested layout support (`<Outlet />`).
  - Pre-loader security guards checking route-level permissions prior to data loading.
  - Parallel route data loaders, actions, and declarative navigation primitives (`<Link>`, `<NavLink>`).

- **Multi-Preprocessor Scoped Stylesheets (`@dotmix/compiler-css`):**
  - First-class compilation for `.scss`, `.sass`, `.less`, `.pcss` (PostCSS), and standard `.css`.
  - Compile-time CSS property validation, AST-level parent selector resolution, and deterministic component attribute scoping.
  - Strict security validation rejecting unsafe expressions, property injections, and unverified at-rules.

- **Zero-Dependency Standard Library (`@dotmix/helpers`):**
  - `@dotmix/helpers/datetime`: IANA timezone conversions and humanized date formatting using native browser `Intl` APIs without external tzdata bundles.
  - `@dotmix/helpers/http`: Resilient HTTP client with automatic retries, exponential backoff, request deduplication, cache controls, and reactive `useHttp` signal hook.
  - `@dotmix/helpers/data`: Immutable nested object utilities (`dot.get`, `dot.set`), deep equality, and data transforms.
  - `@dotmix/helpers/async`: Promise pooling, debouncing, throttling, and concurrency queues.
  - `@dotmix/helpers/web`: Zero-dependency web browser utilities (clipboard, storage, intersection observers).

- **Distributed CRDT Synchronization Engine (`@dotmix/sync`):**
  - Local-first synchronization engine with Lamport timestamps, fractional indexing, vector clocks, and cryptographic signing.
  - Durable persistence adapters for IndexedDB and Origin Private File System (OPFS).
  - Multi-tab lease coordination via BroadcastChannel and automated lease failover.
  - Storage bounds enforcement and incremental checkpointing.

- **Server-Side Rendering & Edge Streams (`@dotmix/compiler-ssr`, `@dotmix/stream`, `@dotmix/server-node`):**
  - Ahead-of-time SSR code generation with automated signal evaluation.
  - Streaming SSR adapter supporting WinterCG Web Streams (`ReadableStream`, `Response`) for edge runtimes (Cloudflare Workers, Deno, Bun).
  - Node.js streaming HTTP server (`@dotmix/server-node`) with per-request cryptographic Content Security Policy (CSP) nonces.

- **Developer Tooling & CLI (`@dotmix/cli`, `@dotmix/vite-plugin`):**
  - CLI (`mix` / `dotmix`) built on native Node.js 22+ modules; the compiler packages it uses depend only on `typescript`, `css-tree` and `acorn` (with `@sveltejs/acorn-typescript`).
  - `mix create`: Project scaffolding supporting TypeScript (`.tix`) and JavaScript (`.mix`), stylesheet preprocessors (`scss`, `sass`, `less`, `pcss`, `css`), and modular templates (`minimal`, `standard`, `sync-crdt`, `showcase`).
  - `mix dev`: Development server with Server-Sent Events (SSE) HMR transport, stable CSS scoping, state-retaining re-instantiation, and `.env*` loading (`import.meta.env` with `MIX_PUBLIC_*`).
  - `mix build`: Production build with one content-hashed ES module per source module, an import map with modulepreload, one merged stylesheet, `.env*` (`import.meta.env` / `MIX_PUBLIC_*`) replacement before hashing, `--prerender <routes>` static HTML generation via CDP, and a bundle report.
  - `mix check` & `mix lint`: Static typechecking of `.tix` components and `.ts` modules, with stylish error formatting; `mix lint --fix` applies automatic fixes.
  - `mix doctor` & `mix info`: Diagnostic utilities running automated configuration checks.
  - `mix upgrade`: Safe dependency lifecycle manager with automated codemod migrations.
  - `mix test`: Native test runner utilizing `node:test` and zero-dependency Chrome DevTools Protocol (CDP) client.
  - `@dotmix/vite-plugin`: Vite integration plugin with HMR and bare workspace resolution.

- **Developer Experience & Editor Support (`@dotmix/language-server`, `vscode-mix`):**
  - Language Server Protocol implementation providing syntax highlighting, hover documentation, completions, and live diagnostics.
  - Official Visual Studio Code extension (`vscode-mix`) supporting `.mix` and `.tix` files.

- **Verification & Test Harnesses (`tools/browser-matrix`):**
  - Real headless browser matrix runner executing zero-dependency test scenarios across Google Chrome, Microsoft Edge, and Mozilla Firefox.
  - Automated bundle size measurement and budget enforcement (`tools/release/measure-size.mjs`).

### Changed
- npm packages are published under the `@dotmix` scope (`@dotmix/runtime`, `@dotmix/cli`, `@dotmix/helpers` ...). The `mix` command and the `.mix` / `.tix` extensions keep their names.
- `mix build` emits one ES module per source module (`dist/assets/<path>-<hash>.js`), maps the specifiers to the hashed files with an import map, and preloads the entry graph with `modulepreload`. Shared modules exist once, so a store imported by two lazy pages has one state.
- `mix build` writes a deployable `dist/`: `index.html` with the import map, the runtime packages under `vendor/`, and the files of `public/`.
- `mix create` and `mix add` generate a sibling stylesheet imported by the component instead of a `<style>` block.
- `mix check` also type-checks the project's `.ts` files with its `tsconfig.json`.
- Scoped packages declare `publishConfig.access: public`.
- `createAuth` is typed per guard. The `user` of `{auth}`, `<Auth>` and `useAuth()` is resolved from an annotated callback parameter, then the same-file `<AuthProvider>`, then the application's `Register.auth` (module augmentation), otherwise `unknown` with a hint. New exported types: `Register`, `RegisteredAuth`, `AuthInstanceOf`, `GuardUser`, `AuthGuards`.

### Fixed
- The production build no longer strips comments, imports or line content with regular expressions; string literals, template literals and regular expressions are emitted unchanged.
- The standard `mix create` template includes `index.html` with the `#root` mount point and, for TypeScript, `src/env.d.ts`; the published `@dotmix/cli` package includes its templates.
- VS Code extension: a packager builds a self-contained `.vsix` (language server and TypeScript plugin included); the TypeScript plugin resolves `.tix` / `.mix` imports in `.ts` files; Ctrl+click opens imported paths.
- HMR: a hot-swapped component keeps the contexts provided above the replaced instance (for example the router context).
- Every runtime primitive that components import automatically (including `onCleanup`, `batch`, `createRoot`, `createResource`) now type-checks in `.tix` files without an explicit import; their types come from `@dotmix/runtime` itself.
- `createForm` reads `initialValues` for field names; `typecheckTix` no longer duplicates diagnostics when given a descriptor.
- Imports of `createAuth`, `AuthProvider`, `useAuth` and `createKeepAlive` from `@dotmix/runtime/directives` are kept in compiled output.
- Loop variables of `{each}` with `{continue if}`, `{break if}` or `{empty}` are typed from the collection.
- `{keepalive ... as key}` and `{isset ... as value}` bindings are typed; `PermissionProvider` children are optional; `useLoaderData()` returns the data of routes with parameters.
- Valueless HTML boolean attributes (`checked`, `disabled`, `hidden`, `readonly`, `open`, and all `BOOLEAN_ATTRIBUTES`) remain present when compiled as empty strings (`""`).
- Comments in markup (`{/* ... */}` and `{// ...}`) report `MIX_ERR_PARSE_SYNTAX` with a clear message directing authors to the component script above `return`.
