# Phase 1 Task Breakdown — Minimal End-to-End Vertical Slice

**Target:** Implement the canonical specifications and the smallest possible genuinely end-to-end vertical slice proving the entire Mix / Tix compiler-runtime architecture.

---

## 1. Work Package 1: Canonical Specification Reconciliation (Spec Import)

| Task ID | Task Description | Scope & Reconciled Decision | Acceptance Criteria |
|---|---|---|---|
| **P1-SPEC-01** | Update `spec/SEMANTICS.md` & `spec/RUNTIME_API.md` | Apply **D-101** (Deferred Rerun, `pendingRerun` decoupled from `ComputationState`, non-nested execution, configurable cycle detection via `SchedulerOptions.maxEffectIterations`, deterministic error handling). | Specification documents exact state transitions, scheduler loop algorithm, and error boundary dispatch. |
| **P1-SPEC-02** | Update `spec/SEMANTICS.md` & `spec/RUNTIME_API.md` | Apply **D-102** (Decouple Owner lifecycle `ACTIVE \| DISPOSED` from Computation state `CLEAN \| CHECK \| DIRTY \| RUNNING \| DISPOSED`). | Explicit unlinking and teardown rules documented for computed nodes and effects. |
| **P1-SPEC-03** | Update `spec/RUNTIME_API.md` | Apply **D-103** (`createRoot(fn, detachedParent?)` contract preserved). | `detachedParent` semantic impact and usage documented with exact TypeScript declaration. |
| **P1-SPEC-04** | Update `spec/RUNTIME_API.md` | Apply **D-104** (Platform-neutral `CancellationToken` and generation counter; DOM `AbortSignal` bridge in adapter). | Zero browser DOM types in core runtime contracts. |
| **P1-SPEC-05** | Update `spec/LANGUAGE.md` & `spec/AST.md` | Apply **D-105** (Preserve `<{~expr}>` syntax, single-evaluation dynamic element identity, delimiter scanner specification). | Formal grammar updated; delimiter handling for comments, quotes, regex, and templates specified. |
| **P1-SPEC-06** | Update `spec/DIAGNOSTICS.md` & `spec/SEMANTICS.md` | Apply **D-106** (`ComponentFactory<Props>`, `RefTarget<T>`, 1:1 bidirectional diagnostic span mapping). | Span mapping algorithm defined from projected TS diagnostics to source `.mix`/`.tix` locations. |
| **P1-SPEC-07** | Update `spec/SECURITY.md` | Apply **D-107** (Normative WHATWG HTML §4.8.4.3.7 `srcset` algorithm and test vectors). | Full step-by-step algorithm and test vectors (data URLs with commas, query commas, whitespace) documented. |
| **P1-SPEC-08** | Update `spec/CSS_SCOPING.md` & `spec/SECURITY.md` | Apply **D-108** (Dual compile-time at-rule rejection and runtime dynamic CSS property/escape/URL validation). | Property allowlist, escape decoding, URL protocol validation rules specified. |
| **P1-SPEC-09** | Update `spec/SECURITY.md` & `spec/RUNTIME_API.md` | Apply **D-109** (Trusted HTML `SanitizerProvider` interface and Trusted Types policy boundary). | Runtime security error specified when raw HTML is bound without an approved sanitizer. |
| **P1-SPEC-10** | Update `spec/SEMANTICS.md` | Apply **D-110** (Keyed reconciliation: duplicate-key diagnostic, first-key retention, duplicate owner disposal, atomic batching). | Fallback surrogate-key behavior removed; deterministic duplicate handling and batching specified. |
| **P1-SPEC-11** | Update `spec/DIAGNOSTICS.md` & `spec/RUNTIME_API.md` | Apply **D-111** (HMR method dispatch via stable component scope context, live-state test specification). | Codegen pattern and verification test specified. |

---

## 2. Work Package 2: Toolchain Configuration & Workspace Foundation

