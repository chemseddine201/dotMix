import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";
import { mix } from "../../node_modules/@dotmix/vite-plugin/dist/index.js";
import { build } from "../../node_modules/@dotmix/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures/test-app");

const FORBIDDEN_HMR_PATTERNS = [
  "import.meta.hot",
  "__mix_hmr",
  "createHmrScope",
  "__createHmrScope",
  "hmrComponentRegistry",
  "__hmr_start",
  "__hmr_end"
];

describe(": Production Purity", () => {
  it("1. compiler-codegen with hmr: false emits zero HMR strings or shims", () => {
    const source = `
export default function PureCounter(props = {}) {
  const count = signal(0);
  const inc = () => count.set(count() + 1);
  return (
    <div class="box">
      <span>{count()}</span>
      <button onClick={inc}>+1</button>
    </div>
  );
}
`;
    const ast = parse(source, { filename: "PureCounter.mix" });
    const descriptor = analyze(ast, { filename: "PureCounter.mix", source });
    const result = generate(descriptor, {
      filename: "PureCounter.mix",
      runtimeImportPath: "@dotmix/runtime",
      hmr: false
    });

    for (const pattern of FORBIDDEN_HMR_PATTERNS) {
      assert.strictEqual(
        result.code.includes(pattern),
        false,
        `Production codegen output must not contain '${pattern}', but found it in:\n${result.code}`
      );
    }
  });

  it("2. vite-plugin transform with hmr: false emits zero HMR acceptance blocks", () => {
    const plugin = mix({ hmr: false, runtimeImportPath: "@dotmix/runtime" });
    const source = `
export default function Widget() {
  return <div>Widget Content</div>;
}
`;
    const transformed = plugin.transform(source, "Widget.mix", { ssr: false });
    assert.ok(transformed, "Plugin must transform module");

    for (const pattern of FORBIDDEN_HMR_PATTERNS) {
      assert.strictEqual(
        transformed.code.includes(pattern),
        false,
        `Production vite-plugin transform must not contain '${pattern}', but found it in:\n${transformed.code}`
      );
    }
  });

  it("3. CLI production build (mix build) output contains zero HMR artifacts", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-build-purity-"));
    const srcDir = path.join(tmpDir, "src");
    const outDir = path.join(tmpDir, "dist");
    fs.cpSync(fixtureDir, tmpDir, { recursive: true });

    try {
      const buildRes = await build({
        srcDir,
        outDir,
        minify: false
      });
      assert.strictEqual(buildRes.success, true, "Production build must succeed");

      // Verify all emitted JS files in dist
      const distFiles = fs.readdirSync(outDir, { recursive: true, withFileTypes: true });
      for (const entry of distFiles) {
        if (entry.isFile() && entry.name.endsWith(".js")) {
          const fullPath = path.join(entry.parentPath || outDir, entry.name);
          const content = fs.readFileSync(fullPath, "utf-8");
          for (const pattern of FORBIDDEN_HMR_PATTERNS) {
            assert.strictEqual(
              content.includes(pattern),
              false,
              `Production dist file '${entry.name}' must not contain '${pattern}'`
            );
          }
        }
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
