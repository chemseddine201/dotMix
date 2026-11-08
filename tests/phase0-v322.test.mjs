import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

test("Phase 0 (v3.2.2 / AGENTS.md Gate 0) — Architecture & Contracts Lock", async (t) => {
  // 1. Governance & Contract Files
  await t.test("AGENTS.md and CONTRACTS.md exist and are non-empty", () => {
    assert.ok(existsSync("AGENTS.md"), "AGENTS.md must exist in root");
    assert.ok(existsSync("CONTRACTS.md"), "CONTRACTS.md must exist in root");
    assert.ok(existsSync("spec/MIX_SPEC_v3.2.2.md"), "spec/MIX_SPEC_v3.2.2.md must exist");

    const agentsText = readFileSync("AGENTS.md", "utf8");
    assert.ok(agentsText.includes("Compiler-Native UI Language"));
    assert.ok(agentsText.includes("The Push-Pull Reactive Scheduler"));
    assert.ok(agentsText.includes("Phase 0 — Architecture & Contracts"));
  });

  // 2. tsconfig.base.json FROZEN Block (§1.2 / R-TS-01)
  await t.test("tsconfig.base.json strictly matches the v3.2.2 FROZEN configuration", () => {
    const raw = readFileSync("tsconfig.base.json", "utf8");
    const parsed = JSON.parse(raw);
    const co = parsed.compilerOptions;

    assert.equal(co.strict, true);
    assert.equal(co.noUncheckedIndexedAccess, true);
    assert.equal(co.isolatedModules, true);
    assert.equal(co.verbatimModuleSyntax, true);
    assert.equal(co.erasableSyntaxOnly, true);
    assert.equal(co.module.toLowerCase(), "nodenext");
    assert.equal(co.moduleResolution.toLowerCase(), "nodenext");
    assert.equal(co.target.toLowerCase(), "es2022");
    assert.equal(co.declaration, true);
    assert.equal(co.sourceMap, true);
  });

  // 3. Package Structure and type: "module" (R-TS-03)
  await t.test("All packages have type: 'module' and valid package manifests", () => {
    const packagesDir = resolve("packages");
    const dirs = readdirSync(packagesDir, { withFileTypes: true }).filter((d) => d.isDirectory());

    for (const d of dirs) {
      const pkgJsonPath = join(packagesDir, d.name, "package.json");
      assert.ok(existsSync(pkgJsonPath), `Missing package.json in packages/${d.name}`);

      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      assert.equal(pkg.type, "module", `packages/${d.name}/package.json must specify "type": "module" (R-TS-03)`);
    }
  });

  // 4. Locked Types in @mix/runtime (packages/runtime/src/types.ts)
  await t.test("packages/runtime/src/types.ts defines locked scheduler and lifecycle states", async () => {
    assert.ok(existsSync("packages/runtime/src/types.ts"), "packages/runtime/src/types.ts must exist");

    const typesMod = await import("../packages/runtime/dist/types.js");

    // ComputationState: CLEAN(0), CHECK(1), DIRTY(2), RUNNING(3), DISPOSED(4)
    assert.equal(typesMod.ComputationState.CLEAN, 0);
    assert.equal(typesMod.ComputationState.CHECK, 1);
    assert.equal(typesMod.ComputationState.DIRTY, 2);
    assert.equal(typesMod.ComputationState.RUNNING, 3);
    assert.equal(typesMod.ComputationState.DISPOSED, 4);

    // OwnerState: ACTIVE(0), DISPOSED(1)
    assert.equal(typesMod.OwnerState.ACTIVE, 0);
    assert.equal(typesMod.OwnerState.DISPOSED, 1);
  });

  // 5. Locked AST in @mix/ast (packages/ast/src/index.ts)
  await t.test("packages/ast defines AST nodes and SourceSpan structures", async () => {
    assert.ok(existsSync("packages/ast/src/index.ts"), "packages/ast/src/index.ts must exist");
    const astMod = await import("../packages/ast/dist/index.js");
    assert.equal(typeof astMod.walk, "function");
    assert.equal(typeof astMod.createComponentNode, "function");
    assert.equal(typeof astMod.createDynamicElementNode, "function");
  });

  // 6. Core Runtime Purity (Zero DOM / Node Globals in Core)
  await t.test("Core runtime types have zero reference to browser DOM elements", () => {
    const typesSource = readFileSync("packages/runtime/src/types.ts", "utf8");
    assert.ok(!typesSource.includes("HTMLElement"), "Core types must not reference HTMLElement");
    assert.ok(!/:\s*Node\b/.test(typesSource), "Core types must not reference DOM Node directly");
    assert.ok(!typesSource.includes("@mix/runtime/dom"), "Core types must not import from @mix/runtime/dom");
    assert.ok(typesSource.includes("RendererAdapter"), "Core types must define RendererAdapter abstraction");
  });
});
