# Mix/Tix Production Roadmap & Architecture Plan (Phase Gates 10–15)

**Authority:** Human Architecture Authority  
**Baseline:** Commit `0439c82` (Phase Gates 0–9 + `HAA-06` / `D-112` Complete, 41/41 Tests Passing)  
**Objective:** Elevate `mix-framework` from a verified compiler/runtime core into a **full, production-ready UI platform** with zero shortcuts, zero Virtual DOM, and zero external runtime dependencies.

---

## 1. Architectural Non-Negotiables Across Gates 10–15

1. **Zero External Runtime Dependencies:** Both `@mix/runtime` and `@mix/router` must maintain `"dependencies": {}`.
2. **Acyclic Package DAG:**
   ```text
   @mix/diagnostics
     └── @mix/ast
           ├── @mix/compiler-frontend
           ├── @mix/compiler-css
           └── @mix/compiler-semantic
                 └── @mix/compiler-codegen
                       ├── @mix/compiler-ssr      (Gate 13)
                       ├── @mix/vite-plugin       (Gate 14)
                       └── @mix/language-server   (Gate 15)
   @mix/runtime (standalone zero-dep runtime)
     └── @mix/router (Gate 12 — depends only on @mix/runtime)
   ```
3. **Full `.tix` TypeScript 6.0.3 Verification:** Every new language construct (`<slot>`, `bind:value`, `{await}`, `<Link>`, `createContext`) must project into virtual `.tix.ts` with 100% byte-covered `SourceMapSpanTable` (`R-SP-01..05`).
4. **No Regex for Semantics:** All binding transformations, slot projections, and SSR hydration markers must be AST-driven.

---

## 2. Phase Gate 10 — Component Composition: Slots (`<slot>`), `children` Projection & Context API (`D-113`)

### 2.1 Scope & Production Deliverables
1. **Default & Named Slots (`<slot />` and `<slot name="header">Fallback</slot>`):**
   - **AST (`@mix/ast`):** Add `SlotOutletNode` (`name: string | null`, `fallback: readonly TemplateNode[]`) and `slot?: string` attribute classification on child nodes passed into `<ComponentCall>`.
   - **Owner & Disposal Semantics (`@mix/runtime`):** Slot content is evaluated lazily inside a child `Owner` parented to the slot outlet's conditional/loop scope so that unmounting a branch inside the child component disposes the projected slot nodes deterministically without leaking parent signals.
   - **React-Style `{props.children}` Interop:** Support both `<slot />` and `{props.children}` in functional `.mix` / `.tix` components.
2. **Typed Context API (`createContext<T>(defaultValue)` & `useContext(ctx)`):**
   - Stored directly on the `Owner` tree (`packages/runtime/src/core/index.ts`), inheriting automatically across `createRoot(..., detachedParent)` (`D-103`) and across `<ComponentCall>` boundaries in $O(1)$ lookup time via prototype-chained context maps.
3. **`.tix` Type Verification (`@mix/compiler-semantic`):**
   - Verify required vs. optional slots and slot prop types via `VerifySlotProps` in `@mix/runtime/typecheck`.

### 2.2 Gate 10 Acceptance Criteria
- Unmocked tests proving default slots, named slots, fallback slot rendering, reactive signal updates across slot boundaries, proper `onCleanup` disposal when a slot branch unmounts, and `createContext` / `useContext` inheritance across deeply nested `.mix` and `.tix` components.

---

## 3. Phase Gate 11 — Two-Way Form Bindings (`bind:*`) & Declarative Async Blocks (`{await}`) (`D-114`)

### 3.1 Scope & Production Deliverables
1. **Compiler-Native Two-Way Bindings (`bind:value`, `bind:checked`, `bind:group`, `bind:files`):**
   - **Syntax (`@mix/compiler-frontend`):** `<input bind:value={draftTitle} />`, `<input type="checkbox" bind:checked={isDone} />`, `<input type="number" bind:value={priority} />`.
   - **Codegen (`@mix/compiler-codegen`):** Compiles directly to a fine-grained DOM effect + native `input`/`change` listener pair (`__bindValue(el, () => draftTitle(), (__v) => draftTitle.set(__v))`) with automatic numeric coercion for `type="number" | "range"`.
   - **`.tix` Type Safety:** `VerifyBind(el, draftTitle)` verifies at compile time that `bind:value` is only attached to `HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement` and that the signal type matches `string | number`.
2. **Declarative `{await}` Control-Flow Block (Integrated with `D-104` `createResource`):**
   - **Clean `HAA-06` Syntax:**
     ```mix
     {await userResource()}
       <p class="loading">Loading profile...</p>
     {then user}
       <ProfileCard user={user} />
     {catch err}
       <p class="error">Failed: {err.message}</p>
     {endawait}
     ```
   - **Runtime (`@mix/runtime`):** Seamless integration with both native `Promise<T>` and `Resource<T>` (`D-104`), automatically cancelling in-flight tokens when the `{await}` block's `Owner` disposes or when the source expression switches promises, preventing race conditions and stale UI commits.

### 3.2 Gate 11 Acceptance Criteria
- Unmocked DOM tests for `bind:value` (text, number, select, textarea), `bind:checked` (checkbox, radio), `{await}` transitions (`pending -> resolved`, `pending -> rejected`, rapid promise switching with stale-result suppression per `D-104`), and `.tix` type-error diagnostics on mismatched `bind:*` targets.

---

## 4. Phase Gate 12 — Production Client Router (`@mix/router`) (`D-115`)

