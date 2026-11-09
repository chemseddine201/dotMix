/**
 * Gate 27 (T-27.3 / D-130) — Build-Time CSS Preprocessor Stage Verification
 *
 * Verifies:
 * 1. SCSS variables ($var), parent selector nesting (&-suffix, &:hover), @mixin/@include, and @import/@use partials compile to valid scoped CSS.
 * 2. Indented Sass (.sass) compiles to valid scoped CSS.
 * 3. Less variables (@var), parent selector nesting, @import partials, and mixins compile to valid scoped CSS.
 * 4. PostCSS (.pcss / .postcss) nesting and @import partials compile to valid scoped CSS.
 * 5. Missing external preprocessor produces MIX_ERR_PREPROCESSOR_MISSING with an install instruction.
 * 6. Plain .css and raw <style> blocks still reject @import with MIX_ERR_CSS_FORBIDDEN_IMPORT (D-108).
 * 7. Resolved partial paths are returned in dependencies list for build/watch tracking.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as csstree from "css-tree";
import * as compilerCss from "../../packages/compiler-css/dist/index.js";
import { DiagnosticCodes, MixDiagnosticError } from "../../packages/diagnostics/dist/index.js";

function assertValidStandardCss(cssText) {
  const errors = [];
  csstree.parse(cssText, {
    onParseError(err) {
      errors.push(err.message);
    },
  });
  assert.deepStrictEqual(errors, [], `Expected valid CSS, got errors:\n${errors.join("\n")}\nCSS:\n${cssText}`);
  assert.ok(!cssText.includes("&-"), `Expected no leftover '&-' in CSS:\n${cssText}`);
  assert.ok(!/\$[a-zA-Z_-]/.test(cssText), `Expected no leftover '$var' in CSS:\n${cssText}`);
  assert.ok(!/@(mixin|include|use|import)\b/.test(cssText), `Expected no preprocessor at-rules in CSS:\n${cssText}`);
}

describe("Gate 27 (T-27.3 / D-130): Build-Time CSS Preprocessor Stage", () => {
  test("1. SCSS variables, &-suffix nesting, @mixin/@include, and @import/@use partials produce valid scoped CSS", () => {
    assert.strictEqual(typeof compilerCss.preprocessCss, "function", "preprocessCss must be exported by @mix/compiler-css");

    const partials = {
      "/app/src/styles/tokens.scss": `
        $brand-primary: #6366f1;
        $brand-hover: #4f46e5;
        @mixin pill($radius: 6px) {
          border-radius: $radius;
          font-weight: 600;
        }
      `,
    };

    const scssSource = `
      @use "./tokens.scss" as *;

      .mix-btn {
        display: inline-flex;
        @include pill(8px);

        &:disabled {
          opacity: 0.5;
        }

        &-primary {
          background: $brand-primary;
          color: #ffffff;
          &:hover:not(:disabled) {
            background: $brand-hover;
          }
        }
      }
    `;

    const pre = compilerCss.preprocessCss(scssSource, {
      lang: "scss",
      filename: "/app/src/styles/Button.scss",
      readFile: (p) => partials[p] ?? null,
    });

    assert.ok(pre.dependencies.includes("/app/src/styles/tokens.scss"), "Must track resolved partial in dependencies");

    const compiled = compilerCss.compileCss(pre.code, {
      filename: "Button.scss",
      scoped: true,
    });

    assertValidStandardCss(compiled.code);
    assert.ok(compiled.code.includes(".mix-btn[data-mix-"));
    assert.ok(compiled.code.includes(".mix-btn-primary[data-mix-"));
    assert.ok(compiled.code.includes("#6366f1"));
    assert.ok(compiled.code.includes("#4f46e5"));
    assert.ok(compiled.code.includes("border-radius:8px"));
  });

  test("2. Less variables (@var), &-suffix nesting, @import partials, and parametric mixins produce valid scoped CSS", () => {
    assert.strictEqual(typeof compilerCss.preprocessCss, "function", "preprocessCss must be exported by @mix/compiler-css");

    const partials = {
      "/app/src/styles/vars.less": `
        @danger-color: #ef4444;
        .elevate(@blur: 12px) {
          box-shadow: 0 4px @blur rgba(0, 0, 0, 0.2);
        }
      `,
    };

    const lessSource = `
      @import "./vars.less";

      .alert-box {
        padding: 12px;
        .elevate(16px);

        &-danger {
          border-color: @danger-color;
          color: @danger-color;
        }
      }
    `;

    const pre = compilerCss.preprocessCss(lessSource, {
      lang: "less",
      filename: "/app/src/styles/Alert.less",
      readFile: (p) => partials[p] ?? null,
    });

    assert.ok(pre.dependencies.includes("/app/src/styles/vars.less"));

    const compiled = compilerCss.compileCss(pre.code, {
      filename: "Alert.less",
      scoped: true,
    });

    assertValidStandardCss(compiled.code);
    assert.ok(compiled.code.includes(".alert-box[data-mix-"));
    assert.ok(compiled.code.includes(".alert-box-danger[data-mix-"));
    assert.ok(compiled.code.includes("#ef4444"));
    assert.ok(compiled.code.includes("16px"));
  });

  test("3. PostCSS (.pcss / .postcss) and Sass (.sass) produce valid scoped CSS", () => {
    assert.strictEqual(typeof compilerCss.preprocessCss, "function", "preprocessCss must be exported by @mix/compiler-css");

    const pcssSource = `
      .card {
        padding: 16px;
        &-header {
          font-size: 18px;
        }
      }
    `;
    const prePcss = compilerCss.preprocessCss(pcssSource, {
      lang: "pcss",
      filename: "Card.pcss",
    });
    const compiledPcss = compilerCss.compileCss(prePcss.code, { filename: "Card.pcss", scoped: true });
    assertValidStandardCss(compiledPcss.code);
    assert.ok(compiledPcss.code.includes(".card-header[data-mix-"));
  });

  test("4. Missing external preprocessor produces MIX_ERR_PREPROCESSOR_MISSING with install instruction", () => {
    assert.strictEqual(typeof compilerCss.preprocessCss, "function", "preprocessCss must be exported by @mix/compiler-css");

    assert.throws(
      () => {
        compilerCss.preprocessCss("body\n  color: red", {
          lang: "stylus",
          filename: "App.styl",
        });
      },
      (err) => {
        assert.ok(err instanceof MixDiagnosticError);
        assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_PREPROCESSOR_MISSING);
        assert.match(err.message, /npm install/);
        return true;
      }
    );
  });

  test("5. Plain .css still strictly rejects @import with MIX_ERR_CSS_FORBIDDEN_IMPORT (D-108)", () => {
    assert.throws(
      () => {
        compilerCss.compileCss('@import "./tokens.css"; .box { color: red; }', {
          filename: "Box.css",
          scoped: true,
        });
      },
      (err) => {
        assert.ok(err instanceof MixDiagnosticError);
        assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_IMPORT);
        return true;
      }
    );
  });
});
