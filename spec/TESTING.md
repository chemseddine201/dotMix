# Testing Strategy — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Testing Strategy (Reconciled Phase Gate 1)  
**Applies to:** Monorepo test suites (`tests/*`) and CI automation  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Test Architecture & Structure

The repository organizes tests into focused directories:

```text
tests/
 ├── foundation/     # Workspace topology, acyclic DAG, exact pins, zero-dependency boundary (Gate 1)
 ├── conformance/    # Syntax, parser, AST invariants, compiler diagnostic validation (Gate 2)
 ├── semantic/       # Scope analysis, symbols, .tix type projection (Gate 3)
 ├── runtime/        # Signals, memos, effects, scheduler, owner lifecycle, cleanup (Gate 4)
 ├── integration/    # End-to-end unmocked component compilation and DOM execution (Gate 5)
 └── security/       # Sanitizer boundaries, srcset parsing vectors, CSS injection tests (Gate 6)
```

---

## 2. Test Execution Harness

- **Test Runner:** Node.js native test runner (`node --test`).
- **Assertions:** `node:assert/strict`.
- **DOM Simulation:** `happy-dom` loaded strictly inside integration/runtime test files where DOM manipulation is asserted; zero exposure to compiler packages or core reactivity.
- **Deterministic Execution:** No test relies on wall-clock `setTimeout` delays. Reactive updates flush via synchronous microtasks or explicit scheduler flush handles.

---

## 3. Decision Acceptance Test Matrix

| Decision | Test Scenario | Expected Outcome |
|---|---|---|
| **D-101** | Effect writes to its own dependency | Triggers deferred rerun without recursive nesting; duplicate writes coalesce into one rerun. |
| **D-101** | Infinite cycle threshold exceeded | Scheduler detects iteration count > `maxEffectIterations` and throws `ReactiveCycleError`. |
| **D-102** | Owner teardown with active computation | Descendant computed/effect nodes transition to `DISPOSED`, unlinking observers. |
| **D-103** | `createRoot` with `detachedParent` | Inherits parent context; parent disposal does not trigger automatic root teardown. |
| **D-104** | Async resource resolution after owner disposal | Stale generation token rejects response; zero reactive updates emitted. |
| **D-105** | Dynamic element `<{~expr}>` | Evaluates `expr` exactly once; tag identity reused for closing tag; attributes compiled. |
| **D-106** | `.tix` virtual projection diagnostics | Emitted compiler diagnostics map 1:1 to original `.tix` template spans. |
| **D-107** | `srcset` candidate with embedded data URL comma | Parses data URL without splitting on internal commas per WHATWG §4.8.4.3.7. |
| **D-108** | Dynamic style with encoded semicolon (`\3b`) | Rejects or normalizes escape sequence; prevents CSS property injection. |
| **D-109 / HAA-03** | `mix-html` binding without registered authority | Throws `MixError` (`MIX_SEC_FOREIGN_TRUSTED_HTML`); rejects caller-supplied sanitizers. |
| **D-110 / HAA-02** | Keyed list with duplicate key | Complete pre-validation; atomic rejection; previous DOM intact; throws `MixError` in DEV and PROD. |
| **D-111** | HMR method replacement | Updated method reads and writes live component state through stable scope trampoline. |
