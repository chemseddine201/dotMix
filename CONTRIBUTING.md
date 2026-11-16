# Contributing to dotMix

The language, runtime and tooling contracts are defined in [`spec/`](spec/README.md). A change that needs a contract the specification does not define, or that contradicts it, starts with an issue that quotes the clauses involved; it is not settled in code.

Architecture rules every change keeps:
- No virtual DOM: the compiler emits direct DOM operations.
- `@dotmix/runtime` has no dependencies; `@dotmix/router`, `@dotmix/helpers` and `@dotmix/sync` depend only on `@dotmix/runtime`.
- Core reactivity and cancellation never reference browser DOM types.
- Scope resolution, dependency analysis and code rewriting use the AST, never regular expressions.
- Source files stay at or under 500 lines.

---

## Tests That Assert Behavior, Not Return Values

Unit tests that only inspect static return values or skip stages of the compiler/runtime pipeline can create false confidence while real user workflows fail. Every contribution must satisfy the following verification checklist:

### 1. Failing-Test-First Discipline
- Every bug fix or hardening task must begin with a test that reproduces the defect and **fails** on the unmodified code.
- Commit the reproducing test (`test: reproduce ...`) before the fix (`fix: ...`).

### 2. Live DOM Mounting & Mutation Verification
- Never test a UI or DOM primitive (such as `<Can>`, `<Teleport>`, `<KeepAlive>`, `{if}`, or `{each}`) solely by asserting its function return value in a non-DOM environment.
- Mount the component into a real DOM container (`happy-dom` or browser harness), mutate the underlying signals (`signal.set(...)`), and assert:
  - The rendered DOM tree (`container.innerHTML`, `container.textContent`, `querySelector`) updates in place.
  - Inactive branch reactive `Owner` scopes and `onCleanup` hooks are disposed on branch transitions.
  - Sibling DOM node identities are preserved (`assert.strictEqual(beforeSibling, container.firstChild)`).

### 3. Full Compiler & Typecheck Pipeline Coverage
- Never test `.tix` templates or scaffolded projects with `parse()` and `analyze()` alone.
- Every `.tix` test must run `typecheckTix(descriptor, source, { filename })` against the real emitted `.d.ts` files of `@dotmix/*` packages and relative user modules, asserting zero unexpected diagnostics.
- Compiler codegen changes must verify the full pipeline:
  `parse -> analyze -> typecheckTix -> compileCss -> generate -> execute / SSR renderToString`.

### 4. No Silent Workarounds
- Never weaken a test assertion, downgrade a template expression (e.g., replacing an element expression `fallback={<span/>}` with a string literal), or bypass the CLI binary to make a test pass.
- If a test reveals a grammar, typechecker, or runtime limitation, open an issue that describes it instead of working around it.

### 5. Mandatory Pre-Commit Verification Gate
Before every implementation commit, run the full verification suite:

```bash
npm run build && npm run lint && npm test && npm run test:golden
```

