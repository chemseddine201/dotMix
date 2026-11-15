# dotMix — Compiler-Native Web Framework

<p align="center">
  <b>Direct DOM · Push-Pull Signals · Zero Virtual DOM · Built-in RBAC/ABAC · Offline CRDT Sync · Zero-Dependency Standard Library</b>
</p>

<p align="center">
  <a href="README.ar.md"><b>العربية</b></a> | <b>English</b> | <a href="FEATURES.md"><b>Features</b></a>
</p>

---

## What is dotMix?

**dotMix** (`.mix` and `.tix`) is an independent, compiler-native ahead-of-time (AOT) UI framework.

Instead of diffing a virtual DOM or interpreting templates at runtime, **dotMix** compiles your templates ahead of time into JavaScript that updates the real DOM directly: only the text node or attribute that depends on a changed signal is touched.

It ships with a fine-grained reactive runtime, a permissions engine (RBAC/ABAC), local-first CRDT sync, and a standard library with no third-party dependencies (`@dotmix/helpers`).

---

## Key Features

| Feature | How dotMix delivers it |
| :--- | :--- |
| **No virtual DOM** | Compiled instructions update only the text node or attribute that changed; there is no tree diffing or reconciliation pass. |
| **No third-party runtime dependencies** | `@dotmix/runtime` has no dependencies; `@dotmix/router`, `@dotmix/sync` and `@dotmix/helpers` depend only on `@dotmix/runtime`. |
| **Native RBAC/ABAC Permissions** | Built-in `<Can>` component, fine-grained reactive signal subjects, async permission cancellation, and pre-loader router guards. (UI visibility guard; pair with server-side authorization). |
| **Timezones without tzdata** | IANA timezone conversion in `@dotmix/helpers/datetime` uses the platform `Intl` API, so no timezone database is bundled. |
| **HTTP client** | `@dotmix/helpers/http`: interceptors, retries with backoff, request deduplication, caching, and a reactive `useHttp` hook. |
| **Offline-first CRDT state** | `@dotmix/sync`: local-first collections with Lamport clocks, fractional indexing, signed operations and durable IndexedDB storage. |
| **Safe keyed lists** | Duplicate keys in a keyed list are rejected up front with a deterministic error, before any DOM change. |
| **Multi-Preprocessor Scoped CSS** | Build-time compilation for `.scss`, `.sass`, `.less`, `.pcss`, and `.css` with strict AST-level scoping and security checks. |
| **TypeScript checking** | `.tix` components are type-checked (props, generics, imports) with the TypeScript compiler against real `.d.ts` files. |

See [FEATURES.md](FEATURES.md) for details.

---

## Quick Start

> **Status: pre-release.** The npm packages are not published yet, so the commands below will work after the first release. Until then you can build and test the framework from this repository (`npm install`, then `npm run build`, then `npm test`).

### 1. Scaffold a New Project

```bash
# TypeScript with SCSS
npx -p @dotmix/cli mix create my-app --ts --scss

# Or plain JavaScript with CSS
npx -p @dotmix/cli mix create my-app --js --css
```

### 2. Project Directory Structure

```text
my-app/
├── src/
│   ├── layouts/          # Persistent layouts (<Outlet /> retains child state)
│   ├── pages/            # Page components bound to declarative routes
│   ├── components/       # Design system primitives & domain widgets
│   ├── permissions/      # Isomorphic RBAC/ABAC capability rules
│   ├── stores/           # Reactive signals & offline CRDT collections
│   ├── styles/           # Global tokens, resets, and preprocessor styles
│   ├── routes.ts         # Declarative routes with pre-loader security guards
│   └── main.mix          # Bootstrap and permission provider
├── mix.config.ts         # Framework configuration
├── package.json
└── tsconfig.json
```

### 3. Development & Production Commands

