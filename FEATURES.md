# dotMix — Features

> **dotMix** (`.mix` and `.tix`) is a compiler-native, ahead-of-time (AOT) UI framework.
>
> It compiles templates into JavaScript that updates the real DOM directly, and ships its own permissions engine, offline sync and standard library, so common needs are covered without third-party packages.

---

## 1. Capabilities

| Capability | dotMix |
| :--- | :--- |
| **Rendering** | Direct DOM updates compiled ahead of time; no virtual DOM |
| **Runtime dependencies** | None in `@dotmix/runtime` |
| **Standard library** | `@dotmix/helpers`: data, datetime, http, async, web |
| **RBAC/ABAC permissions** | `@dotmix/runtime/permissions` and the `<Can>` component |
| **Reactive permission subjects** | Re-evaluated automatically when the signals they read change |
| **Route permission guards** | Checked before route loaders run (`@dotmix/router`) |
| **Two-mode list keys** | Implicit `{each}` works on plain objects without `id`; explicit keys enforce primitive uniqueness atomically + `.tix` compile-time checks |
| **Error overlay & containment** | Dev browser overlay with source-mapped code frames & component stack; `{try}`/`<ErrorBoundary>` + production root safety net (0 dev overhead in `dist/`) |
| **Type checking** | TypeScript compiler API for `.tix` components |
| **Offline-first CRDT state** | `@dotmix/sync` |
| **Typed forms with async cancellation** | `@dotmix/runtime/forms` |
| **Scoped styles** | `.scss`, `.sass`, `.less`, `.pcss` and `.css` |
| **Signals interop** | `@dotmix/interop` (TC39 signals bridge) |
| **Streaming SSR with CSP nonces** | `@dotmix/server-node` |
| **Static Site Generation & SEO** | `mix build --static` (0-JS pages, automatic `idle` islands, `{hydrate}` / `<Hydrate>`, `useHead`, `i18n`, `sitemap.xml`, hash CSP) |
| **Responsive images** | Optional `@dotmix/image` (`<Picture>`, placeholder mode, optional `sharp` AVIF/WebP) |

---

## 2. Details

### 2.1 Native Isomorphic RBAC/ABAC Permissions (`@dotmix/runtime/permissions`)

In traditional frameworks, developers must install third-party libraries (e.g. CASL) to handle permissions. When a user's role or object attributes change, traditional frameworks force an entire Virtual DOM component tree to re-evaluate and re-render. Furthermore, if a remote permission check is slow, rapid navigation results in race conditions.

**How dotMix solves this:**
- **Zero External Dependencies:** Built directly into the runtime kernel with full isomorphic support across CSR and SSR.
- **Reactive Signal Subjects:** If a permission depends on an entity attribute (e.g., `can("update", "Task", (task) => task.ownerId() === currentUserId())`), dotMix tracks the signal dependencies automatically. When `currentUserId()` or `task.ownerId()` changes, only the exact DOM gate updates surgically.
- **Surgical `<Can>` Component:**
  ```tsx
  <Can I="update" this={task} fallback={<span class="read-only">Locked</span>}>
    <Button onClick={editTask}>Edit</Button>
  </Can>
  ```
- **Async Authorization with Cancellation:** In-flight remote permission checks via `ability.canAsync()` integrate with dotMix's `CancellationToken`. If the user navigates away or state changes before the remote server responds, the in-flight request is aborted immediately with zero memory leaks.
- **Pre-Loader Route Guards:** `@dotmix/router` routes declare security rules directly on route definitions:
  ```ts
  {
    path: "/admin",
    permissions: { action: "manage", subject: "AdminDashboard", redirectTo: "/unauthorized" },
    loader: async () => fetchSensitiveAdminData()
  }
  ```
  The router enforces permissions **synchronously during Radix-Trie traversal before data loaders execute**, guaranteeing that unauthorized users never trigger sensitive backend API requests.

---

### 2.2 Two-Mode Safe List Keys & Error Containment

