// Every runtime primitive that codegen imports automatically must also type-check in a .tix file
// without an explicit import; otherwise `mix check` rejects code that compiles and runs.

import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { AUTO_IMPORTABLE_RUNTIME_PRIMITIVES } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";

function typecheckComponent(source) {
  const descriptor = analyze(parse(source, { filename: "Probe.tix" }), { filename: "Probe.tix", source, throwOnError: false });
  return typecheckTix(descriptor, source, { filename: "Probe.tix", throwOnError: false }).diagnostics;
}

for (const primitiveName of AUTO_IMPORTABLE_RUNTIME_PRIMITIVES) {
  test(`${primitiveName} is declared for .tix without an import`, () => {
    const diagnostics = typecheckComponent(
      `export default function Probe() {\n  const reference = ${primitiveName};\n  void reference;\n  return (<p>probe</p>);\n}\n`
    );
    assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.message), []);
  });
}

test("auto-imported lifecycle hooks keep their runtime signatures", () => {
  const validDiagnostics = typecheckComponent(
    "export default function Probe() {\n  onCleanup(() => {});\n  batch(() => {});\n  return (<p>probe</p>);\n}\n"
  );
  assert.deepEqual(validDiagnostics.map((diagnostic) => diagnostic.message), []);
  const invalidDiagnostics = typecheckComponent(
    'export default function Probe() {\n  onCleanup("not a function");\n  return (<p>probe</p>);\n}\n'
  );
  assert.equal(invalidDiagnostics.length > 0, true, "a wrong argument type must still be reported");
});
