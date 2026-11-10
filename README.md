# dotMix — Compiler-Native UI Framework (`.mix` & `.tix`)

**Purpose:** Compiler-native ahead-of-time UI language (`.mix` and `.tix`), zero-dependency fine-grained reactive runtime, and native standard library (`mix-helpers`).

**Current status:** Phase Gates 0 through 9 implemented and verified under Human Architecture Authority authorization (`agent/GATE_2_TO_9_FULL_BUILD_TASK.md`).

## Non-negotiable project identity

dotMix (`.mix` and `.tix`) is an independent compiler-native UI framework. It is not a React wrapper, JSX skin, Virtual DOM framework, runtime template interpreter, or HTML-string rendering framework.

The architecture pipeline is:

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
7. Read task assignment file (e.g., `agent/GATE_2_TO_9_FULL_BUILD_TASK.md` or `AGENT_HANDOFF.md`).
8. Read canonical specification documents under `spec/` (`spec/*.md` and `spec/SOURCE_PROVENANCE.md`).

## Workspace Packages (`packages/`)

| Package | Responsibility | Runtime Dependencies |
|---|---|---|
| `@mix/diagnostics` | Diagnostic codes, `MixError`, `MixDiagnosticError`, and source code frame formatting | `{}` |
| `@mix/ast` | Immutable template AST nodes, `SourceSpan` validation, structural `ESTreeNode`, and AST walker | `@mix/diagnostics` |
| `@mix/compiler-frontend` | `.mix` / `.tix` parser, `Acorn-TypeScript` expression boundary extraction (`R-SYN-01`), and `<{~expr}>` dynamic element token comparator (`D-105`, `R-SYN-02`) | `@mix/diagnostics`, `@mix/ast`, `acorn`, `@sveltejs/acorn-typescript` |
| `@mix/compiler-semantic` | ESTree lexical scope & symbol analyzer, `.tix` virtual TypeScript projection (`SourceMapSpanTable`, `R-SP-01..05`), and TypeScript `6.0.3` Compiler API checker (`D-106`) | `@mix/diagnostics`, `@mix/ast`, `typescript` |
| `@mix/compiler-css` | `css-tree` AST selector scoper (`[data-mix-<hash>]`), `:global()`/`:deep()` transformer, and static CSS security validator (`D-108`, `F-05`) | `@mix/diagnostics`, `@mix/ast`, `css-tree` |
| `@mix/compiler-codegen` | Ahead-of-Time direct DOM JavaScript & V3 SourceMap generator | `@mix/diagnostics`, `@mix/ast`, `@mix/compiler-semantic`, `@mix/compiler-css` |
| `@mix/runtime` | Zero-dependency reactive kernel (`Signal`, `Computed`, `Effect`, `Owner`, `CancellationToken`, `createResource`), surgical DOM adapter, LIS keyed reconciler (`D-110`), security sinks (`D-107..109`), and HMR stable scope (`D-111`) | `{}` (zero runtime dependencies) |

## Verification Commands

```bash
npm run build   # Compile all workspaces via tsc -b
npm run lint    # Verify architectural & ESLint guardrails
npm test        # Execute full unmocked test suite across Gates 1–9
```