### 4.1 Scope & Production Deliverables
1. **Zero-Dependency Reactive Router (`packages/router`):**
   - **Radix-Trie Route Matcher:** Supports static routes (`/dashboard`), dynamic parameters (`/tasks/:id`), catch-all routes (`/docs/*rest`), and nested layout trees.
   - **History & Memory Drivers:** Browser `History` API (`pushState` / `popstate`), Hash driver (`#/path`), and deterministic `MemoryHistory` driver for SSR and unit testing.
   - **Reactive Route Primitives:** `useRoute()`, `useParams<T>()`, `useSearchParams()`, and `useNavigate()`.
   - **Navigation Guards & Cancellation (`D-104`):** Async `beforeEnter` guards receive a `CancellationToken` (`D-104`) that automatically cancels if a newer navigation supersedes an in-flight guard.
   - **Security Boundary (`R-URL-01`):** `<Link href={...}>` and `router.push(...)` enforce `validateSafeUrl` (`spec/SECURITY.md`) to block `javascript:`, `vbscript:`, and cross-origin open-redirect attacks.

### 4.2 Gate 12 Acceptance Criteria
- Unmocked navigation suite covering nested `<RouterView />` layouts, reactive param updates without remounting shared parent layouts, async guard cancellation, scroll restoration, and unsafe URL rejection.

---

## 5. Phase Gate 13 — Server-Side Rendering (`@mix/compiler-ssr`) & Progressive Hydration (`D-116`)

### 5.1 Scope & Production Deliverables
1. **Ahead-of-Time SSR Code Generator (`@mix/compiler-ssr`):**
   - Compiles `.mix` and `.tix` ASTs into high-throughput server rendering functions (`renderToString(App, props)` and Web Streams `renderToStream(App, props)`).
   - Emits deterministic hydration boundary comments (`<!--mix:b:0-->...<!--/mix:b:0-->` and `data-mix-hk` keys) for dynamic blocks (`{if}`, `{each}`, `{await}`, `<$tagName>`).
2. **SSR Security Invariants (`spec/SECURITY.md`):**
   - Automatic HTML entity escaping for all text interpolations and attributes.
   - Enforces `D-109` (`SanitizerProvider`), `D-107` (WHATWG `srcset`), and `D-108` (CSS escape validation) on the server during HTML emission.
   - Safe JSON state serialization (`serializeState`) escaping `<`, `>`, `/`, `\u2028`, `\u2029` to prevent `</script>` breakout XSS.
3. **Surgical Client Hydration (`hydrate(App, container)` in `@mix/runtime`):**
   - Walks existing server-rendered DOM nodes and attaches fine-grained reactive effects and event listeners **without recreating or replacing existing DOM elements**.
   - Emits deterministic `MIX_ERR_HYDRATION_MISMATCH` diagnostic if server DOM and client template structure diverge.

### 5.2 Gate 13 Acceptance Criteria
- Unmocked SSR-to-Hydration roundtrip tests verifying `renderToString` + `hydrate(App, container)` preserves 100% of server DOM node references (`===`), attaches event handlers, resumes reactive signals, and blocks XSS in server-rendered attributes/styles/HTML.

---

## 6. Phase Gate 14 — Build Tooling, Bundler Plugin (`@mix/vite-plugin`) & CLI (`create-mix-app`) (`D-117`)

### 6.1 Scope & Production Deliverables
1. **Official Vite / Rollup Plugin (`@mix/vite-plugin`):**
   - Compiles `.mix` and `.tix` modules on the fly with chained V3 source maps (`@mix/compiler-semantic` + `@mix/compiler-codegen`).
   - Extracts scoped `<style>` blocks into virtual CSS modules (`?mix&type=style.css`) for production CSS minification and code-splitting.
   - Wires `D-111` (`createHmrScope` / `applyHmrUpdate`) into `import.meta.hot.accept(...)` so editing a `.mix` or `.tix` file updates component methods and templates in-place while preserving live `signal()` state when the state signature matches.
2. **CLI & Project Scaffolder (`packages/cli`):**
   - `mix check`: Runs whole-project `.tix` TypeScript 6.0.3 verification and semantic diagnostics from the command line / CI.
   - `mix build` & `mix dev`: Zero-config project build and dev server.

### 6.2 Gate 14 Acceptance Criteria
- End-to-end Vite build and HMR hot-swap verification tests + `mix check` CLI exit-code and code-frame tests.

---

## 7. Phase Gate 15 — Language Server Protocol (`@mix/language-server`) & IDE Extension (`D-118`)

### 7.1 Scope & Production Deliverables
1. **Language Server (`@mix/language-server`):**
   - Powered directly by `@mix/compiler-frontend` and `@mix/compiler-semantic` (`projectTypeScript` + `SourceMapSpanTable` `R-SP-01..05`).
   - Provides real-time IDE diagnostics, hover type information, go-to-definition across `.mix` / `.tix` / `.ts` imports, and completion items for component props, signals, `<$tagName>`, `{if}/{elseif}/{else}/{endif}`, and `{each (item, idx) in list}/{endeach}`.
2. **VS Code Extension (`editors/vscode-mix`):**
   - TextMate grammar (`syntaxes/mix.tmLanguage.json`) for `.mix` and `.tix` files + LSP client wiring.

### 7.2 Gate 15 Acceptance Criteria
- Automated LSP request/response test suite verifying hover, completions, go-to-definition, and exact diagnostic range mapping on `.mix` and `.tix` documents.

