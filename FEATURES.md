# dotMix — Unique Features & Architectural Comparison

> **dotMix** (`.mix` & `.tix`) is a compiler-native, ahead-of-time (AOT) UI framework engineered from the ground up for high-performance, enterprise-grade web applications.
>
> Unlike existing frameworks that rely on Virtual DOM diffing (React, Vue), runtime-interpreted template engines, or fragmented third-party utility ecosystems, **dotMix** compiles declarative UI directly into surgical, zero-allocation DOM instructions paired with a zero-external-dependency standard library and isomorphic security infrastructure.

---

## 1. Feature Comparison Matrix

| Capability | **dotMix** | React 19 | Vue 3.5 | Svelte 5 | Solid.js | Angular 18 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Rendering Architecture** | **Direct DOM (AOT)** | Virtual DOM | Virtual DOM | Direct DOM (Runes) | Direct DOM | Incremental DOM |
| **Virtual DOM Overhead** | **Zero** | High | Medium | Zero | Zero | Zero |
| **Core Runtime Dependencies** | **0 dependencies** | ~2+ | ~3+ | 0 | 0 | ~5+ |
| **Native Standard Library (`helpers`)** | **Built-in (`mix-helpers`)** | ❌ (Need Lodash/Moment/Axios) | ❌ (Need Lodash/Moment/Axios) | ❌ (Need Lodash/Dayjs/Fetch) | ❌ (Need external libs) | ❌ (Partial RxJS only) |
| **Native RBAC/ABAC Permissions** | **Built-in (`@mix/runtime/permissions`)** | ❌ (Need CASL) | ❌ (Need CASL) | ❌ (Manual) | ❌ (Manual) | ❌ (Manual guards) |
| **Reactive Permission Subjects** | **Automatic (Zero-re-render)** | ❌ (Full re-render) | ❌ (Full re-render) | ❌ (Manual) | ❌ (Manual) | ❌ (Manual) |
| **Pre-Loader Route Permission Guards** | **Built-in (Zero-leak)** | ❌ (Ad-hoc) | ❌ (Manual beforeEach) | ❌ (Ad-hoc) | ❌ (Ad-hoc) | Manual CanActivate |
| **Duplicate Key Handling** | **Atomic Rejection (`D-110`)** | Silent bug / glitch | Silent bug / glitch | Glitch / warning | Glitch / corruption | Console warning |
| **Type Verification Engine** | **Official TypeScript 6 Compiler API** | Standard TSX | Vetur / Volar | Custom typechecker fork | Standard TSX | Angular Compiler |
| **Offline-First Distributed CRDT State** | **Built-in (`@mix/sync`)** | ❌ (Need Automerge/Yjs) | ❌ (Need Automerge/Yjs) | ❌ (Need Yjs) | ❌ (Need Yjs) | ❌ (Need external) |
| **Reactive Typed Forms & Async Cancellation**| **Built-in (`@mix/runtime/forms`)** | ❌ (Need React Hook Form/Zod) | ❌ (Need VeeValidate) | ❌ (Manual) | ❌ (Manual) | Reactive Forms |
| **Multi-Preprocessor Scoped Styles** | **Native (`.scss`, `.sass`, `.less`, `.pcss`)** | ❌ (Need CSS modules/plugins) | Built-in | Built-in | ❌ (Need Vite plugin) | Built-in |
| **Polyglot TC39 Signals ABI** | **Built-in (`@mix/interop`)** | ❌ | ❌ | ❌ | Partial | ❌ |
| **Streaming SSR + Cryptographic CSP Nonce** | **Built-in (`@mix/server-node`)** | Partial | Partial | Partial | Partial | Partial |

---

## 2. Core Breakthroughs Not Found in Other Frameworks

