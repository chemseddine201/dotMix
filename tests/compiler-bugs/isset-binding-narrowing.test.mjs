import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import { DiagnosticCodes } from "../../packages/diagnostics/dist/index.js";

function runTixCheck(sourceCode, filename = "IsSetDemo.tix") {
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  const typecheckResult = typecheckTix(descriptor, sourceCode, {
    filename,
    throwOnError: false
  });
  return {
    descriptor,
    diagnostics: [...descriptor.diagnostics, ...typecheckResult.diagnostics]
  };
}

test("isset directive narrows binding to NonNullable<T> even when binding shadows signal name", () => {
  const sourceCode = `import { signal } from "@dotmix/runtime";
interface UserProfile { name: string; }
export default function IsSetDemo() {
  const profile = signal<UserProfile | null>({ name: "Ada" });
  return (
    <div>
      {isset profile() as profile}<span>{profile.name}</span>{endisset}
    </div>
  );
}
`;
  const { descriptor, diagnostics } = runTixCheck(sourceCode, "IsSetDemo.tix");
  assert.deepEqual(diagnostics, []);
  const compiled = generate(descriptor, { filename: "IsSetDemo.tix", componentName: "IsSetDemo" });
  assert.ok(compiled.js.includes("__mixIsSet"));
});

test("isset directive reports invalid property access on narrowed binding", () => {
  const invalidSource = `import { signal } from "@dotmix/runtime";
interface UserProfile { name: string; }
export default function IsSetInvalid() {
  const profile = signal<UserProfile | null>({ name: "Ada" });
  return (
    <div>
      {isset profile() as profile}<span>{profile.missingField}</span>{endisset}
    </div>
  );
}
`;
  const { diagnostics } = runTixCheck(invalidSource, "IsSetInvalid.tix");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
  assert.ok(diagnostics[0].message.includes("missingField"));
});

