# Proposed Repository Architecture & Package Topology

**Audit Date:** 2026-11-08  
**Revised:** 2026-11-08 (Incorporating Human Architecture Authority Review)  
**Auditor:** Antigravity (AI Coding Assistant)  
**Authority:** Human Architecture Authority  
**Task Reference:** Task 6 (`agent/INITIALIZATION_AGENT_TASK.md`)  
**Status:** Architecture Proposal Reconciled — Dedicated Leaf Diagnostics Package Introduced

---

## 1. Executive Summary

This proposal establishes the clean, modular package topology for the Mix / Tix compiler-native UI framework. It directly addresses the architectural defects and review feedback from the Human Architecture Authority:
1. **Introduction of `@mix/diagnostics` as a Dedicated Leaf Package:**
   To permanently resolve the package dependency inversion where `@mix/compiler-frontend` and `@mix/compiler-semantic` depended on `@mix/runtime` for error types, a dedicated leaf package—`@mix/diagnostics`—is introduced. It houses diagnostic codes, error classes (`MixError`, `MixDiagnosticError`), and source diagnostic data structures.
2. **Refined Focus for `@mix/ast`:**
   `@mix/ast` focuses strictly on syntax-tree interfaces, node constructors, source spans, and AST traversal utilities.
3. **Decoupled Compiler Pipeline:**
   Compiler packages depend on `@mix/diagnostics` and `@mix/ast`, with **zero compile-time dependencies on `@mix/runtime`**.
4. **Zero-Dependency Runtime Kernel:**
   `@mix/runtime` remains a self-contained, platform-neutral reactive kernel and DOM adapter with **zero external npm dependencies**.
5. **Deferred Router Expansion:**
   `@mix/router` remains deferred until post-Gate 5.

---

## 2. Package Specifications

### 2.1 `@mix/diagnostics` — Common Diagnostic Leaf Package
- **Responsibility:**
  Houses diagnostic error classes (`MixError`, `MixDiagnosticError`), stable diagnostic error codes (`DiagnosticCode`), severity levels (`DiagnosticSeverity`), and code frame formatting utilities. It is the common leaf package for all error reporting.
- **Public Entry Points:**
  - `.` (`dist/index.js`, `dist/index.d.ts`):
    - `MixError`, `MixDiagnosticError`, `DiagnosticCode`, `DiagnosticSeverity`, `formatDiagnosticCodeFrame`.
- **Allowed Dependencies:**
  **None.** (Zero external dependencies).
- **Forbidden Dependencies:**
  `@mix/ast`, `@mix/compiler-*`, `@mix/runtime`, `@mix/router`.
- **Tests:**
  Error instantiation, message formatting, stable error code preservation, code frame caret underline generation.

---

### 2.2 `@mix/ast` — Syntax Tree & Source Spans
- **Responsibility:**
  Pure type definitions and constructors for the unified Mix/Tix Abstract Syntax Tree, source location spans (`SourceLocation`, `SourceSpan`), and immutable AST traversal utilities (`walk`).
- **Public Entry Points:**
  - `.` (`dist/index.js`, `dist/index.d.ts`):
    - Node interfaces (`ComponentNode`, `ElementNode`, `DynamicElementNode`, `ComponentCallNode`, `TextNode`, `InterpolationNode`, `ControlFlowBlockNode`, `AttributeNode`), factory functions (`createComponentNode`, `createElementNode`), and `walk`.
- **Allowed Dependencies:**
  - `@mix/diagnostics` (internal workspace dependency for error spans).
- **Forbidden Dependencies:**
  `@mix/compiler-*`, `@mix/runtime`, `@mix/router`, any DOM/browser packages.
- **Tests:**
  AST node immutability (`Object.isFrozen`), tree construction, span validity invariants (`start.offset <= end.offset`), visitor traversal order.

---

### 2.3 `@mix/compiler-frontend` — Lexer & Template Parser
- **Responsibility:**
  Template markup parsing, balanced delimiter state machine for embedded expressions (`attr={expr}`, `{expr}`, `<{~expr}>`), `<script>` and `<style>` section extraction, Acorn / TypeScript expression scanner integration, and AST construction with exact source spans.
- **Expression AST Ownership:**
  `@mix/ast` defines template AST nodes containing ESTree-compatible expression nodes (`expression: ESTree.Node`). `@mix/compiler-frontend` invokes `acorn@8.14.0` with `@sveltejs/acorn-typescript@1.4.1` to parse embedded JS/TS expressions into ESTree ASTs with character-exact source spans, avoiding any custom regex-based expression scanning.
