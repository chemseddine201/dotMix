import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import * as acorn from "acorn";
import * as csstree from "css-tree";
import { Window } from "happy-dom";
import { register } from "node:module";
import { toLoaderDirectoryUrl, toLoaderFileUrl } from "../support/module-urls.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliBin = path.join(repoRoot, "packages/cli/dist/bin.js");
const importMapHooksUrl = new URL("../build/import-map-hooks.mjs", import.meta.url);

/** The import map of dist/index.html. */
function readImportMap(distDir) {
  const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
  const openingTag = '<script type="importmap">';
  const start = indexHtml.indexOf(openingTag);
  assert.ok(start >= 0, "dist/index.html must contain an import map");
  return JSON.parse(indexHtml.slice(start + openingTag.length, indexHtml.indexOf("</script>", start)));
}

/** Resolves a specifier of an emitted module as the browser does: against the site root, then the import map. */
function resolveThroughImportMap(distDir, importMap, fromFile, specifier) {
  let sitePath;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const fromSitePath = `/${path.relative(distDir, fromFile).split(path.sep).join("/")}`;
    sitePath = new URL(specifier, `http://dotmix.test${fromSitePath}`).pathname;
    sitePath = importMap.imports[sitePath] ?? sitePath;
  } else {
    sitePath = importMap.imports[specifier] ?? `/__unmapped__/${specifier}`;
  }
  return path.join(distDir, ...sitePath.slice(1).split("/"));
}

/** Registers the import map of dist/ with the Node loader and returns the hashed entry module path. */
function prepareEntryThroughImportMap(distDir) {
  const importMap = readImportMap(distDir);
  const entryUrl = importMap.imports["/assets/main.js"];
  assert.ok(entryUrl, "The import map must list the entry /assets/main.js");
  register(importMapHooksUrl, {
    data: { distDirectoryUrl: toLoaderDirectoryUrl(distDir), imports: importMap.imports }
  });
  return path.join(distDir, ...entryUrl.slice(1).split("/"));
}

const LANGUAGES = [
  { name: "ts", flag: "--ts", typescript: true },
  { name: "js", flag: "--js", typescript: false },
];

const STYLES = ["scss", "sass", "less", "pcss", "css"];

function collectFiles(dir, extFilter) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, extFilter));
    } else if (!extFilter || extFilter(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function resolveWorkspaceExport(specifier) {
  // e.g. @dotmix/runtime or @dotmix/runtime/permissions
  const parts = specifier.split("/");
  if (parts.length < 2 || parts[0] !== "@dotmix") return false;
  const pkgName = parts[1];
  const subpath = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
  const pkgJsonPath = path.join(repoRoot, "packages", pkgName, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return false;
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  if (!pkgJson.exports) return subpath === ".";
  return Object.prototype.hasOwnProperty.call(pkgJson.exports, subpath);
}

function extractModuleSpecifiers(jsCode, filePath) {
  let ast;
  try {
    ast = acorn.parse(jsCode, { ecmaVersion: "latest", sourceType: "module" });
  } catch (err) {
    throw new Error(`Failed to parse emitted JS ${filePath} as valid ES module: ${err.message}`);
  }
  const specifiers = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source &&
      typeof node.source.value === "string"
    ) {
      specifiers.push(node.source.value);
    }
    if (node.type === "ImportExpression" && node.source?.type === "Literal" && typeof node.source.value === "string") {
      specifiers.push(node.source.value);
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === "object") walk(val);
    }
  }
  walk(ast);
  return specifiers;
}

function setupDomGlobals() {
  const window = new Window({ url: "http://localhost:4173/" });
  const document = window.document;
  document.body.innerHTML = '<div id="root"></div><div id="app"></div>';

  globalThis.window = window;
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Text = window.Text;
  globalThis.Comment = window.Comment;
  globalThis.DocumentFragment = window.DocumentFragment;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.history = window.history;
  globalThis.location = window.location;
  globalThis.PopStateEvent = window.PopStateEvent;

  return {
    window,
    document,
    cleanup() {
      window.close();
    },
  };
}

