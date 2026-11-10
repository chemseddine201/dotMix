# Decision Register — Accepted Baseline and Change Control

This register records constraints known to be accepted in the project's current baseline. The agent must compare them against the repository's actual canonical decision documents and report any mismatch. This register does not authorize inventing missing details.

| ID | Accepted direction | Required verification |
|---|---|---|
| D-101 | Deferred rerun; `pendingRerun` independent of computation state; coalesced notifications; non-nested effect execution; configurable scheduler iteration safety ceiling and deterministic cycle error. | Verify exact scheduler algorithm, ceiling semantics, error contract, and tests. |
| D-102 | Owner lifecycle state is separate from computation state. | Verify all state transitions, disposal, unlinking, and scheduling behavior—not only type declarations. |
| D-103 | Preserve `createRoot` with optional `detachedParent?: Owner \| null`. | Verify context inheritance is distinct from automatic disposal ownership. |
| D-104 | Platform-neutral cancellation token in core; adapters may bridge to platform cancellation; generation checks prevent stale results. | Verify token ownership, request replacement, owner disposal, and stale Promise behavior. |
| D-105 | Preserve dynamic element syntax `<{~expr}>...</{~expr}>`; resolve identity once per element instance. | Verify grammar, parser boundaries, and runtime/codegen semantics. |
| D-106 | `.tix` uses TypeScript Compiler API for type verification; no competing type checker. | Verify props/ref/generic model, source mapping, and API isolation. |
| D-107 | `srcset` handling must follow the normative WHATWG algorithm or a reviewed implementation demonstrably conforming to it. | Verify algorithm provenance and meaningful conformance vectors, including data URLs and commas. |
| D-108 | Dynamic CSS has compile-time and runtime validation, including escapes and URL policy. | Verify values and context handling; property allowlist alone is insufficient. |
| D-109 | Explicit trusted HTML boundary and defined SanitizerProvider/Trusted Types integration (ratified by `HAA-03`). | Verify sanitizer trust requirements, application `SanitizerProvider` authority, private `WeakSet` registry, context rejection, and prohibition of caller-supplied sanitizers. |
| D-110 | No surrogate fallback keys; deterministic duplicate-key diagnostics and atomic behavior (ratified by `HAA-02`, Option A Strict). | Verify pre-reconciliation validation, atomic rejection, DOM preservation, zero allocations, and synchronous `MixError` throwing in both DEV and PROD. |
| D-111 | HMR method dispatch uses stable component scope/context; lexical closures must not be assumed rebindable. | Verify updated methods access live component state through the stable scope contract. |
| D-112 | `HAA-06` Language Ergonomics & Syntax Upgrade: (1) Replace `~` dynamic elements with clean `$` syntax `<$tagName>...</$tagName>` and `<$tagName />`; (2) Replace `#if/:else/if` with clean curly keywords `{if cond} ... {elseif cond2} ... {else} ... {endif}`; (3) Replace complex `{#each tasks() as task, idx (task.id)}` with `{each (task, idx) in tasks()} ... {endeach}` (and `{each tasks() as (task, idx)}`) with automatic item key resolution (`item?.id ?? item?.key ?? item`) while preserving `D-110` atomic duplicate-key rejection; (4) Support Functional ReactJS-style `.mix` (JS) and `.tix` (TS) components (`export default function Component(props) { ... return (<...>); }`). | Verify parser frontend, semantic analysis, TypeScript 6.0.3 verification, codegen, showcase, and conformance tests. |
| D-113 | Gate 10: Component Composition — Default and named `<slot />`, fallback slot content, React-style `{props.children}` projection, and `createContext` / `useContext` API. | Verify lazy slot evaluation inside child Owner, deterministic cleanup on branch unmount, and prototype-chained context lookup. |
| D-114 | Gate 11: Two-Way Form Bindings (`bind:value`, `bind:checked`, `bind:group`) and Declarative Async Blocks (`{await ...} ... {then ...} ... {catch ...} ... {endawait}`). | Verify input/change sync, numeric coercion, D-104 CancellationToken integration, and stale-promise suppression. |
| D-115 | Gate 12: Production Client Router (`@mix/router`) with zero external dependencies, Radix-Trie route matching, history/hash/memory drivers, reactive navigation primitives, beforeEnter cancellation, and R-URL-01 safety. | Verify router package boundaries, nested layouts, params, async guards, and security validation. |
| D-116 | Gate 13: Server-Side Rendering (`@mix/compiler-ssr`) and Surgical Client Hydration (`hydrate()`). | Verify renderToString/renderToStream, hydration comment markers, existing DOM node reference preservation, and XSS escaping. |
| D-117 | Gate 14: Bundler Integration (`@mix/vite-plugin`) and CLI Tooling (`mix check`, `mix build`, `mix dev`). | Verify Vite dev/build with HMR (D-111) and CLI typechecking/code-frame output. |
| D-118 | Gate 15: Language Server Protocol (`@mix/language-server`) and VS Code Extension (`editors/vscode-mix`). | Verify LSP hover, diagnostics, go-to-definition, and autocomplete mapped through SourceMapSpanTable (R-SP-01..05). |
| D-119 | Gate 16: Local-First Offline Sync State Engine (`@mix/sync`) with CRDT stores (`syncSignal`, `syncCollection`), OPFS/IndexedDB durable logging, Lamport clocks, optimistic mutations, and rollback. | Verify synchronous local updates, offline survival, deterministic conflict convergence, and transactional rollback. |
| D-120 | Gate 17: Universal Polyglot Component ABI (`@mix/interop`) with TC39 Signals bridge, React 19 / Vue 3.5 / Angular wrappers, and Light-DOM custom elements. | Verify bi-directional reactive updates, zero VDOM overhead, prop/context forwarding, and style inheritance. |
| D-121 | Gate 18: Resilient Streaming & Progressive Hydration (`@mix/ssr`, `@mix/stream`) with chunk manifests, packet loss auto-retry, and surgical zero-VDOM hydration. | Verify island-level resumption, packet dropout simulation, and sub-island error containment. |
| D-122 | Gate 19: Built-In DOM Visual & Lifecycle Primitives (`@mix/runtime/dom`) — `Teleport` (`createPortal`), `KeepAlive` (`createKeepAlive`), and `Transition` (`createTransition`) with context inheritance and FLIP lifecycle CSS transitions. | Verify portal rendering into arbitrary containers with live reactive context, LRU fragment preservation across view switches, and enter/leave transition styling. |
| D-123 | Gate 20: Data Router Loaders, Actions, Lazy Splitting & Prefetching (`@mix/router`) — Route loaders with `useLoaderData`, actions with `useActionData` and `useSubmit`, stale loader cancellation via `CancellationToken`, automatic revalidation, dynamic route splitting (`lazy: () => import(...)`), `<Link prefetch="intent">`, and `useHead`. | Verify async loader execution, stale navigation cancellation, automatic revalidation upon mutation action, lazy code-splitting, prefetching on hover, and reactive document title updates. |
| D-124 | Gate 21: Reactive Typed Forms & Validation Engine (`@mix/runtime/forms`) — `createForm` with per-field and form-level signals, built-in sync validators, and generation-tracked async validators with automatic cancellation. | Verify bi-directional field binding, touched/dirty/valid state computation, composable validators, and cancellation of stale async validation requests. |
| D-125 | Gate 22: CRDT Epoch Compaction & Live Network Transports (`@mix/sync`) — `compact(ackWatermarkClock)` for tombstone GC in `ReplicableArray`, `pruneMutations` in drivers, `HttpBatchSyncTransport` (auto-flushing batch HTTP POST), and `WebSocketSyncTransport` (auto-reconnecting WebSocket). | Verify tombstone purging without sequence shifting, persistent log pruning, batched mutation flushing over HTTP, and offline WebSocket packet queueing. |
| D-126 | Gate 23: Scope-Aware Signal Auto-Invocation in SSR (`@mix/compiler-ssr`) — Ahead-of-time expression AST rewriting transforms bare signals (`count` -> `count()`) in interpolations, conditionals, iterations, and dynamic attributes, matching CSR behavior while preserving explicit calls and property accesses. | Verify SSR and CSR HTML parity for bare signals in templates, preservation of member access and explicit calls, and defensive unwrap for signal props. |
| D-127 | Gate 24: Cross-File Component Intelligence & External CSS Completions (`@mix/language-server`) — Multi-file workspace indexing with Go-To-Definition jumping from `<Component />` tags and imports to source files, nested block completions for `{#each}` and `{#await}`, and external CSS class completions from linked stylesheets. | Verify jump to definition from `<MetricCard />` tags to target `.tix`/`.mix` files, loop/async block scope variable completions, and external stylesheet class suggestions. |
| D-128 | Gate 25: Native Fine-Grained Permissions Engine (`@mix/runtime/permissions` & `@mix/router`) — Zero-dependency isomorphic RBAC/ABAC permissions, reactive signal subject tracking, cancellable `canAsync()`, field-level rules, `<Can>` component, and pre-loader route guards. | Verify RBAC/ABAC evaluation, reactive signal subject tracking, field restrictions, cancellation, and router guards. |
| D-129 | Gate 26: Project Scaffolding & Initialized Framework Architecture (`@mix/cli`) — Standard modular project layout via `mix create` and `mix init` with TypeScript/JavaScript and stylesheet extension options. | Verify full project scaffold generation across variants. |
| D-130 | Gate 27 (`T-27.3`, amends `D-108`): Build-time CSS preprocessor stage before `compileCss` supporting `.scss`, `.sass`, `.less`, and `.pcss`/`.postcss`. `@import`/`@use` allowed inside preprocessor files and resolved at build time; `D-108` `@import` ban remains strictly enforced for raw `<style>` blocks and post-preprocessed CSS output. Missing external preprocessors fail with `MIX_ERR_PREPROCESSOR_MISSING` and an install hint; source is never passed through unprocessed. | Verify valid scoped CSS emission across `.scss`/`.sass`/`.less`/`.pcss`, `@import`/`@use` resolution, `MIX_ERR_PREPROCESSOR_MISSING` diagnostic, and preserved `D-108` raw CSS `@import` rejection. |
| D-131 | Gate 27 (`T-27.4`, amends `D-106`): `typecheckTix` resolves `@mix/*` against the real emitted `.d.ts` declarations of each package via `exports`, and resolves relative user modules (`.tix`/`.mix`/`.ts`/`.js`) through a real `CompilerHost` with on-demand `projectTypeScript`. Hand-written ambient `@mix/runtime` declaration is removed; ambient declarations retain only asset-module shims (`*.css`, `*.scss`, etc.). | Verify `.tix` typechecking resolves all `@mix/*` exports and relative `.tix`/`.ts` imports accurately, catches invalid prop/argument types, and passes runtime surface parity guard. |
| D-132 | Gate 28 (`T-28.4`): Template grammar accepts element and fragment expressions inside `{...}` attribute values (`fallback={<span/>}`, `icon={<Icon/>}`), parsed as a nested template subtree and compiled to a lazily-mounted render function. | Verify parser AST spans, semantic binding, CSR/SSR codegen, and LSP support for attribute element expressions. |
| D-133 | Gates 27–28 (`T-27.2`, `T-28.4`, clarifies `D-112`, Option (b)): Confirm canonical control-flow syntax `{if}/{elseif}/{else}/{endif}` and `{each (x, i) in list}/{endeach}`. Legacy `{#if}`/`{#each}` continue parsing with a compiler/LSP deprecation warning; JSX `{cond && <el/>}` is diagnosed with a compiler hint to use `{if} ... {endif}` (Option b). | Verify canonical control flow in scaffold/showcase templates, deprecation warning on `{#if}`/`{#each}`, and diagnostic hint on `{cond && <el/>}`. |
| D-134 | Gate 29.5 (`T-29.5.1`): Rebrand framework identity to **dotMix** (`dotmix-framework`), maintaining full compatibility for `.mix`/`.tix` source extensions, `@mix/*` package namespaces, and dual `dotmix`/`mix` CLI binaries. | Verify CLI banners, docs URLs, root package name, and CLI alias execution. |
| D-135 | Gate 29.5 (`T-29.5.2`–`T-29.5.4`): Native zero-dependency standard library `mix-helpers` (`@mix/helpers`) covering data paths/collections (`mix-helpers/data` via `dot`), date/time formatting & timezone math (`mix-helpers/datetime` via `dateTime`), HTTP client & reactive hook (`mix-helpers/http` via `http`/`useHttp`), async concurrency control (`mix-helpers/async` via `asyncFlow`), and web utilities (`mix-helpers/web`). | Verify zero external dependencies, tree-shakeable subpaths, and unmocked test suites. |

