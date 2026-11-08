# Contradictions, Gaps & Architectural Risk Register

**Audit Date:** 2026-11-08  
**Revised:** 2026-11-08 (Incorporating Human Architecture Authority Review)  
**Auditor:** Antigravity (AI Coding Assistant)  
**Authority:** Human Architecture Authority  
**Task Reference:** Task 5 (`agent/INITIALIZATION_AGENT_TASK.md`)  
**Status:** Audit Reconciled — Technical Remediation Separated from Human Architecture Decisions

---

## 1. Executive Summary

This register separates **technical implementation remediation** from **decisions requiring explicit Human Architecture Authority approval**.

### Clarification of Authority Scope
Earlier drafts classified broad technical fixes as requiring human approval. In alignment with governance guidelines:
- Technical implementation remediation within accepted guardrails is handled during engineering phases.
- Explicit human approval is reserved strictly for:
  1. **Canonical Baseline Ratification:** Supplying or approving the canonical v3.2.1 language specification.
  2. **D-110 Duplicate-Update Policy:** Approving the atomic rejection policy for collections with duplicate keys.
  3. **Package Topology Ratification:** Approving the concrete monorepo package structure with `@mix/diagnostics` as a dedicated leaf package.
  4. **Toolchain Matrix Approval:** Approving the tested compatibility matrix (Node 26 primary baseline, Node 24/22 compatibility, TypeScript 6.0.3 evaluation, and exact pins).

---

## 2. Issues Breakdown: What Actually Needs Approval vs Technical Remediation

| Issue ID | Category | Scope Description | What Actually Needs Approval / Technical Action | Classification |
|---|---|---|---|---|
| **ISSUE-01** | **Specification Authority (HAA-01)** | Missing canonical v3.2.1 baseline documents and constitution hierarchy alignment. | **Human Architecture Authority must supply or explicitly ratify the canonical specification** (including missing Items 11 & 12) for import into `spec/` with provenance, and confirm `AGENTS.md` precedence. | **HUMAN APPROVAL REQUIRED** |
| **ISSUE-02** | **Duplicate Update Policy (HAA-02 / D-110)** | Contradiction between D-110 (no surrogate keys) and v3.2.2 R-KEY-03 (production surrogate `(k, n)`). | **Human Architecture Authority must approve the exact duplicate-update policy:** Validate complete incoming collection upfront, reject invalid update atomically, preserve existing DOM, allocate zero DOM/owners for rejected items, emit deterministic diagnostic in DEV and PROD, and select error delivery mode (throw vs `onWarning`). | **HUMAN APPROVAL REQUIRED** |
| **ISSUE-03** | **Trusted HTML Security Boundary (HAA-03 / D-109)** | Previous draft `createTrustedHtml(dirty, sanitizerFn)` allowed caller to pass arbitrary identity function `x => x`. | **Human Architecture Authority must approve public security contract:** Public API enforces `setSanitizerProvider` at application root, `createTrustedHtml(dirtyHtml)` invoking configured provider, module-scoped `WeakSet` registry, and native Trusted Types. Caller-supplied sanitizers are eliminated. | **HUMAN APPROVAL REQUIRED** |
| **ISSUE-04** | **Package Organization & Topology (HAA-04)** | Dependency layer inversion (compiler depending on runtime); runtime dependency bundling rule; expression AST boundary. | **Human Architecture Authority approves concrete package organization:** Introduce `@mix/diagnostics` as dedicated leaf package; `@mix/ast` holds template and ESTree expression nodes; `@mix/runtime` imports diagnostics during development and inlines into distribution artifacts for zero external npm dependencies. | **HUMAN APPROVAL REQUIRED** |
| **ISSUE-05** | **Toolchain & Compiler Parser Matrix (HAA-05)** | Outdated recommendations; pinned `typescript@7.0.2` broke `typescript-eslint` peer dependencies; compiler parser selection. | **Human Architecture Authority approves tested toolchain matrix:** Node 26 Active LTS baseline with `node: ">=22.12.0"`; TypeScript 6.0.3; `typescript-eslint@8.72.1`; `@eslint/js@9.39.5`; and compiler parser selections (`acorn@8.14.0`, `@sveltejs/acorn-typescript@1.4.1`, `css-tree@3.1.0`). | **HUMAN APPROVAL REQUIRED** |
| **TECH-06** | **Dynamic Element Codegen** | Codegen dropped attributes on `<{~expr}>` and tag was static in DOM. | **Technical Remediation:** Ensure parser and codegen preserve attributes and bindings on `<{~expr}>` dynamic elements per Charter §4. | Technical Remediation (Gate 2/5) |
| **TECH-07** | **Missing Component Syntax** | Compiler lacks support for custom component tags (`<Header />`), compiling them to `createElement("Header")`. | **Technical Remediation:** Implement `ComponentCallNode` in AST and factory invocation in codegen during Gate 2 and Gate 5. | Technical Remediation (Gate 2/5) |
| **TECH-08** | **Empty `IfBlock` Stub** | Codegen lines 182-196 contains only comments: `// Conditional consequent branch`. | **Technical Remediation:** Implement conditional DOM anchor insertion, branch mounting, and reactive switching in Gate 5. | Technical Remediation (Gate 5) |
| **TECH-09** | **Zero-Dependency Runtime** | `@mix/runtime` declared dependency on `@csstools/css-tokenizer`. | **Technical Remediation:** Remove tokenizer from runtime; move complex tokenization to compile time (`@mix/compiler-css`); use zero-dependency escape validator in runtime. | Technical Remediation (Gate 6) |
| **TECH-10** | **Mocked Vertical Slice** | Existing vertical-slice test hand-wrote DOM operations instead of executing compiled module. | **Technical Remediation:** Rewrite vertical slice in Gate 5 to dynamically import and execute actual emitted JS in `happy-dom`. | Technical Remediation (Gate 5) |
| **OBS-11** | **Elephant–Goldfish Rule** | Earlier draft proposed archiving `AGENTS.md`. | **Correction Applied:** Root `AGENTS.md` is restored and permanently preserved as the active agent constitution. | **CORRECTED** |
| **OBS-12** | **Deferred Router** | Premature router package before core compiler is verified. | **Observation:** Router deferred until post-Gate 5 per Project Charter non-goals. | Observation |

