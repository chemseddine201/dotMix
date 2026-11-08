# AGENTS.md — Master Agent Governance & Core Specifications (v3.2.1-Locked)

This document serves as the absolute, immutable source of truth and operating contract for all AI coding agents working within the Mix / Tix monorepo. Every agent must strictly adhere to the architecture, boundaries, algorithms, and governance rules defined herein.

## Part I: Core Architectural Directives & Invariants

* **Compiler-Native UI Language:** Mix / Tix is not merely a library; it is a unified language (`.mix` for JS, `.tix` for TypeScript) combining structure, scoped CSS, and reactive logic. It compiles via Ahead-of-Time (AOT) compilation directly into surgical vanilla DOM operations with zero Virtual DOM overhead.
* **Zero Runtime Dependencies (`@mix/runtime`):** The runtime must remain completely free of external dependencies. It must bundle to under 3.5 KB (Minified + Brotli).
* **Strict File Ownership:** No agent is permitted to modify files outside its assigned package boundary without explicit, authorized instructions.
* **No Regex for Semantics:** Semantic analysis, variable rewriting, and CSS scoping must never use regular expressions. They must operate strictly via ASTs and Symbol Tables.
* **No DOM Types in Core:** `@mix/runtime/reactivity` and `@mix/runtime/core` must have zero references to browser DOM types (e.g., `Node`, `HTMLElement`). All rendering must pass through the abstract `RendererAdapter`.

## Part II: Monorepo Topology & File Ownership

```
mix-lang/
├── AGENTS.md                        # This governance file
├── CONTRACTS.md                     # Locked API contracts between packages
├── spec/                            # Locked language & runtime specifications
├── packages/
│   ├── ast/                         # AST definitions & SourceSpan structures [Owner: Compiler Agent]
│   ├── compiler-frontend/           # Lexer, recursive descent parser, ESTree adapter [Owner: Compiler Agent]
│   ├── compiler-semantic/           # Symbol Table, Scope Resolution, .tix TypeChecker [Owner: Semantic Agent]
│   ├── compiler-css/                # CSS AST parser, selector scoper, keyframe rewriter [Owner: CSS Agent]
│   ├── compiler-codegen/            # Direct DOM JS emitter, CSS bundle emitter [Owner: Codegen Agent]
│   ├── runtime/                     # Browser-agnostic reactive kernel & surgical DOM adapter [Owner: Runtime Agent]
│   └── cli/                         # Bundler, dev server, HMR engine [Owner: Toolchain Agent]
└── tests/                           # Conformance, runtime, security, and browser suites
```

## Part III: Locked Runtime Contracts (`@mix/runtime`)

### 1. The Push-Pull Reactive Scheduler (`packages/runtime/reactivity.ts`)
* **States:** `CLEAN (0)`, `CHECK (1)`, `DIRTY (2)`, `RUNNING (3)`, `DISPOSED (4)`.
* **Push Phase (`notifySignalChange`):** When a signal mutates, immediate subscribers become `DIRTY` (if effects) or trigger `markNodeCheck` down the tree.
* **Pull Phase (`validateComputed`):** Computed properties use lazy validation. They check their sources recursively. If an intermediate source has not changed, the computation returns to `CLEAN` without re-running, completely solving the Diamond Graph problem.
* **Effect Execution (`runEffect`):** Runs effects, clears previous cycle cleanups, manages nested ownership disposal, and guarantees state recovery in a finally block even if an exception is thrown.

### 2. Separation of Owner and Computation
* **Owner:** Manages lifecycle, tree hierarchy (`children`), context injection (`context`), and destruction cleanups (`scopeCleanups`). State uses `OwnerState` (`ACTIVE = 0`, `DISPOSED = 1`).
* **ComputationNode:** Lightweight reactive nodes (`ComputedNode`) that do not carry the overhead of a full lifecycle owner unless they are `EffectNode`.

### 3. Keyed Reconciliation (`renderKeyedList`)
* Uses a 6-step deterministic algorithm featuring Longest Increasing Subsequence (LIS) in $O(N \log N)$ time to minimize DOM mutations.
* Preserves component identity and reactive signals when items are reordered or updated, destroying items synchronously (`disposeOwner`) when removed.

## Part IV: Locked Compiler & Syntax Specifications (`packages/compiler-*`)

### 1. Grammar & Expression Parsing
* Grammars are strictly defined by LL(1)/LL(2) rules with balanced brace scanners for expressions.
* **Expression Classification:**
  * `isCompileTimeConstant`: True only for pure literals and expressions built entirely from them.
  * `requiresReactiveEvaluation`: True if the expression reads state/props/computed or calls non-pure functions. Unreactive expressions that are not constant evaluate once on mount.

### 2. TypeScript Projection (`.tix`)
* `.tix` files generate in-memory virtual TypeScript files (`.ts` projection) with an accurate `SourceMapSpanTable` mapping virtual offsets back to exact line/column positions in the source `.tix` file.
* Strict prop contracts are enforced via `VerifyProps` and `VerifyRef`.

### 3. CSS Scoping (`@mix/compiler-css`)
* Operates on a real CSS AST (e.g., `css-tree`).
* Generates deterministic hashes (`mx_<hash>`) based on normalized relative paths and component names.
* Supports `:global(...)` and `:deep(...)` following the strict golden transformation matrix (disallowing chained or nested `:deep()` combinators).

## Part V: Security Boundaries & Invariants (`spec/SECURITY.md`)

* **URL Attribute Allowlist:** Attributes like `href`, `src`, `action`, `poster`, `cite`, and `srcset` are strictly validated using a WHATWG-compliant URL parser. Schemes must belong to an explicit allowlist (`http:`, `https:`, `mailto:`, etc.). `javascript:`, `vbscript:`, and `data:image/svg+xml` are strictly blocked.
* **Dynamic CSS Styles (`setStyle`):** Dynamic style maps (`style={{ ... }}`) block `url()`, `image-set()`, `expression()`, and `@import` to prevent CSS injection.
* **Raw HTML Injection (`{@html}`):** Raw HTML is strictly prohibited from accepting raw strings. It requires explicit sanitization via `createTrustedHtml(dirtyHtml, sanitizerFn)` using an active sanitizer (e.g., DOMPurify).

## Part VI: Sequential & Gated Agent Execution Pipeline

* **Phase 0 — Architecture & Contracts:** Lock down `spec/*`, `packages/ast/index.ts`, and `packages/runtime/types.ts`. (Gate 0)
* **Phase 1A & 1B — Runtime & Frontend Compiler:** Build `@mix/runtime` and `@mix/compiler-frontend`. (Gate 1A/1B)
* **Phase 1C — Semantics & CSS Engine:** Build Symbol Table, Semantic Analyzer, and CSS Scoper. (Gate 1C)
* **Phase 1D — Codegen:** Build Direct DOM JavaScript Emitter. (Gate 1D)
* **Phase 2 & 3 — Integration, Security & Toolchain:** Build E2E test suites, OWASP security validations, and `@mix/cli` (`mix dev`, `mix build`, HMR engine). (Gate 2/3)
