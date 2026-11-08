import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import {
  createRoot,
  createElement,
  createTextNode,
  createEffect,
  signal,
  flushQueue,
  applyHmrUpdate,
  setTrustedHtml,
  setSafeSrcset,
  setSafeStyleProperty
} from "../../packages/runtime/dist/index.js";

test("D-111: Stable Scope HMR & Live-State Preservation", async (t) => {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.window = window;

  // --- 1. Initial Component Version ---
  const initialSource = `<script>
  let count = signal(0);
  function increment() {
    count.set((c) => c + 1);
  }
</script>
<button on:click={increment}>Count: {count()}</button>`;

  const ast1 = parse(initialSource, "Counter.mix");
  const descriptor1 = analyze(ast1);
  const codegen1 = generate(descriptor1, { componentName: "Counter" });

  assert.ok(codegen1.code.includes("__scope.increment = increment;"), "Methods should be registered on __scope");
  assert.ok(codegen1.code.includes('__scope["increment"]'), "Event listener should dispatch via __scope");

  // Create component factory function via evaluated codegen code
  function createComponentFactory(generatedCode) {
    const cleanCode = generatedCode
      .replace(/import\s+[^;]+;/g, "")
      .replace(/export\s+function\s+Counter/g, "function Counter");
    const factoryCode = `
      return function(createRoot, createElement, createTextNode, createEffect, signal, setTrustedHtml, setSafeSrcset, setSafeStyleProperty) {
        ${cleanCode}
        return Counter;
      };
    `;
    const fn = new Function(factoryCode)();
    return fn(createRoot, createElement, createTextNode, createEffect, signal, setTrustedHtml, setSafeSrcset, setSafeStyleProperty);
  }

  const CounterV1 = createComponentFactory(codegen1.code);

  let instance;
  let disposeRoot;

  disposeRoot = createRoot((dispose) => {
    instance = CounterV1();
    return dispose;
  });

  // Verify initial mount
  assert.equal(instance.count(), 0);
  const button = instance.element;
  assert.equal(button.tagName.toLowerCase(), "button");
  assert.equal(button.textContent, "Count: 0");

  // Invoke initial increment
  instance.increment();
  flushQueue();
  assert.equal(instance.count(), 1, "Count should be 1 after initial increment");
  assert.equal(button.textContent, "Count: 1", "DOM should reflect count: 1");

  // --- 2. HMR Update: Version 2 with modified increment (+10) and new decrement (-1) ---
  const updatedSource = `<script>
  let count = signal(0);
  function increment() {
    count.set((c) => c + 10);
  }
  function decrement() {
    count.set((c) => c - 1);
  }
</script>
<button on:click={increment}>Count: {count()}</button>`;

  const ast2 = parse(updatedSource, "Counter.mix");
  const descriptor2 = analyze(ast2);
  const codegen2 = generate(descriptor2, { componentName: "Counter" });
  const CounterV2 = createComponentFactory(codegen2.code);

  // Apply HMR update to active component instance
  applyHmrUpdate(instance, CounterV2);

  // LIVE STATE PRESERVATION INVARIANT (D-111):
  // 1. The existing DOM element is retained
  assert.equal(instance.element, button, "DOM element identity must be retained across HMR");
  // 2. The live signal state is NOT reset to 0
  assert.equal(instance.count(), 1, "Signal state must be preserved at 1 (not reset to 0)");
  assert.equal(button.textContent, "Count: 1", "DOM text must remain 1");

  // 3. Updated method reads and mutates LIVE state: +10 -> count becomes 11
  instance.increment();
  flushQueue();
  assert.equal(instance.count(), 11, "Updated increment(+10) must operate on live count (1 + 10 = 11)");
  assert.equal(button.textContent, "Count: 11", "DOM text must update to 11");

  // 4. Newly added method executes on live state: -1 -> count becomes 10
  assert.equal(typeof instance.decrement, "function", "Newly added decrement method should be available");
  instance.decrement();
  flushQueue();
  assert.equal(instance.count(), 10, "Decrement must operate on live count (11 - 1 = 10)");
  assert.equal(button.textContent, "Count: 10", "DOM text must update to 10");

  // 5. DOM Event listener dispatches to updated method dynamically
  button.dispatchEvent(new window.Event("click"));
  flushQueue();
  assert.equal(instance.count(), 20, "DOM click event must invoke updated method (+10 -> 20)");
  assert.equal(button.textContent, "Count: 20", "DOM text must update to 20");

  disposeRoot();
});
