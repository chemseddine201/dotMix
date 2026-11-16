# dotMix CLI Reference & Command Guide (`mix` / `dotmix`)

**Package:** `@dotmix/cli`  
**Binaries:** `mix`, `dotmix`  
**Architecture:** Built on Node.js 22+ built-in modules (`node:util.parseArgs`, `node:http`, `node:zlib`, `node:test`, `node:readline/promises`). Its only third-party code comes through the compiler packages: `typescript`, `acorn` (with `@sveltejs/acorn-typescript`) and `css-tree`.

---

## 1. Overview & Architecture

The dotMix CLI provides a unified, production-grade developer workflow comparable to modern web framework toolchains. It runs on Node.js 22+ and is written in TypeScript.

```
                          ┌────────────────────────┐
                          │     mix / dotmix       │
                          │   Command Dispatcher   │
                          └───────────┬────────────┘
                                      │
     ┌───────────────┬────────────────┼───────────────┬────────────────┐
     ▼               ▼                ▼               ▼                ▼
Scaffolding     Development      Compilation       Testing        Diagnostics
 mix create       mix dev         mix build        mix test        mix info
 mix init        mix preview     mix check        mix lint        mix doctor
                                 mix add/generate                 mix upgrade
```

### Global Options

All commands accept the standard global options:

| Flag | Alias | Description |
| :--- | :--- | :--- |
| `--help` | `-h` | Display help banner, available commands, and option flags. |
| `--version` | `-v` | Display the installed dotMix CLI and framework version. |
| `--debug` | | Print full stack traces and internal debugging diagnostics on error. |
| `--json` | | Emit machine-readable JSON output for CI/CD automation. |
| `--silent` | | Suppress non-essential terminal outputs and spinners. |

### Exit Code Contract

| Code | Meaning |
| :---: | :--- |
| `0` | **Success**: Command completed successfully with zero errors. |
| `1` | **Execution Error**: Compilation failed, typecheck error, test assertion failure, or file not found. |
| `2` | **Usage / Skipped**: Unknown command, invalid CLI argument, or skipped test condition (e.g. absent browser). |

---

## 2. Command Reference

### 2.1 `mix create` / `mix init` — Project Scaffolding

Scaffolds a new dotMix application with interactive terminal prompts or headless CLI flags.

```bash
# Interactive wizard in TTY
mix create

# Headless creation with flags
mix create my-app --template standard --ts --scss --git --install
```

#### Options:
- `[name]`: Name of the directory and project to scaffold (default: `my-mix-app`).
- `--template <minimal | standard | showcase | sync-crdt>`: Scaffold template variant.
  - `minimal`: Single-page starter with counter component and basic style.
  - `standard` (default): Full application architecture with layouts, pages, routing, and design system components.
  - `showcase`: Comprehensive showcase demonstrating forms, permissions, async blocks, and analytics.
  - `sync-crdt`: Offline-first task app on `@dotmix/sync` (`syncCollection`). It runs on the default sync engine.
- `--ts` / `--js`: Use TypeScript (`.tix`) or JavaScript (`.mix`). Default: `--ts`.
- `--scss` / `--less` / `--css` / `--sass` / `--pcss`: Universal stylesheet preprocessor selection. Default: `--scss`.
- `--git` / `--no-git`: Initialize a Git repository with standard `.gitignore` and initial commit.
- `--install` / `--no-install`: Automatically run package manager installation after scaffolding.
- `--package-manager <npm | pnpm | yarn | bun>`: Explicit package manager (detected automatically if omitted).
- `-d, --target <path>`: Target parent directory where the project directory will be created.

---

### 2.2 `mix dev` — Local Development Server

Starts the local development server with instant Server-Sent Events (SSE) Hot Module Replacement (HMR).

```bash
mix dev [dir] --port 3000 --host 0.0.0.0 --open
```

#### Features:
- **Instant HMR**: Granular DOM updates, transactional state retention, and scoped stylesheet replacement without full page reloads.
- **Port Conflict Resolution**: Probes requested port; if already occupied, automatically auto-increments to the next available port and alerts the developer.
- **LAN Network IP Detection**: Displays both `Local: http://localhost:3000/` and `Network: http://192.168.x.x:3000/` addresses on startup.
- **Configuration file**: `mix create` writes `mix.config.ts`, and `mix dev` reports when it finds `mix.config.ts` or `dotmix.config.ts`. Version 0.1.0 does not read its settings yet; use CLI flags and `.env` files.

#### Options:
- `[dir]`: Project root directory (default: current working directory).
- `-p, --port <number>`: Port number to bind (default: `3000`).
- `--host [address]`: Host IP to bind to (e.g. `0.0.0.0` or `localhost`).
- `--open`: Automatically opens the project in the default web browser.
- `--cors`: Enable cross-origin resource sharing headers.
- `--mode <mode>`: Environment mode name used for `.env.<mode>` loading and `import.meta.env.MODE` (default: `development`).

