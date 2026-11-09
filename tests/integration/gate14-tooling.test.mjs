/**
 * Gate 14 Test Suite — Build Tooling & Bundler Integration (@mix/vite-plugin, @mix/cli — D-117)
 *
 * Verifies:
 * 1. Vite plugin transforms .mix and .tix components to executable JS with SourceMap
 * 2. Vite plugin extracts scoped CSS into virtual CSS module (?mix-css=1) and resolves/loads it
 * 3. Vite plugin attaches HMR acceptance block when enabled
 * 4. `check()` validates clean .mix and .tix files with success: true
 * 5. `check()` detects invalid syntax or type errors with success: false and reports diagnostics
 * 6. `build()` compiles components to .js, .css, and .d.ts files in the output directory
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mix } from "../../packages/vite-plugin/dist/index.js";
import { check, build, create } from "../../packages/cli/dist/index.js";

describe("Gate 14: Build Tooling & Bundler Integration (D-117)", () => {
  test("1. Vite plugin transforms .mix component, extracts virtual CSS, and supports load()", () => {
    const plugin = mix();
    const filename = "/virtual/Button.mix";
    const source = `
<script>
  let label = "Click Me";
</script>

<style>
  button { background: blue; color: white; }
</style>

<button>{label}</button>
`;

    const transformed = plugin.transform(source, filename);
    assert.ok(transformed, "Plugin must transform .mix files");
    assert.ok(transformed.code.includes('import "/virtual/Button.mix?mix-css=1"'));
    assert.ok(transformed.code.includes("export function Button"));
    assert.ok(transformed.map, "Transform must generate SourceMap");

    // Virtual CSS resolution and loading
    const virtualId = "/virtual/Button.mix?mix-css=1";
    const resolved = plugin.resolveId(virtualId);
    assert.strictEqual(resolved, virtualId);

    const loadedCss = plugin.load(virtualId);
    assert.ok(loadedCss);
    assert.ok(loadedCss.includes("button[data-mix-"));
    assert.ok(loadedCss.includes("background:") && loadedCss.includes("blue"));
  });

  test("2. Vite plugin attaches HMR acceptance block when enabled", () => {
    const plugin = mix({ hmr: true });
    const source = `<div>Hello HMR</div>`;
    const transformed = plugin.transform(source, "/virtual/App.tix");

    assert.ok(transformed.code.includes("import.meta.hot.accept()"));
  });

  test("3. CLI check() validates clean components and catches syntax/type errors", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cli-test-"));

    try {
      // 1. Valid .mix file
      const validMix = path.join(tmpDir, "Valid.mix");
      fs.writeFileSync(validMix, `
<script>
  let message = "All good";
</script>
<p>{message}</p>
`);

      // 2. Valid .tix file
      const validTix = path.join(tmpDir, "Valid.tix");
      fs.writeFileSync(validTix, `
<script lang="ts">
  const greeting: string = "Hello TypeScript";
</script>
<h1>{greeting}</h1>
`);

      const cleanRes = check({ dir: tmpDir, silent: true });
      assert.strictEqual(cleanRes.success, true);
      assert.strictEqual(cleanRes.errorsCount, 0);

      // 3. Invalid .mix file with unresolved identifier
      const invalidMix = path.join(tmpDir, "Invalid.mix");
      fs.writeFileSync(invalidMix, `
<div>{undefinedVariable}</div>
`);

      const errRes = check({ dir: tmpDir, silent: true });
      assert.strictEqual(errRes.success, false);
      assert.ok(errRes.errorsCount > 0);
      assert.ok(errRes.diagnostics.some((d) => d.code === "MIX_ERR_UNRESOLVED_IDENTIFIER"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("4. CLI build() compiles components into output directory with .js, .css, and .d.ts", () => {
    const inDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-in-"));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-out-"));

    try {
      fs.writeFileSync(path.join(inDir, "Card.tix"), `
<script lang="ts">
  const title: string = "Card Title";
</script>

<style>
  .card { border: 1px solid black; }
</style>

<div class="card">{title}</div>
`);

      const res = build({ inDir, outDir, silent: true });
      assert.strictEqual(res.success, true);

      const jsPath = path.join(outDir, "Card.js");
      const cssPath = path.join(outDir, "Card.css");
      const dtsPath = path.join(outDir, "Card.d.ts");

      assert.ok(fs.existsSync(jsPath), "Card.js must exist");
      assert.ok(fs.existsSync(cssPath), "Card.css must exist");
      assert.ok(fs.existsSync(dtsPath), "Card.d.ts must exist");

      const jsContent = fs.readFileSync(jsPath, "utf-8");
      const cssContent = fs.readFileSync(cssPath, "utf-8");
      const dtsContent = fs.readFileSync(dtsPath, "utf-8");

      assert.ok(jsContent.includes("export function Card"));
      assert.ok(cssContent.includes(".card[data-mix-"));
      assert.ok(dtsContent.includes("title: string"));
      assert.ok(dtsContent.includes("__mixTypecheckTemplate"));
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("5. CLI create() scaffolds React-inspired modular project layout with permissions & SCSS", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-create-test-"));
    const appDir = path.join(tmpDir, "sample-app");

    try {
      const res = create({ projectName: "sample-app", targetDir: appDir, typescript: false });
      assert.strictEqual(res.success, true);
      assert.ok(res.createdFiles.length >= 10, "Should scaffold all core blueprint files");

      // Verify React-inspired folder structure
      assert.ok(fs.existsSync(path.join(appDir, "src/layouts/RootLayout.mix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/layouts/RootLayout.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/HomePage.mix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/HomePage.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/common/Button.mix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/common/Button.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/stores/authStore.ts")));
      assert.ok(fs.existsSync(path.join(appDir, "src/permissions/abilities.ts")));
      assert.ok(fs.existsSync(path.join(appDir, "src/routes.ts")));
      assert.ok(fs.existsSync(path.join(appDir, "src/main.mix")));
      assert.ok(fs.existsSync(path.join(appDir, "package.json")));
      assert.ok(fs.existsSync(path.join(appDir, "mix.config.ts")));

      // Verify content references native permissions and styles
      const mainContent = fs.readFileSync(path.join(appDir, "src/main.mix"), "utf-8");
      assert.ok(mainContent.includes("PermissionProvider"));
      assert.ok(mainContent.includes("defineAppAbility"));

      const homeContent = fs.readFileSync(path.join(appDir, "src/pages/HomePage.mix"), "utf-8");
      assert.ok(homeContent.includes("<Can I="));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

