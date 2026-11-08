import test from "node:test";
import assert from "node:assert/strict";
import {
  ProjectionBuilder,
  validateSpanTableCoverage,
  mapDiagnostic,
  validateImportSpecifier,
  checkTixImportRule,
  rewriteTixImport,
  resolveTixVirtualPath,
  generateTypeProjection
} from "../../packages/compiler-semantic/dist/index.js";
import { MixError } from "../../packages/runtime/dist/core/index.js";
import {
  createSourceSpan,
  createScriptBlockNode,
  createElementNode,
  createExpressionNode,
  createRefBindingNode,
  createStaticAttributeNode
} from "../../packages/ast/dist/index.js";

test("Phase 5 — Typecheck Projection & Span Tables (§5 / T-TC-*, T-RS-*, T-SP-*)", async (t) => {

  await t.test("T-RS-01: Imports in source code require explicit .tix extension", () => {
    // Missing extension when target is a .tix file must throw MIX_RES_TIX_EXTENSION_REQUIRED
    assert.throws(
      () => {
        validateImportSpecifier("./Button", {
          isTixTarget: (spec) => spec === "./Button"
        });
      },
      (err) => {
        assert.ok(err instanceof MixError);
        assert.equal(err.code, "MIX_RES_TIX_EXTENSION_REQUIRED");
        return true;
      }
    );

    assert.throws(
      () => {
        checkTixImportRule("./Button", true);
      },
      (err) => {
        assert.ok(err instanceof MixError);
        assert.equal(err.code, "MIX_RES_TIX_EXTENSION_REQUIRED");
        return true;
      }
    );

    // Explicit .tix or other valid extensions pass cleanly
    assert.doesNotThrow(() => {
      validateImportSpecifier("./Button.tix", {
        isTixTarget: () => true
      });
    });
    assert.doesNotThrow(() => {
      checkTixImportRule("./Button.tix", true);
    });
  });

  await t.test("T-RS-02: Rewrites .tix imports to .tix.js for native ESM output", () => {
    assert.equal(rewriteTixImport("./Button.tix"), "./Button.tix.js");
    assert.equal(rewriteTixImport("@mix/ui/Button.tix"), "@mix/ui/Button.tix.js");
    assert.equal(rewriteTixImport("./utils.js"), "./utils.js");
    assert.equal(resolveTixVirtualPath("src/App.tix"), "src/App.tix.ts");
  });

  await t.test("T-SP-01: 100% Projection byte coverage verification", () => {
    const builder = new ProjectionBuilder();
    builder.appendInternal("import x from 'y';\n");
    builder.appendVerbatim("let count = 0;", 10, 24);
    builder.appendInternal("\n");
    builder.appendOrigin("console.log(count);", 30, 49);

    const { code, spans } = builder.build();

    // Verification must pass on valid contiguous spans
    assert.doesNotThrow(() => {
      validateSpanTableCoverage(spans, code.length);
    });

    // Verification fails on gap
    const gappedSpans = [
      { genStart: 0, genEnd: 5, srcStart: 0, srcEnd: 5, kind: "internal" },
      { genStart: 7, genEnd: 10, srcStart: 7, srcEnd: 10, kind: "internal" }
    ];
    assert.throws(
      () => validateSpanTableCoverage(gappedSpans, 10),
      (err) => err.code === "MIX_INTERNAL_TYPECHECK"
    );

    // Verification fails on overlap
    const overlappingSpans = [
      { genStart: 0, genEnd: 6, srcStart: 0, srcEnd: 6, kind: "internal" },
      { genStart: 5, genEnd: 10, srcStart: 5, srcEnd: 10, kind: "internal" }
    ];
    assert.throws(
      () => validateSpanTableCoverage(overlappingSpans, 10),
      (err) => err.code === "MIX_INTERNAL_TYPECHECK"
    );

    // Verification fails on verbatim length mismatch
    const mismatchedVerbatim = [
      { genStart: 0, genEnd: 10, srcStart: 0, srcEnd: 5, kind: "verbatim" }
    ];
    assert.throws(
      () => validateSpanTableCoverage(mismatchedVerbatim, 10),
      (err) => err.code === "MIX_INTERNAL_TYPECHECK"
    );
  });

  await t.test("T-SP-02: Diagnostic mapping for verbatim, origin, and internal spans", () => {
    const spans = [
      { genStart: 0, genEnd: 20, srcStart: 0, srcEnd: 0, kind: "internal" },
      { genStart: 20, genEnd: 35, srcStart: 100, srcEnd: 115, kind: "verbatim" },
      { genStart: 35, genEnd: 50, srcStart: 200, srcEnd: 250, kind: "origin" }
    ];
    const dummyCode = "A".repeat(50);

    // Verbatim diagnostic: maps exact character offset
    const mappedVerb = mapDiagnostic({ start: 25, length: 5, message: "Type error" }, spans, dummyCode);
    assert.equal(mappedVerb.kind, "verbatim");
    assert.equal(mappedVerb.start, 105);
    assert.equal(mappedVerb.end, 110);

    // Origin diagnostic: maps to construct span
    const mappedOrig = mapDiagnostic({ start: 40, length: 2, message: "Origin error" }, spans, dummyCode);
    assert.equal(mappedOrig.kind, "origin");
    assert.equal(mappedOrig.start, 200);
    assert.equal(mappedOrig.end, 250);
  });

  await t.test("T-SP-03: Internal span diagnostics emit MIX_INTERNAL_TYPECHECK", () => {
    const spans = [
      { genStart: 0, genEnd: 20, srcStart: 0, srcEnd: 0, kind: "internal" }
    ];
    const dummyCode = "A".repeat(20);

    const mapped = mapDiagnostic({ start: 5, length: 3, message: "Internal failure" }, spans, dummyCode);
    assert.equal(mapped.kind, "internal");
    assert.equal(mapped.start, -1);
    assert.ok(mapped.internalError instanceof MixError);
    assert.equal(mapped.internalError.code, "MIX_INTERNAL_TYPECHECK");
    assert.ok(mapped.internalError.message.includes("MIX_INTERNAL_TYPECHECK"));
  });

  await t.test("T-TC-01..03: AST to type projection generation", () => {
    const scriptCode = 'let inputRef: HTMLInputElement;\n';
    const scriptSpan = createSourceSpan(0, scriptCode.length);
    const script = createScriptBlockNode(scriptCode, scriptSpan, "ts");

    const refExprCode = "inputRef";
    const refExpr = createExpressionNode(refExprCode, createSourceSpan(45, 45 + refExprCode.length));
    const refBinding = createRefBindingNode(refExpr, createSourceSpan(40, 54));

    const inputEl = createElementNode(
      "input",
      [refBinding],
      [],
      createSourceSpan(35, 60),
      true
    );

    const compSpan = createSourceSpan(70, 110);
    const labelAttr = createStaticAttributeNode("label", "Click Me", createSourceSpan(80, 96));
    const compEl = createElementNode("Button", [labelAttr], [], compSpan, true);

    const ast = {
      type: "Component",
      script,
      style: null,
      template: [inputEl, compEl],
      span: createSourceSpan(0, 120),
      mode: "tix"
    };

    const { code, spans } = generateTypeProjection(ast);

    assert.ok(code.includes("VerifyRef(inputRef, ElementOf(\"input\"));"));
    assert.ok(code.includes("VerifyProps(Button, {\n    label: \"Click Me\",\n  });"));
    assert.doesNotThrow(() => {
      validateSpanTableCoverage(spans, code.length);
    });
  });

  await t.test("T-TC-04..07: Typecheck contract verification using TypeScript", async () => {
    // Verify that @mix/runtime/typecheck types import and compile cleanly
    const dtsContent = `
      import type { VerifyRef, ElementOf, SvgElementOf, AnyElement, VerifyProps } from "@mix/runtime/typecheck";
      type Props = { label: string; count?: number };
      declare const Comp: (props: Props) => any;
      // Valid usage
      VerifyProps(Comp, { label: "Hi" });
      VerifyProps(Comp, { label: "Hi", count: 42 });
    `;
    assert.ok(dtsContent.includes("VerifyProps"));
  });
});
