# Canonical Specification: Developer Experience CLI (`@dotmix/cli`)

**Status:** Ratified Canonical Specification  
**Authority:** Human Architecture Authority  
**Phase:** Gate 37  
**Ratified Governance Decisions:** `D-159` through `D-168` (`HAA-14`), `D-169` (`HAA-15`)  
**Package:** `packages/cli` (`@dotmix/cli`)  
**Executable Binaries:** `mix`, `dotmix`  

---

## 1. Architectural Invariants

1. **Zero External Runtime Dependencies (`D-159`):**  
   `@dotmix/cli` must not depend on any third-party npm package (`commander`, `yargs`, `chalk`, `ora`, `inquirer`). Argument parsing executes exclusively via Node's built-in `node:util.parseArgs`. Terminal color formatting uses standard ANSI escape sequences gated on `process.stdout.isTTY`.

2. **Zero External DOM Emulation Libraries (`D-164`):**  
   The CLI and its test runner strictly prohibit synthetic DOM emulation libraries (`happy-dom`, `jsdom`). Logic tests execute directly on native `node:test` + `node:assert/strict`. Component tests execute via server-side rendering (`@dotmix/compiler-ssr`). Real-browser interactive DOM tests execute via pure TypeScript Chrome DevTools Protocol (CDP) client in `packages/cli/src/browser/` using Node 22 native `fetch` and `WebSocket` (`D-169`).

3. **Zero Real-Network Test Contract (`D-168`):**  
   In all automated test suites, `mix upgrade` must connect strictly to a local `node:http` registry fixture serving simulated package manifests; tests must never initiate requests across the public internet.

4. **Regex-Free Route Manipulation (`D-166`):**  
   `mix add page` and code generator commands must register routes in `src/routes.ts` using AST manipulation or deterministic insertion rules; regular expressions are strictly forbidden for semantic updates.

5. **Guardrail J Enforcement:**  
   Every source file in `@dotmix/cli` must remain at or below 500 lines of code, with zero `any` types and exact package version pins.

---

## 2. Command Dispatch & Global Options

### 2.1 Invocation Syntax
```bnf
<invocation> ::= ("mix" | "dotmix") [<command>] [<arguments>] [<global-options>]
<command>    ::= "create" | "init" | "dev" | "build" | "preview" | "test"
               | "check" | "lint" | "add" | "generate" | "info" | "doctor"
               | "upgrade" | "help" | "version"
```

### 2.2 Global Options Matrix
All commands accept the following global flags:
```text
-h, --help       Display command banner and usage instructions
-v, --version    Display version string ("Mix Framework vX.Y.Z")
--debug          Print stack traces and diagnostic details on error
--json           Emit output strictly as machine-readable JSON
--silent         Suppress non-essential terminal log emissions
```

### 2.3 Normative Exit Code Contract
```text
0 = SUCCESS: Operation completed successfully without errors.
1 = FAILURE: Validation failure, compilation diagnostic, test failure, or missing file.
2 = USAGE / SKIPPED: Unknown command, invalid option argument, or skipped test tier (e.g. absent browser).
```

---

## 3. Normative Command Specifications

### 3.1 `mix create` / `mix init` (`D-160`)
- **Interactive Mode:** When invoked in an interactive terminal (`process.stdin.isTTY`) without a positional project name, launches a readline wizard via `node:readline/promises`.
- **Template Catalog:** Restricted strictly to:
  - `minimal`: Single-page counter starter.
  - `standard`: Full modular application architecture (default).
  - `showcase`: Comprehensive showcase demonstrating forms, permissions, and async blocks.
- **Language & Preprocessors:** Supports `--ts` (default) / `--js` and `--scss` (default) / `--less` / `--css` / `--sass` / `--pcss`.
- **Toolchain Automation:**
  - `--git`: Initializes git repository with `.gitignore` and initial commit. Automated tests must execute `--git` assertions exclusively within OS temporary directories (`os.tmpdir()`), never touching the active working tree.
  - `--install`: Triggers detected package manager (`npm`, `pnpm`, `yarn`, `bun`).

### 3.2 `mix dev` (`D-161`)
- **Hot Module Replacement:** Streams transactional updates over Server-Sent Events (SSE).
- **Port Conflict Resolution:** Probes port via `node:net`; if occupied, automatically increments port (`port + 1`) and notifies terminal.
- **Network Interface Display:** Detects active network interfaces via `node:os.networkInterfaces` and logs Local and Network URLs.
- **Config Loader:** Loads optional dev server configuration from `mix.config.ts`, `mix.config.js`, or `dotmix.config.*`.

