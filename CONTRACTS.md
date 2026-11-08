# CONTRACTS.md — Locked Package API Contracts (v3.2.1 / v3.2.2)

This document formalizes the immutable public API boundaries and inter-package contracts for the Mix / Tix monorepo.

---

## 1. `@mix/ast` Contract [Owner: Compiler Agent]

### Core Types & Nodes
- `SourceLocation`: `{ readonly line: number; readonly column: number; readonly offset: number; }`
- `SourceSpan`: `{ readonly start: SourceLocation; readonly end: SourceLocation; readonly filename: string; }`
- `ASTNode`: Base interface with `readonly type: string; readonly span: SourceSpan;`
- Nodes:
  - `ComponentNode`: Root holding `script`, `style`, and `template: TemplateChildNode[]`
  - `ScriptBlockNode`: `<script lang="ts"|"js">`
  - `StyleBlockNode`: `<style scoped>`
  - `ElementNode`: Regular HTML/SVG elements with static/dynamic attributes and children
  - `DynamicElementNode`: `<{~tagExpr}> ... </{~tagExpr}>`
  - `InterpolationNode`: `{expr}`
  - `IfBlockNode`: `{#if cond} ... {:else} ... {/if}`
  - `EachBlockNode`: `{#each items as item, index (key)} ... {/each}`
  - `walk(ast, visitor)`: AST traversal utility.

---

## 2. `@mix/runtime` Contract [Owner: Runtime Agent]

### 2.1 Reactive Core (`@mix/runtime` / `@mix/runtime/reactivity`)
- **Zero DOM Types:** Strictly ECMAScript-only, zero references to `Node` or `HTMLElement`.
- **States:**
  - `ComputationState`: `CLEAN = 0`, `CHECK = 1`, `DIRTY = 2`, `RUNNING = 3`, `DISPOSED = 4` as const.
  - `OwnerState`: `ACTIVE = 0`, `DISPOSED = 1` as const.
- **Push-Pull Scheduler:**
  - `notifySignalChange(signal)`: Pushes `DIRTY` to effects, `CHECK` to down-tree computed nodes.
  - `validateComputed(computed)`: Lazy pull-validation verifying dependency sources; skips re-evaluation if sources are unchanged.
  - `runEffect(effect)`: Executes effects, resets previous cleanups, disposes child owners, ensures state recovery in `finally`.
- **Primitives:**
  - `signal<T>(initialValue: T, equals?: Equals<T>): Signal<T>`
  - `computed<T>(fn: (prev?: T) => T, equals?: Equals<T>): Computed<T>`
  - `createEffect(fn: () => void): () => void`
  - `batch<T>(fn: () => T): T`
  - `untrack<T>(fn: () => T): T`
  - `createRoot<T>(fn: (dispose: () => void) => T, detachedParent?: Owner | null): T`
  - `CancellationTokenSource` / `CancellationToken`: Platform-neutral cancellation.

### 2.2 Surgical DOM Adapter (`@mix/runtime/dom`)
- `RendererAdapter`: Abstract operations bridge.
- `renderKeyedList<T>`: Keyed reconciliation using Longest Increasing Subsequence (LIS) in $O(N \log N)$ time.
- `setTrustedHtml(el, trustedValue)`: Inserts trusted HTML with context verification and W3C Trusted Types policy.
- `setStyle(el, property, value)`: Sets dynamic style properties individually via `el.style.setProperty`, enforcing security allowlists.

### 2.3 Security Subsystem (`@mix/runtime/security`)
- `isAllowedUrl(url: string, context: "navigation" | "media" | "resource"): boolean`: WHATWG URL parser validation.
- `parseSrcset(rawSrcset: string): SrcsetCandidate[]`: Conforming WHATWG srcset parser.
- `createTrustedHtml(dirtyHtml: string, sanitizerFn: (dirty: string) => string): TrustedHtmlValue`: WeakSet-registered trusted HTML values.

---

## 3. `@mix/compiler-frontend` Contract [Owner: Compiler Agent]
- `parse(source: string, filename?: string): ComponentNode`:
  - LL(1)/LL(2) markup tokenizer.
  - Expression boundary parsing via ESTree adapter (`parseExpressionAt` with `preserveParens: true`).
  - Expression classification: `isCompileTimeConstant` vs `requiresReactiveEvaluation`.

---

## 4. `@mix/compiler-semantic` Contract [Owner: Semantic Agent]
- `analyze(ast: ComponentNode): ComponentDescriptor`:
  - Symbol Table construction and lexical scope resolution.
  - Reactive binding dependency extraction.
  - TypeScript projection generation (`.tix.ts`) with `VerifyProps` and `VerifyRef`.
  - `SourceMapSpanTable` mapping virtual projection offsets back to `.tix` source (`verbatim`, `origin`, `internal`).

---

## 5. `@mix/compiler-css` Contract [Owner: CSS Agent]
- `compileCss(css: string, options?: CssOptions): CompiledCssResult`:
  - CSS AST parsing via real parser.
  - Deterministic component scoping with `mx_<hash>`.
  - Golden transformation matrix for `:global(...)` and `:deep(...)`.
  - Rejection of forbidden `@import` and `@charset` declarations.

---

## 6. `@mix/compiler-codegen` Contract [Owner: Codegen Agent]
- `generate(descriptor: ComponentDescriptor, options?: CodegenOptions): CodegenResult`:
  - Surgical direct vanilla DOM operations.
  - Zero Virtual DOM overhead.
  - Deterministic code emission with stable scope for HMR.

---

## 7. `@mix/cli` Contract [Owner: Toolchain Agent]
- CLI commands: `mix dev`, `mix build`, `mix check`.
- HMR engine using compiler-generated scopes and stable-identity trampolines.
