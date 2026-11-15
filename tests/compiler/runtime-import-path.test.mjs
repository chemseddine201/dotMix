// The runtime import is the runtime module's identity: codegen must emit it exactly as given, so
// compiled code and its host resolve the same URL and share one runtime on every machine and OS.

import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";
import { runtimeUrl } from "../support/module-urls.mjs";

const componentSource = `import { signal } from "@dotmix/runtime";
export default function Counter() {
  const count = signal(0);
  return <button onClick={() => count.set(count() + 1)}>{count()}</button>;
}
`;

function compileWithRuntime(runtimeImportPath) {
  const ast = parse(componentSource, { filename: "Counter.mix" });
  const descriptor = analyze(ast, { filename: "Counter.mix", source: componentSource });
  return generate(descriptor, { filename: "Counter.mix", runtimeImportPath }).js;
}

for (const runtimeImportPath of [
  "file:///g:/projects/app/node_modules/@dotmix/runtime/dist/index.js",
  "file:///G:/projects/app/node_modules/@dotmix/runtime/dist/index.js",
  "file:///home/dev/app/node_modules/@dotmix/runtime/dist/index.js",
  "file:///Users/dev/My%20App/node_modules/@dotmix/runtime/dist/index.js",
  "/vendor/@dotmix/runtime/dist/index.js",
]) {
  test(`codegen emits the runtime import verbatim: ${runtimeImportPath}`, () => {
    const compiledCode = compileWithRuntime(runtimeImportPath);
    assert.ok(
      compiledCode.includes(`from ${JSON.stringify(runtimeImportPath)}`),
      "the emitted runtime import must be the given specifier, byte for byte"
    );
    assert.equal(compiledCode.includes('"@dotmix/runtime"'), false, "the user's bare runtime import must be redirected too");
  });
}

test("codegen keeps the bare @dotmix/runtime specifier by default", () => {
  const compiledCode = compileWithRuntime(undefined);
  assert.ok(compiledCode.includes('from "@dotmix/runtime"'));
});

test("the test runtime URL is the one Node resolves for @dotmix/runtime", () => {
  assert.equal(runtimeUrl, import.meta.resolve("@dotmix/runtime"));
});
