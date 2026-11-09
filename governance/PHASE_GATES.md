# Phase Gates and Acceptance Policy

## Gate 0 — Initialization and audit

Scope:
- inspect repository and history;
- identify canonical specs and decisions;
- inventory existing code;
- report contradictions and gaps;
- propose repository layout and dependency graph;
- propose phased implementation and measurable acceptance tests.

Acceptance:
- every existing project artifact is classified;
- canonical documents have provenance and version/hash where possible;
- no specification has been silently rewritten;
- all conflicts are listed;
- package boundaries and dependency graph are acyclic;
- each phase has deliverables, tests, and stop conditions;
- agent confirms no implementation was started.

## Gate 1 — Foundation

Only after explicit approval:
- package manager/workspaces;
- pinned toolchain and lockfile;
- strict TypeScript base config;
- package skeletons and project references;
- lint/test/build scripts;
- CI verification;
- canonical spec import with provenance.

Acceptance:
- clean install succeeds from lockfile;
- all workspaces build;
- lint and tests run in CI;
- package dependency graph is acyclic;
- no placeholder specification is represented as complete.

## Gate 2 — Minimal language frontend

- lexer/parser;
- template and expression boundaries;
- AST and source spans;
- parser diagnostics;
- conformance tests from canonical grammar.

Acceptance:
- valid fixtures parse into expected AST;
- invalid fixtures produce stable diagnostics;
- nested expressions and template boundaries are tested;
- source spans are correct;
- no invented grammar is accepted.

## Gate 3 — Semantic analysis

- scopes and symbols;
- binding classification;
- component contracts;
- diagnostics;
- `.tix` projection/type-check adapter.

Acceptance:
- references resolve correctly;
- invalid references/props/refs are diagnosed;
- source locations map to original files;
- TypeScript checker is used rather than reimplemented.

## Gate 4 — Reactive runtime

- Signal, Computed, Effect;
- scheduler;
- Owner and cleanup;
- cancellation/resources.

Acceptance:
- diamond graph;
- deferred rerun;
- write-during-effect;
- cycle detection;
- nested owners;
- detached roots;
- disposal/unlinking;
- stale async result suppression;
all have deterministic tests.

## Gate 5 — Direct DOM vertical slice

Acceptance must prove the entire real path:

`.mix source → lexer/parser → AST → semantic binding → codegen → runtime → DOM mount → signal update → owner disposal`

Required assertions:
1. source compiles;
2. AST can be inspected;
3. signal binding is resolved;
4. generated JavaScript is readable;
5. DOM is created directly without Virtual DOM;
6. signal update changes the existing text node;
7. ordinary reactive update does not recreate static DOM;
8. disposal removes subscriptions;
9. later writes do not execute disposed effects;
10. diagnostics and source maps are valid.

This must be an unmocked integration test. A manually constructed AST or handwritten DOM demo does not satisfy it.

## Gate 6 — CSS and security

Acceptance:
- scoped selector fixtures;
- `:deep` and `:global` per canonical spec;
- escape and URL policy tests;
- at-rule rejection/handling;
- trusted HTML boundary tests;
- browser tests for security-sensitive behavior.

## Gate 7 — Keyed reconciliation

Acceptance:
- insert/remove/reorder;
- stable identity;
- duplicate key diagnostics;
- owner cleanup;
- atomic update behavior;
- algorithm benchmark if LIS is required.

## Gate 8 — Full `.tix` verification

Acceptance:
- strict props/ref/type tests;
- generics where specified;
- compiler diagnostics mapped to source;
- supported TypeScript compatibility matrix.

## Gate 9 — Hardening and Showcase

Acceptance:
- real-browser suite;
- security suite;
- performance baselines;
- documentation;
- Showcase compiles actual `.mix`/`.tix` sources through the real compiler.

## Gate 10 — Component Composition: Slots (`<slot>`), `children` Projection & Context API

Scope:
- Default and named `<slot />` and `<slot name="name">fallback</slot>`;
- Child `<slot>` routing from `<ComponentCall>`;
- React-style `{props.children}` projection;
- `createContext<T>(defaultValue)` & `useContext(context)` on `Owner` hierarchy;
- `.tix` verification for slot props.

Acceptance:
- unmocked integration tests for default and named slots;
- slot fallback rendering when no child provided;
- reactive updates cross slot boundaries without remounting;
- lazy slot evaluation inside child `Owner` with deterministic cleanup;
- prototype-chained context inheritance across components and detached roots.

