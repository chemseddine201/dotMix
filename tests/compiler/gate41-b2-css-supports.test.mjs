import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileCss } from "../../node_modules/@dotmix/compiler-css/dist/index.js";
import { MixDiagnosticError, DiagnosticCodes } from "../../node_modules/@dotmix/diagnostics/dist/index.js";

describe("Gate 41 B2: @supports full <supports-condition> grammar in @dotmix/compiler-css", () => {
  const validCases = [
    [
      "outer parens with and",
      "@supports ((animation-timeline: view()) and (animation-range: entry)) { .reveal { opacity: 1; } }",
      "animation-timeline"
    ],
    [
      "nested not (a or (b and c))",
      "@supports not ((display: grid) or ((color: red) and (gap: 1rem))) { .fallback { display: block; } }",
      "display:grid"
    ],
    [
      "outer parens around not/or/and",
      "@supports (not (display: subgrid) or ((color: red) and (gap: 1rem))) { .box { margin: 0; } }",
      "subgrid"
    ],
    [
      "selector(:has(a))",
      "@supports selector(:has(a)) { .card { border: 1px solid currentColor; } }",
      "selector(:has(a))"
    ],
    [
      "font-tech()",
      "@supports font-tech(color-COLRv1) { .emoji { font-family: sans-serif; } }",
      "font-tech(color-COLRv1)"
    ],
    [
      "font-format()",
      "@supports font-format(woff2) { .text { font-weight: 600; } }",
      "font-format(woff2)"
    ],
    [
      "unknown <general-enclosed> condition passed through unchanged",
      "@supports (future-feature(1, 2)) and (display: flex) { .flex { display: flex; } }",
      "future-feature(1, 2)"
    ],
    [
      "unknown top-level function condition passed through unchanged",
      "@supports future-fn(foo bar) { .x { color: green; } }",
      "future-fn(foo bar)"
    ]
  ];

  for (const [label, css, expectedSubstr] of validCases) {
    it(`accepts ${label} (unscoped and scoped)`, () => {
      const unscoped = compileCss(css, { filename: "motion.css", scoped: false });
      assert.ok(unscoped.code.includes("@supports"), `Missing @supports in: ${unscoped.code}`);
      assert.ok(
        unscoped.code.replace(/\s+/g, "").includes(expectedSubstr.replace(/\s+/g, "")),
        `Expected '${expectedSubstr}' in: ${unscoped.code}`
      );

      const scoped = compileCss(css, { filename: "Motion.tix", scoped: true });
      assert.ok(scoped.code.includes("[data-mix-"), `Expected scoped selector inside @supports: ${scoped.code}`);
    });
  }

  it("still rejects genuinely malformed CSS syntax inside @supports", () => {
    assert.throws(
      () => compileCss("@supports ((display: grid) { .bad { color: red; } }", { filename: "bad.css", scoped: false }),
      (err) => err instanceof MixDiagnosticError && err.code === DiagnosticCodes.MIX_ERR_PARSE_SYNTAX
    );
  });
});