---

## Ratified Human Architecture Authority Decisions (`HAA-01` through `HAA-05`)

Ratified by Human Architecture Authority on 2026-11-08 for Phase Gate 1 authorization:

### 1. `HAA-01` — Canonical Specification Baseline & Provenance (`spec/*.md`)
- Reconcile archived pre-initialization specifications from `archive/pre-initialization-b95110e` (`b95110ec04a564cdea9feb7dfd3b635f3de18803`, specifically `spec/MIX_SPEC_v3.2.2.md` from commit `74dc8f9`, historical `DECISIONS.md`, and prior `spec/*.md`) **strictly subordinate to** `governance/PROJECT_CHARTER.md`, `governance/ARCHITECTURE_GUARDRAILS.md`, `governance/DECISION_REGISTER.md`, and `HAA-01`..`HAA-05` into 10 authoritative English specification files under `spec/`:
  `LANGUAGE.md`, `AST.md`, `SEMANTICS.md`, `RUNTIME_API.md`, `CSS_SCOPING.md`, `DIAGNOSTICS.md`, `SECURITY.md`, `TESTING.md`, `PERFORMANCE.md`, `COMPATIBILITY.md`.
- Maintain `spec/SOURCE_PROVENANCE.md` recording Git commits, SHA-256 hashes, dates, and governance overrides applied (`D-101`, `D-105`, `D-109`, `D-110`).
- **Strict Non-Fabrication Rule:** Upstream `v3.2.1` Items 11 & 12 (`MIX_SPEC_v3.2.2.md` §0.3) were absent from repository history and are explicitly documented as **Unratified / Absent Upstream**.