```bash
cd my-app

# Development server with hot module replacement
npm run dev

# Static typechecking and semantic diagnostics
npm run check

# Ahead-of-time production build with route code-splitting & gzip report
npm run build

# Preview production build locally with SPA routing fallback & compression
npx mix preview

# Execute zero-dependency tests (logic, SSR, real-browser CDP)
npx mix test

# Audit and automatically fix syntax
npx mix lint --fix

# Check the project setup for common problems
npx mix doctor

# Check and update dependencies safely with automated codemods
npx mix upgrade --dry-run
```

All commands and flags: [docs/CLI.md](docs/CLI.md).

### 4. Editor Support (VS Code)

The `vscode-mix` extension adds syntax highlighting, live diagnostics, completions, hover and go-to-definition (Ctrl+click) for `.mix` and `.tix` files. Its TypeScript plugin also handles component imports in `.ts` files: `import App from "./App.tix"` type-checks, and Ctrl+click on the path or on the imported name opens the component.

The extension is not on the Marketplace yet. Build and install it from this repository:

```bash
# At the repository root
npm install
npm run build

# Package the extension (the .vsix includes the language server and the TypeScript plugin)
cd editors/vscode-mix
npm run package

# Install it, replacing any older version
code --install-extension vscode-mix-0.1.0.vsix --force
```

Then run **Developer: Reload Window** (Ctrl+Shift+P, or Cmd+Shift+P on macOS).

**TypeScript projects.** `mix create --ts` adds `src/env.d.ts`. In an existing project, create it:

```ts
// src/env.d.ts
/// <reference types="@dotmix/runtime/client" />
```

It declares `.tix` and `.mix` components and stylesheet imports (`import "./App.css";`), so `tsc` and editors without the extension accept them too.

**If something does not work:**

| Problem | Fix |
| :--- | :--- |
| `Cannot find module './App.tix'` in a `.ts` file | Check that `src/env.d.ts` exists and that `tsconfig.json` includes it, then run **TypeScript: Restart TS Server**. |
| Ctrl+click does nothing in a `.tix` file | Check in the Extensions view that **Mix / Tix Language Support** is installed and enabled, then run **dotMix: Restart Language Server**. |
| Errors or logs from the extension | Run **dotMix: Show Output Channel**. |

Full guide: [docs/VSCODE_EXTENSION_GUIDE.md](docs/VSCODE_EXTENSION_GUIDE.md).

---

## Syntax & Component Model

dotMix supports both **JavaScript** (`.mix`) and **strict TypeScript** (`.tix`) with a modern, functional component syntax:

```tsx
import "./UserProfile.scss";
import { createSignal } from "@dotmix/runtime";
import { Can } from "@dotmix/runtime/permissions";
import { http, useHttp } from "@dotmix/helpers/http";
import { dateTime } from "@dotmix/helpers/datetime";
import { dot } from "@dotmix/helpers/data";

export interface UserProps {
  userId: string;
  initialRole?: string;
}

export default function UserProfile(props: UserProps) {
  const user = createSignal({ name: "Alex", role: props.initialRole ?? "viewer" });

  // Reactive HTTP hook with automatic cancellation
  const { data: stats, loading } = useHttp(`/api/users/${props.userId}/stats`);

  return (
    <div class="user-profile-card">
      <header>
        <h2>{user().name}</h2>
        <span class="updated-time">Joined {dateTime().fromNow()}</span>
      </header>

      {if loading()}
        <p class="skeleton">Loading analytics...</p>
      {elseif stats()}
        <div class="metrics">
          <span>Views: {dot.get(stats(), "metrics.views", 0)}</span>
          <span>Score: {dot.get(stats(), "metrics.score", 0)}</span>
        </div>
      {else}
        <p>No analytics available.</p>
      {endif}

      {/* Permission gate */}
      <Can I="edit" this={user()} fallback={<span class="badge">Read Only</span>}>
        <button class="btn-primary" onClick={() => console.log("Edit user")}>
          Edit Profile
        </button>
      </Can>
    </div>
  );
}
```

---

## Packages

