# Agent Assignment — Mix/Tix Initialization Phase

## Assignment status

**AUTHORIZED:** repository inspection, specification inventory, analysis, reporting, and preparation of a proposed implementation plan.

**NOT AUTHORIZED:** compiler/runtime implementation, language syntax changes, specification rewriting, package implementation, deleting/renaming existing files, dependency installation that mutates the project, or Showcase implementation.

The project owner is the Human Architecture Authority.

## Mandatory reading

Read in this order:
1. `README.md`
2. `governance/PROJECT_CHARTER.md`
3. `governance/ARCHITECTURE_GUARDRAILS.md`
4. `governance/DECISION_REGISTER.md`
5. `governance/PHASE_GATES.md`

## Task 1 — Repository inventory

Inspect the repository without modifying it.

Report:
- root files and directories;
- package/workspace configuration;
- source files and generated artifacts;
- tests and scripts;
- CI configuration;
- Git status and relevant history;
- dependency and toolchain versions;
- lockfile status.

Classify each relevant artifact:
- canonical;
- accepted implementation;
- experimental;
- generated;
- obsolete candidate;
- unknown provenance.

Do not delete or move anything.

## Task 2 — Canonical specification recovery

Locate the actual approved canonical documents, especially the v3.2.1 baseline and accepted decision records.

For each document report:
- exact path;
- title/version/date if present;
- Git commit or other provenance if available;
- whether complete or partial;
- whether it is superseded;
- whether it conflicts with this initialization package.

Required documents include:
- LANGUAGE.md
- AST.md
- SEMANTICS.md
- RUNTIME_API.md
- CSS_SCOPING.md
- DIAGNOSTICS.md
- SECURITY.md
- TESTING.md
- PERFORMANCE.md
- COMPATIBILITY.md

If any are missing, say MISSING. Do not recreate them from memory or infer their contents.

## Task 3 — Decision reconciliation

Compare actual accepted decisions against `governance/DECISION_REGISTER.md`.

For D-101 through D-111:
- quote the authoritative clause;
- identify the actual document/path;
- report MATCH, PARTIAL, CONFLICT, or MISSING;
- explain any mismatch;
- identify implementation tests required later.

Do not mark a decision accepted based only on the summary in this package if the canonical record says otherwise.

## Task 4 — Audit the current Showcase

Inspect the current Mix/Tix Showcase source.

For every syntax feature used, report:
- whether it exists in canonical grammar;
- exact grammar/spec reference;
- whether compiler support exists;
- whether it is only handwritten JavaScript/HTML;
- whether it is an unapproved addition.

Explicitly inspect:
- `signal(...)`;
- `.set(...)`;
- `@click={...}`;
- `<script>` and `<style>` block semantics;
- conditional/dynamic syntax;
- dynamic element syntax;
- component syntax;
- claimed LIS, WHATWG security, TypeScript projection, cancellation.

Do not infer that a feature is supported because it appears in the Showcase.

## Task 5 — Contradictions and missing contracts

Create a table containing:
- ID;
- affected documents/packages;
- exact conflict or missing definition;
- risk;
- smallest proposed resolution;
- whether human approval is required.

Prioritize actual blockers. Separate:
- BLOCKER: implementation cannot be correct without resolution;
- NON-BLOCKING: can be resolved within an approved phase;
- OBSERVATION: informational only.

Do not manufacture blockers to make the report look thorough.

## Task 6 — Proposed repository structure

Propose the smallest package structure that supports the approved architecture.

Baseline package candidates:
- `@mix/ast`
- `@mix/compiler-frontend`
- `@mix/compiler-semantic`
- `@mix/compiler-css`
- `@mix/compiler-codegen`
- `@mix/runtime`
- `@mix/router` (defer implementation)

For each package define:
- responsibility;
- public entry points;
- allowed dependencies;
- forbidden dependencies;
- tests.

Produce an acyclic dependency graph.

Do not create packages or install dependencies during this assignment.

## Task 7 — Toolchain recommendation

Evaluate a reproducible toolchain based on actual API compatibility:
- supported Node LTS baseline;
- TypeScript Compiler API version;
- TypeScript project references;
- npm workspaces;
- node:test or justified alternative;
- DOM test environment;
- real-browser test strategy;
- linting;
- exact dependency pins and lockfile strategy.

If using unstable TypeScript subpath APIs, identify every required API and prove it is available in the proposed version. Recommend an adapter boundary.

Do not claim that a version is suitable merely because it is latest.

## Task 8 — Phase plan and acceptance criteria

Produce a phased implementation plan aligned with `governance/PHASE_GATES.md`.

Each task must include:
- ID;
- objective;
- input contracts;
- expected output/files;
- dependencies;
- tests;
- acceptance criteria;
- risks;
- stop condition.

The first executable implementation phase must include a genuine end-to-end vertical slice, not disconnected mocked demonstrations.

## Required output files

Create only these report files:

1. `reports/INITIALIZATION_AUDIT.md`
2. `reports/CANONICAL_SPEC_INVENTORY.md`
3. `reports/DECISION_RECONCILIATION.md`
4. `reports/SHOWCASE_COMPLIANCE_AUDIT.md`
5. `reports/CONTRADICTIONS_AND_GAPS.md`
6. `reports/PROPOSED_ARCHITECTURE.md`
7. `reports/TOOLCHAIN_RECOMMENDATION.md`
8. `reports/IMPLEMENTATION_PHASE_PLAN.md`
9. `reports/FILESYSTEM_CHANGE_PROPOSAL.md`

Do not modify canonical specification files.
Do not modify source code.
Do not install dependencies.
Do not create implementation files.
Do not remove or archive anything.

## Final response format

Return:
1. Executive summary.
2. Confirmed canonical baseline.
3. Blocking issues only.
4. Proposed architecture and dependency graph.
5. Phase plan.
6. Exact files created.
7. Explicit statement: "No implementation was started."
8. Explicit request for Human Architecture Authority approval.

STOP after these reports. Wait for explicit approval.