### 2. `HAA-02` — `D-110` Atomic Duplicate-Update Rejection Policy (Option A — Strict)
- Ratified policy for keyed collection reconciliation:
  1. Validate complete incoming collection of keys upfront prior to reconciliation diffing.
  2. Detect duplicate keys deterministically.
  3. Reject invalid update atomically.
  4. Preserve previously rendered DOM collection and child owners intact.
  5. Allocate zero DOM nodes or owner state for items in a rejected update.
  6. **Option A (Strict):** Emit and **throw** deterministic `MixError` (`MIX_ERR_DUPLICATE_KEY`) synchronously in **both DEV and PROD**, while ensuring reactive scheduler/queue invariants remain uncorrupted (`D-101`).

### 3. `HAA-03` — `D-109` Trusted HTML Public Boundary & Sanitizer Authority
- Root application configures sanitization authority via `setSanitizerProvider(provider)`.
- `createTrustedHtml(dirtyHtml)` invokes configured `SanitizerProvider` (and native W3C Trusted Types `window.trustedTypes` where supported).
- Authentic trusted HTML wrappers are registered in a private module-scoped `WeakSet<object>`.
- HTML sinks accept only instances present in that `WeakSet`; caller-supplied sanitizer callbacks (`createTrustedHtml(dirty, fn)`) are permanently prohibited.

