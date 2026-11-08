# Mix / Tix — Phase 0 Project Bootstrap

**Status:** Phase 0 scaffold; implementation has not started.  
**Language bootstrap:** TypeScript.  
**Product direction:** compiler-native UI language with `.mix` (flexible syntax) and `.tix` (strict TypeScript-oriented syntax).

## What this repository is

Mix / Tix is intended to be a complete UI language: markup, scoped CSS, and reactive logic compiled ahead of time to direct DOM operations. `.mix` and `.tix` share one AST and compiler pipeline. The browser SPA is the MVP target; renderer adapters preserve a future path to SSR without making SSR part of this phase.

## Phase 0 contents

- Initial monorepo/package layout.
- Architecture and agent-handoff documents.
- Specification status and unresolved decision register.
- Minimal repository validation script.
- No runtime, parser, compiler, renderer, or CLI implementation.

## Prerequisites

- Node.js 22 or newer.
- npm (npm workspaces; no additional package manager is required for this scaffold).

## Verify the scaffold

```bash
npm test
```

This checks that the expected Phase 0 directories and documents exist. It does **not** compile the language or validate runtime semantics.

## Next step

Read `AGENT_HANDOFF.md` and `spec/SPEC_STATUS.md` first. The implementation agent must complete the Phase 0 audit and submit its report before starting Phase 1. It must not silently resolve open language/runtime contracts.

## Repository map

```text
mix-tix/
├── AGENT_HANDOFF.md
├── DECISIONS.md
├── PHASE_0_SCOPE.md
├── ROADMAP.md
├── package.json
├── tsconfig.base.json
├── scripts/
│   └── verify-phase0.mjs
├── spec/
│   ├── README.md
│   ├── LANGUAGE.md
│   ├── AST.md
│   ├── SEMANTICS.md
│   ├── RUNTIME_API.md
│   ├── CSS_SCOPING.md
│   ├── DIAGNOSTICS.md
│   ├── SECURITY.md
│   ├── TESTING.md
│   ├── PERFORMANCE.md
│   ├── COMPATIBILITY.md
│   └── SPEC_STATUS.md
├── packages/
│   ├── ast/
│   ├── compiler-frontend/
│   ├── compiler-semantic/
│   ├── compiler-css/
│   ├── compiler-codegen/
│   ├── runtime/
│   └── router/                 # Phase 2; placeholder only
└── tests/
    ├── conformance/
    ├── runtime/
    ├── integration/
    └── security/
```