## Gate 11 — Two-Way Form Bindings (`bind:*`) & Declarative Async Blocks (`{await}`)

Scope:
- `bind:value`, `bind:checked`, `bind:group` on form controls;
- `{await promise} ... {then result} ... {catch error} ... {endawait}`;
- CancellationToken integration (D-104) and stale result suppression;
- `.tix` type verification for `bind:*`.

Acceptance:
- bi-directional synchronization between signal and DOM input elements;
- numeric coercion for `type="number" | "range"`;
- promise state transitions (`pending -> fulfilled -> rejected`);
- cancellation of in-flight promises on owner disposal or rapid replacement.

## Gate 12 — Production Client Router (`@mix/router`)

Scope:
- Radix-Trie route matching with params and wildcards;
- History, Hash, and Memory navigation drivers;
- `useRoute`, `useParams`, `useNavigate`, `<Link>`, `<RouterView>`;
- Async navigation guards with cancellation;
- Safe URL verification (`R-URL-01`).

Acceptance:
- zero external dependencies in `@mix/router`;
- nested layouts update without remounting parent layout;
- navigation guard cancellation on rapid route changes;
- malicious URL schemes (`javascript:`, `vbscript:`) rejected.

## Gate 13 — Server-Side Rendering (`@mix/compiler-ssr`) & Progressive Hydration

Scope:
- Ahead-of-time SSR code generation (`renderToString`, `renderToStream`);
- Hydration comment markers and key annotations;
- Surgical client-side hydration (`hydrate()`) without recreating DOM nodes;
- SSR security sanitization and state serialization escaping.

Acceptance:
- SSR HTML matches client DOM structure;
- hydration attaches event listeners and reactive bindings preserving existing DOM references;
- XSS prevention in SSR attributes, text, and serialized state;
- mismatch diagnostic emitted on divergent DOM.

## Gate 14 — Build Tooling & Bundler Integration (`@mix/vite-plugin`, `@mix/cli`)

Scope:
- Vite / Rollup plugin with HMR support (D-111);
- Scoped CSS virtual module extraction;
- Command-line tool `mix check` (standalone `.tix` typecheck) and `mix build`.

Acceptance:
- Vite plugin builds and serves `.mix`/`.tix` components;
- HMR updates methods and template without losing live signal state;
- `mix check` correctly reports diagnostics and exits with appropriate status code.

## Gate 15 — Language Server Protocol (`@mix/language-server`) & IDE Extension

Scope:
- Language server implementing hover, completions, go-to-definition, and diagnostics;
- Integration with TypeScript 6.0.3 Compiler API and `SourceMapSpanTable`;
- VS Code extension package with syntax grammar.

Acceptance:
- automated LSP protocol tests for `.mix` and `.tix` files;
- accurate source mapping of diagnostics and completions.

## Gate 16 — Local-First Offline Sync Engine (`@mix/sync`) (D-119)

Scope:
- Reactive CRDT State Primitives: `syncSignal<T>` and `syncCollection<T>`;
- Durable Client Persistence: pluggable drivers (`MemoryDriver`, `IndexedDbDriver`, `OpfsDriver`);
- Vector Clocks, Lamport timestamps, and monotonic sequence mutation tracking;
- Deterministic Conflict-Free Replicated Data Types: LWW-Register and Replicable Array CRDT with fractional indexing;
- Optimistic mutation execution with transactional rollback on server rejection;
- Transport-agnostic synchronization protocol and client sync manager (`SyncEngine`).

Acceptance:
- Zero external dependencies in `@mix/sync` (depends only on `@mix/runtime`);
- Mutations applied synchronously to local signal/DOM (0ms perceived latency);
- Mutations persist to storage log and survive page reload;
- Concurrent modifications on divergent nodes converge to identical deterministic state (LWW & fractional index order);
- Rejected mutations roll back local signal state and surgical DOM without full-page re-mount;
- 100% type safety and unmocked integration tests covering offline, sync, conflict, and recovery.

## Gate 17 — Universal Polyglot Component ABI (`@mix/interop`) (D-120)

Scope:
- ECMAScript TC39 Signals Standard interoperability bridge (`SignalRef<T>`);
- Direct DOM surgical component projection without VDOM wrapping;
- React 19 / Next.js adapter (`useMixComponent`, `asReactComponent`);
- Vue 3.5 / Angular 18+ signal adapters;
- Light-DOM Custom Element generator with complex object property reflection and context inheritance.

