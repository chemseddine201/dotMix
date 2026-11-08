import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

test("Foundation 1: Workspace package graph is strictly acyclic (DAG)", async () => {
  const packagesDir = path.join(rootDir, "packages");
  const packageFolders = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const adjacencyList = new Map();

  for (const folder of packageFolders) {
    const pkgJsonPath = path.join(packagesDir, folder, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    const deps = Object.keys(pkgJson.dependencies || {});
    adjacencyList.set(pkgJson.name, deps);
  }

  const visited = new Set();
  const inStack = new Set();

  function hasCycle(node, pathStack = []) {
    visited.add(node);
    inStack.add(node);
    pathStack.push(node);

    const neighbors = adjacencyList.get(node) || [];
    for (const neighbor of neighbors) {
      if (!adjacencyList.has(neighbor)) continue;
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor, pathStack)) return true;
      } else if (inStack.has(neighbor)) {
        pathStack.push(neighbor);
        return true;
      }
    }

    inStack.delete(node);
    pathStack.pop();
    return false;
  }

  for (const pkg of adjacencyList.keys()) {
    if (!visited.has(pkg)) {
      const cycleStack = [];
      const cycle = hasCycle(pkg, cycleStack);
      assert.strictEqual(cycle, false, `Cycle detected in workspace package dependencies: ${cycleStack.join(" -> ")}`);
    }
  }
});

test("Foundation 2: Layer boundaries, zero runtime in compiler, and deferred router", async () => {
  const packagesDir = path.join(rootDir, "packages");

  assert.strictEqual(
    fs.existsSync(path.join(packagesDir, "router")),
    false,
    "packages/router must remain absent per Charter non-goals and HAA-04"
  );

  const diagPkg = JSON.parse(fs.readFileSync(path.join(packagesDir, "diagnostics", "package.json"), "utf-8"));
  assert.deepStrictEqual(diagPkg.dependencies, {}, "@mix/diagnostics must declare zero dependencies");

  const compilerPackages = ["ast", "compiler-frontend", "compiler-semantic", "compiler-css", "compiler-codegen"];
  for (const pkg of compilerPackages) {
    const pkgPath = path.join(packagesDir, pkg, "package.json");
    if (fs.existsSync(pkgPath)) {
      const json = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      assert.strictEqual(
        "@mix/runtime" in allDeps,
        false,
        `Package ${pkg} must not depend on @mix/runtime`
      );
    }
  }
});

test("Foundation 3: @mix/runtime zero-dependency boundary and import type erasure in dist", async () => {
  const runtimePkg = JSON.parse(fs.readFileSync(path.join(rootDir, "packages/runtime/package.json"), "utf-8"));
  assert.deepStrictEqual(
    runtimePkg.dependencies,
    {},
    "@mix/runtime package.json must declare 'dependencies': {}"
  );

  const runtimeDist = path.join(rootDir, "packages/runtime/dist");
  assert.strictEqual(
    fs.existsSync(runtimeDist),
    true,
    "packages/runtime/dist must exist (run 'npm run build' before testing)"
  );

  function checkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDir(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
        const content = fs.readFileSync(fullPath, "utf-8");
        assert.strictEqual(
          /from\s+["']@mix\/diagnostics["']/.test(content),
          false,
          `Compiled runtime artifact ${entry.name} must not contain imports from @mix/diagnostics`
        );
        assert.strictEqual(
          /require\s*\(\s*["']@mix\/diagnostics["']\s*\)/.test(content),
          false,
          `Compiled runtime artifact ${entry.name} must not contain require("@mix/diagnostics")`
        );
      }
    }
  }
  checkDir(runtimeDist);

  const astDts = path.join(rootDir, "packages/ast/dist/index.d.ts");
  assert.strictEqual(fs.existsSync(astDts), true, "packages/ast/dist/index.d.ts must exist");
  const astDtsContent = fs.readFileSync(astDts, "utf-8");
  assert.strictEqual(
    /from\s+["'](?!@mix\/diagnostics["'])[^."']/.test(astDtsContent),
    false,
    "@mix/ast index.d.ts must not leak external third-party package imports"
  );
});

test("Foundation 4: Runtime and Diagnostics MixError and code parity", async () => {
  const diagModule = await import("../../packages/diagnostics/dist/index.js");
  const runtimeModule = await import("../../packages/runtime/dist/errors.js");

  assert.ok(diagModule.DiagnosticCodes, "@mix/diagnostics must export DiagnosticCodes");
  assert.ok(runtimeModule.DiagnosticCodes, "@mix/runtime must export DiagnosticCodes");

  for (const [key, val] of Object.entries(diagModule.DiagnosticCodes)) {
    assert.strictEqual(
      runtimeModule.DiagnosticCodes[key],
      val,
      `Diagnostic code mismatch for ${key}`
    );
  }

  const err1 = new diagModule.MixError(diagModule.DiagnosticCodes.MIX_ERR_DUPLICATE_KEY, "test");
  const err2 = new runtimeModule.MixError(runtimeModule.DiagnosticCodes.MIX_ERR_DUPLICATE_KEY, "test");

  assert.strictEqual(err1.code, err2.code);
  assert.strictEqual(err1.message, err2.message);
  assert.strictEqual(err1.name, err2.name);
});

test("Foundation 5: Exact version pins across all package manifests (no ^, ~, *, or >=)", async () => {
  const manifests = [
    path.join(rootDir, "package.json"),
    ...fs.readdirSync(path.join(rootDir, "packages"), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(rootDir, "packages", d.name, "package.json"))
  ];

  const semverRangeRegex = /^[\^~*]|>=/;

  for (const manifestPath of manifests) {
    if (!fs.existsSync(manifestPath)) continue;
    const json = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const pkgName = json.name;

    for (const depType of ["dependencies", "devDependencies"]) {
      const deps = json[depType] || {};
      for (const [dep, ver] of Object.entries(deps)) {
        assert.strictEqual(
          semverRangeRegex.test(ver),
          false,
          `Package ${pkgName} ${depType}["${dep}"] = "${ver}" must be an exact pin, not a range`
        );
      }
    }
  }
});

test("Foundation 6: All 10 canonical specs and SOURCE_PROVENANCE.md exist without stubs", async () => {
  const expectedSpecs = [
    "LANGUAGE.md",
    "AST.md",
    "SEMANTICS.md",
    "RUNTIME_API.md",
    "CSS_SCOPING.md",
    "DIAGNOSTICS.md",
    "SECURITY.md",
    "TESTING.md",
    "PERFORMANCE.md",
    "COMPATIBILITY.md",
    "SOURCE_PROVENANCE.md",
    "README.md"
  ];

  for (const specFile of expectedSpecs) {
    const specPath = path.join(rootDir, "spec", specFile);
    assert.strictEqual(fs.existsSync(specPath), true, `spec/${specFile} must exist`);
    const content = fs.readFileSync(specPath, "utf-8");
    assert.ok(content.length > 200, `spec/${specFile} must not be empty or a stub`);
    assert.strictEqual(
      content.includes("TODO") || content.includes("[Placeholder]") || content.includes("TBD"),
      false,
      `spec/${specFile} must not contain placeholder stubs`
    );
  }
});