#### Environment Variables (`.env` and `import.meta.env`):
- At server startup, `mix dev` reads `.env`, `.env.local`, `.env.<mode>`, and `.env.<mode>.local` in the project root (later files override earlier ones; `process.env` overrides all files).
- Only keys prefixed with `MIX_PUBLIC_` are exposed to client code; non-prefixed keys are never included in served modules.
- `import.meta.env.MODE`, `.DEV`, `.PROD`, `.MIX_PUBLIC_*`, and bare `import.meta.env` are replaced when serving modules.
- **Restart `mix dev` after editing `.env`** so updated environment values take effect.

---

### 2.3 `mix build` — Production AOT Bundler

Compiles declarative templates ahead-of-time directly into surgical JavaScript instructions and bundles production assets.

```bash
mix build [src] [dist] --target client --clean --analyze
```

#### Options:
- `[src]`: Source directory containing entry points (default: `src`).
- `[dist]`: Destination output directory (default: `dist`).
- `-d, --target <client | ssr>`: Compilation target mode.
  - `client` (default): Client-side single-page application bundle.
  - `ssr`: Node.js server entry point emitting `@dotmix/server-node` streaming handler.
  - For static HTML pages, build with `client` and add `--prerender` (below). `static` is accepted and builds the same output as `client`.
- `--mode <mode>`: Environment mode name used for `.env.<mode>` loading and `import.meta.env` (default: `production`). `.env`, `.env.local`, `.env.<mode>`, and `.env.<mode>.local` are loaded from the project root (`process.env` wins); only `MIX_PUBLIC_*` keys are exposed and replaced before chunk hashing.
- `--prerender <routes>`: Comma-separated list of static route paths (for example `--prerender /,/about`; no route parameters or `*`) to pre-render in headless Chrome via CDP after building. Saves `dist/index.html` for `/` and `dist/<path>/index.html` for nested paths with `data-mix-prerendered` on the mount element (which `mount()` clears before mounting the client DOM). The saved `<html>` and `<body>` keep the attributes of your `index.html`: classes or attributes the app adds to them at runtime (theme, cursor, animation state) are not saved, because they would apply before any script runs; `<head>` changes such as `useHead` titles are kept. Requires an installed Chromium browser (`MIX_BROWSER_PATH`); omitted by default so normal builds need no browser.
- `--sourcemap`: Accepted, but version 0.1.0 does not emit source maps yet.
- `--clean`: Wipes the destination `dist/` directory before compiling.
- `--analyze`: Outputs visual chunk table with file sizes, gzip sizes, and asset relationships.
- Emits `dist/mix-manifest.json` (target, entry module, and every hashed module and asset with its size) and `dist/bundle-report.json`.

---

### 2.4 `mix preview` — Production Preview Server

Runs a zero-dependency static HTTP server to preview compiled production bundles locally.

```bash
mix preview [dist] --port 4173 --host 127.0.0.1
```

#### Features:
- **SPA Routing Fallback**: Non-file URL paths automatically route to `index.html` with HTTP 200, enabling deep URL link refreshes.
- **MIME & Compression Negotiation**: Automatically compresses responses using `gzip` and `brotli` (`br`) via `node:zlib` based on client `Accept-Encoding`.
- **Zero Third-Party Code**: Implemented strictly with Node's native `node:http`.

#### Options:
- `[dist]`: Path to directory to serve (default: `dist`).
- `-p, --port <number>`: Port number to bind (default: `4173`).
- `--host <address>`: Host interface (default: `127.0.0.1`).
- `--open`: Open in default browser upon startup.

---

### 2.5 `mix test` — Zero-Dependency Test Runner

Executes unit, logic, component SSR, and real-browser interactive tests using Node 22 native test primitives. Completely eliminates synthetic DOM emulation libraries (`happy-dom`, `jsdom`).

```bash
mix test [pattern] --browser --coverage
```

#### Execution Tiers:
1. **Logic & Unit Tests**: Driven natively by `node:test` and `node:assert/strict`.
2. **Component Tests**: Rendered via `@dotmix/compiler-ssr` (`renderToString`) to assert on true HTML markup and attributes without virtual DOM shims.
3. **Interactive DOM Tests**: Controls installed Chrome, Edge, or Chromium via a pure TypeScript Chrome DevTools Protocol (CDP) client (`packages/cli/src/browser/cdp.ts`) using Node 22 native `fetch` and `WebSocket`.

#### Skip Contract:
If `--browser` is passed but no compatible Chromium browser executable is installed on the machine, the test runner outputs a clear diagnostic skip notice and exits cleanly with **code 2** without failing unrelated logic tests.