### 2.1 Native Isomorphic RBAC/ABAC Permissions (`@mix/runtime/permissions`)

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
- **Async Authorization with Cancellation (`D-104`):** In-flight remote permission checks via `ability.canAsync()` integrate with dotMix's `CancellationToken`. If the user navigates away or state changes before the remote server responds, the in-flight request is aborted immediately with zero memory leaks.
- **Pre-Loader Route Guards:** `@mix/router` routes declare security rules directly on route definitions:
  ```ts
  {
    path: "/admin",
    permissions: { action: "manage", subject: "AdminDashboard", redirectTo: "/unauthorized" },
    loader: async () => fetchSensitiveAdminData()
  }
  ```
  The router enforces permissions **synchronously during Radix-Trie traversal before data loaders execute**, guaranteeing that unauthorized users never trigger sensitive backend API requests.

---

### 2.2 Atomic Keyed Collection Rejection (`D-110`)

In React, Vue, Svelte, and Solid, providing duplicate keys in a list (`key={item.id}` or `{#each ... (item.id)}`) causes silent rendering glitches, misplaced inputs, DOM node corruptions, or confusing warnings that leave the application in an unpredictable state.

**How dotMix solves this:**
- dotMix validates the entire incoming collection of keys upfront in $O(N)$ time before any reconciliation begins.
- If a duplicate key is detected, dotMix **atomically rejects the update**, leaves the existing rendered DOM and child reactivity scopes completely untouched, allocates zero new DOM nodes, and throws a deterministic `MIX_ERR_DUPLICATE_KEY` synchronously in **both DEV and PROD**.
- This guarantees the UI state is never left partially applied or visually corrupted.

---

### 2.3 Native Zero-Dependency Standard Library (`mix-helpers` / `@mix/helpers`)

Enterprise frontend applications routinely suffer from "dependency sprawl", importing dozens of uncoordinated npm packages: `lodash`, `moment`, `dayjs`, `axios`, `async`, `p-limit`, `qs`, `mitt`, and `uuid`. This inflates bundle size, introduces supply-chain security risks, and produces inconsistent typing.

dotMix provides **`mix-helpers`** with **100% zero external dependencies**, designed specifically for modern JavaScript/TypeScript and tree-shakeable via semantic subpaths:

#### A. Data & Object Paths (`mix-helpers/data` via `dot`)
- **Prototype-Pollution Protection:** Deep path operations (`dot.get`, `dot.set`, `dot.merge`, `dot.unset`) automatically reject `__proto__`, `constructor`, and `prototype` keys, neutralizing client-side injection vectors.
- **Circular-Safe Operations:** `dot.cloneDeep` and `dot.isEqual` handle circular references (`WeakMap`), `Map`, `Set`, `Date`, `RegExp`, and TypedArrays.
- **Rich Collection Manipulation:** Multi-key `dot.orderBy(items, ["category", "price"], ["asc", "desc"])`, `dot.groupBy`, `dot.keyBy`, `dot.chunk`, `dot.uniqBy`, and functional helpers (`dot.debounce`, `dot.throttle`, `dot.once`, `dot.memoize`, `dot.pipe`).

#### B. Date/Time & IANA Timezones (`mix-helpers/datetime` via `dateTime` & `duration`)
- **Zero-Data Timezone Math:** Converts and formats dates across any IANA timezone (`.tz("America/New_York")`, `.tz("Asia/Tokyo")`) using native browser `Intl.DateTimeFormat` with **zero external tzdata bundles**.
- **Immutable Arithmetic:** `.add(5, "days")`, `.subtract(2, "hours")`, `.startOf("month")`, `.diff(other, "days")`.
- **Human Relative Time:** `.fromNow()`, `.toNow()`, and `duration(90, "minutes").humanize()` without external locales.

#### C. Resilient HTTP Client & Reactive Hook (`mix-helpers/http` via `http`, `useHttp`)
- **Full Interceptor Pipeline:** Request/response interceptors matching Axios ergonomics.
- **Smart Retries & Deduplication:** Automatic exponential backoff on 500/503 errors and in-flight request coalescing for identical concurrent GET calls.
- **TTL Cache:** Built-in in-memory caching with automatic stale eviction.
- **Reactive Hook (`useHttp`):** Returns reactive signals (`data()`, `error()`, `loading()`, `status()`) that automatically abort requests via `CancellationToken` when parameters change or the component unmounts.

