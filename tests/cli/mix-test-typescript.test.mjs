// `mix test` runs project tests that import TypeScript modules with the usual NodeNext `.js`
// specifiers (`import { x } from "../../src/x.js"` for `src/x.ts`), as the scaffolded tests do.

/* global process */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const binPath = path.join(repoRoot, "packages/cli/dist/bin.js");

function writeProjectFile(projectDir, relativePath, content) {
  const target = path.join(projectDir, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf-8");
}

function runMixTest(projectDir) {
  const result = spawnSync(process.execPath, [binPath, "test"], {
    cwd: projectDir,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" }
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("mix test with TypeScript sources", () => {
  it("runs a test that imports .ts modules through .js specifiers, including nested imports and types", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-test-ts-"));
    try {
      writeProjectFile(projectDir, "package.json", JSON.stringify({ name: "probe", type: "module" }));
      writeProjectFile(projectDir, "src/labels.ts", [
        "export type Currency = \"EUR\" | \"USD\";",
        "export function label(amount: number, currency: Currency): string {",
        "  return `${amount.toFixed(2)} ${currency}`;",
        "}",
        ""
      ].join("\n"));
      writeProjectFile(projectDir, "src/pricing.ts", [
        "import { label } from \"./labels.js\";",
        "import type { Currency } from \"./labels.js\";",
        "interface Line { readonly price: number; readonly quantity: number }",
        "export function total(lines: readonly Line[], currency: Currency): string {",
        "  return label(lines.reduce((sum, line) => sum + line.price * line.quantity, 0), currency);",
        "}",
        ""
      ].join("\n"));
      writeProjectFile(projectDir, "tests/unit/pricing.test.mjs", [
        "import { test } from \"node:test\";",
        "import assert from \"node:assert/strict\";",
        "import { total } from \"../../src/pricing.js\";",
        "test(\"totals the lines\", () => {",
        "  assert.equal(total([{ price: 2.5, quantity: 2 }, { price: 1, quantity: 3 }], \"EUR\"), \"8.00 EUR\");",
        "});",
        ""
      ].join("\n"));

      const { status, output } = runMixTest(projectDir);
      assert.equal(status, 0, output);
      assert.match(output, /totals the lines/);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("still reports a real assertion failure with exit code 1", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-test-ts-"));
    try {
      writeProjectFile(projectDir, "package.json", JSON.stringify({ name: "probe", type: "module" }));
      writeProjectFile(projectDir, "src/value.ts", "export const value: number = 1;\n");
      writeProjectFile(projectDir, "tests/value.test.mjs", [
        "import { test } from \"node:test\";",
        "import assert from \"node:assert/strict\";",
        "import { value } from \"../src/value.js\";",
        "test(\"value is two\", () => { assert.equal(value, 2); });",
        ""
      ].join("\n"));

      const { status } = runMixTest(projectDir);
      assert.equal(status, 1);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
