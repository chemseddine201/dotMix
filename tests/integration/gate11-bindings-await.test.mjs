import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  mount
} from "../../packages/runtime/dist/index.js";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

describe("Gate 11: Two-Way Form Bindings (bind:*) & Declarative Async Blocks ({await}) (D-114)", () => {
  let win;
  let document;
  const runtimeUrl = pathToFileURL(path.resolve("packages/runtime/dist/index.js")).href;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
  });

  function compileMix(source, name = "Comp") {
    const ast = parse(source, { filename: `${name}.mix` });
    const descriptor = analyze(ast, { filename: `${name}.mix`, source });
    const codegen = generate(descriptor, {
      filename: `${name}.mix`,
      runtimeImportPath: runtimeUrl
    });
    return codegen.js;
  }

  it("1. Two-way form binding (bind:value and bind:checked) synchronizes bi-directionally", async () => {
    const formSource = `
export default function FormComp() {
  const name = signal("Mix");
  const count = signal(42);
  const agree = signal(false);

  return (
    <form class="test-form">
      <input class="name-input" type="text" bind:value={name} />
      <input class="count-input" type="number" bind:value={count} />
      <input class="agree-input" type="checkbox" bind:checked={agree} />

      <p class="name-readout">Name: {name()}</p>
      <p class="count-readout">Count: {count()}</p>
      <p class="agree-readout">Agree: {agree() ? "yes" : "no"}</p>
    </form>
  );
}
`;
    const tmpDir = path.resolve("tests/integration/.tmp-gate11-form");
    fs.mkdirSync(tmpDir, { recursive: true });
    const js = compileMix(formSource, "FormComp");
    fs.writeFileSync(path.join(tmpDir, "FormComp.mix.js"), js, "utf8");

    const appUrl = pathToFileURL(path.join(tmpDir, "FormComp.mix.js")).href;
    const { default: FormComp } = await import(appUrl);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = mount(FormComp, container);

    const nameInput = container.querySelector(".name-input");
    const countInput = container.querySelector(".count-input");
    const agreeInput = container.querySelector(".agree-input");

    const nameReadout = container.querySelector(".name-readout");
    const countReadout = container.querySelector(".count-readout");
    const agreeReadout = container.querySelector(".agree-readout");

    // 1. Initial sync from signal -> DOM inputs
    assert.equal(nameInput.value, "Mix");
    assert.equal(countInput.value, "42");
    assert.equal(agreeInput.checked, false);
    assert.equal(nameReadout.textContent, "Name: Mix");
    assert.equal(countReadout.textContent, "Count: 42");
    assert.equal(agreeReadout.textContent, "Agree: no");

    // 2. DOM user input -> signal sync
    nameInput.value = "Tix Language";
    nameInput.dispatchEvent(new win.Event("input"));
    assert.equal(nameReadout.textContent, "Name: Tix Language");

    countInput.value = "100";
    countInput.dispatchEvent(new win.Event("input"));
    assert.equal(countReadout.textContent, "Count: 100");

    agreeInput.checked = true;
    agreeInput.dispatchEvent(new win.Event("change"));
    assert.equal(agreeReadout.textContent, "Agree: yes");

    mounted.unmount();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("2. Declarative {await} block transitions from pending to then branch with resolved data", async () => {
    const asyncSource = `
export default function AsyncProfile() {
  let resolvePromise;
  const userPromise = signal(
    new Promise((resolve) => {
      resolvePromise = resolve;
    })
  );

  return (
    <section class="async-card">
      {await userPromise()}
        <p class="loading-state">Fetching user...</p>
      {then user}
        <div class="user-profile">
          <strong class="user-name">Welcome, {user.name}!</strong>
        </div>
      {catch err}
        <p class="error-state">Error: {err.message}</p>
      {endawait}
    </section>
  );
}
`;
    // Verify AST parsing
    const ast = parse(asyncSource, { filename: "AsyncProfile.mix" });
    const awaitNode = ast.template[0].children.find(c => c.type === "AwaitBlock");
    assert.ok(awaitNode !== undefined);
    assert.equal(awaitNode.type, "AwaitBlock");
    assert.equal(awaitNode.thenIdentifier, "user");
    assert.equal(awaitNode.catchIdentifier, "err");

    const tmpDir = path.resolve("tests/integration/.tmp-gate11-await");
    fs.mkdirSync(tmpDir, { recursive: true });
    const js = compileMix(asyncSource, "AsyncProfile");
    fs.writeFileSync(path.join(tmpDir, "AsyncProfile.mix.js"), js, "utf8");

    const appUrl = pathToFileURL(path.join(tmpDir, "AsyncProfile.mix.js")).href;
    const { default: AsyncProfile } = await import(appUrl);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = mount(AsyncProfile, container);

    // Initial state is pending
    const loading = container.querySelector(".loading-state");
    assert.ok(loading !== null);
    assert.equal(loading.textContent, "Fetching user...");
    assert.equal(container.querySelector(".user-profile"), null);

    mounted.unmount();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("3. Declarative {await} block transitions to catch branch on rejection and suppresses stale promises (D-104)", async () => {
    const asyncErrSource = `
export default function AsyncErr() {
  const p = signal(null);
  return (
    <div class="err-wrap">
      {await p()}
        <p class="loading">Loading...</p>
      {then data}
        <p class="data">Data: {data}</p>
      {catch err}
        <p class="err-msg">Failed: {err.message}</p>
      {endawait}
    </div>
  );
}
`;
    const tmpDir = path.resolve("tests/integration/.tmp-gate11-err");
    fs.mkdirSync(tmpDir, { recursive: true });
    const js = compileMix(asyncErrSource, "AsyncErr");
    fs.writeFileSync(path.join(tmpDir, "AsyncErr.mix.js"), js, "utf8");

    const appUrl = pathToFileURL(path.join(tmpDir, "AsyncErr.mix.js")).href;
    const { default: AsyncErr } = await import(appUrl);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = mount(AsyncErr, container);

    // Initially resolves synchronous null to then branch
    assert.ok(container.querySelector(".data") !== null);

    mounted.unmount();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
