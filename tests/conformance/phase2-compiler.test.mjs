import test from "node:test";
import assert from "node:assert/strict";

import { parse, scanExpressionBoundary } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { compileCss, generateScopeId } from "../../packages/compiler-css/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import { walk } from "../../packages/ast/dist/index.js";

test("Phase 2 Conformance — Comprehensive Core Language & Compiler Pipeline", async (t) => {
  // 1. Syntax Modes: .mix vs .tix
  await t.test("Mode handling: .mix (flexible) and .tix (strict)", () => {
    const mixSource = `<script>let x = signal(1);</script><div>{x()}</div>`;
    const mixAst = parse(mixSource, "App.mix");
    assert.equal(mixAst.mode, "mix");
    const mixSem = analyze(mixAst);
    assert.equal(mixSem.diagnostics.length, 0);

    const tixSource = `<script>let y = signal(2);</script><div>{y()}</div>`;
    const tixAst = parse(tixSource, "App.tix");
    assert.equal(tixAst.mode, "tix");
    const tixSem = analyze(tixAst);
    // Emits strict lang requirement warning
    assert.ok(tixSem.diagnostics.some((d) => d.code === "MIX_ERR_TIX_STRICT_LANG"));
  });

  // 2. DynamicElement Syntax: <{~expr}> ... </{~expr}> (D-105)
  await t.test("DynamicElement <{~expr}> parsing and codegen (D-105)", () => {
    const source = `<script>let tag = signal("button");</script><{~tag()}>Click</{~tag()}>`;
    const ast = parse(source);

    assert.equal(ast.template.length, 1);
    const dyn = ast.template[0];
    assert.equal(dyn.type, "DynamicElement");
    assert.equal(dyn.tagExpression.code, "tag()");
    assert.equal(dyn.children.length, 1);
    assert.equal(dyn.children[0].type, "Text");
    assert.equal(dyn.children[0].value, "Click");

    const sem = analyze(ast);
    const codegen = generate(sem);
    assert.ok(codegen.code.includes("const __dynTag = tag();"));
    assert.ok(codegen.code.includes("createElement(__dynTag)"));
  });

  // 3. Expression Boundary Scanner (D-105)
  await t.test("scanExpressionBoundary handles complex JS/TS delimiters", () => {
    const src1 = "{ a ? '{nested}' : `tmpl ${foo({ b: 1 })}` }";
    const end1 = scanExpressionBoundary(src1, 0);
    assert.equal(end1, src1.length - 1);

    const src2 = "{ /* comment with { braces } */ count() }";
    const end2 = scanExpressionBoundary(src2, 0);
    assert.equal(end2, src2.length - 1);

    const src3 = "{ /regex\\/with\\{brace\\}/.test(val) }";
    const end3 = scanExpressionBoundary(src3, 0);
    assert.equal(end3, src3.length - 1);
  });

  // 4. Control Flow: {#if} and {#each} (D-110)
  await t.test("Control flow parsing and keyed list validation", () => {
    const source = `<script>let show = signal(true); let items = signal([1, 2]);</script>
{#if show()}
  <span>Visible</span>
{:else}
  <span>Hidden</span>
{/if}
{#each items() as item, idx (item)}
  <div>{item}</div>
{/each}`;

    const ast = parse(source);
    assert.equal(ast.template.length, 2);

    const ifBlock = ast.template[0];
    assert.equal(ifBlock.type, "IfBlock");
    assert.equal(ifBlock.condition.code, "show()");
    assert.ok(ifBlock.alternate);

    const eachBlock = ast.template[1];
    assert.equal(eachBlock.type, "EachBlock");
    assert.equal(eachBlock.itemBinding, "item");
    assert.equal(eachBlock.indexBinding, "idx");
    assert.ok(eachBlock.keyExpression);
    assert.equal(eachBlock.keyExpression.code, "item");

    // Unkeyed warning test (D-110)
    const unkeyedSource = `{#each list as x}<div>{x}</div>{/each}`;
    const unkeyedAst = parse(unkeyedSource);
    const unkeyedSem = analyze(unkeyedAst);
    assert.ok(unkeyedSem.diagnostics.some((d) => d.code === "MIX_WARN_UNKEYED_EACH"));
  });

  // 5. Attributes, Events, Refs, and Directives
  await t.test("Comprehensive attributes and directive parsing", () => {
    const source = `<button class="btn" disabled={isDisabled()} @click={handleClick} ref={btnRef} mix-html={rawHtml()}>Click</button>`;
    const ast = parse(source);
    const btn = ast.template[0];

    assert.equal(btn.type, "Element");
    assert.equal(btn.attributes.length, 5);

    const [stat, dyn, evt, ref, dir] = btn.attributes;
    assert.equal(stat.type, "StaticAttribute");
    assert.equal(stat.name, "class");
    assert.equal(stat.value, "btn");

    assert.equal(dyn.type, "DynamicAttribute");
    assert.equal(dyn.name, "disabled");
    assert.equal(dyn.expression.code, "isDisabled()");

    assert.equal(evt.type, "EventBinding");
    assert.equal(evt.eventName, "click");
    assert.equal(evt.handler.code, "handleClick");

    assert.equal(ref.type, "RefBinding");
    assert.equal(ref.target.code, "btnRef");

    assert.equal(dir.type, "Directive");
    assert.equal(dir.name, "mix-html");
    assert.equal(dir.expression.code, "rawHtml()");
  });

  // 6. Scoped CSS Compilation & Forbidden At-Rules (D-108)
  await t.test("CSS Scoping and At-rule validation (D-108)", () => {
    const validCss = `
      .card { color: red; }
      :host { display: block; }
      :global(.external) { margin: 0; }
    `;
    const compiled = compileCss(validCss, { scopeId: "data-mix-test1" });
    assert.equal(compiled.errors.length, 0);
    assert.ok(compiled.code.includes(".card[data-mix-test1]"));
    assert.ok(compiled.code.includes("[data-mix-test1] { display: block; }"));
    assert.ok(compiled.code.includes(".external { margin: 0; }"));

    // Forbidden @import rule (D-108)
    const importCss = `@import url("malicious.css"); .body { color: black; }`;
    const importRes = compileCss(importCss);
    assert.ok(importRes.errors.some((e) => e.includes("MIX_ERR_CSS_FORBIDDEN_IMPORT")));

    // Forbidden @charset rule (D-108)
    const charsetCss = `@charset "UTF-8"; h1 { font-size: 20px; }`;
    const charsetRes = compileCss(charsetCss);
    assert.ok(charsetRes.errors.some((e) => e.includes("MIX_ERR_CSS_FORBIDDEN_CHARSET")));
  });

  // 7. AST Visitor Walking
  await t.test("AST walk infrastructure traverses all nodes", () => {
    const source = `<div><span>Text</span><{~dynTag()} /></div>`;
    const ast = parse(source);
    const visitedTypes = [];

    walk(ast, {
      enter(node) {
        visitedTypes.push(node.type);
      }
    });

    assert.ok(visitedTypes.includes("Component"));
    assert.ok(visitedTypes.includes("Element"));
    assert.ok(visitedTypes.includes("Text"));
    assert.ok(visitedTypes.includes("DynamicElement"));
  });

  // 8. Deterministic Codegen and HMR Scope (D-111)
  await t.test("Codegen determinism and stable __scope for HMR (D-111)", () => {
    const source = `<script>let val = signal(10);</script><div title={val()}>{val()}</div>`;
    const ast = parse(source);
    const sem = analyze(ast);

    const run1 = generate(sem, { componentName: "TestWidget" });
    const run2 = generate(sem, { componentName: "TestWidget" });

    assert.equal(run1.code, run2.code, "Codegen output must be 100% deterministic");
    assert.ok(run1.code.includes("const __scope = Object.create(null);"));
    assert.ok(run1.code.includes("__scope.val = val;"));
    assert.ok(run1.code.includes("__scope,"));
  });

  // 9. Error Diagnostics for Malformed Syntax
  await t.test("Parser reports errors on unclosed tags", () => {
    assert.throws(
      () => parse("<div><span>Unclosed</div>"),
      (err) => err.message.includes("Unclosed element <span>")
    );

    assert.throws(
      () => parse("<{~dynTag}>No close"),
      (err) => err.message.includes("Unclosed dynamic element")
    );
  });
});
