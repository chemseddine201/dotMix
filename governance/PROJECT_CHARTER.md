# Project Charter — Mix / Tix

## 1. Mission

Build Mix/Tix as an independent compiler-native UI language with developer-friendly `.mix` syntax and strict TypeScript-oriented `.tix` syntax. Both extensions share one language model, AST architecture, compiler pipeline, and runtime model.

## 2. Product principles

1. Compiler-native, not runtime-interpreted templates.
2. Ahead-of-time compilation.
3. Direct DOM operations; no Virtual DOM.
4. Fine-grained Push-Pull reactivity.
5. Explicit ownership and deterministic disposal.
6. Scoped CSS compiled as a first-class compiler stage.
7. Strict static verification for `.tix`, using TypeScript's checker rather than a competing type checker.
8. Small, modular packages with explicit contracts.
9. Readable and deterministic generated code.
10. Security and correctness take priority over micro-optimizing bundle size.
11. Browser SPA is the initial target; renderer abstraction must not leak DOM types into platform-neutral core contracts.
12. SSR is a future capability, not an excuse to over-generalize the MVP.

## 3. Explicit non-goals

- React compatibility layer or React dependency.
- Virtual DOM.
- Runtime template interpretation.
- HTML-string rendering as the primary rendering mechanism.
- Reimplementing JavaScript/TypeScript parsers or TypeScript's type checker.
- Unapproved language syntax.
- A Showcase that simulates compiler capabilities with handwritten JavaScript.
- Premature router/SSR/plugin expansion before the compiler/runtime core is proven.

## 4. Language identity

- `.mix`: JavaScript-oriented developer experience.
- `.tix`: strict TypeScript-oriented developer experience.
- Shared AST and compiler pipeline.
- Differences between the extensions must be specified, not inferred.

The approved dynamic element syntax baseline is:

```tsx
<{~expr}>
  ...
</{~expr}>
```

The `~` marker is canonical in the currently approved baseline and must not be removed or altered without explicit approval. The expression is resolved once for an element instance; the closing tag must match the resolved identity rather than independently re-evaluating the expression.

All other grammar must be taken from the canonical language specification. This charter is not a substitute grammar.

## 5. Governance

The project owner is the Human Architecture Authority.

The agent may:
- inspect;
- report;
- propose;
- implement only within an explicitly approved phase and scope.

The agent may not silently:
- change grammar or public APIs;
- revise accepted semantic decisions;
- replace canonical specifications;
- add dependencies that alter architectural boundaries;
- delete or rewrite project history/specifications;
- claim implementation or compliance without tests.

## 6. Definition of done

A phase is complete only when:
- its deliverables exist;
- public contracts are documented;
- tests exercise behavior, not just file presence;
- all required tests pass;
- known limitations are disclosed;
- source mappings and diagnostics are verified where applicable;
- no unresolved blocker remains;
- the project owner accepts the phase.

A generated demo, a successful TypeScript build, or a scaffold check alone is not proof of compiler correctness.