Acceptance:
- Bi-directional reactivity binding between Mix signals and foreign framework state;
- Seamless prop/callback/context forwarding across framework boundaries;
- Zero VDOM overhead during Mix component execution inside React/Vue trees;
- Full typography and style inheritance in Light-DOM custom elements.

## Gate 18 — Resilient Resumable Streaming & Progressive Hydration (`@mix/ssr`, `@mix/stream`) (D-121)

Scope:
- Streaming HTML generator with signed island chunk manifests;
- Progressive surgical DOM hydration without VDOM replay;
- Autonomous packet loss & microservice dropout chunk recovery protocol;
- Sub-island error boundary containment.

Acceptance:
- Dropped chunk simulation recovers seamlessly via background chunk retry without aborting sibling islands;
- Client attaches event listeners and signal bindings in a single O(N) pass;
- Zero full-tree re-renders on streaming recovery.

## Gate 19 — Built-In DOM Visual & Lifecycle Primitives (`@mix/runtime/dom`) (D-122)

Scope:
- `Teleport` (`createPortal`): Mounts children into arbitrary target container with logical parent `Context` inheritance, active `disabled` dynamic toggle, and cleanup on unmount;
- `KeepAlive` (`createKeepAlive`): Caches offscreen `DocumentFragment` DOM subtrees and preserves live signals, input state, and event listeners across view switches with LRU cache eviction;
- `Transition` (`createTransition`): FLIP/CSS enter/leave lifecycle classes (`{name}-enter-from`, `{name}-enter-active`, `{name}-enter-to`, `{name}-leave-from`, `{name}-leave-active`, `{name}-leave-to`), duration delays, and hooks.

Acceptance:
- Automated integration test suite covering Teleport context inheritance and in-place toggle;
- KeepAlive LRU cache eviction and signal preservation across key changes;
- Transition CSS lifecycle class application and duration timing;
- Zero external runtime dependencies in `@mix/runtime`.

## Gate 20 — Data Router Loaders, Actions, Lazy Splitting & Prefetching (`@mix/router`) (D-123)

Scope:
- Async Route Loaders: Declarative data loading with `useLoaderData<T>()`;
- Stale Navigation Cancellation: `CancellationToken` aborts superseded loader runs during rapid navigation;
- Route Actions: Mutation execution with `useActionData<T>()`, `useSubmit()`, and automatic loader revalidation;
- Lazy Route Splitting: Dynamic route chunking (`lazy: () => import(...)`);
- Link Prefetching: `<Link prefetch="intent">` pre-warms route loaders on pointer hover/focus;
- Reactive Head Management: `useHead({ title, meta })` for dynamic document metadata.

Acceptance:
- Unmocked integration tests covering loaders, stale cancellation, action submissions, and automatic revalidation;
- Lazy route modules load and mount on-demand with 0ms microtask fast-path for non-async routes;
- Link prefetching preloads data before navigation occurs;
- Zero external dependencies in `@mix/router` (depends only on `@mix/runtime`).

## Gate 21 — Reactive Typed Forms & Validation Engine (`@mix/runtime/forms`) (D-124)

Scope:
- `createForm<T>(config)`: Per-field signals (`value`, `error`, `touched`, `dirty`, `validating`) and form-level signals (`values`, `errors`, `isValid`, `isDirty`, `isSubmitting`);
- Composable Sync Validators: `validators.required`, `validators.minLength`, `validators.maxLength`, `validators.pattern`, `validators.email`;
- Cancellable Async Validators: Integrated generation-tracked `CancellationToken` aborts superseded keystrokes automatically;
- Submission Lifecycle: `handleSubmit(onValid, onInvalid)` and `reset()`.

Acceptance:
- Two-way field binding synchronizes values and marks dirty/touched state;
- Sync and async validation pipelines report field and form-level errors;
- Fast keystrokes cleanly cancel stale async validation requests;
- Form reset restores initial state and clears all errors;
- Zero external dependencies in `@mix/runtime`.

## Gate 22 — CRDT Epoch Compaction & Live Network Transports (`@mix/sync`) (D-125)

Scope:
- CRDT Epoch Compaction: `compact(ackWatermarkClock)` in `ReplicableArray` purges deleted tombstones while preserving sequence integrity;
- Storage Log Pruning: `pruneMutations(predicate)` in `SyncDriver` and `SyncEngine.compact()`;
- `HttpBatchSyncTransport`: Auto-flushing batched HTTP POST mutation synchronization;
- `WebSocketSyncTransport`: Auto-reconnecting WebSocket transport with offline packet queueing.