- **Public Entry Points:**
  - `.` (`dist/index.js`, `dist/index.d.ts`):
    - `parse(source: string, filename?: string): ComponentNode`
- **Allowed Dependencies:**
  - `@mix/diagnostics`
  - `@mix/ast`
  - `acorn@8.14.0` (expression parsing)
  - `@sveltejs/acorn-typescript@1.4.1` (TypeScript expression syntax support)
- **Forbidden Dependencies:**
  `@mix/runtime` (**STRICTLY FORBIDDEN**), `@mix/compiler-codegen`, `@mix/compiler-css`, `@mix/compiler-semantic`.
- **Tests:**
  Standard `.mix` and `.tix` template parsing, unclosed tags, expression boundary extraction across string/regex/comment edge cases, dynamic element `<{~expr}>` parsing, syntax error diagnostics with line/column carets.

---

### 2.4 `@mix/compiler-semantic` — Scopes, Symbols & Type Projection
- **Responsibility:**
  Semantic symbol resolution, component props/ref validation, scope hierarchy construction, `.tix` virtual TypeScript projection (`.tix.ts`) with `VerifyProps` and `VerifyRef` contracts, TypeScript Compiler API integration adapter, and accurate bidirectional source map generation. Consumes the ESTree expression nodes produced by `@mix/compiler-frontend` for identifier and dependency analysis without regular expressions.
- **Public Entry Points:**
  - `.` (`dist/index.js`, `dist/index.d.ts`):
    - `analyze(ast: ComponentNode): ComponentDescriptor`
    - `projectTypeScript(ast: ComponentNode): TypeProjectionResult`
    - `generateSourceMap(filename: string, source: string, generated: string): SourceMapV3`
- **Allowed Dependencies:**
  - `@mix/diagnostics`
  - `@mix/ast`
  - `typescript@6.0.3` (strictly encapsulated behind internal compiler adapter)
- **Forbidden Dependencies:**
  `@mix/runtime` (**STRICTLY FORBIDDEN**), `@mix/compiler-codegen`, `@mix/compiler-css`.
- **Tests:**
  Scope resolution, duplicate variable detection, `.tix` virtual projection byte coverage verification, TypeScript compiler type-check diagnostic mapping back to original source spans.

---

### 2.5 `@mix/compiler-css` — Style Scoping & Validation
- **Responsibility:**
  Component style parsing, deterministic scope ID generation (`mx-[hash]`), selector transformation (scoped attribute insertion, `:global(...)`, `:deep(...)`), and compile-time validation (rejection of `@import` and `@charset`).
- **Public Entry Points:**
  - `.` (`dist/index.js`, `dist/index.d.ts`):
    - `compileCss(cssSource: string, options?: CssCompileOptions): CssCompileResult`
- **Allowed Dependencies:**
  - `@mix/diagnostics`
  - `@mix/ast`
  - `css-tree@3.1.0` (AST-based CSS parser)
- **Forbidden Dependencies:**
  `@mix/runtime`, `@mix/compiler-frontend`, `@mix/compiler-semantic`, `@mix/compiler-codegen`.
- **Tests:**
  Selector transformation matrix, `:global` escaping, `@import` and `@charset` rejection with exact source spans, keyframe animation scoping.

---

### 2.6 `@mix/compiler-codegen` — Direct DOM JavaScript Emitter
- **Responsibility:**
  Deterministic Ahead-of-Time code generation emitting readable vanilla JavaScript/TypeScript module code that performs direct DOM operations calling `@mix/runtime` primitives (`createElement`, `createTextNode`, `createEffect`, etc.), child component factory calls, dynamic element resolution, conditional branch mounting, and stable scope context generation for HMR (D-111).
- **Public Entry Points:**
  - `.` (`dist/index.js`, `dist/index.d.ts`):
    - `generate(descriptor: ComponentDescriptor, options?: CodegenOptions): CodegenResult`
- **Allowed Dependencies:**
  - `@mix/diagnostics`
  - `@mix/ast`
  - `@mix/compiler-semantic`
  - `@mix/compiler-css`
- **Forbidden Dependencies:**
  `@mix/runtime` (Compile-time code imports are references in emitted code text, but codegen itself does not depend on runtime package execution).
