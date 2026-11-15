import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";

function runTixCheckAndBuild(sourceCode, filename = "KeepAliveDemo.tix") {
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  const typecheckResult = typecheckTix(descriptor, sourceCode, {
    filename,
    throwOnError: false
  });
  const compiled = generate(descriptor, { filename, componentName: "KeepAliveDemo" });
  return {
    diagnostics: [...descriptor.diagnostics, ...typecheckResult.diagnostics],
    compiled
  };
}

test("keepalive block mode with 'as key' binding typechecks and builds with zero diagnostics", () => {
  const blockSource = `import { signal } from "@dotmix/runtime";
export default function KeepAliveBlockDemo() {
  const activeTab = signal("overview");
  const TabPanel = (_props: { id: string }) => null;
  return (
    <div>
      {keepalive activeTab() max 5 as key}<TabPanel id={key} />{endkeepalive}
    </div>
  );
}
`;
  const { diagnostics, compiled } = runTixCheckAndBuild(blockSource, "KeepAliveBlockDemo.tix");
  assert.deepEqual(diagnostics, []);
  assert.ok(compiled.js.includes("__KeepAlive"));
});

test("KeepAlive component mode with child function binding typechecks and builds with zero diagnostics", () => {
  const componentSource = `import { signal } from "@dotmix/runtime";
import { KeepAlive } from "@dotmix/runtime/directives";
export default function KeepAliveCompDemo() {
  const activeTab = signal("overview");
  const TabPanel = (_props: { id: string }) => null;
  return (
    <div>
      <KeepAlive activeKey={activeTab()} max={5}>{(key) => <TabPanel id={key} />}</KeepAlive>
    </div>
  );
}
`;
  const { diagnostics, compiled } = runTixCheckAndBuild(componentSource, "KeepAliveCompDemo.tix");
  assert.deepEqual(diagnostics, []);
  assert.ok(compiled.js.includes("__KeepAlive"));
  assert.ok(compiled.js.includes("__get_kaKey_"));
});
