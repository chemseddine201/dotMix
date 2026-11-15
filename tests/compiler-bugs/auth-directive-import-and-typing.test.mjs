import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import { DiagnosticCodes } from "../../packages/diagnostics/dist/index.js";
import { runtimeUrl } from "../support/module-urls.mjs";

// Test and compiled component load the runtime from the URL Node resolves, so they share one instance.
const runtime = await import(runtimeUrl);

const authDemoSource = `import { createAuth, AuthProvider } from "@dotmix/runtime/directives";
const accountAuth = createAuth({ guards: { web: () => ({ name: "Ada" }) }, defaultGuard: "web" });
export default function AuthDemo() {
  return (
    <AuthProvider value={accountAuth}>
      {auth as user}<p>Welcome back, {user.name}</p>{else}<p>Guest</p>{endauth}
    </AuthProvider>
  );
}
`;

function runTixCheck(sourceCode, filename = "AuthDemo.tix") {
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  const typecheckResult = typecheckTix(descriptor, sourceCode, {
    filename,
    throwOnError: false
  });
  return [...descriptor.diagnostics, ...typecheckResult.diagnostics];
}

test("compiled output keeps createAuth and AuthProvider imports and renders Welcome back, Ada", async () => {
  const filename = "AuthDemo.tix";
  const ast = parse(authDemoSource, { filename });
  const descriptor = analyze(ast, { filename, source: authDemoSource, throwOnError: false });
  const compiled = generate(descriptor, {
    filename,
    componentName: "AuthDemo",
    runtimeImportPath: runtimeUrl
  });

  assert.ok(
    compiled.js.includes("createAuth"),
    "Expected compiled JS to import createAuth"
  );
  assert.ok(
    compiled.js.includes("AuthProvider"),
    "Expected compiled JS to import AuthProvider"
  );

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-auth-demo-"));
  const modulePath = path.join(fixtureDir, "AuthDemo.mjs");
  fs.writeFileSync(modulePath, compiled.js, "utf-8");

  const domWindow = new Window({ url: "http://localhost:3000/" });
  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement
  };
  Object.assign(globalThis, {
    window: domWindow,
    document: domWindow.document,
    Node: domWindow.Node,
    Element: domWindow.Element,
    HTMLElement: domWindow.HTMLElement
  });

  try {
    const importedModule = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
    const container = domWindow.document.createElement("div");
    const mounted = runtime.mount(importedModule.default, container);
    assert.equal(container.textContent?.trim(), "Welcome back, Ada");
    mounted.unmount();
  } finally {
    domWindow.close();
    Object.assign(globalThis, previousGlobals);
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("auth directive binding user is typed from auth configuration with zero diagnostics", () => {
  const diagnostics = runTixCheck(authDemoSource, "AuthDemo.tix");
  assert.deepEqual(diagnostics, []);

  const invalidPropertySource = `import { createAuth, AuthProvider } from "@dotmix/runtime/directives";
const accountAuth = createAuth({ guards: { web: () => ({ name: "Ada" }) }, defaultGuard: "web" });
export default function AuthDemoInvalid() {
  return (
    <AuthProvider value={accountAuth}>
      {auth as user}<p>Welcome back, {user.nonexistentField}</p>{else}<p>Guest</p>{endauth}
    </AuthProvider>
  );
}
`;
  const invalidDiagnostics = runTixCheck(invalidPropertySource, "AuthDemoInvalid.tix");
  assert.ok(
    invalidDiagnostics.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE),
    "Expected invalid property on typed user to report MIX_ERR_INVALID_PROP_TYPE"
  );
});