### 4. `HAA-04` — Package Topology & `@mix/runtime` Zero-Dependency Boundary (`NEW-F-03`)
- Introduce `@mix/diagnostics` as the zero-dependency leaf package for error types and diagnostic codes.
- `@mix/ast` holds template AST node interfaces, spans, and structural self-contained ESTree-compatible expression node interfaces (no external `@types/*` leakage in `.d.ts` outputs).
- `@mix/runtime` declares `"dependencies": {}` and uses **`import type` ONLY** when referencing `@mix/diagnostics` types (enforced with `"verbatimModuleSyntax": true` so `tsc -b` completely erases all `@mix/diagnostics` imports at compile time, requiring zero bundler). `@mix/runtime` defines its own small, self-contained runtime `MixError` class and code constants, verified for parity against `@mix/diagnostics` by Gate 1 tests.
- `@mix/router` remains deferred (no package scaffolded in Gate 1).

### 5. `HAA-05` — Toolchain & Compiler Parser Matrix (`NEW-F-01` & `NEW-F-02`)
- **Acorn TypeScript Fix (`NEW-F-01`):** Use verified npm release `@sveltejs/acorn-typescript@1.0.13` (acorn `^8.9.0` peer).
- **Linter Lockstep Fix (`NEW-F-02`):** Pair `"eslint": "9.39.5"` with `"@eslint/js": "9.39.5"`.
- **Exact Verified Version Pins (NO `^` or `~` ranges):**
  - Root `engines`: `{ "node": ">=22.12.0", "npm": ">=10.0.0" }` (Node 26 Active LTS baseline; Node 22 host support).
  - Root `devDependencies`:
    `@eslint/js@9.39.5`, `@types/node@26.0.0`, `eslint@9.39.5`, `happy-dom@15.11.7`, `typescript@6.0.3`, `typescript-eslint@8.72.1`.
  - Workspace package dependencies:
    - `@mix/diagnostics`: `{}`
    - `@mix/ast`: `{ "@mix/diagnostics": "0.1.0" }`
    - `@mix/compiler-frontend`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "acorn": "8.14.0", "@sveltejs/acorn-typescript": "1.0.13" }`
    - `@mix/compiler-semantic`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "typescript": "6.0.3" }`
    - `@mix/compiler-css`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "css-tree": "3.1.0" }`
    - `@mix/compiler-codegen`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "@mix/compiler-semantic": "0.1.0", "@mix/compiler-css": "0.1.0" }`
    - `@mix/runtime`: `{}` (zero runtime dependencies; `@mix/diagnostics` in `devDependencies` / `references` for `import type` erasure only).