Lists without `id` fields should work out of the box, while explicit keys should catch bugs immediately before mutating the DOM — and runtime failures should never collapse silently into a white page.

**How dotMix solves this:**
- **Implicit vs. Explicit Keys (`D-188`):** When no key expression is written (`{each item in list}`), dotMix resolves `item.id`, then `item.key` (when a valid primitive), else object/function reference identity, else the primitive value; duplicate implicit keys are disambiguated by occurrence with stable DOM reuse and a single dev warning (`MIX_WARN_IMPLICIT_DUPLICATE_KEY`). When a key expression is written (`{each (item, i, item.id) in list}` or `<Each key={...}>`), dotMix enforces valid primitive keys (`MIX_ERR_INVALID_KEY`, also checked at compile time in `.tix`) and atomic duplicate-key rejection (`MIX_ERR_DUPLICATE_KEY`) in $O(N)$ time before touching the DOM.
- **Dev Error Overlay & Boundaries (`D-189`):** In `mix dev`, uncaught errors from render, effects, handlers, `onMount`, resources, hydration, and unhandled promise rejections render in an accessible `<mix-error-overlay>` with a 7-line source-mapped `.tix`/`.mix` code frame, component stack, docs link, Copy, Open in editor, and Dismiss (auto-clearing on HMR). `{try}…{catch err, reset}…{endtry}` / `<ErrorBoundary>` contain subtree errors in CSR and SSR, and production `mount()`/`hydrate()` provide a configurable root safety net with zero dev overlay code shipped in `dist/`.

---

### 2.3 Native Zero-Dependency Standard Library (`@dotmix/helpers`)

Enterprise frontend applications routinely suffer from "dependency sprawl", importing dozens of uncoordinated npm packages: `lodash`, `moment`, `dayjs`, `axios`, `async`, `p-limit`, `qs`, `mitt`, and `uuid`. This inflates bundle size, introduces supply-chain security risks, and produces inconsistent typing.

dotMix provides **`@dotmix/helpers`** with **100% zero external dependencies**, designed specifically for modern JavaScript/TypeScript and tree-shakeable via semantic subpaths:

#### A. Data & Object Paths (`@dotmix/helpers/data` via `dot`)
- **Prototype-Pollution Protection:** Deep path operations (`dot.get`, `dot.set`, `dot.merge`, `dot.unset`) automatically reject `__proto__`, `constructor`, and `prototype` keys, neutralizing client-side injection vectors.
- **Circular-Safe Operations:** `dot.cloneDeep` and `dot.isEqual` handle circular references (`WeakMap`), `Map`, `Set`, `Date`, `RegExp`, and TypedArrays.
- **Rich Collection Manipulation:** Multi-key `dot.orderBy(items, ["category", "price"], ["asc", "desc"])`, `dot.groupBy`, `dot.keyBy`, `dot.chunk`, `dot.uniqBy`, and functional helpers (`dot.debounce`, `dot.throttle`, `dot.once`, `dot.memoize`, `dot.pipe`).

#### B. Date/Time & IANA Timezones (`@dotmix/helpers/datetime` via `dateTime` & `duration`)
- **Zero-Data Timezone Math:** Converts and formats dates across any IANA timezone (`.tz("America/New_York")`, `.tz("Asia/Tokyo")`) using native browser `Intl.DateTimeFormat` with **zero external tzdata bundles**.
- **Immutable Arithmetic:** `.add(5, "days")`, `.subtract(2, "hours")`, `.startOf("month")`, `.diff(other, "days")`.
- **Human Relative Time:** `.fromNow()`, `.toNow()`, and `duration(90, "minutes").humanize()` without external locales.

#### C. Resilient HTTP Client & Reactive Hook (`@dotmix/helpers/http` via `http`, `useHttp`)
- **Full Interceptor Pipeline:** Request/response interceptors matching Axios ergonomics.
- **Smart Retries & Deduplication:** Automatic exponential backoff on 500/503 errors and in-flight request coalescing for identical concurrent GET calls.
- **TTL Cache:** Built-in in-memory caching with automatic stale eviction.
- **Reactive Hook (`useHttp`):** Returns reactive signals (`data()`, `error()`, `loading()`, `status()`) that automatically abort requests via `CancellationToken` when parameters change or the component unmounts.

