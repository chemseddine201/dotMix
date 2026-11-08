# Architecture Guardrails

These rules constrain all design and implementation work.

## A. Compiler boundaries

Required conceptual stages:

1. Source loading and source identity.
2. Lexing and template-aware parsing.
3. AST construction with source spans.
4. Semantic scope and symbol analysis.
5. `.tix` type verification through TypeScript Compiler API.
6. CSS parsing, validation, and scoping.
7. Lowering/IR transformations where justified.
8. Deterministic JavaScript code generation.
9. Runtime execution and DOM adapter.

Every stage must have documented input/output contracts. Do not let one stage silently absorb another stage's responsibilities.

## B. Parser and TypeScript integration

- Do not write a partial JavaScript/TypeScript parser.
- Use the parser/compiler infrastructure selected by the approved architecture.
- TypeScript Compiler API is the authority for `.tix` type checking.
- If another parser is used for embedded expressions, define its exact role and compatibility boundary.
- Do not expose unstable TypeScript API types in public Mix/Tix contracts.
- Isolate unstable APIs behind a small internal adapter.
- Preserve original source spans through parsing and transformations.

## C. Reactive runtime

Required concepts include Signal, Computed, Effect, Owner, cleanup, scheduler, resource, and cancellation token.

Scheduler states in the accepted baseline:
- `CLEAN`
- `CHECK`
- `DIRTY`
- `RUNNING`

Disposal must be represented explicitly and consistently. Owner lifecycle state must not be conflated with computation execution state.

Deferred rerun rules:
- no nested effect execution;
- `pendingRerun` is independent from computation state;
- coalesce repeated notifications;
- effects finish before queued reruns execute;
- writes during effect execution must not lose updates;
- cycle detection must be deterministic;
- iteration ceilings are configurable scheduler safety controls, not language semantics.

Computed reads must validate upstream state correctly. Diamond graphs must not cause duplicate or inconsistent downstream execution.

## D. Ownership and asynchronous work

- Preserve the approved `createRoot` contract, including `detachedParent?: Owner | null`, unless the owner explicitly approves a change.
- Define ownership inheritance and disposal separately.
- Do not assume async context automatically survives `await`.
- Define cleanup order, owner disposal during async work, cancellation, and stale-result handling.
- Use generation/version checks for latest-request-wins behavior; cancellation alone is insufficient.

## E. Platform boundary

- Core reactivity and ownership must be platform-neutral.
- Core must not require DOM `Node`, `Document`, or `AbortSignal`.
- DOM-specific behavior belongs in a DOM adapter.
- A platform-neutral cancellation token may be bridged to `AbortController` in an adapter.

## F. Direct DOM generation

- AOT-generated code performs DOM creation, insertion, and targeted updates.
- Do not introduce a Virtual DOM or generic runtime template interpreter.
- Preserve stable node references for reactive updates.
- Avoid recreating static DOM for ordinary signal updates.
- Generated code must be readable and deterministic.
- Effects and ownership must be disposed with their rendered scope.

Illustrative output only:

```ts
const root = document.createElement("div");
const text = document.createTextNode("");
root.appendChild(text);

const stop = effect(() => {
  text.data = String(count.get());
});

container.appendChild(root);
```

This is not a prescribed public API or codegen template. The actual output must follow the canonical runtime contracts.

## G. CSS and security

- Do not parse complex CSS with regular expressions alone.
- Treat `@import` and `@charset` as at-rules, not function tokens.
- Validate property names, values, escapes, URL-bearing values, at-rules, and renderer application.
- A property allowlist alone is not a complete CSS security policy.
- Define trusted HTML creation and sanitizer trust boundaries.
- TypeScript brands and Symbols are not security boundaries.
- Never make unsafe HTML insertion the default.
- URL validation must be context-aware and protocol-aware.

## H. Keyed lists

- Stable keys and deterministic behavior.
- Duplicate keys produce deterministic diagnostics.
- No synthetic/surrogate fallback keys to conceal duplicates.
- Avoid creating DOM/Owner state for a duplicate item that is rejected.
- Updates must not expose inconsistent partial state.
- Implement LIS only if required by the canonical accepted specification; benchmark the actual algorithm before claiming complexity.

## I. Diagnostics and source maps

- Diagnostics have stable codes, severity, message, and original source span.
- Do not map generated errors to a merely nearby source line.
- Preserve source identity through parser, semantic analysis, and codegen.
- Related diagnostics should identify relevant declarations/references when possible.

## J. Dependency and code quality

- No circular package dependencies.
- No giant monolithic files.
- No broad `any` escape hatches.
- No unnecessary runtime dependencies.
- Keep public API surface small and documented.
- Pin exact dependency versions and commit the lockfile.
- Validate actual required APIs against the selected toolchain; do not select versions by novelty alone.
