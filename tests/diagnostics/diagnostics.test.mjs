import test from "node:test";
import assert from "node:assert/strict";

import {
  formatDiagnostic,
  generateSourceMap,
  encodeVlq
} from "../../packages/compiler-semantic/dist/index.js";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";

test("Phase 5 Diagnostics & Source Maps Conformance", async (t) => {

  // --- 1. Diagnostic Code Frame Formatting (D-106) ---
  await t.test("formatDiagnostic produces rich code frames with caret underlines", () => {
    const source = `<script>
  let count = signal(0);
</script>
<style>
  @import url("evil.css");
</style>
<span>{count()}</span>`;

    const diag = {
      code: "MIX_ERR_CSS_FORBIDDEN_IMPORT",
      message: "@import rules are forbidden in component styles",
      severity: "error",
      span: {
        start: { line: 5, column: 3, offset: 42 },
        end: { line: 5, column: 27, offset: 66 }
      }
    };

    const formatted = formatDiagnostic(source, diag, "Card.mix");

    assert.ok(formatted.includes("error[MIX_ERR_CSS_FORBIDDEN_IMPORT]: @import rules are forbidden in component styles"));
    assert.ok(formatted.includes("--> Card.mix:5:3"));
    assert.ok(formatted.includes('5 |   @import url("evil.css");'));
    assert.ok(formatted.includes("^^^^^^^^^^^^^^^^^^^^^^^^"));

    // Warning severity
    const warnDiag = {
      code: "MIX_WARN_UNKEYED_EACH",
      message: "Keyed reconciliation requires an explicit key expression",
      severity: "warning",
      span: {
        start: { line: 7, column: 1, offset: 70 },
        end: { line: 7, column: 23, offset: 92 }
      }
    };
    const warnFormatted = formatDiagnostic(source, warnDiag, "Card.mix");
    assert.ok(warnFormatted.includes("warning[MIX_WARN_UNKEYED_EACH]"));
  });

  // --- 2. Base64 VLQ Encoding ---
  await t.test("encodeVlq accurately encodes integers per SourceMap V3 spec", () => {
    assert.equal(encodeVlq(0), "A");
    assert.equal(encodeVlq(1), "C");
    assert.equal(encodeVlq(-1), "D");
    assert.equal(encodeVlq(2), "E");
    assert.equal(encodeVlq(-2), "F");
    assert.equal(encodeVlq(15), "e");
  });

  // --- 3. SourceMap V3 Generation ---
  await t.test("generateSourceMap produces conforming SourceMap V3", () => {
    const source = `<script>\nlet x = 1;\n</script>\n<div>{x}</div>`;
    const generated = `import { createElement } from "@mix/runtime";\nexport function Component() {}\n`;

    const map = generateSourceMap("Component.mix", source, generated);

    assert.equal(map.version, 3);
    assert.equal(map.file, "Component.js");
    assert.deepEqual(map.sources, ["Component.mix"]);
    assert.equal(typeof map.mappings, "string");
    assert.ok(map.mappings.length > 0);
  });

  // --- 4. Codegen SourceMap Integration ---
  await t.test("generate attaches sourceMap when filename and source are supplied", () => {
    const source = `<script>\nlet count = signal(0);\n</script>\n<span>{count()}</span>`;
    const ast = parse(source, "Counter.mix");
    const descriptor = analyze(ast);
    const result = generate(descriptor, {
      componentName: "Counter",
      filename: "Counter.mix",
      source
    });

    assert.ok(result.sourceMap, "sourceMap should be generated");
    assert.equal(result.sourceMap.version, 3);
    assert.equal(result.sourceMap.file, "Counter.js");
    assert.deepEqual(result.sourceMap.sources, ["Counter.mix"]);
  });

});