#### D. Async Orchestration (`mix-helpers/async` via `asyncFlow`)
- `parallel(tasks, concurrency)` with strict concurrency caps.
- `series(tasks)` and `waterfall(tasks)`.
- `createQueue(worker, concurrency)` with priority scheduling.
- `createMutex()` and `createSemaphore(permits)` for synchronization in web apps.

#### E. Web Utilities (`mix-helpers/web`)
- URL query string parsing & stringification with bracket array formatting and prototype-pollution guards.
- Cryptographically secure `uuidv4()` (RFC 4122) and `nanoid()`.
- SHA-256 and synchronous FNV-1a hashing.
- Lightweight typed pub/sub `createEventBus()`.
- Currency, percentage, and byte size formatters.

---

### 2.4 Offline-First Distributed CRDT Synchronization (`@mix/sync`)

Building offline-capable collaborative web applications typically requires external frameworks like Yjs or Automerge. 

dotMix incorporates **`@mix/sync`** natively:
- **Zero-Latency Mutations:** Signals update synchronously in 0ms; changes are queued optimistically.
- **Durable Local Storage:** Pluggable persistence drivers (`MemoryDriver`, `IndexedDbDriver`, `OpfsDriver`) ensure mutation logs survive page reloads and browser crashes.
- **Deterministic Convergence:** Vector clocks, Lamport timestamps, and fractional indexing guarantee that divergent offline edits converge to identical states without server coordination.
- **Automatic Rollback:** If a server rejects an optimistic mutation, local state and surgical DOM rollback automatically without full-page remounting.

---

### 2.5 Polyglot TC39 Signals Interoperability ABI (`@mix/interop`)

dotMix does not lock teams into an all-or-nothing migration:
- **TC39 Signals Bridge:** Wrap dotMix components into React 19, Vue 3.5, or Angular components with bi-directional reactive prop and signal bindings.
- **Zero VDOM Overhead:** Even inside a React or Vue component tree, dotMix components execute directly against the DOM without Virtual DOM diffing.
- **Custom Elements:** Compile any dotMix component to a native Custom Element with complex property reflection and context inheritance.

---

### 2.6 Compiler-Native Scoped CSS with Multi-Preprocessor Pipeline (`@mix/compiler-css`)

Unlike frameworks that require complex PostCSS/Vite plugins or CSS-in-JS runtimes:
- Ahead-of-time compilation for `.scss`, `.sass`, `.less`, `.pcss`, and `.css` directly in `<style src="..." />` and project stylesheets.
- Pure build-time AST scoping with zero runtime overhead (`[data-mix-<hash>]`).
- Build-time security validation rejecting `@import` inside raw styles to prevent CSS exfiltration attacks (`D-108`).

---

### 2.7 Production Toolchain & Streaming SSR with Cryptographic CSP Nonces (`@mix/server-node`)

- **Automatic Route Code-Splitting:** Dynamic routes (`lazy: () => import(...)`) compile into hashed, code-split chunks.
- **Streaming HTML Generation:** Renders chunked HTML with progressive hydration markers.
- **Cryptographic CSP Nonces:** Automatically generates per-request CSP nonce headers and applies them to all injected `<style>` and `<script>` tags, preventing inline script injection.
- **Sub-Island Error Recovery:** Async streaming errors inside isolated components are caught by boundaries without aborting the HTTP stream.

---

## 3. Summary

dotMix eliminates the friction, performance costs, and security risks of legacy web development by unifying **compiler-native direct DOM operations**, **fine-grained reactivity**, **built-in isomorphic permissions**, **offline CRDT synchronization**, and a **zero-dependency standard library** into a single cohesive architecture.

