/* global document */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";
import { runtimeUrl } from "../support/module-urls.mjs";
import { Window } from "happy-dom";

describe(": Two-instance Event Handler Scoping", () => {
  it("clicking instance A invokes instance A's own handler, not instance B", async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    const source = `
import { signal } from "@dotmix/runtime";

export default function Counter(props = {}) {
  const count = signal(0);
  const inc = () => {
    count.set(count() + 1);
  };
  return (
    <div class="counter" id={props.id}>
      <span class="count-val">{count()}</span>
      <button class="btn" onClick={inc}>+1</button>
    </div>
  );
}
`;
    const ast = parse(source, { filename: "Counter.mix" });
    const descriptor = analyze(ast, { filename: "Counter.mix", source });
    const result = generate(descriptor, {
      filename: "Counter.mix",
      runtimeImportPath: runtimeUrl,
      hmr: true
    });

    // Verify codegen does NOT wrap in __hmr.trampoline
    assert.strictEqual(
      result.code.includes("__hmr.trampoline"),
      false,
      "Handlers must not be wrapped in __hmr.trampoline"
    );
    assert.strictEqual(
      result.code.includes("__createHmrScope"),
      false,
      "Component body must not emit __createHmrScope"
    );

    // Evaluate component code and mount two instances
    const tmpFile = path.join(os.tmpdir(), `mix-two-instance-${Date.now()}.mjs`);
    fs.writeFileSync(tmpFile, result.code.replaceAll("@dotmix/runtime", runtimeUrl), "utf-8");
    let Counter;
    try {
      const mod = await import(pathToFileURL(tmpFile).href);
      Counter = mod.default;
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }

    const containerA = document.createElement("div");
    const containerB = document.createElement("div");
    document.body.appendChild(containerA);
    document.body.appendChild(containerB);

    const domNodesA = Counter({ id: "inst-A" });
    for (const node of domNodesA) containerA.appendChild(node);

    const domNodesB = Counter({ id: "inst-B" });
    for (const node of domNodesB) containerB.appendChild(node);

    const btnA = containerA.querySelector(".btn");
    const btnB = containerB.querySelector(".btn");
    const valA = containerA.querySelector(".count-val");
    const valB = containerB.querySelector(".count-val");

    // Click A: only A should increment
    btnA.click();
    assert.strictEqual(valA.textContent, "1", "Instance A must increment when clicked");
    assert.strictEqual(valB.textContent, "0", "Instance B must NOT increment when A is clicked");

    // Click B: only B should increment
    btnB.click();
    assert.strictEqual(valA.textContent, "1", "Instance A must remain 1");
    assert.strictEqual(valB.textContent, "1", "Instance B must increment to 1");
  });
});
