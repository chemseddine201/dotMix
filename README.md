# Mix & Tix — Compiler-Native UI Language & Framework

**Version:** `1.0.0-rc.1`  
**Architecture:** Compiler-Native Ahead-of-Time (AOT) Direct-DOM UI Framework  
**Syntax:** `.mix` (flexible reactive syntax) and `.tix` (strict TypeScript syntax)  
**Status:** All Implementation Phases (0 through 6) Complete and Verified

---

## 1. What is Mix & Tix?

Mix / Tix is a complete, compiler-native UI language and framework that compiles declarative components directly to fine-grained DOM operations:
- **No Virtual DOM:** Compilation generates direct DOM instructions (`createElement`, `createTextNode`, `setAttribute`), eliminating runtime virtual tree diffing overhead.
- **Zero Avoidable Runtime Dependencies:** `@mix/runtime` is completely self-contained with zero third-party dependencies.
- **Unified Pipeline:** `.mix` and `.tix` components share a single immutable AST model and compiler pipeline.
- **Fine-Grained Pull-Push Reactivity:** Signals push dirty marks lazily to memos while scheduling effects in a deferred rerun queue with cycle detection (**D-101**).
- **Hardened Security Boundary:** Normative WHATWG `srcset` parsing (**D-107**), dynamic CSS escape sequence decoding and URL validation (**D-108**), and W3C Trusted Types policy integration (**D-109**).
- **Stable Scope HMR:** Live-state preserving Hot Module Replacement that swaps methods onto component scopes without resetting signal state or unmounting elements (**D-111**).

---

## 2. Monorepo Architecture

The framework is organized as an npm workspaces monorepo with composite TypeScript project references:

```text
mix-framework/
├── packages/
│   ├── ast/                 # Immutable AST node contracts and visitor traversal
│   ├── compiler-frontend/   # Lexer, markup parser, DynamicElement & delimiter scanner
│   ├── compiler-semantic/   # Lexical scopes, type projection, code frames & source maps
│   ├── compiler-css/        # Scoped CSS transforms, at-rule rejection (@import)
│   ├── compiler-codegen/    # Deterministic AOT code generator emitting direct DOM code
│   ├── runtime/             # Platform-neutral reactive core, DOM adapter, and security
│   └── router/              # Client-side reactive SPA routing
├── bin/
│   └── mix.mjs              # Standalone CLI driver & Vite/Rollup transform plugin
├── benchmarks/
│   └── run-benchmarks.mjs   # Reproducible performance benchmark suite
└── tests/                   # Conformance, security, runtime, HMR, and CLI test suites
```

---

## 3. Quickstart & CLI

### Installation & Prerequisites

- **Node.js:** Node.js 24 LTS (Active) or Node.js 26 LTS.
- **Package Manager:** npm (native workspaces).

```bash
# Clone and build all packages
git clone https://github.com/mix-framework/mix-framework.git
cd mix-framework
npm install
npm run build
```

### CLI Commands (`mix`)

```bash
# Compile a .mix or .tix component to JS, CSS, and Source Maps
node bin/mix.mjs compile src/Counter.mix --out dist/

# Check component syntax and display visual code frames
node bin/mix.mjs check src/Counter.mix

# Display framework version
node bin/mix.mjs version
```

### Vite / Rollup Plugin

```javascript
// vite.config.js
import { defineConfig } from "vite";
import { createMixPlugin } from "./bin/mix.mjs";

export default defineConfig({
  plugins: [createMixPlugin()]
});
```

---

## 4. Component Syntax Guide

### Flexible `.mix` Syntax

```mix
<script>
  let count = signal(0);

  function increment() {
    count.set((c) => c + 1);
  }
</script>

<style>
  .counter-btn {
    background-color: #2563eb;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
  }
</style>

<button class="counter-btn" on:click={increment}>
  Count: {count()}
</button>
```

### Strict `.tix` Syntax

`.tix` components require strict TypeScript script blocks and typed props:

```tix
<script lang="ts">
  export let initialCount: number = 0;
  let count = signal<number>(initialCount);

  function increment(): void {
    count.set((c) => c + 1);
  }
</script>

<div class="card">
  <span>Current Count: {count()}</span>
  <button on:click={increment}>Increment</button>
</div>
```

### Dynamic Elements (`<{~expr}>`)

Dynamic tags use canonical `<{~expr}>` syntax (**D-105**), evaluating the tag expression once upon element creation and reusing the resolved tag constructor for the closing boundary:

```mix
<script>
  let headingLevel = signal("h2");
</script>

<{~headingLevel()}>
  Dynamic Section Title
</{~headingLevel()}>
```

### Keyed Control Flow (`{#each}`)

Keyed list reconciliation enforces explicit key expressions with a deterministic first-occurrence duplicate policy (**D-110**):

```mix
{#each items as item, index (item.id)}
  <div class="row">
    <span>#{index()}: {item.title}</span>
  </div>
{/each}
```

---

## 5. Performance Baselines

The framework benchmarks against the official baselines defined in `spec/PERFORMANCE.md` using `npm run bench`:

| Benchmark Metric | Target Baseline | Actual Result | Status |
|---|---|---|---|
| **Reconciliation: Create 1,000 rows** | < 40ms | **26.44ms** | **✓ PASS** |
| **Reconciliation: Partial update (every 10th row)** | < 10ms | **2.78ms** | **✓ PASS** |
| **Reconciliation: Swap 2 rows (row 4 with row 992)**| < 12ms | **2.42ms** | **✓ PASS** |
| **Reconciliation: Clear 1,000 rows** | < 15ms | **1.80ms** | **✓ PASS** |
| **Reactivity: Create 50,000 signals** | < 50ms | **11.00ms** | **✓ PASS** |
| **Reactivity: Computed chain propagation** | < 15ms | **3.52ms** | **✓ PASS** |
| **Reactivity: Atomic batching (5,000 writes)** | < 15ms | **5.83ms** | **✓ PASS** |

---

## 6. Security Model

1. **Normative WHATWG `srcset` Parser (D-107):** Full conformance to HTML Standard §4.8.4.3.7, correctly parsing data URLs and query parameters containing commas, extracting descriptors, and recovering from malformed candidates.
2. **Dynamic CSS & Style Validation (D-108):** Decodes hex/character CSS escape sequences (`\3b` -> `;`), enforces strict identifier property allowlists, detects delimiter injections, and filters dangerous `url()` schemes.
3. **Trusted HTML Boundary (D-109):** Rejects unescaped HTML injection (`mix-html`) without an explicit `SanitizerProvider` or native W3C `window.trustedTypes` policy.

---

## 7. Verification & Tests

Run the complete test suite:

```bash
# Execute scaffold checks, compiler conformance, runtime, security, HMR, diagnostics, and CLI suites
npm test

# Execute performance benchmarks
npm run bench

# Verify publishable tarball packaging across all packages
npm run pack
```

---

## 8. License

MIT
