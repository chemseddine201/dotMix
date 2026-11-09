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
