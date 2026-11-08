# Agent Assignment — Phase Gate 1: Foundation & Canonical Specification Import

**Authority:** Human Architecture Authority  
**Approved Phase Scope:** **Phase Gate 1 — Foundation ONLY** (`governance/PHASE_GATES.md` §Gate 1)  
**Status:** **PHASE GATE 1 IS EXPLICITLY APPROVED** (Gates 2 through 9 remain **NOT AUTHORIZED**)

---

## 1. Mandatory Reading Order (Elephant–Goldfish Rule)

Before executing any command or editing any file, read in this exact order:
1. `AGENTS.md`
2. `README.md`
3. `governance/PROJECT_CHARTER.md`
4. `governance/ARCHITECTURE_GUARDRAILS.md`
5. `governance/DECISION_REGISTER.md`
6. `governance/PHASE_GATES.md`
7. `reports/PROPOSED_ARCHITECTURE.md`, `reports/TOOLCHAIN_RECOMMENDATION.md`, `reports/CONTRADICTIONS_AND_GAPS.md`, and `reports/FILESYSTEM_CHANGE_PROPOSAL.md`

---

## 2. Ratified Human Architecture Authority Decisions (`HAA-01`..`HAA-05`)

The Human Architecture Authority hereby ratifies the following binding decisions. You must record these durably in `governance/DECISION_REGISTER.md` and reconcile all affected `reports/*.md` and `spec/*.md` documents so zero ambiguity remains for future sessions:

1. **`HAA-01` — Canonical Specification Baseline & Provenance (`spec/*.md`):**
   - Reconcile the archived pre-initialization specifications from `archive/pre-initialization-b95110e` (`b95110ec04a564cdea9feb7dfd3b635f3de18803`, specifically `spec/MIX_SPEC_v3.2.2.md` from commit `74dc8f9`, historical `DECISIONS.md`, and prior `spec/*.md`) **strictly subordinate to** `governance/PROJECT_CHARTER.md`, `governance/ARCHITECTURE_GUARDRAILS.md`, `governance/DECISION_REGISTER.md`, and `HAA-01`..`HAA-05` into the 10 authoritative English specification files under `spec/`:
     `LANGUAGE.md`, `AST.md`, `SEMANTICS.md`, `RUNTIME_API.md`, `CSS_SCOPING.md`, `DIAGNOSTICS.md`, `SECURITY.md`, `TESTING.md`, `PERFORMANCE.md`, `COMPATIBILITY.md`.
   - Create `spec/SOURCE_PROVENANCE.md` recording the source Git commits/SHA-256 hashes, date, governance overrides applied (`D-101` independent `pendingRerun` over `R-RX-04`; `D-105` `<{~expr}>`; `D-109` `setSanitizerProvider` + `WeakSet`; `D-110` Option A strict atomic rejection over `R-KEY-03` surrogate keys), and explicit provenance status.
   - **Strict Non-Fabrication Rule:** Explicitly document in `spec/SOURCE_PROVENANCE.md` and `spec/README.md` that upstream `v3.2.1` Items 11 & 12 (`MIX_SPEC_v3.2.2.md` §0.3) were absent from repository history and are marked **Unratified / Absent Upstream**—do **not** invent contents for Items 11 & 12, and do **not** invent unapproved template syntax where historical drafts conflicted.

2. **`HAA-02` — `D-110` Atomic Duplicate-Update Rejection Policy (Option A — Strict):**
   - Ratified policy for keyed collection reconciliation:
     1. Validate the complete incoming collection of keys upfront prior to reconciliation diffing.
     2. Detect duplicate keys deterministically.
     3. Reject the invalid update atomically.
     4. Preserve the previously rendered DOM collection and child owners intact.
     5. Allocate zero DOM nodes or owner state for items in a rejected update.
     6. **Option A (Strict):** Emit and **throw** deterministic `MixError` (`MIX_ERR_DUPLICATE_KEY`) synchronously in **both DEV and PROD**, while ensuring reactive scheduler/queue invariants remain uncorrupted (`D-101`).

3. **`HAA-03` — `D-109` Trusted HTML Public Boundary & Sanitizer Authority:**
   - Root application configures sanitization authority via `setSanitizerProvider(provider)`.
   - `createTrustedHtml(dirtyHtml)` invokes the configured `SanitizerProvider` (and native W3C Trusted Types `window.trustedTypes` where supported).
   - Authentic trusted HTML wrappers are registered in a private module-scoped `WeakSet<object>`.
   - HTML sinks accept only instances present in that `WeakSet`; caller-supplied sanitizer callbacks (`createTrustedHtml(dirty, fn)`) are permanently prohibited.