Acceptance:
- Compaction purges tombstones without shifting visible fractional indices;
- Committed mutation log entries are pruned from persistent storage;
- HTTP batch transport coalesces rapid mutations into a single network payload;
- WebSocket transport queues mutations during disconnection and flushes on reconnect;
- Zero external dependencies in `@mix/sync`.

## Gate 23 — Scope-Aware Signal Auto-Invocation in SSR (`@mix/compiler-ssr`) (D-126)

Scope:
- Ahead-of-Time Expression AST Rewriting: Transforms bare signals (`count` -> `count()`) in interpolations, conditionals, iterations, and dynamic attributes;
- Scope Binding Detection: Integrates with `ComponentDescriptor.signals` and `computeds` from `@mix/compiler-semantic`;
- AST Walker: Safely avoids double invocation for explicit calls (`count()`), member properties (`obj.count`), and shadowed loop variables;
- SSR Runtime Defensive Unwrapping: `__escapeHtml` and `__escapeAttr` safely unwrap signal functions passed dynamically via props.

Acceptance:
- SSR and CSR HTML parity for bare signal expressions;
- Keyed `{#each}` and `{#if}` conditional branches evaluate signal values accurately;
- Zero double-invocations (`count()()` is never emitted);
- 100% test pass rate in integration suite.

## Gate 24 — Cross-File Component Intelligence & External CSS Completions (`@mix/language-server`) (D-127)

Scope:
- Multi-File Workspace Indexing: `setWorkspaceFiles`, `getFileContent`, and cross-file URI resolution;
- Cross-File Go-To-Definition (`doDefinition`): Jumps from `<Component />` calls and import clauses directly to target `.tix`/`.mix` source files;
- Nested Scope Completions: Contextual completions suggest loop variables (`item`, `idx`) inside `{#each}` blocks and resolved data (`profile`, `error`) inside `{#await}` branches;
- External CSS Class Completions: Extracts class selectors from linked `<style src="./styles.css" />`, embedded `<style>`, and script CSS imports.

Acceptance:
- Definition lookup navigates from component tag to target file URI;
- Completions provide accurate block-scoped variables only within their lexical AST boundaries;
- CSS class completions suggest all selectors from linked stylesheets with `Property` kind;
- Unmocked automated tests verify LSP methods across multi-file scenarios.

## Gate 25 — Native Fine-Grained Permissions Engine (`@mix/runtime/permissions` & `@mix/router`) (D-128)

Scope:
- Native RBAC + ABAC Permissions Engine: `Ability`, `AbilityBuilder`, `defineAbility`, `createAbility`, `subject`, `ForbiddenError`;
- Fine-Grained Reactive Signal Predicates: Tracks reactive signal properties on subjects with zero-latency DOM updates and zero VDOM re-renders;
- Declarative `<Can>` Component: Surgical conditional DOM gating with `I`, `a`/`an`/`this`, `field`, `not`, and `fallback` props;
- Granular Field-Level Permissions: Supports restricting specific object fields on actions (`can("update", "Doc", ["title"])`);
- Async Evaluation with Cancellation: Native `ability.canAsync()` integrated with generation-checked `CancellationToken` (D-104);
- Deep Router Integration: `RoutePermissionConfig` on `RouteObject` and `RouteRecord`, evaluating access during Radix-Trie traversal before data loaders execute.

Acceptance:
- Core RBAC/ABAC rules, wildcards (`manage`, `all`), and inverted rule overrides (`cannot`) evaluate correctly;
- Reactive signal subjects trigger automatic memoized recalculations without manual `ability.update()` calls;
- `<Can>` component gates DOM elements and swaps fallbacks reactively;
- Field-level permissions isolate allowed fields from forbidden fields;
- Async permission checks abort cleanly upon `CancellationToken` cancellation;
- Router redirects unauthorized navigations instantly before executing route loaders;
- Zero external runtime dependencies in `@mix/runtime` and `@mix/router`.

## Gate 26 — Project Scaffolding & Initialized Framework Architecture (`@mix/cli`) (D-129)

Scope:
- Full React-Inspired Project Scaffolding: `mix create [name] [options]` and `mix init` generating standard enterprise directory tree: `layouts/`, `pages/`, `components/` (common/ & domain/), `stores/`, `permissions/`, `styles/`, `routes.ts`, `main.mix`, `mix.config.ts`, `package.json`, `tsconfig.json`;
- Language & Preprocessor Flexibility: Supports TypeScript (`.tix`) by default or JavaScript (`.mix`), with universal stylesheet preprocessor selection (`.scss`, `.sass`, `.less`, `.pcss`, `.css`);
- Out-of-the-Box Native Capabilities: Generated project comes with working demonstrations of built-in RBAC/ABAC permissions (`defineAppAbility`, `<Can>`), offline CRDT state (`syncCollection`), and reactive typed forms (`createForm`, `validators`);
- CLI Flags & Options: Command-line arguments `--ts`/`--js`, `--scss`/`--less`/`--css`, `--target <dir>`.

