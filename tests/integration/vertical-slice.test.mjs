import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { Window } from "happy-dom";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import { mount } from "../../packages/runtime/dist/index.js";

const runtimeUrl = pathToFileURL(
  path.resolve("packages/runtime/dist/index.js")
).href;

async function compileAndImport(source, filename = "Counter.mix") {
  const ast = parse(source, { filename });
  const descriptor = analyze(ast, { filename, source, throwOnError: true });
  const codegen = generate(descriptor, {
    filename,
    runtimeImportPath: runtimeUrl
  });
  const encoded = globalThis.Buffer.from(codegen.js, "utf8").toString("base64");
  const mod = await import(`data:text/javascript;base64,${encoded}`);
  return { ast, descriptor, codegen, Component: mod.default };
}

describe("Gate 5: Unmocked End-to-End Vertical Slice (.mix / .tix -> AST -> Semantic -> Codegen -> Runtime -> DOM)", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
  });

  it("compiles, mounts, updates via events, and unmounts a real .mix component end-to-end without mocks", async () => {
    const source = `
<script>
  const count = signal(2);
  const doubled = computed(() => count() * 2);
  const headingTag = "h2";
  const boxRef = createRef(null);

  function increment() {
    count.set(count() + 1);
  }
</script>

<style>
  .counter-card {
    border: 1px solid #333;
  }
</style>

<section class="counter-card" ref={boxRef}>
  <{~headingTag} class="title" data-count={count()}>Count: {count()} (Doubled: {doubled()})</{~headingTag}>
  {#if count() >= 4}
    <p class="milestone">Milestone reached!</p>
  {:else}
    <p class="milestone">Keep clicking...</p>
  {/if}
  <button class="inc-btn" on:click={increment}>+1</button>
</section>
`;

    const { ast, descriptor, codegen, Component } = await compileAndImport(source, "Counter.mix");

    // 1. Source compiles & 2. AST can be inspected
    assert.equal(ast.type, "Component");
    assert.ok(ast.script !== null && ast.style !== null);
    assert.equal(ast.template[0].type, "Element");

    // 3. Signal binding is resolved in semantic descriptor
    assert.ok(descriptor.signals.includes("count"));
    assert.ok(descriptor.computeds.includes("doubled"));
    assert.ok(descriptor.refs.includes("boxRef"));
    assert.ok(descriptor.functions.includes("increment"));

    // 4. Generated JavaScript is readable & 5. Direct DOM operations (no Virtual DOM)
    assert.ok(codegen.js.includes("__createElement(\"section\""));
    assert.ok(codegen.js.includes("__createDynamicElement"));
    assert.ok(!codegen.js.includes("createElement(\"vnode\""));

    // 10. Source maps & scoped CSS are valid
    assert.ok(codegen.css.includes(".counter-card[data-mix-"));
    assert.ok(codegen.scopeAttribute.startsWith("data-mix-"));
    assert.equal(codegen.map.version, 3);
    assert.equal(typeof codegen.map.mappings, "string");
    assert.ok(codegen.map.mappings.length > 0);

    const root = document.createElement("div");
    document.body.appendChild(root);

    const mounted = mount(Component, root);

    // Verify scoped stylesheet injected into document.head
    const injectedStyle = document.head.querySelector(`style[data-mix-style="${codegen.scopeId}"]`);
    assert.ok(injectedStyle !== null);

    // Verify initial DOM structure & dynamic element <{~headingTag}> with preserved attributes (D-105, TECH-06)
    const section = root.querySelector("section.counter-card");
    assert.ok(section !== null);
    assert.equal(section.hasAttribute(codegen.scopeAttribute), true);

    const heading = section.querySelector("h2.title");
    assert.ok(heading !== null);
    assert.equal(heading.getAttribute("data-count"), "2");
    assert.equal(heading.textContent, "Count: 2 (Doubled: 4)");
    assert.equal(section.querySelector("p.milestone").textContent, "Keep clicking...");

    // Capture exact Text node reference before update (Assertion 6 & 7)
    const countTextNodeBefore = heading.childNodes[1];
    const button = section.querySelector("button.inc-btn");

    // Simulate real user click events
    button.click();
    assert.equal(heading.getAttribute("data-count"), "3");
    assert.equal(heading.textContent, "Count: 3 (Doubled: 6)");
    assert.equal(section.querySelector("p.milestone").textContent, "Keep clicking...");

    // 6. Signal update mutates existing Text node in place; 7. Static DOM is not recreated
    assert.equal(heading.childNodes[1], countTextNodeBefore);
    assert.equal(root.querySelector("section.counter-card"), section);
    assert.equal(section.querySelector("h2.title"), heading);

    button.click();
    assert.equal(heading.getAttribute("data-count"), "4");
    assert.equal(heading.textContent, "Count: 4 (Doubled: 8)");
    assert.equal(section.querySelector("p.milestone").textContent, "Milestone reached!");

    // 8 & 9. Unmount disposes owner & subscriptions; subsequent clicks do not execute disposed effects
    mounted.unmount();
    assert.equal(root.querySelector("section.counter-card"), null);
    button.click();
    assert.equal(heading.textContent, "Count: 4 (Doubled: 8)");
  });

  it("compiles and typechecks a .tix component with keyed {#each} and reactive props end-to-end", async () => {
    const tixSource = `
<script lang="ts">
  interface TodoItem {
    id: string;
    title: string;
  }

  const props = defineProps<{ heading: string }>({ heading: "Tasks" });
  const todos = signal<TodoItem[]>([
    { id: "t1", title: "Write compiler" },
    { id: "t2", title: "Verify runtime" }
  ]);

  function reverseTodos(): void {
    todos.set([...todos()].reverse());
  }
</script>

<div class="todo-board">
  <h3>{props.heading}</h3>
  <button class="rev-btn" on:click={reverseTodos}>Reverse</button>
  <ul>
    {#each todos() as item, idx (item.id)}
      <li data-id={item.id}>{idx}: {item.title}</li>
    {/each}
  </ul>
</div>
`;

    const ast = parse(tixSource, { filename: "TodoBoard.tix" });
    const descriptor = analyze(ast, { filename: "TodoBoard.tix", source: tixSource, throwOnError: true });
    const tc = typecheckTix(descriptor, tixSource, { throwOnError: true });
    assert.equal(tc.diagnostics.length, 0);

    const { Component } = await compileAndImport(tixSource, "TodoBoard.tix");
    const host = document.createElement("div");
    const mounted = mount(Component, host, { heading: "Gate 5 Roadmap" });

    assert.equal(host.querySelector("h3").textContent, "Gate 5 Roadmap");
    const initialItems = [...host.querySelectorAll("li")];
    assert.equal(initialItems.length, 2);
    assert.deepEqual(
      initialItems.map((li) => li.textContent),
      ["0: Write compiler", "1: Verify runtime"]
    );

    // Click reverse button and verify DOM node identity is preserved via LIS reconciliation
    host.querySelector("button.rev-btn").click();
    const reversedItems = [...host.querySelectorAll("li")];
    assert.equal(reversedItems[0], initialItems[1]);
    assert.equal(reversedItems[1], initialItems[0]);
    assert.deepEqual(
      reversedItems.map((li) => li.textContent),
      ["0: Verify runtime", "1: Write compiler"]
    );

    mounted.unmount();
  });
});
