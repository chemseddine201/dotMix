/**
 * Style Separation & External CSS Imports Test Suite
 *
 * Verifies:
 * 1. <style src="./Component.css" /> and <style src="./Component.css"></style> parse correctly
 * 2. `import "./Component.css";` is accepted without diagnostic errors (R-RS-01 .css extension)
 * 3. Scoped CSS compiler processes external stylesheets and generates deterministic scope hashes
 * 4. Elements receive the data-mix-<hash> attribute
 * 5. Generated JavaScript omits bare CSS imports, preventing ERR_UNKNOWN_FILE_EXTENSION in Node ESM
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";

describe("Style Separation & External CSS Import Architecture", () => {
  test("1. Parses <style src='./MyCard.css' /> with external file resolver", () => {
    const source = `
export default function MyCard() {
  return <div class="my-card"><span>Card Content</span></div>;
}
<style src="./MyCard.css" />
`;

    const externalCss = `.my-card { padding: 12px; } .my-card span { font-weight: bold; }`;
    const ast = parse(source, {
      filename: "MyCard.mix",
      readFile: (relPath) => {
        assert.strictEqual(relPath, "./MyCard.css");
        return externalCss;
      }
    });

    assert.ok(ast.style, "ast.style must exist");
    assert.strictEqual(ast.style.src, "./MyCard.css");
    assert.strictEqual(ast.style.content, externalCss);
    assert.strictEqual(ast.style.scoped, true);

    const descriptor = analyze(ast, { filename: "MyCard.mix", source });
    const codegen = generate(descriptor, { filename: "MyCard.mix" });

    assert.ok(codegen.css, "codegen.css must be generated");
    assert.ok(codegen.css.includes("[data-mix-"), "Selectors must have scoped hash attribute");
    assert.ok(codegen.js.includes("__createElement(\"div\", \"data-mix-"), "div must have scope attribute attached");
  });

  test("2. Supports import './Button.css'; side-effect import with automatic scoping", () => {
    const source = `
import "./Button.css";

export default function Button() {
  return <button class="btn">Click Me</button>;
}
`;

    const buttonCss = `.btn { background: blue; color: white; }`;
    const ast = parse(source, { filename: "Button.mix" });
    const descriptor = analyze(ast, { filename: "Button.mix", source });

    assert.ok(descriptor.cssImports, "descriptor.cssImports must exist");
    assert.strictEqual(descriptor.cssImports.length, 1);
    assert.strictEqual(descriptor.cssImports[0], "./Button.css");

    const codegen = generate(descriptor, {
      filename: "Button.mix",
      resolveStyle: (relPath) => {
        assert.strictEqual(relPath, "./Button.css");
        return buttonCss;
      }
    });

    assert.ok(codegen.css, "codegen.css must be compiled from imported stylesheet");
    assert.ok(codegen.css.includes(".btn[data-mix-"), "Imported CSS selector must be scoped");
    assert.ok(!codegen.js.includes('import "./Button.css"'), "CSS import must not be emitted as bare JS import");
    assert.ok(codegen.js.includes("__injectStylesheet"), "CSS must be injected into stylesheet registry");
  });

  test("3. Scopes :global(...) and :deep(...) inside external style files", () => {
    const source = `
import "./Layout.css";

export default function Layout() {
  return (
    <div class="layout-container">
      <div class="inner-slot">Content</div>
    </div>
  );
}
`;

    const layoutCss = `
.layout-container { display: flex; }
:global(.global-item) { margin: 0; }
:deep(.child-comp) { color: red; }
`;

    const ast = parse(source, { filename: "Layout.mix" });
    const descriptor = analyze(ast, { filename: "Layout.mix", source });
    const codegen = generate(descriptor, {
      filename: "Layout.mix",
      resolveStyle: () => layoutCss
    });

    assert.ok(codegen.css.includes(".layout-container[data-mix-"));
    assert.ok(codegen.css.includes(".global-item"));
    assert.ok(!codegen.css.includes(":global"));
    assert.ok(!codegen.css.includes(":deep"));
  });

  test("4. Supports importing preprocessor files (.scss, .sass, .less, .styl, .pcss) without <style> tag", () => {
    const source = `
import "./Card.scss";
import "./Header.less";
import "./Footer.pcss";

export default function MultiStyleCard() {
  return (
    <div class="card-root">
      <header class="card-header">Header</header>
      <footer class="card-footer">Footer</footer>
    </div>
  );
}
`;

    const ast = parse(source, { filename: "MultiStyleCard.mix" });
    const descriptor = analyze(ast, { filename: "MultiStyleCard.mix", source });

    assert.ok(descriptor.cssImports, "descriptor.cssImports must exist");
    assert.deepStrictEqual(descriptor.cssImports, [
      "./Card.scss",
      "./Header.less",
      "./Footer.pcss"
    ]);

    // Verify code generation resolves preprocessed styles and attaches scope hashes
    const preprocessorCssMap = {
      "./Card.scss": ".card-root { border-radius: 8px; }",
      "./Header.less": ".card-header { font-size: 1.25rem; font-weight: bold; }",
      "./Footer.pcss": ".card-footer { color: #888; }"
    };

    const codegen = generate(descriptor, {
      filename: "MultiStyleCard.mix",
      resolveStyle: (relPath) => preprocessorCssMap[relPath] ?? ""
    });

    assert.ok(codegen.css, "codegen.css must be generated");
    assert.ok(codegen.css.includes(".card-root[data-mix-"));
    assert.ok(codegen.css.includes(".card-header[data-mix-"));
    assert.ok(codegen.css.includes(".card-footer[data-mix-"));

    // Ensure none of the preprocessor imports leak into the JS output
    assert.ok(!codegen.js.includes('import "./Card.scss"'));
    assert.ok(!codegen.js.includes('import "./Header.less"'));
    assert.ok(!codegen.js.includes('import "./Footer.pcss"'));
    assert.ok(codegen.js.includes("__injectStylesheet"));
  });
});


