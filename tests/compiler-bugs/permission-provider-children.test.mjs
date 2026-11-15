import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";

test("PermissionProvider used with template children in .tix does not require an explicit children prop", () => {
  const sourceCode = `import { defineAbility, PermissionProvider } from "@dotmix/runtime/permissions";
const ability = defineAbility((can) => {
  can("read", "Post");
});
export default function PermissionProviderDemo() {
  return (
    <PermissionProvider ability={ability}>
      {can "read" on "Post"}<p>Readable</p>{endcan}
    </PermissionProvider>
  );
}
`;
  const filename = "PermissionProviderDemo.tix";
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  const typecheckResult = typecheckTix(descriptor, sourceCode, {
    filename,
    throwOnError: false
  });
  const compiled = generate(descriptor, { filename, componentName: "PermissionProviderDemo" });

  const diagnostics = [...descriptor.diagnostics, ...typecheckResult.diagnostics];
  assert.deepEqual(diagnostics, []);
  assert.ok(compiled.js.includes("PermissionProvider"));
});