#### D. Async Orchestration (`@dotmix/helpers/async` via `asyncFlow`)
- `parallel(tasks, concurrency)` with strict concurrency caps.
- `series(tasks)` and `waterfall(tasks)`.
- `createQueue(worker, concurrency)` with priority scheduling.
- `createMutex()` and `createSemaphore(permits)` for synchronization in web apps.

#### E. Web Utilities (`@dotmix/helpers/web`)
- URL query string parsing & stringification with bracket array formatting and prototype-pollution guards.
- Cryptographically secure `uuidv4()` (RFC 4122) and `nanoid()`.
- SHA-256 and synchronous FNV-1a hashing.
- Lightweight typed pub/sub `createEventBus()`.
- Currency, percentage, and byte size formatters.

---

### 2.4 Offline-First Distributed CRDT Synchronization (`@dotmix/sync`)

Building offline-capable collaborative web applications typically requires external frameworks like Yjs or Automerge. 

dotMix incorporates **`@dotmix/sync`** natively:
- **Instantaneous Optimistic Mutations:** Signals update synchronously with no virtual DOM work; changes are queued optimistically.
- **Durable Local Storage:** Pluggable persistence drivers (`MemoryDriver`, `IndexedDbDriver`, `OpfsDriver`) ensure mutation logs survive page reloads and browser crashes.
- **Deterministic Convergence:** Vector clocks, Lamport timestamps, and fractional indexing guarantee that divergent offline edits converge to identical states without server coordination.
- **Automatic Rollback:** If a server rejects an optimistic mutation, local state and surgical DOM rollback automatically without full-page remounting.

---

### 2.5 Polyglot TC39 Signals Interoperability ABI (`@dotmix/interop`)

dotMix does not lock teams into an all-or-nothing migration:
- **TC39 Signals Bridge:** Wrap dotMix components into React 19, Vue 3.5, or Angular components with bi-directional reactive prop and signal bindings.
- **Zero VDOM Overhead:** Even inside a React or Vue component tree, dotMix components execute directly against the DOM without Virtual DOM diffing.
- **Custom Elements:** Compile any dotMix component to a native Custom Element with complex property reflection and context inheritance.

---

### 2.6 Compiler-Native Scoped CSS with Multi-Preprocessor Pipeline (`@dotmix/compiler-css`)

Unlike frameworks that require complex PostCSS/Vite plugins or CSS-in-JS runtimes:
- Ahead-of-time compilation of `.scss`, `.sass`, `.less`, `.pcss` and `.css` with the compiler's own preprocessors (no `sass`, `less` or `postcss` package needed), for stylesheets a component imports (`import "./Button.scss";`) and for `<style>` blocks.
- Pure build-time AST scoping with zero runtime overhead (`[data-mix-<hash>]`).
- Build-time security validation rejecting `@import` inside raw styles to prevent CSS exfiltration attacks.

---

### 2.7 Production Toolchain & Streaming SSR with Cryptographic CSP Nonces (`@dotmix/server-node`)

- **Code-Splitting:** `mix build` writes every module as its own content-hashed file; lazy routes (`lazy: () => import(...)`) load their modules only when visited.
- **Streaming HTML Generation:** Renders chunked HTML with progressive hydration markers.
- **Cryptographic CSP Nonces:** Automatically generates per-request CSP nonce headers and applies them to all injected `<style>` and `<script>` tags, preventing inline script injection.
- **Sub-Island Error Recovery:** Async streaming errors inside isolated components are caught by boundaries without aborting the HTTP stream.

---

## 3. Summary

dotMix combines compiled direct DOM updates, fine-grained reactivity, built-in permissions, offline CRDT sync and a dependency-free standard library in one toolchain.

