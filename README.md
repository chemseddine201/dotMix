# Mix / Tix — Initialization Package

**Purpose:** establish a strict, auditable project foundation and give a coding agent a controlled first assignment.

**Current gate:** Initialization package prepared. Repository audit and planning only. **No compiler/runtime implementation is authorized yet.**

## Non-negotiable project identity

Mix/Tix is an independent compiler-native UI language. It is not a React wrapper, JSX skin, Virtual DOM framework, runtime template interpreter, or HTML-string rendering framework.

The intended architecture is:

`Source → Lexer/Parser → AST → Semantic Analysis → Type Verification (.tix) → CSS Compilation → Direct DOM Code Generation → Runtime`

The runtime provides fine-grained Push-Pull reactivity, ownership, lifecycle, resources, and platform adapters. The compiler emits readable, deterministic JavaScript that performs direct DOM operations.

## Start here

Mandatory reading sequence per `AGENTS.md §3`:
1. Read `AGENTS.md` (Master Agent Constitution under the Elephant–Goldfish Rule).
2. Read `README.md`.
3. Read `governance/PROJECT_CHARTER.md`.
4. Read `governance/ARCHITECTURE_GUARDRAILS.md`.
5. Read `governance/DECISION_REGISTER.md`.
6. Read `governance/PHASE_GATES.md`.
7. Read task assignment file (e.g., `agent/INITIALIZATION_AGENT_TASK.md` or `AGENT_HANDOFF.md`).
8. Read canonical specification documents under `spec/` (upon supply/ratification).
9. Require the agent to produce the required phase deliverables and stop for human approval.

## Canonical specification warning

This package does **not** pretend to contain the full canonical v3.2.1 language specification. The exact approved source documents must be located in the existing repository or supplied by the project owner and imported without semantic rewriting.

Files in `spec/` are import-control documents, not replacements for the canonical specifications.

## Expected first deliverables

The agent must produce:
- repository inventory;
- canonical specification inventory and provenance;
- approved decision inventory;
- experimental/unapproved code inventory;
- contradiction and missing-contract report;
- proposed clean repository structure and dependency graph;
- phase breakdown with acceptance criteria;
- exact list of files to preserve, replace, archive, or remove;
- explicit confirmation that no implementation was started.

## Approval rule

Only the project owner can authorize implementation. Silence, a passing scaffold test, or an agent's claim of readiness is not approval.
