# Decision Register — Accepted Baseline and Change Control

This register records constraints known to be accepted in the project's current baseline. The agent must compare them against the repository's actual canonical decision documents and report any mismatch. This register does not authorize inventing missing details.

| ID | Accepted direction | Required verification |
|---|---|---|
| D-101 | Deferred rerun; `pendingRerun` independent of computation state; coalesced notifications; non-nested effect execution; configurable scheduler iteration safety ceiling and deterministic cycle error. | Verify exact scheduler algorithm, ceiling semantics, error contract, and tests. |
| D-102 | Owner lifecycle state is separate from computation state. | Verify all state transitions, disposal, unlinking, and scheduling behavior—not only type declarations. |
| D-103 | Preserve `createRoot` with optional `detachedParent?: Owner \| null`. | Verify context inheritance is distinct from automatic disposal ownership. |
| D-104 | Platform-neutral cancellation token in core; adapters may bridge to platform cancellation; generation checks prevent stale results. | Verify token ownership, request replacement, owner disposal, and stale Promise behavior. |
| D-105 | Preserve dynamic element syntax `<{~expr}>...</{~expr}>`; resolve identity once per element instance. | Verify grammar, parser boundaries, and runtime/codegen semantics. |
| D-106 | `.tix` uses TypeScript Compiler API for type verification; no competing type checker. | Verify props/ref/generic model, source mapping, and API isolation. |
| D-107 | `srcset` handling must follow the normative WHATWG algorithm or a reviewed implementation demonstrably conforming to it. | Verify algorithm provenance and meaningful conformance vectors, including data URLs and commas. |
| D-108 | Dynamic CSS has compile-time and runtime validation, including escapes and URL policy. | Verify values and context handling; property allowlist alone is insufficient. |
| D-109 | Explicit trusted HTML boundary and defined SanitizerProvider/Trusted Types integration (ratified by `HAA-03`). | Verify sanitizer trust requirements, application `SanitizerProvider` authority, private `WeakSet` registry, context rejection, and prohibition of caller-supplied sanitizers. |
| D-110 | No surrogate fallback keys; deterministic duplicate-key diagnostics and atomic behavior (ratified by `HAA-02`, Option A Strict). | Verify pre-reconciliation validation, atomic rejection, DOM preservation, zero allocations, and synchronous `MixError` throwing in both DEV and PROD. |
| D-111 | HMR method dispatch uses stable component scope/context; lexical closures must not be assumed rebindable. | Verify updated methods access live component state through the stable scope contract. |

---

## Ratified Human Architecture Authority Decisions (`HAA-01` through `HAA-05`)

Ratified by Human Architecture Authority on 2026-11-08 for Phase Gate 1 authorization:

### 1. `HAA-01` — Canonical Specification Baseline & Provenance (`spec/*.md`)
- Reconcile archived pre-initialization specifications from `archive/pre-initialization-b95110e` (`b95110ec04a564cdea9feb7dfd3b635f3de18803`, specifically `spec/MIX_SPEC_v3.2.2.md` from commit `74dc8f9`, historical `DECISIONS.md`, and prior `spec/*.md`) **strictly subordinate to** `governance/PROJECT_CHARTER.md`, `governance/ARCHITECTURE_GUARDRAILS.md`, `governance/DECISION_REGISTER.md`, and `HAA-01`..`HAA-05` into 10 authoritative English specification files under `spec/`:
  `LANGUAGE.md`, `AST.md`, `SEMANTICS.md`, `RUNTIME_API.md`, `CSS_SCOPING.md`, `DIAGNOSTICS.md`, `SECURITY.md`, `TESTING.md`, `PERFORMANCE.md`, `COMPATIBILITY.md`.
- Maintain `spec/SOURCE_PROVENANCE.md` recording Git commits, SHA-256 hashes, dates, and governance overrides applied (`D-101`, `D-105`, `D-109`, `D-110`).
- **Strict Non-Fabrication Rule:** Upstream `v3.2.1` Items 11 & 12 (`MIX_SPEC_v3.2.2.md` §0.3) were absent from repository history and are explicitly documented as **Unratified / Absent Upstream**.

