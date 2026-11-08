import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

// Import compiled packages
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import {
  createRoot,
  createElement,
  createTextNode,
  createEffect,
  signal,
  flushQueue
} from "../../packages/runtime/dist/index.js";

test("Phase 1 Vertical Slice — Complete End-to-End Pipeline", async (t) => {
  const source = `<script>
  let count = signal(0);
</script>
<span>Count: {count()}</span>`;

  // --- Step 1: Lexer & Parser (@mix/compiler-frontend) ---
  await t.test("Stage 1: Parser produces valid immutable AST", () => {
    const ast = parse(source, "Counter.mix");

    assert.equal(ast.type, "Component");
    assert.ok(ast.script, "Script block should be present");
    assert.equal(ast.script.content, "let count = signal(0);");
    assert.equal(ast.template.length, 1);

    const rootElement = ast.template[0];
    assert.equal(rootElement.type, "Element");
    assert.equal(rootElement.tag, "span");
    assert.equal(rootElement.children.length, 2);

    const [textNode, interpNode] = rootElement.children;
    assert.equal(textNode.type, "Text");
    assert.equal(textNode.value, "Count: ");

    assert.equal(interpNode.type, "Interpolation");
    assert.equal(interpNode.expression.code, "count()");
  });

  // --- Step 2: Semantic Analysis (@mix/compiler-semantic) ---
  let descriptor;
  await t.test("Stage 2: Semantic analyzer extracts reactive bindings", () => {
    const ast = parse(source, "Counter.mix");
    descriptor = analyze(ast);

    assert.equal(descriptor.diagnostics.length, 0);
    assert.equal(descriptor.signals.length, 1);
    assert.equal(descriptor.signals[0].name, "count");
    assert.equal(descriptor.signals[0].initialValueCode, "0");

    assert.equal(descriptor.bindings.length, 1);
    assert.equal(descriptor.bindings[0].expressionCode, "count()");
    assert.deepEqual(descriptor.bindings[0].dependencies, ["count"]);
  });

  // --- Step 3: Codegen (@mix/compiler-codegen) ---
  let codegenResult;
  await t.test("Stage 3: Codegen generates deterministic direct DOM code", () => {
    codegenResult = generate(descriptor);

    assert.ok(codegenResult.code.includes('import { createElement, createTextNode, createEffect, signal } from "@mix/runtime";'));
    assert.ok(codegenResult.code.includes('const count = signal(0);'));
    assert.ok(codegenResult.code.includes('createElement("span")'));
    assert.ok(codegenResult.code.includes('createTextNode("Count: ")'));
    assert.ok(codegenResult.code.includes('createEffect(() => {'));
    assert.ok(!codegenResult.code.includes("React"));
    assert.ok(!codegenResult.code.includes("virtual"));
  });

  // --- Step 4: Runtime Execution & Initial Mount (@mix/runtime) ---
  await t.test("Stage 4 & 5 & 6: Runtime mounts, updates, and disposes cleanly in DOM", () => {
    // Setup DOM environment via happy-dom
    const window = new Window();
    globalThis.document = window.document;
    globalThis.window = window;

    let instance;
    let disposeFn;

    // Simulate executing the generated component module within createRoot
    disposeFn = createRoot((dispose) => {
      // Direct execution of the codegen pattern
      const count = signal(0);
      const el0 = createElement("span");
      const t0 = createTextNode("Count: ");
      const t1 = createTextNode("");
      el0.appendChild(t0);
      el0.appendChild(t1);

      createEffect(() => {
        t1.data = String(count());
      });

      instance = {
        element: el0,
        count
      };

      return dispose;
    });

    // 1. Initial Mount Assertion
    assert.equal(instance.element.tagName, "SPAN");
    assert.equal(instance.element.textContent, "Count: 0");

    // 2. Reactive Update Assertion (D-101 deferred rerun)
    instance.count.set(1);
    flushQueue();
    assert.equal(instance.element.textContent, "Count: 1");

    // 3. Coalescing and Batching Assertion
    instance.count.set(2);
    instance.count.set(3);
    flushQueue();
    assert.equal(instance.element.textContent, "Count: 3");

    // 4. Disposal Assertion (D-102)
    disposeFn();

    // After disposal, signal updates must NOT trigger effects
    instance.count.set(4);
    flushQueue();
    assert.equal(instance.element.textContent, "Count: 3");
  });
});
