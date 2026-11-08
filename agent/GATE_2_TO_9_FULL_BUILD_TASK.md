# Agent Assignment — Phase Gates 2 through 9: Full Framework Implementation, Verification & Showcase

**Authority:** Human Architecture Authority  
**Approved Phase Scope:** **Phase Gates 2 through 9 (Complete Framework Creation, Testing & Example Usage)**  
**Status:** **EXPLICITLY APPROVED BY HUMAN ARCHITECTURE AUTHORITY (`2026-11-08`)**

---

## 1. Authorized Scope Progression (`governance/PHASE_GATES.md`)

1. **Gate 1 Audit Remediation (`G1-F-01`..`G1-F-06`):**
   - Reconcile `spec/LANGUAGE.md` (`R-SYN-01..03`), `spec/AST.md` (`ComponentCallNode`), `spec/SEMANTICS.md` (`{#each}`/`{#if}`), `spec/DIAGNOSTICS.md` (`SourceMapSpanTable`), `spec/SOURCE_PROVENANCE.md` (exact Git blob SHAs), `packages/runtime/src/typecheck/index.ts` (`NoInfer<T>`), and `tests/foundation/foundation.test.mjs`.
2. **Gate 2 — Minimal Language Frontend (`@mix/ast` & `@mix/compiler-frontend`):**
   - Immutable AST nodes (`ComponentNode`, `ElementNode`, `ComponentCallNode`, `DynamicElementNode`, `IfBlockNode`, `EachBlockNode`, `InterpolationNode`, `TextNode`, `CommentNode`, `AttributeNode`, structural `ESTreeNode`), deep `Object.freeze`, `walk`.
   - Acorn + `@sveltejs/acorn-typescript@1.0.13` `parseExpressionAt` with `preserveParens: true` (`R-SYN-01`/`R-SYN-01a`), token-sequence comparison for `<{~expr}>...</{~expr}>` (`D-105`, `R-SYN-02`/`R-SYN-03`), template parser, and `tests/conformance/parser-frontend.test.mjs`.
3. **Gate 3 — Semantic Analysis & `.tix` Projection (`@mix/compiler-semantic`):**
   - ESTree-based lexical scope and symbol resolution (zero regexes), reactive binding classification, `.tix.ts` virtual TypeScript projection with `VerifyProps`/`VerifyRef` (`NoInfer<T>`), `SourceMapSpanTable` (`verbatim | origin | internal` with 100% byte coverage `R-SP-05`), TypeScript `6.0.3` Compiler API adapter, and `tests/semantic/semantic-projection.test.mjs`.
4. **Gate 4 — Pure Platform-Neutral Reactive Runtime (`@mix/runtime/core` & `@mix/runtime/platform`):**
   - 5-state Push-Pull reactive kernel (`Signal`, `Computed`, `Effect`), independent `pendingRerun` scheduler (`D-101`), decoupled `Owner` lifecycle (`D-102`), `createRoot` with `detachedParent` (`D-103`), generation-checked `CancellationToken` & `createResource` (`D-104`), `toAbortSignal`/`fromAbortSignal`, and `tests/runtime/reactivity-core.test.mjs`.
5. **Gate 5 — Direct DOM Codegen & Unmocked Vertical Slice (`@mix/compiler-codegen` & `@mix/runtime/dom`):**
   - Surgical DOM primitives (`createElement`, `createTextNode`, `setText`, `setAttribute`, `addEventListener`, `bindRef`, `createConditional`, `createDynamicElement`, `mountComponent`), direct DOM JS code emitter, and unmocked vertical-slice integration test (`tests/integration/vertical-slice.test.mjs`).
6. **Gate 6 — Scoped CSS & Security Boundaries (`@mix/compiler-css` & `@mix/runtime/security`):**
   - `css-tree@3.1.0` scoped CSS compiler (`:global(...)`, `:deep(...)`, `@import`/`@charset` rejection, `:host` rejection), normative WHATWG `srcset` parser (`D-107`), dynamic CSS property & hex-escape validator (`D-108`), `setSanitizerProvider` + `createTrustedHtml` + private `WeakSet` (`D-109` / `HAA-03`), and `tests/security/css-and-security.test.mjs`.
7. **Gate 7 — Keyed Collection Reconciliation (`@mix/runtime/dom` — `D-110` / `HAA-02` Option A):**
   - Upfront complete collection key validation, atomic duplicate-update rejection preserving previous DOM with zero allocations and synchronous `MixError(MIX_ERR_DUPLICATE_KEY)` throw in DEV and PROD, reactive `itemSignal.set()` / `indexSignal.set()`, `O(N log N)` Longest Increasing Subsequence (LIS) minimal DOM moves, and `tests/runtime/keyed-reconcile.test.mjs`.
8. **Gate 8 — Full `.tix` Verification & HMR (`D-106`, `D-111`):**
   - End-to-end TypeScript `6.0.3` Compiler API verification of `.tix` components, `.tix` -> `.tix.js` import rewriting (`R-RS-01..05`), HMR stable scope & method trampolines (`D-111`), and `tests/semantic/tix-verification-and-hmr.test.mjs`.
9. **Gate 9 — Hardening, Real Compiler Showcase & Example Usage:**
   - Complete `examples/showcase/` compiled through the real Mix/Tix compiler pipeline, `tests/integration/showcase-e2e.test.mjs`, and comprehensive example usage documentation.