### 6. `HAA-06` (`D-112`) — Language Ergonomics & Syntax Upgrade
Ratified by Human Architecture Authority on 2026-11-08:
1. **Dynamic Element Syntax (`<$tagName>`):** Eliminate `~` from user-facing dynamic elements in favor of `<$tagName>...</$tagName>`, `<$props.tag />`, and `<${expr}>...</${expr}>` (while retaining backward parser compatibility for legacy `<{~expr}>` conformance tests).
2. **Clean Symbol-Free Conditional Blocks (`{if} / {elseif} / {else} / {endif}`):** Replace `{#if} / {:else} / {/if}` with clean symbol-free curly keywords `{if cond} ... {elseif cond2} ... {else} ... {endif}`.
3. **Clean Standard `each` Loops (`{each (item, idx) in list} ... {endeach}`):** Replace `{#each tasks() as task, idx (task.id)}` with `{each (task, idx) in tasks()} ... {endeach}` (and `{each tasks() as (task, idx)} ... {endeach}`), automatically resolving item keys (`task?.id ?? task?.key ?? task`) without boilerplate `(task.id)` while preserving `D-110` (`HAA-02`) atomic duplicate-key rejection.
4. **Functional ReactJS-Style `.mix` (JS) and `.tix` (TS) Components:** Write `.mix` (JavaScript) and `.tix` (TypeScript) components as clean React-style functions (`export default function ComponentName(props: PropsType = defaults) { ... return ( <...> ); }`) alongside optional `<style>...</style>`, compiled ahead-of-time to direct surgical DOM operations with zero Virtual DOM.

### 7. `HAA-07` (`D-128`) — Native Fine-Grained Permissions Engine (Gate 25)
Ratified by Human Architecture Authority on 2026-11-09:
1. **Zero-Dependency Native Permissions Engine:** Incorporate isomorphic RBAC + ABAC permissions natively into `@mix/runtime/permissions`, with zero external dependencies.
2. **Fine-Grained Signal Reactivity:** Unlike CASL's re-render cascades, rules and reactive subjects are wired directly to fine-grained signal dependencies (`_rules()` signal, reactive signal predicates on subjects). DOM gates update surgically without Virtual DOM or component re-renders.
3. **Async Cancellation:** `ability.canAsync()` integrates natively with `CancellationToken` (D-104), cleanly aborting in-flight remote authorization requests upon rapid navigation or UI state transitions.
4. **Pre-Loader Route Guards:** `@mix/router` routes declare `permissions: { action, subject, redirectTo }`, verified synchronously during Radix-Trie traversal before data loaders execute, preventing unauthorized data requests.
5. **Declarative `<Can>` Component & Field-Level Rules:** Supports fine-grained field restrictions (`can("update", "Doc", ["title"])`) and `<Can I="update" this={doc} field="title">` with native fallback switching.