describe("Gate 27 Golden-Path E2E Harness (All 10 Scaffold Variants)", () => {
  for (const lang of LANGUAGES) {
    for (const style of STYLES) {
      const variantId = `${lang.name}-${style}`;

      test(`Golden Path [${variantId}]: create -> check -> build -> specifier audit -> css validity -> happy-dom smoke`, async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mix-golden-${variantId}-`));
        const projectDir = path.join(tmpRoot, `app-${variantId}`);

        try {
          // 1. Run `mix create` via the real CLI binary
          const createRes = spawnSync(
            process.execPath,
            [cliBin, "create", `app-${variantId}`, lang.flag, `--${style}`, "--target", projectDir],
            { encoding: "utf-8", cwd: tmpRoot }
          );
          assert.strictEqual(
            createRes.status,
            0,
            `[create] exited with ${createRes.status}:\nSTDOUT: ${createRes.stdout}\nSTDERR: ${createRes.stderr}`
          );

          // Link workspace node_modules so package imports resolve as in a real installed project
          const targetNodeModules = path.join(projectDir, "node_modules");
          if (!fs.existsSync(targetNodeModules)) {
            fs.symlinkSync(
              path.join(repoRoot, "node_modules"),
              targetNodeModules,
              process.platform === "win32" ? "junction" : "dir"
            );
          }

          // 2. Run `mix check src` via the real CLI binary
          const checkRes = spawnSync(
            process.execPath,
            [cliBin, "check", path.join(projectDir, "src")],
            { encoding: "utf-8", cwd: projectDir }
          );
          assert.strictEqual(
            checkRes.status,
            0,
            `[check] exited with ${checkRes.status}:\nSTDOUT:\n${checkRes.stdout}\nSTDERR:\n${checkRes.stderr}`
          );
          assert.ok(
            !checkRes.stdout.includes("[ERROR]") && !checkRes.stderr.includes("Error processing"),
            `[check] output contained errors:\nSTDOUT:\n${checkRes.stdout}\nSTDERR:\n${checkRes.stderr}`
          );

          // 3. Run `mix build src dist` via the real CLI binary
          const distDir = path.join(projectDir, "dist");
          const buildRes = spawnSync(
            process.execPath,
            [cliBin, "build", path.join(projectDir, "src"), distDir],
            { encoding: "utf-8", cwd: projectDir }
          );
          assert.strictEqual(
            buildRes.status,
            0,
            `[build] exited with ${buildRes.status}:\nSTDOUT:\n${buildRes.stdout}\nSTDERR:\n${buildRes.stderr}`
          );
          assert.strictEqual(
            buildRes.stderr.trim(),
            "",
            `[build] produced stderr output:\n${buildRes.stderr}`
          );

          // 3b. Run the scaffolded project's own tests with `mix test` (they import its .ts modules)
          const projectTestRes = spawnSync(
            process.execPath,
            [cliBin, "test"],
            { encoding: "utf-8", cwd: projectDir }
          );
          assert.strictEqual(
            projectTestRes.status,
            0,
            `[mix test] exited with ${projectTestRes.status}:\nSTDOUT:\n${projectTestRes.stdout}\nSTDERR:\n${projectTestRes.stderr}`
          );

          // 4. Specifier Audit on all emitted .js files
          const jsFiles = collectFiles(distDir, (name) => name.endsWith(".js"));
          assert.ok(jsFiles.length >= 10, `Expected at least 10 emitted .js files in dist, found ${jsFiles.length}`);

          const importMap = readImportMap(distDir);
          for (const jsFile of jsFiles) {
            const code = fs.readFileSync(jsFile, "utf-8");
            const specifiers = extractModuleSpecifiers(code, jsFile);
            for (const spec of specifiers) {
              assert.ok(
                !spec.startsWith("file://") && !path.isAbsolute(spec),
                `Forbidden absolute/file:// specifier "${spec}" in ${path.relative(distDir, jsFile)}`
              );
              assert.ok(
                !/\.(tix|mix|ts|scss|sass|less|pcss|postcss)$/i.test(spec),
                `Uncompiled source extension in specifier "${spec}" in ${path.relative(distDir, jsFile)}`
              );
              if (spec.startsWith("./") || spec.startsWith("../")) {
                const resolved = resolveThroughImportMap(distDir, importMap, jsFile, spec);
                assert.ok(
                  fs.existsSync(resolved),
                  `Relative specifier "${spec}" in ${path.relative(distDir, jsFile)} does not exist at ${path.relative(distDir, resolved)}`
                );
              } else if (spec.startsWith("@dotmix/")) {
                assert.ok(
                  resolveWorkspaceExport(spec),
                  `Bare specifier "${spec}" in ${path.relative(distDir, jsFile)} is not exported by workspace package.json`
                );
                assert.ok(
                  fs.existsSync(resolveThroughImportMap(distDir, importMap, jsFile, spec)),
                  `Bare specifier "${spec}" in ${path.relative(distDir, jsFile)} has no vendored file in the import map`
                );
              } else if (spec === "@dotmix/helpers" || spec.startsWith("@dotmix/helpers/")) {
                assert.ok(true);
              } else {
                assert.fail(`Unexpected external specifier "${spec}" in ${path.relative(distDir, jsFile)}`);
              }
            }
          }

          // 5. CSS Validity Check: one merged stylesheet that carries every source stylesheet
          const cssFiles = collectFiles(distDir, (name) => name.endsWith(".css"));
          assert.strictEqual(cssFiles.length, 1, `Expected one merged stylesheet in dist, found ${cssFiles.length}`);
          assert.match(path.basename(cssFiles[0]), /^styles-[a-f0-9]{8}\.css$/);
          const sourceStylesheets = collectFiles(path.join(projectDir, "src"), (name) =>
            /\.(css|scss|sass|less|pcss)$/i.test(name)
          );
          assert.ok(sourceStylesheets.length >= 6, `Expected at least 6 source stylesheets, found ${sourceStylesheets.length}`);
          const mergedCssText = fs.readFileSync(cssFiles[0], "utf-8");
          for (const sourceStylesheet of sourceStylesheets) {
            const firstClassSelector = /^\s*(\.[a-zA-Z][\w-]*)/m.exec(fs.readFileSync(sourceStylesheet, "utf-8"));
            if (!firstClassSelector) continue;
            assert.ok(
              mergedCssText.includes(firstClassSelector[1]),
              `Merged stylesheet is missing ${firstClassSelector[1]} from ${path.relative(projectDir, sourceStylesheet)}`
            );
          }

          for (const cssFile of cssFiles) {
            const cssText = fs.readFileSync(cssFile, "utf-8");
            const parseErrors = [];
            csstree.parse(cssText, {
              filename: path.basename(cssFile),
              onParseError(err) {
                parseErrors.push(err.message);
              },
            });
            assert.deepStrictEqual(
              parseErrors,
              [],
              `CSS parse errors in ${path.relative(distDir, cssFile)}:\n${parseErrors.join("\n")}\nCSS:\n${cssText}`
            );
            assert.ok(
              !cssText.includes("&-") && !cssText.includes("&:") && !cssText.includes("&."),
              `Uncompiled parent selector '&' found in ${path.relative(distDir, cssFile)}:\n${cssText}`
            );
            assert.ok(
              !/\$[a-zA-Z_-][a-zA-Z0-9_-]*/.test(cssText),
              `Uncompiled SCSS variable '$...' found in ${path.relative(distDir, cssFile)}:\n${cssText}`
            );
            assert.ok(
              !/@(mixin|include|use|import)\b/.test(cssText),
              `Uncompiled preprocessor at-rule (@mixin/@include/@use/@import) found in ${path.relative(distDir, cssFile)}:\n${cssText}`
            );
          }

          // 6. Execution Smoke Test in happy-dom
          const dom = setupDomGlobals();
          try {
            const mainJsPath = prepareEntryThroughImportMap(distDir);
            assert.ok(fs.existsSync(mainJsPath), `Built entry ${mainJsPath} does not exist`);

            await import(`${toLoaderFileUrl(mainJsPath)}?t=${Date.now()}`);
            const rootEl = dom.document.getElementById("root");
            assert.ok(rootEl, "#root element must exist");
            assert.ok(
              rootEl.innerHTML.includes("Mix Framework App"),
              `Expected RootLayout header 'Mix Framework App' in #root, got: ${rootEl.innerHTML}`
            );
            assert.ok(
              rootEl.innerHTML.includes("Compiler-Native Web Application"),
              `Expected HomePage hero 'Compiler-Native Web Application' in #root, got: ${rootEl.innerHTML}`
            );

            // Navigate to /tasks via NavLink click
            const links = Array.from(rootEl.querySelectorAll("a"));
            const tasksLink = links.find((a) => a.getAttribute("href") === "/tasks");
            assert.ok(tasksLink, "Expected NavLink to /tasks");
            tasksLink.click();

            assert.ok(
              rootEl.innerHTML.includes("Offline-First CRDT Tasks"),
              `Expected TasksPage heading after navigating to /tasks, got: ${rootEl.innerHTML}`
            );
            assert.ok(
              rootEl.innerHTML.includes("Build compiler frontend"),
              `Expected initial CRDT task item on /tasks page, got: ${rootEl.innerHTML}`
            );

            // Navigate to /forms via NavLink click
            const formsLink = Array.from(rootEl.querySelectorAll("a")).find((a) => a.getAttribute("href") === "/forms");
            assert.ok(formsLink, "Expected NavLink to /forms");
            formsLink.click();

            assert.ok(
              rootEl.innerHTML.includes("Reactive Form Validation"),
              `Expected FormsPage heading after navigating to /forms, got: ${rootEl.innerHTML}`
            );
          } finally {
            dom.cleanup();
          }
        } finally {
          fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
      });
    }
  }
});

