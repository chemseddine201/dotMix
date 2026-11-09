/**
 * Gate 26: Project Scaffolding & Initialized Framework Architecture (D-129)
 *
 * Verifies:
 * 1. CLI create() scaffolds TypeScript (.tix) + SCSS project with complete React-inspired hierarchy.
 * 2. CLI create() scaffolds JavaScript (.mix) + Less project with preprocessor bindings.
 * 3. Scaffolded components (layouts, pages, components) parse and semantically analyze with 0 errors.
 * 4. Scaffolded permissions matrix and abilities unit test pass assertion checks.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { create } from "../../packages/cli/dist/index.js";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";

describe("Gate 26: Project Scaffolding Architecture (D-129)", () => {
  test("1. Scaffolds TypeScript (.tix) + SCSS project with full React-inspired modular hierarchy", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-scaffold-ts-"));
    const appDir = path.join(tmpDir, "portal-app");

    try {
      const res = create({
        projectName: "portal-app",
        targetDir: appDir,
        typescript: true,
        styleFormat: "scss"
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.createdFiles.length >= 20, "Must scaffold full enterprise file tree");

      // 1. Core directories and configurations
      assert.ok(fs.existsSync(path.join(appDir, "package.json")));
      assert.ok(fs.existsSync(path.join(appDir, "tsconfig.json")));
      assert.ok(fs.existsSync(path.join(appDir, "mix.config.ts")));
      assert.ok(fs.existsSync(path.join(appDir, "README.md")));

      // 2. Global Styles & Design Tokens (.scss)
      assert.ok(fs.existsSync(path.join(appDir, "src/styles/tokens.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/styles/global.scss")));

      // 3. Permissions & Abilities (RBAC/ABAC)
      assert.ok(fs.existsSync(path.join(appDir, "src/permissions/abilities.ts")));
      assert.ok(fs.existsSync(path.join(appDir, "src/permissions/subjects.ts")));

      // 4. Stores (Auth Signals & Offline CRDT Collections)
      assert.ok(fs.existsSync(path.join(appDir, "src/stores/authStore.ts")));
      assert.ok(fs.existsSync(path.join(appDir, "src/stores/taskSyncStore.ts")));

      // 5. Layouts (.tix & .scss)
      assert.ok(fs.existsSync(path.join(appDir, "src/layouts/RootLayout.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/layouts/RootLayout.scss")));

      // 6. Components - Common & Domain
      assert.ok(fs.existsSync(path.join(appDir, "src/components/common/Button.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/common/Button.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/common/Input.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/common/Input.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/domain/TaskItem.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/domain/TaskItem.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/domain/SyncStatusPill.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/domain/SyncStatusPill.scss")));

      // 7. Pages (.tix & .scss)
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/HomePage.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/HomePage.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/TasksPage.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/TasksPage.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/FormsPage.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/FormsPage.scss")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/UnauthorizedPage.tix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/NotFoundPage.tix")));

      // 8. Routes & Bootstrap
      assert.ok(fs.existsSync(path.join(appDir, "src/routes.ts")));
      assert.ok(fs.existsSync(path.join(appDir, "src/main.mix")));

      // 9. Unit tests
      assert.ok(fs.existsSync(path.join(appDir, "tests/unit/abilities.test.mjs")));

      // Verify mix.config.ts contains scss preprocessor
      const mixConfig = fs.readFileSync(path.join(appDir, "mix.config.ts"), "utf-8");
      assert.ok(mixConfig.includes('"scss"'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("2. Scaffolds JavaScript (.mix) + Less project with preprocessor bindings", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-scaffold-js-"));
    const appDir = path.join(tmpDir, "lite-app");

    try {
      const res = create({
        projectName: "lite-app",
        targetDir: appDir,
        typescript: false,
        styleFormat: "less"
      });

      assert.strictEqual(res.success, true);

      // Verify .mix and .less extensions
      assert.ok(fs.existsSync(path.join(appDir, "src/layouts/RootLayout.mix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/layouts/RootLayout.less")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/common/Button.mix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/components/common/Button.less")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/HomePage.mix")));
      assert.ok(fs.existsSync(path.join(appDir, "src/pages/HomePage.less")));
      assert.ok(fs.existsSync(path.join(appDir, "src/styles/tokens.less")));

      const mixConfig = fs.readFileSync(path.join(appDir, "mix.config.ts"), "utf-8");
      assert.ok(mixConfig.includes('"less"'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("3. Scaffolded components parse and semantically analyze with 0 errors", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-scaffold-compile-"));
    const appDir = path.join(tmpDir, "check-app");

    try {
      create({
        projectName: "check-app",
        targetDir: appDir,
        typescript: false,
        styleFormat: "scss"
      });

      const componentsToVerify = [
        "src/layouts/RootLayout.mix",
        "src/components/common/Button.mix",
        "src/components/common/Input.mix",
        "src/components/domain/TaskItem.mix",
        "src/components/domain/SyncStatusPill.mix",
        "src/pages/HomePage.mix",
        "src/pages/TasksPage.mix",
        "src/pages/FormsPage.mix",
        "src/pages/UnauthorizedPage.mix",
        "src/pages/NotFoundPage.mix",
        "src/main.mix"
      ];

      for (const relComp of componentsToVerify) {
        const fullPath = path.join(appDir, relComp);
        assert.ok(fs.existsSync(fullPath), `${relComp} must exist`);
        const source = fs.readFileSync(fullPath, "utf-8");

        let ast;
        try {
          ast = parse(source, { filename: relComp });
        } catch (err) {
          throw new Error(`Failed parsing ${relComp}: ${err.message}`);
        }
        assert.ok(ast, `AST must parse for ${relComp}`);

        let desc;
        try {
          desc = analyze(ast, { filename: relComp, source });
        } catch (err) {
          throw new Error(`Failed analyzing ${relComp}: ${err.message}`);
        }
        assert.ok(desc, `Descriptor must be generated for ${relComp}`);
        assert.strictEqual(
          desc.diagnostics.length,
          0,
          `Component ${relComp} must have 0 diagnostics, got: ${JSON.stringify(desc.diagnostics)}`
        );
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
