# Phase 0 — Repository Foundation and Implementation Readiness

## Objective

Create a clean, verifiable repository foundation and make the remaining specification decisions visible before implementation. Phase 0 is complete when an agent can open the repository, understand its boundaries, run the scaffold check, and produce a source-backed Phase 1 plan.

## In scope

- Establish the repository structure.
- Establish npm workspace metadata without introducing runtime dependencies.
- Add shared TypeScript configuration baseline.
- Add package boundary placeholders.
- Add specification document placeholders and status tracking.
- Add a deterministic scaffold verification command.
- Prepare the coding-agent handoff instructions.
- Audit and report all unresolved specification contracts.

## Explicitly out of scope

- Implementing the parser, AST, semantic checker, CSS compiler, code generator, runtime, DOM renderer, router, or CLI.
- Choosing or implementing a new reactive algorithm.
- Rewriting the complete specification from memory.
- Adding UI examples or product features.
- Adding SSR, hydration, server components, or a Virtual DOM.
- Publishing packages or creating a public API stability promise.

## Phase 0 tasks

| ID | Task | Acceptance criteria |
|---|---|---|
| P0-01 | Repository structure | All directories in README exist; responsibilities are documented. |
| P0-02 | Workspace metadata | Root package is private; package workspaces are declared; no unnecessary dependencies. |
| P0-03 | TypeScript baseline | Shared `tsconfig.base.json` exists; strict mode is enabled; no false claim that packages already compile. |
| P0-04 | Specification inventory | Every planned spec has a file and a clear status. |
| P0-05 | Decision register | All known unresolved v3.2.1 contracts are recorded as open decisions. |
| P0-06 | Agent handoff | Agent rules, phase gates, and reporting requirements are explicit. |
| P0-07 | Scaffold verification | `npm test` passes and checks required files/directories. |
| P0-08 | Agent audit | Agent creates `reports/phase-0-audit.md` with actual environment/toolchain findings. |

## Phase 0 exit gate

Phase 0 is accepted only when:
- `npm test` succeeds;
- no compiler/runtime implementation has been introduced;
- the agent audit exists;
- unresolved decisions are explicit;
- the user approves the Phase 1 toolchain and implementation contracts.

**A passing scaffold check is not evidence that the language is implemented or that the specifications are complete.**
