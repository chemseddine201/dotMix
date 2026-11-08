# Agent Handoff

## Current Active Assignment

Execute **Phase Gate 1: Foundation & Canonical Specification Import ONLY** per `agent/GATE_1_FOUNDATION_TASK.md` and `governance/PHASE_GATES.md` §Gate 1.

## Scope Boundary

- **Allowed (Gate 1 ONLY):**
  - Verify archive integrity on branch/tag `archive/pre-initialization-b95110e`.
  - Reconcile and import the 10 canonical English specifications in `spec/*.md` and `spec/SOURCE_PROVENANCE.md`.
  - Durably record ratified decisions `HAA-01` through `HAA-05` in `governance/DECISION_REGISTER.md`.
  - Cleanly configure workspace root (`package.json`, `package-lock.json`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `.github/workflows/ci.yml`).
  - Scaffold 7 package skeletons (`@mix/diagnostics`, `@mix/ast`, `@mix/compiler-frontend`, `@mix/compiler-semantic`, `@mix/compiler-css`, `@mix/compiler-codegen`, `@mix/runtime`).
  - Implement zero-dependency build-time erasure boundary for `@mix/runtime` (`import type` only from `@mix/diagnostics`, `"dependencies": {}`).
  - Write and pass unmocked Gate 1 foundation test suite (`tests/foundation/`).
- **Forbidden (Gates 2 through 9 remain NOT AUTHORIZED):**
  - No template lexer/parser implementation (Gate 2).
  - No semantic analyzer or `.tix` projection implementation (Gate 3).
  - No reactive signal/computed/scheduler runtime engine (Gate 4).
  - No codegen emitter or vertical slice (Gate 5).
  - No CSS scoping parser or runtime security parsers (Gate 6).
  - No LIS keyed list reconciler (Gate 7).
  - No router package (`@mix/router` is deferred).
  - No showcase or benchmark execution.

## Required Stop

Immediately after committing Gate 1 deliverables on `master` with exit code `0` across `npm ci`, `npm run build`, `npm run lint`, and `npm test`, output the Gate 1 Completion Report and **STOP**. Wait for explicit written approval from the Human Architecture Authority naming Gate 2 before touching any Gate 2 deliverables.