| Task ID | Task Description | Scope | Acceptance Criteria |
|---|---|---|---|
| **P1-TOOL-01** | Toolchain Pinning & Lockfile | Re-evaluate TypeScript 7.0.2 Compiler API; baseline on Node.js 24 LTS with Node.js 26 LTS compatibility; pin exact dependencies in `package.json` and commit `package-lock.json`. | Lockfile committed; `engines` strictly requires `^24.0.0 \|\| ^26.0.0`. |
| **P1-TOOL-02** | Composite TypeScript Configs | Configure `tsconfig.json` in each package extending `tsconfig.base.json` with `composite: true` and project references. | `npx tsc --build` compiles topological project graph cleanly. |
| **P1-TOOL-03** | Monorepo Scripts & Linting | Configure `"build": "tsc -b"`, `"lint": "eslint ."`, `"test": "node --test"` in root `package.json`. | All root scripts execute without errors. |

---

## 3. Work Package 3: Complete Minimum End-to-End Vertical Slice

To prove the architectural pipeline end-to-end without implementing the full language surface, Phase 1 implements the complete path for a single minimal component:

```mix
<script>
  let count = signal(0);
</script>
<span>Count: {count()}</span>
```

### Pipeline Steps:

```text
[Source .mix/.tix]
       │
       ▼ (P1-SLICE-01: @mix/compiler-frontend)
[Token Stream & Minimal AST Nodes]
       │
       ▼ (P1-SLICE-02: @mix/ast)
[ComponentNode, ElementNode, InterpolationNode]
       │
       ▼ (P1-SLICE-03: @mix/compiler-semantic)
[Resolved Scope, Signal Dependency Map]
       │
       ▼ (P1-SLICE-04: @mix/compiler-codegen)
[Deterministic TypeScript/JavaScript Direct DOM Code]
       │
       ▼ (P1-SLICE-05: @mix/runtime)
[createRoot, signal, createEffect, direct DOM elements]
       │
       ▼ (P1-SLICE-06: DOM Update Verification)
[count.set(1) -> deferred rerun -> textNode.data = 'Count: 1']
       │
       ▼ (P1-SLICE-07: Disposal Verification)
[root.dispose() -> effect unlinked -> elements detached]
```

| Task ID | Component / Package | Minimum Scope Implemented | Acceptance Criteria |
|---|---|---|---|
| **P1-SLICE-01** | `@mix/compiler-frontend` | Minimal tokenizer & parser extracting `<script>` block and root template element with text interpolation `{expr}`. | Parses the minimal source into raw syntax tokens. |
| **P1-SLICE-02** | `@mix/ast` | Minimal AST node definitions: `ComponentNode`, `ScriptBlockNode`, `ElementNode`, `TextNode`, `InterpolationNode`, `SourceSpan`. | Strongly-typed, immutable AST nodes generated with accurate spans. |
| **P1-SLICE-03** | `@mix/compiler-semantic` | Single-scope symbol binding: Identifies `count` as a reactive signal call in text interpolation. | Emits semantic descriptor with dependency bindings. |
| **P1-SLICE-04** | `@mix/compiler-codegen` | Direct-DOM emitter: Generates JS module that imports from `@mix/runtime` and calls `createRoot`, `createElement('span')`, `createTextNode()`, and `createEffect()`. | Deterministic JS code emitted matching direct DOM contract. |
| **P1-SLICE-05** | `@mix/runtime` (Reactive Core) | Implements minimal `signal`, `createEffect` (with `pendingRerun` deferred rerun), `createRoot` (with `detachedParent`), and `Owner` lifecycle. | Platform-neutral reactive core passes unit tests. |
| **P1-SLICE-06** | `@mix/runtime` (DOM Adapter) | Minimal DOM adapter: `createElement`, `createTextNode`, `setTextContent`. | Manipulates real/mock DOM nodes directly. |
| **P1-SLICE-07** | `tests/conformance` | End-to-end integration test: Compiles source string, instantiates component, asserts initial DOM, updates signal, asserts deferred DOM update, calls `dispose()`, asserts teardown. | Test runs via `node --test` and passes 100%. |

---

## 4. Phase 1 Exit Gate

Phase 1 is complete and verified only when:
1. All 12 documents in `spec/` are fully articulated and reconciled with decisions D-101 through D-111.
2. The minimal end-to-end vertical slice (`P1-SLICE-01` through `P1-SLICE-07`) passes automatically under `npm test`.
3. Zero premature Phase 2/3 features (such as CSS scoping, complex control flow, dynamic elements, components with props) are implemented outside the minimal vertical slice.
4. The human architecture authority reviews the vertical-slice results and authorizes advancement to Phase 2.
