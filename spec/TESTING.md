# Testing Strategy — Mix & Tix

**Status:** Canonical Testing Strategy (Reconciled Phase 1)  
**Applies to:** Monorepo test suites (`tests/*`) and CI automation

---

## 1. Test Architecture & Structure

The repository organizes tests into four focused directories:

```text
tests/
 ├── conformance/    # Syntax, parser, AST invariants, compiler diagnostic validation
 ├── runtime/        # Signals, memos, effects, scheduler, owner lifecycle, cleanup
 ├── integration/    # End-to-end component compilation, DOM rendering, hydration
 └── security/       # Sanitizer boundaries, srcset parsing vectors, CSS injection tests
```

---

## 2. Test Execution Harness

- **Test Runner:** Node.js native test runner (`node --test`).
- **Assertions:** `node:assert/strict`.
- **DOM Simulation:** `happy-dom` loaded strictly inside integration/runtime test files where DOM manipulation is asserted.
- **Deterministic Execution:** No test relies on wall-clock `setTimeout` delays. Reactive updates flush via synchronous microtasks or explicit scheduler flush handles.

---

## 3. Decision Acceptance Test Matrix (Phase 1)

| Decision | Test Scenario | Expected Outcome |
|---|---|---|
| **D-101** | Effect writes to its own dependency | Triggers deferred rerun without recursive nesting; duplicate writes coalesce. |
| **D-101** | Infinite cycle threshold exceeded | Scheduler detects iteration count > `maxEffectIterations` and throws `ReactiveCycleError`. |
| **D-102** | Owner teardown with active computation | Descendant computed/effect nodes transition to `DISPOSED`, unlinking observers. |
| **D-103** | `createRoot` with `detachedParent` | Inherits parent context; parent disposal does not trigger automatic root teardown. |
| **D-104** | Async resource resolution after owner disposal | Stale generation token rejects response; zero reactive updates emitted. |
| **D-105** | Dynamic element `<{~expr}>` | Evaluates `expr` exactly once; tag identity reused for closing tag. |
| **D-107** | `srcset` candidate with embedded data URL comma | Parses data URL without splitting on internal commas. |
| **D-108** | Dynamic style with encoded semicolon (`\3b`) | Reject or normalize escape sequence; prevents CSS property injection. |
| **D-109** | `mix-html` binding without `SanitizerProvider` | Throws runtime `MixSecurityError`. |
| **D-110** | Keyed list with duplicate key | Emits `MIX_ERR_DUPLICATE_KEY`; retains first item; cleanly disposes duplicate owner. |
| **D-111** | HMR method replacement | Updated method reads and writes live component state without re-instantiation. |