4. **`HAA-04` — Package Topology & `@mix/runtime` Zero-Dependency Boundary (Final Review `NEW-F-03` Fix):**
   - Introduce `@mix/diagnostics` as the zero-dependency leaf package.
   - `@mix/ast` holds template AST node interfaces, spans, and **self-contained structural ESTree-compatible expression node interfaces** (do not leak external `@types/*` imports into `@mix/ast` `.d.ts` output).
   - `@mix/runtime` declares `"dependencies": {}` and uses **`import type` ONLY** when referencing `@mix/diagnostics` types (enforced with `"verbatimModuleSyntax": true` so `tsc -b` completely erases all `@mix/diagnostics` imports at compile time, requiring **zero bundler**). `@mix/runtime` defines its own small, self-contained runtime `MixError` class and code constants, verified for parity against `@mix/diagnostics` by Gate 1 tests.
   - `@mix/router` remains **deferred** (do not create `packages/router/`).

5. **`HAA-05` — Toolchain & Compiler Parser Matrix (Final Review `NEW-F-01` & `NEW-F-02` Fixes):**
   - **CRITICAL FIX (`NEW-F-01`):** `@sveltejs/acorn-typescript@1.4.1` **does not exist on npm (`E404`)**. Replace every occurrence of `1.4.1` across reports and manifests with verified **`@sveltejs/acorn-typescript@1.0.13`** (`peerDependencies: { acorn: "^8.9.0" }`).
   - **LINTER LOCKSTEP FIX (`NEW-F-02`):** Replace `"eslint": "9.19.0"` with **`"eslint": "9.39.5"`** in lockstep with `"@eslint/js": "9.39.5"`.
   - **Exact Verified Version Pins (NO `^` or `~` ranges anywhere):**
     - Root `engines`: `{ "node": ">=22.12.0", "npm": ">=10.0.0" }` (Node 26 Active LTS primary baseline; CI matrix across Node 22, 24, 26).
     - Root `devDependencies`:
       - `"@eslint/js": "9.39.5"`
       - `"@types/node": "26.0.0"`
       - `"eslint": "9.39.5"`
       - `"happy-dom": "15.11.7"`
       - `"typescript": "6.0.3"`
       - `"typescript-eslint": "8.72.1"`
     - Workspace package `dependencies` (exact pins only):
       - `@mix/diagnostics`: `{}`
       - `@mix/ast`: `{ "@mix/diagnostics": "0.1.0" }`
       - `@mix/compiler-frontend`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "acorn": "8.14.0", "@sveltejs/acorn-typescript": "1.0.13" }`
       - `@mix/compiler-semantic`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "typescript": "6.0.3" }`
       - `@mix/compiler-css`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "css-tree": "3.1.0" }`
       - `@mix/compiler-codegen`: `{ "@mix/diagnostics": "0.1.0", "@mix/ast": "0.1.0", "@mix/compiler-semantic": "0.1.0", "@mix/compiler-css": "0.1.0" }`
       - `@mix/runtime`: `{}` (zero runtime dependencies; `@mix/diagnostics` allowed only in `devDependencies` / TS `references` for `import type` erasure).

---

## 3. Authorized Gate 1 Deliverables & Execution Steps

1. **Verify Archive Integrity First:**
   - Confirm branch and tag `archive/pre-initialization-b95110e` resolve to `b95110ec04a564cdea9feb7dfd3b635f3de18803` before staging or removing the remaining `122` legacy pre-initialization deletions.
2. **Persist Task Governance & Final Review Corrections (`NEW-F-01`..`NEW-F-05`):**
   - Save this directive to `agent/GATE_1_FOUNDATION_TASK.md` and update `AGENT_HANDOFF.md` to reflect Gate 1 authorization and stop conditions.
   - Update `governance/DECISION_REGISTER.md` with the ratified `HAA-01`..`HAA-05` resolutions.
   - Reconcile `reports/TOOLCHAIN_RECOMMENDATION.md`, `reports/PROPOSED_ARCHITECTURE.md`, `reports/CONTRADICTIONS_AND_GAPS.md`, `reports/DECISION_RECONCILIATION.md` (fixing minor `b95110e` symbol/file attributions), `reports/INITIALIZATION_AUDIT.md`, and `reports/INDEPENDENT_TECHNICAL_REVIEW.md` (resolving its unstaged modification and labeling it accurately).
3. **Import Reconciled Canonical Specifications (`spec/*.md` + `spec/SOURCE_PROVENANCE.md`):**
   - Populate all 10 English canonical specification documents in `spec/` plus `spec/SOURCE_PROVENANCE.md` per `HAA-01`. Ensure zero placeholder stubs remain and missing upstream `v3.2.1` Items 11 & 12 are transparently documented.
4. **Configure Root Workspace, TypeScript, Linting, and CI:**
   - Create clean root `package.json` (`"type": "module"`, `"workspaces": ["packages/*"]`, exact pins, `"build": "tsc -b"`, `"lint": "eslint ."`, `"test": "node --test tests/**/*.test.mjs"`).
   - Create `tsconfig.base.json` (`"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"verbatimModuleSyntax": true`, `"erasableSyntaxOnly": true`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2023"`, `"composite": true`, `"declaration": true`, `"declarationMap": true`, `"sourceMap": true`) and root `tsconfig.json` with project references across the 7 active packages.
   - Create `eslint.config.js` using `@eslint/js` + `typescript-eslint` across `packages/**/*.ts` and `tests/**/*.mjs`, including architectural `no-restricted-imports` rules forbidding `@mix/runtime` in compiler packages and forbidding DOM globals (`Node`, `HTMLElement`, `AbortSignal`, `window`, `document`) in `@mix/runtime` core entrypoints.
   - Create `.github/workflows/ci.yml` testing Node `22`, `24`, and `26` (`npm ci`, `npm run build`, `npm run lint`, `npm test`).
5. **Scaffold Clean Package Skeletons Only (Strictly Gate 1 — NO Gate 2+ Implementation):**
   - Create minimal compilable TypeScript entry-point skeletons (`package.json`, `tsconfig.json`, `src/index.ts`, plus `@mix/runtime` subpath skeletons `./core`, `./dom`, `./platform`, `./security`, `./typecheck` and shared diagnostic error/code types in `@mix/diagnostics` vs `import type` + self-contained `MixError` in `@mix/runtime`).
   - **Scope Enclosure Warning (`AGENTS.md §4`):** Do **NOT** implement the lexer/parser (Gate 2), semantic analyzer/`.tix` projection (Gate 3), reactive signal/scheduler engine (Gate 4), codegen vertical slice (Gate 5), CSS/security parsers (Gate 6), or LIS reconciler (Gate 7). Export typed skeleton signatures or `MixError` not-yet-implemented stubs where needed so `tsc -b` succeeds cleanly without smuggling future-gate logic into Gate 1.
6. **Install Locked Dependencies & Verify Reproducibility:**
   - Run `npm install` to generate a clean `package-lock.json`, then run `npm ci` to prove clean reproducible lockfile installation with zero `ERESOLVE` or peer warnings.
7. **Write Unmocked Gate 1 Foundation Verification Tests (`tests/foundation/`):**
   - Using `node:test` and `node:assert/strict`, test:
     1. Workspace package graph is strictly acyclic (DAG).
     2. Zero compiler/AST packages depend on `@mix/runtime`; `@mix/diagnostics` has zero dependencies; `@mix/router` is absent.
     3. `@mix/runtime/package.json` has `"dependencies": {}` AND built `packages/runtime/dist/**/*.js` files contain **zero** runtime `import` / `require` statements targeting `@mix/diagnostics` or any external package.
     4. `@mix/runtime`'s self-contained `MixError` and diagnostic code constants match `@mix/diagnostics`.
     5. Every dependency across root and `packages/*/package.json` uses exact version pins (no `^`, `~`, `*`, or `>=`).
     6. All 10 `spec/*.md` files + `spec/SOURCE_PROVENANCE.md` exist, are non-empty, and contain zero placeholder stub headers.

---

## 4. Gate 1 Acceptance Criteria & Mandatory Stop Condition

Before reporting completion, verify all of the following pass with exit code `0`:
1. `git rev-parse archive/pre-initialization-b95110e` equals `b95110ec04a564cdea9feb7dfd3b635f3de18803`.
2. `npm ci` succeeds cleanly from `package-lock.json`.
3. `npm run build` (`tsc -b`) compiles all 7 workspace skeletons cleanly.
4. `npm run lint` (`eslint .`) passes with TypeScript rules active.
5. `npm test` passes all Gate 1 foundation tests.
6. `git status` is completely clean after committing Gate 1 deliverables on `master`.

**MANDATORY STOP:** Immediately after committing Gate 1 and verifying a clean working tree, output your Gate 1 Completion Report and **STOP**. Do **not** begin Gate 2 (`@mix/ast` / `@mix/compiler-frontend` implementation) without explicit written Gate 2 approval from the Human Architecture Authority.
