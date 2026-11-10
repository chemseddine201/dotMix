# dotMix — Compiler-Native Web Framework

<p align="center">
  <b>Direct DOM · Push-Pull Signals · Zero Virtual DOM · Built-in RBAC/ABAC · Offline CRDT Sync · Zero-Dependency Standard Library</b>
</p>

<p align="center">
  <a href="README.ar.md"><b>العربية</b></a> | <b>English</b> | <a href="FEATURES.md"><b>Full Features & Architectural Comparison</b></a>
</p>

---

## ⚡ What is dotMix?

**dotMix** (`.mix` and `.tix`) is an independent, compiler-native ahead-of-time (AOT) UI framework.

Instead of running heavy Virtual DOM diffing (like React and Vue) or interpreting templates at runtime, **dotMix** compiles your declarative templates directly into surgical, zero-allocation JavaScript instructions that operate directly on the real DOM.

Paired with a fine-grained reactive runtime, an isomorphic RBAC/ABAC permissions engine, local-first offline CRDT sync, and a 100% zero-dependency standard library (`mix-helpers`), dotMix is built from the ground up for mission-critical and enterprise-scale web applications.

---

## 🚀 Key Advantages Over Other Frameworks

| Advantage | How dotMix Delivers It |
| :--- | :--- |
| **Zero Virtual DOM Overhead** | Direct AOT compiler instructions update only the exact text node or attribute that changed. Sub-microsecond (<1µs) surgical DOM updates with zero Virtual DOM reconciliation latency. |
| **Zero External Runtime Dependencies** | `@mix/runtime` and `@mix/router` have 0 dependencies. The standard library `mix-helpers` has 0 third-party dependencies. |
| **Native RBAC/ABAC Permissions** | Built-in `<Can>` component, fine-grained reactive signal subjects, async permission cancellation, and pre-loader router guards. (UI visibility guard; pair with server-side authorization). |
| **Zero-Data Timezones & Date Engine** | Native IANA timezone conversions (`mix-helpers/datetime`) using the browser's `Intl` engine with 0 external tzdata bundles. |
| **Resilient Interceptor HTTP Client** | Full Axios-compatible client (`mix-helpers/http`) with automatic retries/backoff, deduplication, cache, and reactive `useHttp` signal hook. |
| **Offline-First Distributed CRDT State** | Built-in `@mix/sync` with Lamport timestamps, fractional indexing, vector clocks, and durable OPFS/IndexedDB storage. |
| **Atomic Keyed Reconciliation (`D-110`)** | Duplicate keys in collections are rejected atomically upfront, throwing a deterministic error without UI or DOM corruption. |
| **Multi-Preprocessor Scoped CSS** | Build-time compilation for `.scss`, `.sass`, `.less`, `.pcss`, and `.css` with strict AST-level scoping and security checks. |
| **Official TypeScript 6 Compiler API** | Strict static verification of `.tix` component props, generics, and imports against real `.d.ts` declaration files. |

👉 **Read the comprehensive deep dive in [FEATURES.md](FEATURES.md).**

---

## 📦 Quick Start

### 1. Scaffold a New Project

```bash
# Using dotmix CLI
npm create dotmix my-app

# Or use npx with custom options
npx @mix/cli create my-app --ts --scss
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

# Start lightning-fast development server with instant HMR
npm run dev

# Static typechecking and semantic diagnostics
npm run check

# Ahead-of-time production build with route code-splitting & gzip report
npm run build
```

---

## 💡 Syntax & Component Model

dotMix supports both **JavaScript** (`.mix`) and **strict TypeScript** (`.tix`) with a modern, functional component syntax:

```tsx
import "./UserProfile.scss";
import { createSignal } from "@mix/runtime";
import { Can } from "@mix/runtime/permissions";
import { http, useHttp } from "mix-helpers/http";
import { dateTime } from "mix-helpers/datetime";
import { dot } from "mix-helpers/data";

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

      {/* Surgical DOM permission gate */}
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

## 🛠️ The Workspace Packages

| Package | Purpose | Dependencies |
| :--- | :--- | :---: |
| [`@mix/runtime`](packages/runtime) | Push-Pull reactivity kernel, surgical DOM adapter, keyed reconciler, permissions | **0 dependencies** |
| [`@mix/router`](packages/router) | Radix-Trie data router, loaders, actions, pre-loader security guards | **0 dependencies** |
| [`mix-helpers`](packages/helpers) | Zero-dependency standard library (`data`, `datetime`, `http`, `async`, `web`) | `@mix/runtime` only |
| [`@mix/sync`](packages/sync) | Offline-First CRDT distributed state synchronization engine | `@mix/runtime` only |
| [`@mix/compiler-frontend`](packages/compiler-frontend) | `.mix` / `.tix` parser and expression boundary extraction | Dev toolchain |
| [`@mix/compiler-semantic`](packages/compiler-semantic) | Scope analyzer, TS 6 Compiler API checker, virtual projection | Dev toolchain |
| [`@mix/compiler-css`](packages/compiler-css) | Multi-preprocessor scoper (`.scss`, `.sass`, `.less`, `.pcss`) & AST security | Dev toolchain |
| [`@mix/compiler-codegen`](packages/compiler-codegen) | Ahead-Of-Time direct DOM code & SourceMap generator | Dev toolchain |
| [`@mix/compiler-ssr`](packages/compiler-ssr) | Server-side rendering generator with signal auto-invocation | Dev toolchain |
| [`@mix/stream`](packages/stream) | WinterCG Edge Web Streams (`ReadableStream`, `Response`) for Cloudflare, Deno, Bun & partial hydration | Edge & Node runtime |
| [`@mix/server-node`](packages/server-node) | Streaming SSR HTTP server with per-request cryptographic CSP nonces | Node runtime |
| [`@mix/vite-plugin`](packages/vite-plugin) | Vite & Rollup compiler plugin with instant HMR | Dev toolchain |
| [`@mix/cli`](packages/cli) | CLI tool (`mix` / `dotmix`: `dev`, `build`, `check`, `create`) | Dev toolchain |
| [`@mix/language-server`](packages/language-server) | Language Server Protocol (LSP) for VS Code and editors | Dev toolchain |

---

## 🌐 Browser & Runtime Baseline (Modern 2022+)

dotMix targets modern web platforms and evergreen runtimes:
- **Browsers:** Chrome 100+, Edge 100+, Safari 15.4+, Firefox 100+ (ES2022+ baseline).
- **Web Standards:** Native `BroadcastChannel`, Web Crypto (`crypto.getRandomValues`), IndexedDB, OPFS, and `AbortSignal`.
- **Server & Edge Runtimes:** Node.js 18+ / 20+ / 22+, Cloudflare Workers, Deno, Bun, and Vercel Edge.
- **Security Note:** Client-side RBAC/ABAC rules (`@mix/runtime/permissions`) govern UI presentation and interactive workflows; backend APIs must independently enforce authoritative authorization.

---

## 🧪 Testing & Verification

The dotMix repository enforces strict automated verification:

```bash
# Compile all workspace packages
npm run build

# Run architecture guardrails & ESLint
npm run lint

# Execute full unmocked test suite (208+ tests)
npm test

# Run Golden-Path E2E verification across all 10 scaffold variants
npm run test:golden
```

---

## 📄 License

**dotMix** is [MIT Licensed](LICENSE) (open source, exactly like React) © 2026 [Chemseddine](https://github.com/chemseddine201).
See [`LICENSE`](LICENSE) (English) and [`LICENSE.ar.md`](LICENSE.ar.md) (العربية).