| Package | Purpose | Dependencies |
| :--- | :--- | :---: |
| [`@dotmix/runtime`](packages/runtime) | Push-Pull reactivity kernel, surgical DOM adapter, keyed reconciler, permissions | **0 dependencies** |
| [`@dotmix/router`](packages/router) | Radix-Trie data router, loaders, actions, pre-loader security guards | `@dotmix/runtime` only |
| [`@dotmix/helpers`](packages/helpers) | Zero-dependency standard library (`data`, `datetime`, `http`, `async`, `web`) | `@dotmix/runtime` only |
| [`@dotmix/sync`](packages/sync) | Offline-First CRDT distributed state synchronization engine | `@dotmix/runtime` only |
| [`@dotmix/compiler-frontend`](packages/compiler-frontend) | `.mix` / `.tix` parser and expression boundary extraction | Dev toolchain |
| [`@dotmix/compiler-semantic`](packages/compiler-semantic) | Scope analyzer, TS 6 Compiler API checker, virtual projection | Dev toolchain |
| [`@dotmix/compiler-css`](packages/compiler-css) | Multi-preprocessor scoper (`.scss`, `.sass`, `.less`, `.pcss`) & AST security | Dev toolchain |
| [`@dotmix/compiler-codegen`](packages/compiler-codegen) | Ahead-Of-Time direct DOM code & SourceMap generator | Dev toolchain |
| [`@dotmix/compiler-ssr`](packages/compiler-ssr) | Server-side rendering generator with signal auto-invocation | Dev toolchain |
| [`@dotmix/stream`](packages/stream) | WinterCG Edge Web Streams (`ReadableStream`, `Response`) for Cloudflare, Deno, Bun & partial hydration | Edge & Node runtime |
| [`@dotmix/server-node`](packages/server-node) | Streaming SSR HTTP server with per-request cryptographic CSP nonces | Node runtime |
| [`@dotmix/vite-plugin`](packages/vite-plugin) | Vite & Rollup compiler plugin with instant HMR | Dev toolchain |
| [`@dotmix/cli`](packages/cli) | CLI tool (`mix` / `dotmix`: `dev`, `build`, `check`, `create`) | Dev toolchain |
| [`@dotmix/language-server`](packages/language-server) | Language Server Protocol (LSP) for VS Code and editors | Dev toolchain |
| [`vscode-mix`](editors/vscode-mix) | VS Code extension for `.mix` and `.tix` (not on the Marketplace yet; [install guide](#4-editor-support-vs-code)) | VS Code / IDE |

---

## Browser & Runtime Support

dotMix targets modern web platforms and evergreen runtimes:
- **Browsers:** Chrome 100+, Edge 100+ and Firefox 100+ (tested); Safari 15.4+ (expected to work, not yet tested). ES2022 baseline.
- **Web Standards:** Native `BroadcastChannel`, Web Crypto (`crypto.getRandomValues`), IndexedDB, OPFS, and `AbortSignal`.
- **Server & edge:** Node.js 22+ (tested in CI on 22, 24 and 26). `@dotmix/stream` uses standard Web Streams, so WinterCG runtimes (Cloudflare Workers, Deno, Bun) are targeted but not yet tested.
- **Security Note:** Client-side RBAC/ABAC rules (`@dotmix/runtime/permissions`) govern UI presentation and interactive workflows; backend APIs must independently enforce authoritative authorization.

---

## Testing

The checks the repository runs:

```bash
# Compile all workspace packages
npm run build

# Run architecture guardrails & ESLint
npm run lint

# Full test suite (no mocks)
npm test

# Golden-path check of all 12 scaffold variants
npm run test:golden

# Real-browser tests (Chrome, Edge, Firefox)
npm run test:browser
npm run test:e2e
```

---

## License

**dotMix** is released under the [MIT License](LICENSE). © 2026 [Chemseddine](https://github.com/chemseddine201) and dotMix contributors.
An Arabic translation is provided for reference in [LICENSE.ar.md](LICENSE.ar.md); the English text is the legal version.