#### Options:
- `[pattern]`: Test file path or glob pattern (e.g. `tests/**/*.test.mjs`).
- `--browser`: Enables interactive CDP real-browser execution.
- `-w, --watch`: Re-executes matching tests automatically on file changes.
- `--coverage`: Generates native V8 code coverage report.

---

### 2.6 `mix check` & `mix lint` — Static Analysis & Linter

Performs static semantic checking, dead import pruning, slot validation, and syntax audits.

```bash
# Typecheck and semantic validation
mix check [dir] --format json

# Syntax and code quality linting
mix lint [dir] --fix
```

#### Capabilities:
- `mix check`: Validates `.tix` component props, generics, and template syntax against TypeScript compiler declarations.
  - `-w, --watch`: Continuous checking in background.
  - `--format <stylish | json | github>`: Formats diagnostics for terminal, CI JSON, or GitHub Actions workflow annotations.
- `mix lint`: Audits unused component imports, unreferenced CSS selectors, slot consistency, and deprecated control-flow syntax (`{#if}`, `{#each}`).
  - `--fix`: Automatically rewrites legacy control flow to canonical `{if}` / `{each}` syntax without altering template semantics.

---

### 2.7 `mix add` / `mix generate` — Architectural Code Generator

Atomically scaffolds new architecture primitives and safely registers routes without regular expressions.

```bash
mix add component Button
mix add page Dashboard --route /dashboard
mix add layout Admin
mix add store Cart
mix add permission Billing
```

#### Subcommands:
- `component <Name>`: Creates `src/components/<Name>.tix`, a sibling stylesheet imported by the component (`<Name>.css`, or the format chosen with `--scss`, `--sass`, `--less` or `--pcss`) and `tests/components/<Name>.test.mjs`.
- `page <Name> [--route <path>]`: Creates `src/pages/<Name>Page.tix` and deterministically registers route in `src/routes.ts`.
- `layout <Name>`: Creates persistent layout component in `src/layouts/<Name>Layout.tix` with `<slot />`.
- `store <Name>`: Scaffolds reactive signal store in `src/stores/<Name>Store.ts`.
- `permission <Name>`: Generates RBAC/ABAC ability rules in `src/permissions/<Name>.ts`.
- `sync <Name>`: Generates an offline-first synced collection in `src/sync/<Name>Collection.ts`. It never overwrites an existing file, and it reminds you to add `@dotmix/sync` to `dependencies` if it is missing.

---

### 2.8 `mix info` & `mix doctor` — Diagnostics & Health Audits

Extracts environment information and audits local project health across 10 automated checkpoints.

```bash
# System & environment details
mix info --json

# Automated health audit
mix doctor
```

#### 10 Automated Health Checks in `mix doctor`:
1. **Package Version Parity**: Verifies all installed `@dotmix/*` dependencies match exact identical versions.
2. **`tsconfig.json` Alignment**: Validates `verbatimModuleSyntax: true` and `moduleResolution: "bundler"`.
3. **CSS Preprocessor Peer Dependencies**: Verifies `sass`, `less`, or `postcss` are installed if preprocessor stylesheets are used.
4. **Circular Import Audit**: Detects circular dependency cycles across components and routes.
5. **Control-Flow Syntax Health**: Flags deprecated `{#if}` or prohibited JSX-style `{cond && <El/>}` expressions.
6. **Lockfile & Build Consistency**: Detects stale `.tsbuildinfo` or mismatched lockfiles.
7. **Orphaned File Detection**: Flags unreferenced style sheets or unused components.
8. **File Size Compliance**: Enforces architectural guardrail $\le 500$ lines per source file.
9. **Binary Executable Permissions**: Verifies CLI binaries have correct execute flags.
10. **Node.js Engine Compatibility**: Enforces Node.js engine requirement (`>=22.12.0`).

---

### 2.9 `mix upgrade` — Dependency Lifecycle & Codemod Engine

Inspects the npm registry for newer `@dotmix/*` package releases, computes semver diffs, previews upgrade plans, and applies automated AST syntax migrations.

```bash
# Non-destructive preview
mix upgrade --dry-run

# Execute upgrade and update package.json
mix upgrade

# Upgrade and apply automated template syntax codemods
mix upgrade --codemod

# Machine-readable JSON
mix upgrade --json
```

#### Zero Real-Network Testing Contract:
In test suites, `mix upgrade` connects exclusively to a local `node:http` registry fixture serving simulated package manifests; tests never touch the public internet.

#### Options:
- `[dir]`: Project directory to inspect and upgrade (default: current directory).
- `--dry-run`: Previews version upgrades without modifying `package.json`.
- `--codemod`: Automatically runs AST migrations across project `.mix` and `.tix` files to fix deprecated syntax for breaking upgrades.
- `--registry <url>`: Custom npm registry URL (or set via `MIX_REGISTRY_URL` / `npm_config_registry`).
- `--json`: Emits structured JSON summary containing package plans, semver diff types (`major`, `minor`, `patch`), and update status.

