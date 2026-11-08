import test from "node:test";
import assert from "node:assert/strict";

import {
  parseTSExpression,
  assertDynamicCloseMatch,
  tokenizeExpression,
  compareTokenStreams
} from "../../packages/compiler-frontend/dist/parser/index.js";

import {
  parseTemplate,
  scanExpressionBoundary
} from "../../packages/compiler-frontend/dist/index.js";

import { MixError } from "../../packages/runtime/dist/core/index.js";

test("Phase 4 — Syntax & Expression Delimiters (§4.1 & §4.2 / T-SYN-01..12)", async (t) => {
  // --- 4.1 TSExpression Delimiters ---

  await t.test("T-SYN-01: Basic expressions parsed accurately with correct delimiter", () => {
    const src1 = "{ count }";
    const res1 = parseTSExpression(src1, 1, "}");
    assert.equal(res1.raw, " count ");
    assert.equal(res1.endOffset, 9);

    const src2 = "{ count + 1 }";
    const res2 = parseTSExpression(src2, 1, "}");
    assert.equal(res2.raw, " count + 1 ");
  });

  await t.test("T-SYN-02: Parenthesized object literals & nested objects preserved (R-SYN-01a)", () => {
    // Parenthesized object literal
    const src1 = "{ ({ k: 1 }) }";
    const res1 = parseTSExpression(src1, 1, "}");
    assert.equal(res1.raw, " ({ k: 1 }) ");
    assert.equal(res1.node.type, "ParenthesizedExpression");

    // Nested object literals
    const src2 = "{ { a: { b: 2 } } }";
    const res2 = parseTSExpression(src2, 1, "}");
    assert.equal(res2.raw, " { a: { b: 2 } } ");
    assert.equal(res2.node.type, "ObjectExpression");
  });

  await t.test("T-SYN-03: Template literals and regular expressions containing closing braces", () => {
    // Template literal containing '}'
    const src1 = "{ `val: ${x}}` }";
    const res1 = parseTSExpression(src1, 1, "}");
    assert.equal(res1.raw, " `val: ${x}}` ");

    // Regular expression containing '}'
    const src2 = "{ /}/.test(str) }";
    const res2 = parseTSExpression(src2, 1, "}");
    assert.equal(res2.raw, " /}/.test(str) ");
  });

  await t.test("T-SYN-04: Comments containing closing braces inside expressions", () => {
    // Block comment containing '}'
    const src1 = "{ count /* } fake close */ + 1 }";
    const res1 = parseTSExpression(src1, 1, "}");
    assert.equal(res1.raw, " count /* } fake close */ + 1 ");

    // Line comment containing '}'
    const src2 = "{ count // } line comment\n + 2 }";
    const res2 = parseTSExpression(src2, 1, "}");
    assert.equal(res2.raw, " count // } line comment\n + 2 ");
  });

  await t.test("T-SYN-05: Missing delimiter throws MIX_SYN_EXPR_UNTERMINATED with offset", () => {
    const src = "{ count + 1";
    assert.throws(
      () => parseTSExpression(src, 1, "}"),
      (err) => err instanceof MixError && err.code === "MIX_SYN_EXPR_UNTERMINATED"
    );
  });

  await t.test("T-SYN-06: Syntactically invalid TypeScript throws MIX_SYN_EXPR_INVALID", () => {
    const src = "{ const = invalid;; }";
    assert.throws(
      () => parseTSExpression(src, 1, "}"),
      (err) => err instanceof MixError && err.code === "MIX_SYN_EXPR_INVALID"
    );
  });

  // --- 4.2 Dynamic Elements ---

  await t.test("T-SYN-07: Self-closing dynamic element <{~ Component } prop='val' />", () => {
    const template = '<{~ Component } prop="val" />';
    const nodes = parseTemplate(template, 0, template.length, "Test.mix");

    assert.equal(nodes.length, 1);
    const dyn = nodes[0];
    assert.equal(dyn.type, "DynamicElement");
    assert.equal(dyn.tagExpression.code, "Component");
    assert.equal(dyn.attributes.length, 1);
    assert.equal(dyn.attributes[0].name, "prop");
    assert.equal(dyn.children.length, 0);
  });

  await t.test("T-SYN-08: Dynamic element with children <{~ Tag }><span>child</span></{~ Tag }>", () => {
    const template = "<{~ Tag }><span>child</span></{~ Tag }>";
    const nodes = parseTemplate(template, 0, template.length, "Test.mix");

    assert.equal(nodes.length, 1);
    const dyn = nodes[0];
    assert.equal(dyn.type, "DynamicElement");
    assert.equal(dyn.tagExpression.code, "Tag");
    assert.equal(dyn.children.length, 1);
    assert.equal(dyn.children[0].type, "Element");
    assert.equal(dyn.children[0].tag, "span");
  });

  await t.test("T-SYN-09: Token-stream match allows different whitespace/comments in closing tag (R-SYN-02)", () => {
    // Tokens match: state.tag vs state . tag /* comment */
    const template = "<{~ state.tag }>content</{~ state . tag /* comment */ }>";
    const nodes = parseTemplate(template, 0, template.length, "Test.mix");

    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, "DynamicElement");
    assert.equal(nodes[0].tagExpression.code, "state.tag");
  });

  await t.test("T-SYN-10: Mismatch in dynamic closing expression throws MIX_SYN_DYNAMIC_CLOSE_MISMATCH (R-SYN-02)", () => {
    const template = "<{~ ComponentA }>content</{~ ComponentB }>";
    assert.throws(
      () => parseTemplate(template, 0, template.length, "Test.mix"),
      (err) => err instanceof MixError && err.code === "MIX_SYN_DYNAMIC_CLOSE_MISMATCH"
    );
  });

  await t.test("T-SYN-11: Closing expression is never evaluated or emitted in AST (R-SYN-03)", () => {
    const template = "<{~ Header }><h1>Title</h1></{~ Header }>";
    const nodes = parseTemplate(template, 0, template.length, "Test.mix");

    const dyn = nodes[0];
    assert.equal(dyn.type, "DynamicElement");
    // Closing expression node does NOT exist on DynamicElementNode
    assert.equal(dyn.tagExpression.code, "Header");
    assert.equal("closingTag" in dyn, false);
  });

  await t.test("T-SYN-12: Spaces inside '<{~' or '</{~' are forbidden", () => {
    assert.throws(
      () => parseTemplate("<{ ~ Comp } />", 0, 14, "Test.mix"),
      (err) => err instanceof MixError && err.code === "MIX_SYN_EXPR_INVALID"
    );
    assert.throws(
      () => parseTemplate("</{ ~ Comp }>", 0, 13, "Test.mix"),
      (err) => err instanceof MixError && err.code === "MIX_SYN_EXPR_INVALID"
    );
  });

  await t.test("tokenizeExpression and compareTokenStreams utility contract", () => {
    const t1 = tokenizeExpression("a.b");
    const t2 = tokenizeExpression("a  .  b /* comment */");
    assert.equal(compareTokenStreams(t1, t2), true);

    const t3 = tokenizeExpression("a.c");
    assert.equal(compareTokenStreams(t1, t3), false);

    assert.doesNotThrow(() => {
      assertDynamicCloseMatch("foo.bar", "foo.bar");
    });
  });

  await t.test("scanExpressionBoundary integrates with Acorn expression parser", () => {
    const src = "{ ({ a: 1 }) } rest";
    const closeIdx = scanExpressionBoundary(src, 0);
    assert.equal(src[closeIdx], "}");
    assert.equal(src.slice(0, closeIdx + 1), "{ ({ a: 1 }) }");
  });
});
