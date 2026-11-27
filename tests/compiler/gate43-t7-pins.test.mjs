import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../fixtures/gate43/helpers.mjs";

describe("Gate 43 T7 — Exact TypeScript Dependency Pin (R1)", () => {
  it("pins identical exact typescript versions in compiler-frontend and compiler-semantic", () => {
    const frontendPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "packages", "compiler-frontend", "package.json"), "utf8")
    );
    const semanticPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "packages", "compiler-semantic", "package.json"), "utf8")
    );

    const frontendPin = frontendPkg.dependencies?.typescript;
    const semanticPin = semanticPkg.dependencies?.typescript;

    assert.strictEqual(typeof semanticPin, "string", "compiler-semantic must declare dependencies.typescript");
    assert.strictEqual(typeof frontendPin, "string", "compiler-frontend must declare dependencies.typescript");
    assert.ok(!/^[~^<>]/.test(frontendPin), `compiler-frontend typescript pin must be exact, got: ${frontendPin}`);
    assert.strictEqual(
      frontendPin,
      semanticPin,
      `TypeScript pin mismatch: compiler-frontend=${frontendPin}, compiler-semantic=${semanticPin}`
    );
  });
});