Acceptance:
- CLI creates complete 20+ file project tree without missing directories or stubs;
- Scaffolded components parse and semantically analyze with 0 errors and 0 warnings;
- Preprocessor formats and file extensions accurately match requested options;
- Unmocked integration tests verify project scaffolding across TypeScript and JavaScript variants.

## Gate 27 — Golden Path (P0 Production Hardening)

Scope:
- `T-27.1`: Golden-path E2E harness (`tests/golden/golden-path.test.mjs`, `npm run test:golden`) exercising all 10 scaffold variants (`{TS, JS} × {scss, sass, less, pcss, css}`) via the real CLI binary (`mix create`, `mix check src`, `mix build src dist`, specifier audit, `happy-dom` execution smoke test, and `css-tree` strict CSS validity check);
- `T-27.2`: Scaffold template corrections (`RouterProvider`, removal of unimplemented `--watch` in `dev`, strict TypeScript typing in generated `.tix` files, externalized template directory `packages/cli/templates/{ts,js}/`);
- `T-27.3` (requires D-130): Build-time CSS preprocessor stage (`preprocess` before `compileCss`) for `.scss`, `.sass`, `.less`, and `.pcss`/`.postcss` with `MIX_ERR_PREPROCESSOR_MISSING` diagnostics;
- `T-27.4` (requires D-131): `typecheckTix` module resolution against real package `.d.ts` files and on-demand relative `.tix`/`.mix`/`.ts` resolution.

Acceptance:
- `npm run test:golden` is 100% green across all 10 variants with zero `todo` markers remaining;
- All emitted `.js` specifiers are valid and free of `file:///` paths;
- All emitted `.css` files parse cleanly under `css-tree` with no residual preprocessor tokens;
- Built output mounts and navigates cleanly across `/`, `/tasks`, and `/forms` in `happy-dom`.

## Gate 28 — Correctness and Security Hardening (P1)

Scope:
- `T-28.1`: Reactive `<Can>` DOM conditional mounting and disposal via `createConditional`;
- `T-28.2`: Router permission guard enforcement on initial load, `popstate`, and reactive ability changes;
- `T-28.3`: Permissions engine hardening (`isSignal` brand check, sync `can()` error on async rules, `constructor.name` warning/strict mode, memoized `useAbility()`);
- `T-28.4` (requires D-132, D-133): Element and fragment expressions inside `{...}` attribute values across parser, semantic, codegen, SSR, and LSP;
- `T-28.5`: Production sanitizer adapter package (`@mix/sanitizer-dompurify`) and XSS vector verification;
- `T-28.6`: Strengthened DOM/typecheck assertions in integration tests.

Acceptance:
- All audit contradictions C2, C3, C5, C7, C8, and C9 closed with reproducing tests;
- `npm test` and `npm run test:golden` 100% green.

## Gate 29 — Production Toolchain (P2)

Scope:
- `T-29.1`: `mix dev` server built on `@mix/vite-plugin` with HMR, module resolution, and SPA fallback;
- `T-29.2`: `mix build` bundler integration with route code-splitting, minification, hashed assets, and bundle-size report;
- `T-29.3`: Formatted CLI diagnostics with source code frames, `file:line:col`, and error codes;
- `T-29.4`: Node SSR server adapter (`@mix/server-node`) with streaming HTML, error boundaries, and CSP nonce support.

Acceptance:
- Automated HMR and dev server tests pass;
- Production bundle passes specifier and size audits;
- Streaming SSR hydrates cleanly with CSP nonce enforcement.

## Gate 30 — Prove and Publish (P3)

Scope:
- `T-30.1`: Real-browser Playwright verification matrix (Chromium, Firefox, WebKit) across Showcase and Golden-Path scaffold;
- `T-30.2`: Automated benchmark suite and CI bundle-size budget enforcement;
- `T-30.3`: Documentation site, semver/release policy, changelog, and clean registry package verification.

Acceptance:
- Playwright test matrix green across Chromium, Firefox, and WebKit;
- Benchmarks and size budgets verified and recorded transparently.



