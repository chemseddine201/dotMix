# Mix / Tix — Canonical Specification Directory

**Authority:** Human Architecture Authority  
**Status:** Canonical Specifications Reconciled & Imported for Phase Gate 1  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Directory Inventory

This directory contains the 10 authoritative canonical English specifications defining the Mix/Tix compiler-native UI language and runtime contracts:

1. `LANGUAGE.md` — Syntax modes (`.mix` vs `.tix`), component structure, dynamic elements (`<{~expr}>`), delimiters, bindings.
2. `AST.md` — Abstract Syntax Tree definitions, source spans, structural expression nodes, immutability invariants.
3. `SEMANTICS.md` — Pull-Push reactivity, scheduler and deferred reruns (`D-101`), owner lifecycles (`D-102`), keyed reconciliation with strict atomic duplicate rejection policy (`D-110` / `HAA-02`).
4. `RUNTIME_API.md` — Reactive primitives, `createRoot` with `detachedParent` (`D-103`), platform-neutral cancellation (`D-104`), trusted HTML security boundary (`D-109` / `HAA-03`), renderer adapter.
5. `CSS_SCOPING.md` — Scoped CSS model, at-rule compile-time validation (`D-108`), `:global(...)` and `:deep(...)` selector scoping, runtime dynamic style validation.
6. `DIAGNOSTICS.md` — Diagnostic data structures, 1:1 bidirectional span mapping (`D-106`), canonical diagnostic code registry.
7. `SECURITY.md` — Threat model, normative WHATWG `srcset` parsing algorithm (`D-107`), application `SanitizerProvider` authority & `WeakSet` registry (`D-109` / `HAA-03`), protocol allowlists.
8. `TESTING.md` — Test suite architecture, harness requirements, decision verification test matrix (`D-101`..`D-111`).
9. `PERFORMANCE.md` — Direct DOM invariants, fine-grained reactivity benchmarks, reproducible measurement discipline.
10. `COMPATIBILITY.md` — Execution environment baselines, Node.js 26 Active LTS baseline with `node: ">=22.12.0"`, pure ESM, ES2023, browser SPA platform target.

---

## 2. Upstream Specification Gap Notice: Items 11 & 12

Upstream `v3.2.1` Items 11 & 12 were absent from the pre-initialization commit history (`MIX_SPEC_v3.2.2.md` §0.3). In accordance with the **Elephant–Goldfish Rule** and **`HAA-01`**, Items 11 & 12 are formally recorded as **Unratified / Absent Upstream**. Agents are strictly forbidden from inventing syntax, algorithms, or APIs to fill these gaps.