describe("Golden Path — sync-crdt Scaffold Variants (TS & JS)", () => {
  for (const lang of LANGUAGES) {
    const variantId = `sync-crdt-${lang.name}`;

    test(`Golden Path [${variantId}]: create --template sync-crdt -> check -> build -> specifier audit -> happy-dom smoke`, async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mix-golden-${variantId}-`));
      const projectDir = path.join(tmpRoot, `app-${variantId}`);

      try {
        // 1. Run `mix create` with --template sync-crdt
        const createRes = spawnSync(
          process.execPath,
          [cliBin, "create", `app-${variantId}`, lang.flag, "--template", "sync-crdt", "--target", projectDir],
          { encoding: "utf-8", cwd: tmpRoot }
        );
        assert.strictEqual(
          createRes.status,
          0,
          `[create] exited with ${createRes.status}:\nSTDOUT: ${createRes.stdout}\nSTDERR: ${createRes.stderr}`
        );

        // Verify generated sync collection code does NOT pass an explicit engine option (d137 is default)
        const ext = lang.name === "ts" ? "ts" : "js";
        const tasksStore = fs.readFileSync(path.join(projectDir, `src/stores/tasks.${ext}`), "utf-8");
        assert.ok(tasksStore.includes("syncCollection"), "Store must use syncCollection");
        assert.ok(!tasksStore.includes('engine: "d137"'), "Generated code must not hard-code engine option (d137 is default)");

        // Link workspace node_modules so package imports resolve as in a real installed project
        const targetNodeModules = path.join(projectDir, "node_modules");
        if (!fs.existsSync(targetNodeModules)) {
          fs.symlinkSync(
            path.join(repoRoot, "node_modules"),
            targetNodeModules,
            process.platform === "win32" ? "junction" : "dir"
          );
        }

        // 2. Run `mix check src` via real CLI binary
        const checkRes = spawnSync(
          process.execPath,
          [cliBin, "check", path.join(projectDir, "src")],
          { encoding: "utf-8", cwd: projectDir }
        );
        assert.strictEqual(
          checkRes.status,
          0,
          `[check] exited with ${checkRes.status}:\nSTDOUT:\n${checkRes.stdout}\nSTDERR:\n${checkRes.stderr}`
        );
        assert.ok(
          !checkRes.stdout.includes("[ERROR]") && !checkRes.stderr.includes("Error processing"),
          `[check] output contained errors:\nSTDOUT:\n${checkRes.stdout}\nSTDERR:\n${checkRes.stderr}`
        );

        // 3. Run `mix build src dist` via real CLI binary
        const distDir = path.join(projectDir, "dist");
        const buildRes = spawnSync(
          process.execPath,
          [cliBin, "build", path.join(projectDir, "src"), distDir],
          { encoding: "utf-8", cwd: projectDir }
        );
        assert.strictEqual(
          buildRes.status,
          0,
          `[build] exited with ${buildRes.status}:\nSTDOUT:\n${buildRes.stdout}\nSTDERR:\n${buildRes.stderr}`
        );
        assert.strictEqual(
          buildRes.stderr.trim(),
          "",
          `[build] produced stderr output:\n${buildRes.stderr}`
        );

        // 4. Specifier Audit on all emitted .js files
        const jsFiles = collectFiles(distDir, (name) => name.endsWith(".js"));
        const importMap = readImportMap(distDir);
        for (const jsFile of jsFiles) {
          const jsCode = fs.readFileSync(jsFile, "utf-8");
          const specifiers = extractModuleSpecifiers(jsCode, jsFile);
          for (const spec of specifiers) {
            assert.ok(!spec.startsWith("file:///"), `Absolute file URL found in ${jsFile}: ${spec}`);
            if (spec.startsWith("./") || spec.startsWith("../")) {
              const resolved = resolveThroughImportMap(distDir, importMap, jsFile, spec);
              assert.ok(
                fs.existsSync(resolved) || fs.existsSync(`${resolved}.js`),
                `Unresolvable relative import ${spec} in ${jsFile}`
              );
            } else if (spec.startsWith("@dotmix/")) {
              assert.ok(resolveWorkspaceExport(spec), `Unresolved workspace export: ${spec}`);
            }
          }
        }

        // 5. Execution Smoke Test in happy-dom
        const dom = setupDomGlobals();
        try {
          const mainJsPath = prepareEntryThroughImportMap(distDir);
          assert.ok(fs.existsSync(mainJsPath), `Built entry ${mainJsPath} does not exist`);

          await import(`${toLoaderFileUrl(mainJsPath)}?t=${Date.now()}`);
          const rootEl = dom.document.getElementById("app") || dom.document.getElementById("root");
          assert.ok(rootEl, "Mount element must exist");
          assert.ok(
            rootEl.innerHTML.includes(`app-${variantId}`),
            `Expected heading in mount element, got: ${rootEl.innerHTML}`
          );
          assert.ok(
            rootEl.innerHTML.includes("Pending changes:"),
            `Expected 'Pending changes:' in mount element, got: ${rootEl.innerHTML}`
          );
        } finally {
          dom.cleanup();
        }
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  }
});

