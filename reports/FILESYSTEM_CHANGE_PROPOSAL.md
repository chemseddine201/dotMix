# Filesystem Change Proposal — Preserve, Replace, Archive, and Remove

**Audit Date:** 2026-11-08  
**Revised:** 2026-11-08 (Incorporating Human Architecture Authority Review)  
**Auditor:** Antigravity (AI Coding Assistant)  
**Authority:** Human Architecture Authority  
**Task Reference:** Task 1 & Task 8 (`agent/INITIALIZATION_AGENT_TASK.md`)  
**Status:** Proposal Only — No Destructive Cleanup Authorized

---

## 1. Executive Summary & Mandatory Safeguards

In strict accordance with the Human Architecture Authority's instructions:

1. **NO FILESYSTEM CLEANUP IS PERFORMED YET.**
   The unstaged deletions currently visible in Git status are not committed or purged. Current working directory and committed repository history are different.
2. **Pre-Initialization State Preserved:**
   The entire pre-initialization repository state (commit `b95110ec04a564cdea9feb7dfd3b635f3de18803`) has been permanently preserved through both a dedicated archival branch and a Git tag:
   - **Branch:** `archive/pre-initialization-b95110e`
   - **Tag:** `archive/pre-initialization-b95110e`
3. **`AGENTS.md` Kept Permanently at Root:**
   Under the **Elephant–Goldfish rule**, `AGENTS.md` is the agent's constitution. It is not archived; it remains permanently at the repository root to govern all future agent sessions.
4. **Historical Work Preserved:**
   No router, CLI, tests, or historical implementations will be deleted until their preservation against the archive has been fully verified.
5. **Separate Commit Discipline:**
   The initialization audit reports and governance files will be committed separately without accidentally committing the unstaged deletions.

---

## 2. Exhaustive File Categorization Ledger

### 2.1 Files to PRESERVE PERMANENTLY (Active Constitution & Governance)

| File Path | Authority & Role | Classification |
|---|---|---|
| `AGENTS.md` | **Master Agent Constitution** (Elephant–Goldfish Rule) | **PRESERVE PERMANENTLY AT ROOT** |
| `.gitignore` | Root repository ignore configuration | Preserve |
| `AGENT_HANDOFF.md` | Initialization assignment scope boundary | Preserve |
| `README.md` | Core project definition and phase gate warning | Preserve |
| `agent/INITIALIZATION_AGENT_TASK.md` | Assignment instructions for the initialization audit | Preserve |
| `governance/PROJECT_CHARTER.md` | Mission, principles, identity, non-goals | Preserve |
| `governance/ARCHITECTURE_GUARDRAILS.md` | Technical guardrails A through J | Preserve |
| `governance/DECISION_REGISTER.md` | Accepted decisions D-101 through D-111 | Preserve |
| `governance/PHASE_GATES.md` | Gate 0 through Gate 9 acceptance criteria | Preserve |
| `reports/README.md` | Reporting guidelines | Preserve |
| `spec/README.md` | Canonical specification import guidelines | Preserve |
| `reports/INITIALIZATION_AUDIT.md` | Audit Report 1 | Preserve |
| `reports/CANONICAL_SPEC_INVENTORY.md` | Audit Report 2 | Preserve |
| `reports/DECISION_RECONCILIATION.md` | Audit Report 3 | Preserve |
| `reports/SHOWCASE_COMPLIANCE_AUDIT.md` | Audit Report 4 | Preserve |
| `reports/CONTRADICTIONS_AND_GAPS.md` | Audit Report 5 | Preserve |
| `reports/PROPOSED_ARCHITECTURE.md` | Audit Report 6 | Preserve |
| `reports/TOOLCHAIN_RECOMMENDATION.md` | Audit Report 7 | Preserve |
| `reports/IMPLEMENTATION_PHASE_PLAN.md` | Audit Report 8 | Preserve |
| `reports/FILESYSTEM_CHANGE_PROPOSAL.md` | Audit Report 9 | Preserve |

---

### 2.2 Packages to Structure (Gate 1 Foundation)

| Package Path | Action | Role |
|---|---|---|
| `packages/diagnostics/` | **CREATE NEW** | **Dedicated leaf package:** `MixError`, `DiagnosticCode`, `DiagnosticSeverity`, source spans. |
| `packages/ast/` | Configure | Syntax tree node interfaces, constructors, `walk` traversal. |
| `packages/compiler-frontend/` | Configure | Lexer, balanced expression scanner, template parser. |
| `packages/compiler-semantic/` | Configure | Scopes, symbols, `.tix.ts` virtual projection, TS Compiler adapter. |
| `packages/compiler-css/` | Configure | Component selector scoping, `@import` rejection. |
| `packages/compiler-codegen/` | Configure | Direct DOM JavaScript emitter. |
| `packages/runtime/` | Configure | Pure reactive kernel, 5-state scheduler, DOM adapter, security boundary. |
| `packages/router/` | **DEFER** | Preserved in `archive/pre-initialization-b95110e`; deferred from active build until post-Gate 5. |

---

### 2.3 Files to REPLACE (Upon Explicit Gate 1 Authorization)

| File Path | Current State in HEAD | Proposed Replacement Action in Gate 1 |
|---|---|---|
| `package.json` | Old engine bounds, TS 7.0 | Clean manifest with Node 26 Active LTS baseline, TS 6.0.3 evaluation, workspaces. |
| `package-lock.json` | Tied to TS 7.0 | Cleanly generated after manifest and peer resolution verification. |
| `tsconfig.base.json` | Outdated references | Strict, `NodeNext`, composite project configuration. |
| `tsconfig.json` | Outdated workspace references | Clean project references pointing to active packages. |
| `eslint.config.js` | TS linting stripped | Flat config integrating `typescript-eslint` with TS 6.0.3. |
| `.github/workflows/ci.yml` | Node 24/26 matrix | Matrix testing Node 22, 24, and 26. |
| `spec/LANGUAGE.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/AST.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/SEMANTICS.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/RUNTIME_API.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/CSS_SCOPING.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/DIAGNOSTICS.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/SECURITY.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/TESTING.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/PERFORMANCE.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `spec/COMPATIBILITY.md` | Synthetic agent draft | Replaced with imported canonical v3.2.1 text. |
| `tests/conformance/vertical-slice.test.mjs` | Mocked DOM test | Replaced with unmocked integration test in Gate 5. |

---

### 2.4 Historical Artifacts Preserved in Archival Branch
All pre-initialization files (including `spec/MIX_SPEC_v3.2.2.md`, historical reports `reports/phase-*.md`, `bin/mix.mjs`, `benchmarks/run-benchmarks.mjs`, `scripts/verify-phase0.mjs`, and `examples/showcase/`) are **safely and immutably preserved in Git history on branch `archive/pre-initialization-b95110e`**.

---

## 3. Safe Execution Protocol for Gate 1

When Gate 1 is authorized by the Human Architecture Authority:
1. **Verification of Archive:** Ensure `git branch -a` confirms `archive/pre-initialization-b95110e` is intact.
2. **Selective Staging:** Stage only the new governance files, root `AGENTS.md`, and `reports/*.md`.
3. **Commit Initialization State:** Commit the initialization audit and constitution cleanly to `master`.
4. **Scaffold Packages:** Initialize `@mix/diagnostics` and clean package skeletons.
5. **Import Canonical Specs:** Import ratified v3.2.1 specifications into `spec/` with `spec/SOURCE_PROVENANCE.md`.
6. **Generate Clean Lockfile:** Run `npm install` with pinned `typescript@6.0.3` and verified `typescript-eslint` peers.