### 8. `HAA-08` (`D-129`) — Initialized Project Architecture & CLI Scaffolding (Gate 26)
Ratified by Human Architecture Authority on 2026-11-09:
1. **Standard Modular Hierarchy:** `mix create [name] [options]` and `mix init` scaffold a production-grade directory tree: `layouts/`, `pages/`, `components/` (common/ & domain/), `stores/`, `permissions/`, `styles/`, `routes.ts`, `main.mix`, `mix.config.ts`, `package.json`, `tsconfig.json`.
2. **Language & Preprocessor Options:** Supports TypeScript (`.tix`) by default and JavaScript (`.mix`), with universal stylesheet preprocessor selection (`.scss`, `.sass`, `.less`, `.pcss`, `.css`) without `<style>` tags.
3. **Out-of-the-Box Integrations:** Scaffolded applications include working, verifiable implementations of built-in RBAC/ABAC permissions (`defineAppAbility`, `<Can>`), offline-first CRDT state (`syncCollection`), and reactive typed forms (`createForm`, `validators`).
4. **CLI Flags & Parameters:** Supports `--ts` / `--js`, `--scss` / `--less` / `--css`, and `--target <dir>`.

### 9. `HAA-09` (`D-130` through `D-133`) — Production Hardening Decisions (Gates 27–28)
Ratified by Human Architecture Authority on 2026-11-09:
1. **`D-130` (Build-Time Preprocessor Stage, amends `D-108`):** Add a build-time CSS preprocessor stage before `compileCss`. `@import`/`@use` are allowed inside preprocessor files and resolved at build time; the `D-108` ban remains strictly enforced for raw `<style>` blocks and post-preprocessed CSS. Missing external preprocessors fail with `MIX_ERR_PREPROCESSOR_MISSING` and an install instruction. `@mix/runtime` remains at zero dependencies.
2. **`D-131` (Real `.d.ts` & Relative Module Resolution in `typecheckTix`, amends `D-106`):** `typecheckTix` resolves `@mix/*` against the real emitted `.d.ts` declarations of each package via `exports` and resolves relative user modules (`.tix`/`.mix`/`.ts`/`.js`) through a real `CompilerHost` with on-demand `projectTypeScript`. Hand-written ambient `@mix/runtime` declarations are removed; ambient declarations retain only asset-module shims.
3. **`D-132` (Element & Fragment Expressions in Attributes):** Template grammar accepts element and fragment expressions inside `{...}` attribute values (`fallback={<span/>}`, `icon={<Icon/>}`), parsed as a nested template subtree and compiled to a lazily-mounted render function.
4. **`D-133` (Canonical Control-Flow Syntax & Option (b) Diagnostic, clarifies `D-112`):** Canonical control-flow syntax is `{if}/{elseif}/{else}/{endif}` and `{each (x, i) in list}/{endeach}`. Legacy `{#if}`/`{#each}` continue parsing with a deprecation warning; JSX `{cond && <el/>}` is diagnosed with a compiler hint to use `{if} ... {endif}` (Option b).

### 10. `HAA-10` (`D-134` and `D-135`) — dotMix Rebranding & `mix-helpers` Standard Library (Gate 29.5)
Ratified by Human Architecture Authority on 2026-11-10:
1. **`D-134` (dotMix Framework Identity):** Rebrand the framework identity to **dotMix** (`dotmix-framework`), providing dual `dotmix` and `mix` CLI executables, updating docs URLs to `https://dotmix.dev/docs/errors#<CODE>`, and preserving `.mix` (JS) and `.tix` (TS) file extensions and `@mix/*` package namespaces.
2. **`D-135` (`mix-helpers` / `@mix/helpers` Standard Library):** Establish `packages/helpers` as a zero-external-dependency, tree-shakeable standard library providing `mix-helpers/data` (`dot` namespace for path access, collections, strings, functions), `mix-helpers/datetime` (`dateTime` and `duration` with token formatting, relative time, timezones), `mix-helpers/http` (resilient interceptor HTTP client with retries, deduplication, cache, and reactive `useHttp` signal hook), `mix-helpers/async` (`asyncFlow` with parallel, series, mapLimit, queue, mutex), and `mix-helpers/web` (query strings, crypto/IDs, typed event bus, formatters, and storage).

---

## Change-control protocol

For any conflict:
1. Quote the conflicting canonical clauses.
2. Identify affected decision IDs and packages.
3. Explain behavioral and compatibility consequences.
4. Propose the smallest viable resolution.
5. STOP for human approval.

Do not mark a decision "closed" merely because a document mentions it. Require implementation-level tests when the relevant phase is implemented.