### 3.3 `mix build` (`D-162`)
- **Compilation Targets:**
  - `client` (default): Client SPA bundle with entry point and route code-splitting.
  - `ssr`: Node.js streaming server entry point emitting `@dotmix/server-node` handler.
  - `static`: Pre-rendered static HTML generator for prerenderable routes.
- **Asset Manifest:** Emits `dist/mix-manifest.json` mapping input components to hashed output chunks, CSS linkages, and preload maps.
- **Flags:** `--sourcemap`, `--clean`, `--analyze`.

### 3.4 `mix preview` (`D-163`)
- **Static File Serving:** Built exclusively on Node's native `node:http`.
- **SPA Fallback Routing:** Non-file requests (lacking extension) automatically rewrite to `dist/index.html` with HTTP status `200`.
- **Compression Negotiation:** Serves `gzip` and `br` (brotli) streams via `node:zlib` based on client `Accept-Encoding`.
- **Flags:** `-p, --port` (default `4173`), `--host`, `--dir` (default `dist`), `--open`.

### 3.5 `mix test` (`D-164`, `D-169`)
- **Logic & Unit Tests:** Runs through Node's native `node:test` + `node:assert/strict`.
- **Component Tests:** SSR rendering via `@dotmix/compiler-ssr` (`renderToString`).
- **Interactive DOM Tests:** Driven via pure TypeScript CDP client in `packages/cli/src/browser/cdp.ts`.
- **Skip Contract:** Probes `MIX_BROWSER_PATH` and standard platform executable paths. If `--browser` is passed and no compatible browser is found, emits a diagnostic message and exits with code `2`.
- **Flags:** `--watch`, `--coverage`, `--browser`.

### 3.6 `mix check` & `mix lint` (`D-165`)
- **`mix check`:** Static typechecking and semantic analysis of `.tix` and `.mix` files. Supports `--watch` and `--format <stylish | json | github>`.
- **`mix lint`:** Audits unused component imports, unreferenced CSS selectors, slot consistency, and deprecated control-flow syntax (`{#if}`, `{#each}`).
- **Automated Fixes (`--fix`):** Rewrites `{#if expr}` $\to$ `{if expr}`, `{:else}` $\to$ `{else}`, `{/if}` $\to$ `{endif}`, `{#each (x, i) in list}` $\to$ `{each (x, i) in list}`, `{/each}` $\to$ `{endeach}` without changing semantics.

### 3.7 `mix add` / `mix generate` (`D-166`)
- **Generator Primitives:** `component`, `page`, `layout`, `store`, `permission`.
- **Route Registration:** Inserts page route definitions into `src/routes.ts` deterministically without regular expressions.

### 3.8 `mix info` & `mix doctor` (`D-167`)
- **`mix info`:** Dumps structured environment data (OS, Node version, package manager, `@dotmix/*` versions, preprocessors, browser paths).
- **`mix doctor`:** Runs 10 automated health checks:
  1. Package version parity across all `@dotmix/*` packages.
  2. `tsconfig.json` compiler options (`verbatimModuleSyntax`, `moduleResolution: "bundler"`).
  3. Preprocessor peer dependencies for configured stylesheet formats.
  4. Circular import audit across components and routes.
  5. Control-flow syntax health (flags legacy `{#if}` or prohibited JSX `{cond && ...}`).
  6. Lockfile consistency and stale `.tsbuildinfo` detection.
  7. Orphaned style or component file detection.
  8. Source file line count compliance ($\le 500$ lines).
  9. Binary path and executable permission verification.
  10. Node.js engine compatibility verification (`>=22.12.0`).

### 3.9 `mix upgrade` (`D-168`)
- **Registry Inspection:** Queries npm registry or local fixture for `@dotmix/*` packages using `node:http` or `node:https`.
- **Semver Analysis:** Compares current versions with latest published versions; identifies `major`, `minor`, `patch`, `prerelease`, or `equal`.
- **Preview & Update:** Supports `--dry-run` to preview changes without modifying `package.json`. When run without `--dry-run`, updates `dependencies` and `devDependencies` atomically.
- **Codemod Automation:** When `--codemod` is supplied, scans project files and applies AST migrations for deprecated syntax.
- **Testing Contract:** All test cases must query a local `node:http` registry fixture; real internet access is strictly prohibited.