- **Tests:**
  Deterministic code generation output, unmocked direct DOM generation, child component factory invocation, dynamic element creation, conditional branch anchor creation, source map correctness.

---

### 2.7 `@mix/runtime` — Reactive Kernel & DOM Adapter
- **Responsibility:**
  Platform-neutral reactive core (Signal, Computed, Effect, Batch, Owner, Cleanup, 5-state push-pull scheduler, cycle detection, deterministic error recovery), pure ECMAScript cancellation tokens and generation counters, surgical DOM adapter (direct element creation, text updates, LIS keyed reconciliation with atomic duplicate update rejection per D-110), trusted HTML boundary (application-configured `SanitizerProvider` invoking `createTrustedHtml`, `WeakSet` registry, Native Trusted Types integration per D-109), and safe dynamic style application.
- **Public Entry Points:**
  - `.` (`dist/index.js`, `dist/index.d.ts`): Primary runtime entry point.
  - `./core`: Pure platform-neutral reactive kernel (`signal`, `computed`, `createEffect`, `createRoot`, `Owner`).
  - `./dom`: Surgical browser DOM adapter (`createElement`, `createTextNode`, `renderKeyedList`).
  - `./platform`: Platform bridges (`toAbortSignal`).
  - `./security`: Security boundaries (`createTrustedHtml`, `setSanitizerProvider`, `setSafeSrcset`, `setSafeStyleProperty`).
  - `./typecheck`: Type helper contracts for `.tix` projection (`VerifyProps`, `VerifyRef`, `RefTarget`).
- **Allowed Dependencies:**
  - Workspace development: `@mix/diagnostics` (for standard `MixError` and diagnostic codes).
  - Published distribution: **Zero external npm dependencies** (`dependencies: {}`). The build step inlines required diagnostic types/codes into the runtime distribution artifacts, guaranteeing that `@mix/runtime` is completely self-contained.
- **Forbidden Dependencies:**
  `@mix/ast`, `@mix/compiler-*`, `@csstools/css-tokenizer`, any external npm runtime package.
- **Tests:**
  12 Appendix C reference tests, diamond graph lazy pull-push memoization, non-nested deferred rerun, write-during-running, runaway cycle ceiling (`ReactiveCycleError`), owner disposal unlinking, detached root context inheritance, stale async result rejection, LIS reconciliation with atomic duplicate collection rejection (D-110), WHATWG srcset conformance vectors, CSS escape decoding, Trusted HTML WeakSet registry.

---

### 2.8 `@mix/router` — Client-Side Router
- **Status:** **DEFERRED**
  Per Project Charter non-goals, client-side routing is deferred until after Gate 5 vertical-slice acceptance.

---

## 3. Acyclic Package Dependency Graph

```text
                           +--------------------+
                           | @mix/diagnostics   |  (Zero dependencies: errors, codes, spans)
                           +--------------------+
                             /        |        \
                            /         |         \
                           v          |          v
                 +-----------------+  |   +------------------+
                 |    @mix/ast     |  |   |   @mix/runtime   | (Zero external dependencies:
                 +-----------------+  |   +------------------+  platform-neutral core,
                   /        \         |                         DOM adapter, security)
                  /          \        |
                 v            v       v
+-----------------------+   +-------------------+
| @mix/compiler-frontend|   | @mix/compiler-css | (Zero external runtime dependencies;
+-----------------------+   +-------------------+  CSS parser only)
            |
            v
+-----------------------+
|@mix/compiler-semantic |
+-----------------------+
            \                        /
             \                      /
              v                    v
          +----------------------------+
          |   @mix/compiler-codegen    |
          +----------------------------+
                        :
                        : (Emits JS that imports @mix/runtime at runtime)
                        v
               [Emitted Component.js] ----> imports ----> @mix/runtime
```

### Dependency Validation Invariants:
1. **Zero Circularity:** The graph is strictly directed and acyclic (DAG).
2. **Zero Inverted Layers:** Compiler packages (`frontend`, `semantic`, `css`, `codegen`) depend on `@mix/diagnostics` and `@mix/ast`, and never depend on `@mix/runtime`.
3. **Zero External Runtime Dependencies:** `@mix/runtime` publishes with zero external npm dependencies (`dependencies: {}`). It imports `@mix/diagnostics` internally via monorepo workspace references during development, and inlines needed diagnostics into its distribution artifacts at build time.
4. **Independent Verifiability:** `@mix/runtime` and compiler packages can be compiled and tested independently in parallel.