---

## 3. Human Architecture Decisions Submitted for Gate 1 Approval

The following five specific decisions are submitted to the Human Architecture Authority:

### Decision 1 (`HAA-01`): Canonical Specification Baseline Ratification & Precedence
- **The Issue:** No external v3.2.1 baseline exists in repository history.
- **Decision to Approve:** Human Architecture Authority will provide or explicitly ratify the canonical specification text for the 10 documents (`LANGUAGE.md`, `AST.md`, `SEMANTICS.md`, `RUNTIME_API.md`, `CSS_SCOPING.md`, `DIAGNOSTICS.md`, `SECURITY.md`, `TESTING.md`, `PERFORMANCE.md`, `COMPATIBILITY.md`), including text for the missing Items 11 & 12, to be imported with recorded provenance under Gate 1, and ratify the governance precedence in `AGENTS.md §2`.

### Decision 2 (`HAA-02`): D-110 Keyed Reconciliation Policy & Diagnostic Delivery
- **The Issue:** Resolving the contradiction between D-110 and `MIX_SPEC_v3.2.2.md` R-KEY-03.
- **Decision to Approve:** Adopt the **Atomic Duplicate-Update Rejection Policy**:
  1. Complete incoming collection is validated prior to diffing.
  2. Duplicate keys are detected deterministically.
  3. The invalid update is rejected atomically.
  4. The previously rendered DOM collection remains mounted and unchanged.
  5. Zero DOM nodes or owner instances are allocated for rejected items.
  6. Emits `MIX_ERR_DUPLICATE_KEY` in both DEV and PROD.
  - *Option A (Strict):* Throw unhandled `MixError` synchronously.
  - *Option B (Resilient):* Deliver via root/app `onWarning` diagnostic hook while keeping previous DOM intact.

### Decision 3 (`HAA-03`): D-109 Trusted HTML Public Contract & Sanitizer Authority
- **The Issue:** Eliminating the bypass where untrusted callers could supply arbitrary identity sanitizers to `createTrustedHtml`.
- **Decision to Approve:** Ratify the public trusted HTML contract:
  1. Root application establishes security authority via `setSanitizerProvider(provider)`.
  2. `createTrustedHtml(dirtyHtml)` invokes the configured provider (or native W3C Trusted Types).
  3. Instances are registered in a private module-scoped `WeakSet<object>`.
  4. Sinks accept only registered instances from the `WeakSet`. Caller-supplied sanitizer callbacks are completely removed.

### Decision 4 (`HAA-04`): Concrete Package Structure, Diagnostics Leaf & Expression AST
- **The Issue:** Eliminating package dependency inversion and defining clear AST boundaries.
- **Decision to Approve:** Authorize introducing `@mix/diagnostics` as the dedicated zero-dependency leaf package; authorize `@mix/ast` to hold template AST nodes and ESTree-compatible expression nodes; authorize `@mix/runtime` to import `@mix/diagnostics` internally in workspace development and inline it upon build/publish to maintain zero external npm dependencies (`dependencies: {}`).

### Decision 5 (`HAA-05`): Toolchain Compatibility Matrix & Compiler Parser Selection
- **The Issue:** Aligning toolchain with November 2026 reality and establishing deterministic compiler parsers.
- **Decision to Approve:** Authorize evaluating Node.js 26 Active LTS as the primary development and CI baseline, retaining `node: ">=22.12.0"` for local development, evaluating TypeScript 6.0.3 with the Compiler API, pairing with `typescript-eslint@8.72.1` and `@eslint/js@9.39.5`, and utilizing pinned compiler parser libraries (`acorn@8.14.0`, `@sveltejs/acorn-typescript@1.4.1`, `css-tree@3.1.0`).
