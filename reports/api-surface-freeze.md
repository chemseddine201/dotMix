# Mix & Tix Framework — Final API Surface Freeze Report

**Date:** 2026-11-08  
**Phase:** Phase 6 (Stabilization & Release Readiness)  
**Status:** Frozen & Reconciled (1.0.0-rc.1)  
**Monorepo Packages:** `@mix/ast`, `@mix/compiler-frontend`, `@mix/compiler-semantic`, `@mix/compiler-css`, `@mix/compiler-codegen`, `@mix/runtime`, `@mix/router`, and `mix` CLI.

---

## 1. Package API Surface Inventory

### `@mix/ast`
- **Node Types:** `ComponentNode`, `ScriptBlockNode`, `StyleBlockNode`, `ElementNode`, `DynamicElementNode`, `TextNode`, `InterpolationNode`, `IfBlockNode`, `EachBlockNode`, `AwaitBlockNode`, `StaticAttributeNode`, `DynamicAttributeNode`, `DirectiveNode`, `EventBindingNode`, `RefBindingNode`.
- **Position & Span Types:** `SourcePosition`, `SourceSpan`.
- **Visitor Infrastructure:** `walk(ast, visitor)`.

### `@mix/compiler-frontend`
- **Parsing Entry Points:**
  - `parse(source: string, filename?: string, options?: ParseOptions): ComponentNode`
  - `tokenizeMarkup(source: string): Token[]`
  - `scanExpressionBoundary(source: string, startOffset: number): ExpressionBoundary`
- **Grammar Support:** Both `.mix` (flexible JavaScript) and `.tix` (strict `<script lang="ts">`), canonical `<{~expr}>` DynamicElement syntax (**D-105**), and balanced delimiter extraction.

### `@mix/compiler-semantic`
- **Semantic Descriptors:** `analyze(ast: ComponentNode): ComponentDescriptor`
- **Types:** `SemanticDiagnostic`, `SignalDeclaration`, `ComponentPropDeclaration`, `ComponentMethodDeclaration`, `ScopeSymbol`, `ScopeTree`, `ReactiveBinding`, `ComponentDescriptor`.
- **Tooling & Formatting:**
  - `formatDiagnostic(source, diag, filename, options): string` (**D-106** visual code frames).
  - `generateSourceMap(filename, source, generated): SourceMapV3` (Standard SourceMap V3 mapping).
  - `encodeVlq(val: number): string` (Base64 VLQ encoder).

### `@mix/compiler-css`
- **Scoping Entry Point:** `compileCss(cssContent: string, options?: CompileCssOptions): CompileCssResult`
- **Utility:** `generateScopeId(input: string): string`
- **Enforcement:** Disallows `@import` (`MIX_ERR_CSS_FORBIDDEN_IMPORT`), `@charset` (`MIX_ERR_CSS_FORBIDDEN_CHARSET`), unbalanced braces (`MIX_ERR_CSS_SYNTAX`), and unsafe declarations (**D-108**).

### `@mix/compiler-codegen`
- **AOT Codegen:** `generate(descriptor: ComponentDescriptor, options?: CodegenOptions): CodegenResult`
- **Codegen Contract:** Emits deterministic JavaScript/TypeScript modules calling direct DOM operations. Implements stable `__scope` context for HMR (**D-111**), and includes SourceMap V3 when source information is supplied.

### `@mix/runtime`
- **Reactive Core:**
  - `signal<T>(initialValue: T): Signal<T>`
  - `computed<T>(fn: () => T): Computed<T>` (Pull-Push lazy memoization)
  - `createEffect(fn: () => void): () => void` (Deferred rerun scheduler per **D-101**)
  - `batch<T>(fn: () => T): T` (Multi-signal atomic batching)
  - `createRoot<T>(fn: (dispose: () => void) => T, detachedParent?: Owner | null): T` (Root lifecycle with detached parent per **D-103**)
  - `onCleanup(fn: () => void): void`
- **Async Cancellation & Resource Management (D-104):**
  - `createCancellationToken(): CancellationToken`
  - `createResource<T>(fetcher: (token: CancellationToken) => Promise<T>): Resource<T>`
- **Keyed List Reconciliation (D-110):**
  - `reconcileKeyed<T>(parent, anchor, items, keyFn, renderFn): void` (First occurrence duplicate policy, recursive owner disposal, minimal-mutation single pass DOM reconciliation).
- **Security & HTML/CSS Validation (D-107, D-108, D-109):**
  - `isSafeUrl(url: string): boolean`
  - `parseSrcset(input: string): SrcsetCandidate[]` (Normative WHATWG HTML §4.8.4.3.7 parser)
  - `serializeSrcset(candidates: readonly SrcsetCandidate[]): string`
  - `setSafeSrcset(el: Element, rawSrcset: string): void`
  - `decodeCssEscapes(val: string): string`
  - `validateCssPropertyName(name: string): boolean`
  - `validateCssPropertyValue(val: string): boolean`
  - `setSafeStyleProperty(el: HTMLElement, prop: string, val: string): void`
  - `setSanitizerProvider(provider: SanitizerProvider | null): void`
  - `renderTrustedHtml(rawHtml: string, context?: SanitizerContext): string`
  - `setTrustedHtml(el: Element, rawHtml: string, context?: SanitizerContext): void`
  - `getOrCreateTrustedTypesPolicy(): Policy | null`
- **Direct DOM Adapter:**
  - `createElement`, `createTextNode`, `setTextContent`, `setAttribute`, `removeAttribute`, `setStyleProperty`, `appendChild`, `insertBefore`, `removeChild`, `addEventListener`.
- **HMR Support (D-111):**
  - `applyHmrUpdate(instance: ComponentInstance, updatedFactoryOrMethods: unknown): void`

### `@mix/router`
- **Reactive SPA Routing:**
  - `createRouter(options: RouterOptions): RouterInstance`
  - `RouteRecord`, `RouterOptions`, `RouterInstance`.

### Compiler CLI & Tooling (`bin/mix.mjs`)
- **CLI Commands:** `mix compile <file> [--out <dir>]`, `mix check <file>`, `mix version`.
- **Bundler Plugin:** `createMixPlugin(options)` (Vite / Rollup transform hook).

---

## 2. Invariant & Dependency Audit

- **Runtime Zero Dependencies:** `@mix/runtime` declares **zero** external runtime dependencies.
- **Platform Neutrality:** Browser DOM types (`HTMLElement`, `Event`, `Document`) do not leak into the platform-neutral core scheduler and reactivity engine.
- **No Virtual DOM:** Compilation targets direct DOM operations only.