### 2. `HAA-02` — `D-110` Atomic Duplicate-Update Rejection Policy (Option A — Strict)
- Ratified policy for keyed collection reconciliation:
  1. Validate complete incoming collection of keys upfront prior to reconciliation diffing.
  2. Detect duplicate keys deterministically.
  3. Reject invalid update atomically.
  4. Preserve previously rendered DOM collection and child owners intact.
  5. Allocate zero DOM nodes or owner state for items in a rejected update.
  6. **Option A (Strict):** Emit and **throw** deterministic `MixError` (`MIX_ERR_DUPLICATE_KEY`) synchronously in **both DEV and PROD**, while ensuring reactive scheduler/queue invariants remain uncorrupted (`D-101`).

### 3. `HAA-03` — `D-109` Trusted HTML Public Boundary & Sanitizer Authority
- Root application configures sanitization authority via `setSanitizerProvider(provider)`.
- `createTrustedHtml(dirtyHtml)` invokes configured `SanitizerProvider` (and native W3C Trusted Types `window.trustedTypes` where supported).
- Authentic trusted HTML wrappers are registered in a private module-scoped `WeakSet<object>`.
- HTML sinks accept only instances present in that `WeakSet`; caller-supplied sanitizer callbacks (`createTrustedHtml(dirty, fn)`) are permanently prohibited.

### 4. `HAA-04` — Package Topology & `@mix/runtime` Zero-Dependency Boundary (`NEW-F-03`)
- Introduce `@mix/diagnostics` as the zero-dependency leaf package for error types and diagnostic codes.
- `@mix/ast` holds template AST node interfaces, spans, and structural self-contained ESTree-compatible expression node interfaces (no external `@types/*` leakage in `.d.ts` outputs).
- `@mix/runtime` declares `"dependencies": {}` and uses **`import type` ONLY** when referencing `@mix/diagnostics` types (enforced with `"verbatimModuleSyntax": true` so `tsc -b` completely erases all `@mix/diagnostics` imports at compile time, requiring zero bundler). `@mix/runtime` defines its own small, self-contained runtime `MixError` class and code constants, verified for parity against `@mix/diagnostics` by Gate 1 tests.
- `@mix/router` remains deferred (no package scaffolded in Gate 1).

### 5. `HAA-05` — Toolchain & Compiler Parser Matrix (`NEW-F-01` & `NEW-F-02`)
- **Acorn TypeScript Fix (`NEW-F-01`):** Use verified npm release `@sveltejs/acorn-typescript@1.0.13` (acorn `^8.9.0` peer).
- **Linter Lockstep Fix (`NEW-F-02`):** Pair `"eslint": "9.39.5"` with `"@eslint/js": "9.39.5"`.
- **Exact Verified Version Pins (NO `^` or `~` ranges):**
  - Root `engines`: `{ "node": ">=22.12.0", "npm": ">=10.0.0" }` (Node 26 Active LTS baseline; Node 22 host support).
  - Root `devDependencies`:
    `@eslint/js@9.39.5`, `@types/node@26.0.0`, `eslint@9.39.5`, `happy-dom@15.11.7`, `typescript@6.0.3`, `typescript-eslint@8.72.1`.
  - Workspace package dependencies:
    - `@mix/diagnostics`: `{}`
    - `@mix/ast`: `{ "@mix/diagnostics": "0.1.0" }`
    - `@mix/compiler-frontend`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "acorn": "8.14.0", "@sveltejs/acorn-typescript": "1.0.13" }`
    - `@mix/compiler-semantic`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "typescript": "6.0.3" }`
    - `@mix/compiler-css`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "css-tree": "3.1.0" }`
    - `@mix/compiler-codegen`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "@mix/compiler-semantic": "0.1.0", "@mix/compiler-css": "0.1.0" }`
    - `@mix/runtime`: `{}` (zero runtime dependencies; `@mix/diagnostics` in `devDependencies` / `references` for `import type` erasure only).

---

## Change-control protocol

For any conflict:
1. Quote the conflicting canonical clauses.
2. Identify affected decision IDs and packages.
3. Explain behavioral and compatibility consequences.
4. Propose the smallest viable resolution.
5. STOP for human approval.

Do not mark a decision "closed" merely because a document mentions it. Require implementation-level tests when the relevant phase is implemented.