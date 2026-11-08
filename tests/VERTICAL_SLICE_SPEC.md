# Phase 1 Vertical Slice Acceptance Tests Specification

**Purpose:** Define explicit, reproducible test scenarios proving the complete, unmocked pipeline from source code to direct DOM manipulation and lifecycle disposal.

---

## 1. Minimal Component Source

The vertical slice tests this exact, canonical component:

```mix
<script>
  let count = signal(0);
</script>
<span>Count: {count()}</span>
```

---

## 2. Pipeline Test Stages & Assertions

### Stage 1: Lexer & Parser (`@mix/compiler-frontend`)
- **Input:** Source string above.
- **Action:** Execute parser `parse(source)`.
- **Expected AST Output (`@mix/ast`):**
  - Root: `ComponentNode`
    - `script`: `ScriptBlockNode` (content: `let count = signal(0);`, span: `{ start: 0, end: 41 }`)
    - `template`: `ElementNode` (tag: `"span"`, span: `{ start: 42, end: 72 }`)
      - Children:
        1. `TextNode` (value: `"Count: "`, span: `{ start: 48, end: 55 }`)
        2. `InterpolationNode` (expression: `"count()"`, span: `{ start: 55, end: 65 }`)
- **Assertions:**
  - `ast.type === "Component"`
  - `ast.template.tag === "span"`
  - `ast.template.children.length === 2`
  - Every node has immutable properties and valid source spans.

### Stage 2: Semantic Analysis (`@mix/compiler-semantic`)
- **Input:** AST from Stage 1.
- **Action:** Execute semantic analyzer `analyze(ast)`.
- **Expected Output:**
  - Component descriptor containing:
    - `signals`: `[ { name: "count", initialValue: 0 } ]`
    - `reactiveBindings`: `[ { targetNodeId: textNode.id, dependency: "count" } ]`
    - Zero diagnostic errors or warnings.
- **Assertions:**
  - `descriptor.diagnostics.length === 0`
  - `descriptor.bindings[0].dependencies.includes("count")`

### Stage 3: Deterministic Code Generation (`@mix/compiler-codegen`)
- **Input:** Semantic descriptor from Stage 2.
- **Action:** Execute code generator `generate(descriptor)`.
- **Expected Output:** Deterministic JavaScript/TypeScript module importing exclusively from `@mix/runtime`:
  ```js
  import { createRoot, createElement, createTextNode, createEffect, signal } from "@mix/runtime";

  export function renderComponent(owner) {
    const count = signal(0);
    const el0 = createElement("span");
    const t0 = createTextNode("Count: ");
    const t1 = createTextNode("");
    el0.appendChild(t0);
    el0.appendChild(t1);

    createEffect(() => {
      t1.data = String(count());
    });

    return {
      element: el0,
      count
    };
  }
  ```
- **Assertions:**
  - Output contains zero Virtual DOM, JSX, or React imports.
  - Generates direct DOM calls: `createElement`, `createTextNode`, `appendChild`, and `createEffect`.
  - Code generation is strictly deterministic across repeated runs.

### Stage 4: Runtime Execution & Initial Mount (`@mix/runtime`)
- **Input:** Generated component function from Stage 3 executed in a DOM environment (via `happy-dom`).
- **Action:**
  ```js
  let instance;
  const dispose = createRoot((cleanup) => {
    instance = renderComponent();
    return cleanup;
  });
  ```
- **Assertions:**
  - `instance.element.tagName === "SPAN"`
  - `instance.element.textContent === "Count: 0"`
  - Effect computation state is `CLEAN`.
  - `pendingRerun === false`.

### Stage 5: Reactive Update & Deferred Rerun Verification
- **Input:** Mounted instance from Stage 4.
- **Action:**
  ```js
  // Update signal
  instance.count.set(1);
  ```
- **Assertions:**
  - Synchronous write schedules deferred rerun (`pendingRerun` set, computation does not invoke recursively).
  - Following microtask/scheduler flush: `instance.element.textContent === "Count: 1"`.
- **Deduplication & Coalescing Check:**
  ```js
  instance.count.set(2);
  instance.count.set(3);
  ```
  - `pendingRerun` remains set once; effect executes exactly once during the deferred flush.
  - Following flush: `instance.element.textContent === "Count: 3"`.

### Stage 6: Lifecycle Teardown & Disposal Verification
- **Input:** Mounted instance from Stage 5.
- **Action:**
  ```js
  dispose();
  ```
- **Assertions:**
  - Root owner state transitions to `DISPOSED`.
  - Effect state transitions to `DISPOSED`.
  - Effect computation is unlinked from `instance.count` signal observers.
  - Calling `instance.count.set(4)` triggers zero effect executions.
  - `instance.element.textContent` remains `"Count: 3"`.

---

## 3. Mandatory Corner-Case & Error Acceptance Tests

### Scenario A: Cycle Detection & Runaway Loop Prevention
- An effect writing to its own dependency:
  ```js
  const s = signal(0);
  createEffect(() => {
    s.set(s() + 1);
  });
  ```
- **Assertion:** Scheduler detects exceeding `maxEffectIterations` (default 1000) and throws `ReactiveCycleError` deterministically without hanging the test process.

### Scenario B: Non-Nested Execution
- Writing to a dependency inside an effect does not trigger immediate recursive re-entry.
- **Assertion:** Effect completes its initial frame before any rerun is dispatched.

### Scenario C: Deterministic Error Recovery
- An effect that throws an error during execution:
  ```js
  createEffect(() => {
    if (s() === 1) throw new Error("Boom");
  });
  ```
- **Assertion:** Running state is reset; scheduler queue is not corrupted; subsequent signal updates for unrelated effects continue to execute normally.

