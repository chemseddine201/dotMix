# Agent Handoff — Mix / Tix

## Mission

Take this repository from an empty scaffold to a verified, implementation-ready compiler project, then implement it only through the phase gates in `ROADMAP.md`.

The user is the final architecture authority. The agent is an implementer and technical reviewer, not an autonomous product owner.

## Mandatory first action

1. Read this file, `PHASE_0_SCOPE.md`, `DECISIONS.md`, `ROADMAP.md`, and every file under `spec/`.
2. Inspect the repository as it actually exists. Do not assume the scaffold is complete merely because the files are present.
3. Run `npm test`.
4. Produce `reports/phase-0-audit.md` containing:
   - repository inventory and exact tool versions;
   - current scaffold validation output;
   - proposed minimal TypeScript build/test/lint toolchain, with reasons;
   - package dependency graph (must remain acyclic);
   - specification contradictions and missing definitions;
   - the exact decisions that require human approval;
   - a Phase 1 task breakdown with acceptance criteria.
5. Stop and request human review of the Phase 0 report. Do not begin compiler/runtime implementation before approval.

## Architecture constraints

- `.mix` and `.tix` must use the same AST and compiler pipeline.
- `.mix` is flexible syntax; `.tix` is strict TypeScript-oriented syntax.
- Use a standard JavaScript/TypeScript parser and the TypeScript Compiler API where appropriate. Do not build a replacement TypeScript type checker.
- AOT compilation generates direct DOM operations. Do not introduce a Virtual DOM or React.
- Fine-grained reactivity uses the specified Pull-Push model. Do not replace it with a generic framework.
- Keep compiler frontend, semantic analysis, CSS compilation, code generation, and runtime responsibilities separate.
- `@mix/runtime` should have no avoidable dependencies.
- Core runtime contracts must not leak browser DOM types into platform-neutral core.
- Browser SPA is the MVP. SSR is a future adapter capability, not a Phase 0/1 deliverable.
- Code generation must be deterministic and readable.
- Correctness, lifecycle safety, and security take priority over minimizing bundle size.

## Language and tool constraints

- TypeScript is the bootstrap language.
- Do not introduce C#.
- Do not use Python for project implementation.
- Do not add React, Babel, Webpack, or Rollup as foundational dependencies.
- Do not add dependencies without documenting why they are needed.
- Pin versions once the toolchain proposal is approved; do not float unbounded versions in the lockfile.

## Change-control rules

- Do not rewrite or silently reinterpret the language specification.
- Do not make an unresolved decision by guessing. Record the alternatives, recommendation, impact, and ask for approval.
- Do not combine unrelated modules or create giant files.
- Keep modules small, with one clear responsibility.
- Do not add features outside the current phase.
- Do not modify unrelated files.
- Do not claim tests pass unless the exact command was executed and its output was observed.
- Do not report an API or algorithm as WHATWG-compliant unless conformance is demonstrated by tests or a pinned implementation.
- Never use `TODO` as a substitute for a required core implementation after a phase is approved.

## Phase 1 is not automatically authorized

Phase 1 begins only after the human reviews `reports/phase-0-audit.md` and explicitly approves:
- the toolchain;
- the corrected specification contracts;
- the package dependency graph;
- the Phase 1 task list.

## Required reporting format

At the end of each phase, provide:
1. Scope completed.
2. Files created/changed.
3. Decisions made (and who approved them).
4. Commands executed and actual results.
5. Tests added and actual results.
6. Known limitations and unresolved issues.
7. Exact next-phase proposal.

Keep reports concise and evidence-based.
