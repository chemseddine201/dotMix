# AGENTS.md — Master Agent Constitution & Governance

**Authority:** Human Architecture Authority  
**Applies to:** All AI Coding Agents, Pair Programmers, and Automated Workers  
**Status:** Permanent Root-Level Constitution (Under the Elephant–Goldfish Rule)

---

## 1. The Elephant–Goldfish Principle

Every agent session begins with fresh execution context (the "Goldfish" memory). To maintain architectural integrity across sessions, the repository maintains durable, immutable governance (the "Elephant" memory).

1. **Active Constitution:** This file is the primary entry point and mandatory constitution for every agent operating in this repository.
2. **Prohibition on Assumed Memory:** Never rely on remembered conversations, previous context, or speculative assumptions. If a rule, contract, or decision is not recorded in the repository's durable documentation, it does not exist.
3. **No Unapproved Inference:** Never infer that a feature, syntax, or runtime behavior is supported merely because it appears in an example, an unapproved draft, or an earlier agent commit.

---

## 2. Governance Hierarchy

All technical design, implementation, and verification work must respect the following strict order of authority:

```text
1. Human Architecture Authority (Project Owner)
   └── 2. Master Constitution & Root Governance:
          ├── AGENTS.md                              (Root agent constitution)
          ├── governance/PROJECT_CHARTER.md          (Mission, identity, non-goals)
          └── governance/ARCHITECTURE_GUARDRAILS.md  (Guardrails A through J)
   └── 3. Canonical Specification Documents (spec/*.md + spec/SOURCE_PROVENANCE.md)
   └── 4. Change Control & Gate Definitions:
          ├── governance/DECISION_REGISTER.md        (Accepted decisions D-101..111)
          └── governance/PHASE_GATES.md              (Gate acceptance criteria)
   └── 5. Task Directives & Handoffs:
          ├── agent/*.md
          └── AGENT_HANDOFF.md
   └── 6. Active Code, Packages, and Tests
```

---

## 3. Mandatory Reading Order

Before proposing any changes, generating code, or executing tasks, every agent must read documents in this exact sequence:

1. `AGENTS.md` (this constitution)
2. `README.md`
3. `governance/PROJECT_CHARTER.md`
4. `governance/ARCHITECTURE_GUARDRAILS.md`
5. `governance/DECISION_REGISTER.md`
6. `governance/PHASE_GATES.md`
7. Task assignment file (e.g., `agent/*.md` or `AGENT_HANDOFF.md`)
8. Relevant canonical specifications under `spec/`

---

## 4. Phase Gates & Authorization Rules

1. **Phase Boundary Rule:** Work proceeds strictly phase-by-phase according to `governance/PHASE_GATES.md`.
2. **Explicit Human Approval Required:** An agent is **never** authorized to advance to the next implementation phase without explicit written approval from the Human Architecture Authority naming the approved phase (e.g., *"Phase 1 is approved"*).
3. **No Implicit Authorization:** A passing test suite, a clean TypeScript build, a successful scaffold check, or an agent's internal assertion of readiness is **not** approval.
4. **Scope Enclosure:** Agents must implement only within the approved phase scope. Never touch packages, features, or syntax belonging to future gates.

---

## 5. Protocol for Missing or Contradictory Specifications

When an agent encounters a missing contract, an ambiguous definition, or a conflict between documents:

1. **STOP IMMEDIATELY.** Do not guess, improvise, or choose a resolution autonomously.
2. **Do Not Synthesize:** Never invent language syntax, runtime algorithms, or API signatures from memory or common framework patterns (e.g., React, Svelte, Solid).
3. **Quote the Conflict:** Formulate an issue identifying:
   - The affected documents and packages.
   - The exact conflicting clauses or missing contracts.
   - The technical risk and architectural impact.
   - The smallest viable proposed resolution.
4. **Submit for Human Approval:** Record the finding in a structured contradiction report and wait for explicit instructions from the Human Architecture Authority.

---

## 6. Architectural Non-Negotiables

- **Compiler-Native UI Language:** Mix/Tix compiles ahead-of-time directly to surgical DOM operations. No Virtual DOM. No React runtime.
- **Zero Runtime Dependencies:** `@mix/runtime` must remain completely free of external dependencies.
- **Separation of Concerns:** Keep compiler frontend, semantic analysis, CSS compilation, code generation, diagnostics, and runtime responsibilities strictly separated in an acyclic package graph.
- **Pure Core Reactivity:** Core reactive primitives and cancellation tokens must remain platform-neutral with zero references to browser DOM types (`Node`, `HTMLElement`, `AbortSignal`).
- **No Regex for Semantics:** Semantic variable rewriting, dependency analysis, and scope resolution must never use regular expressions.
- **Strict Verification:** Unmocked integration tests must prove the entire compilation and execution pipeline before claiming phase completion.

