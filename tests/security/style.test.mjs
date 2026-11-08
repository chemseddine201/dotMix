import test from "node:test";
import assert from "node:assert/strict";

import {
  isAllowedStyleProperty,
  isAllowedStyleValue,
  decodeCssEscapes
} from "../../packages/runtime/dist/security/index.js";

test("Phase 3 — CSS Style Validation (§6.3 / T-CSS-01..12)", async (t) => {
  await t.test("T-CSS-01: Valid standard CSS property names", () => {
    assert.equal(isAllowedStyleProperty("color"), true);
    assert.equal(isAllowedStyleProperty("font-size"), true);
    assert.equal(isAllowedStyleProperty("border-radius"), true);
    assert.equal(isAllowedStyleProperty("background-color"), true);
    assert.equal(isAllowedStyleProperty("margin-top"), true);
  });

  await t.test("T-CSS-02: CamelCase to kebab-case conversion for property names", () => {
    assert.equal(isAllowedStyleProperty("fontSize"), true);
    assert.equal(isAllowedStyleProperty("backgroundColor"), true);
    assert.equal(isAllowedStyleProperty("borderRadius"), true);
    assert.equal(isAllowedStyleProperty("zIndex"), true);
  });

  await t.test("T-CSS-03: Custom CSS properties (--*)", () => {
    assert.equal(isAllowedStyleProperty("--theme-primary"), true);
    assert.equal(isAllowedStyleProperty("--font-scale-1"), true);
    assert.equal(isAllowedStyleProperty("--color-accent_2"), true);
  });

  await t.test("T-CSS-04: Invalid CSS property names rejected (R-CSS-02)", () => {
    assert.equal(isAllowedStyleProperty("color; background"), false);
    assert.equal(isAllowedStyleProperty("property: value"), false);
    assert.equal(isAllowedStyleProperty("width{100}"), false);
    assert.equal(isAllowedStyleProperty("font\\3b"), false);
    assert.equal(isAllowedStyleProperty(""), false);
    assert.equal(isAllowedStyleProperty("   "), false);
    assert.equal(isAllowedStyleProperty("123invalid"), false);
    assert.equal(isAllowedStyleProperty("-123invalid"), false);
  });

  await t.test("T-CSS-05: Fast path: Simple safe values without delimiters accepted immediately (R-CSS-04)", () => {
    assert.equal(isAllowedStyleValue("red"), true);
    assert.equal(isAllowedStyleValue("16px"), true);
    assert.equal(isAllowedStyleValue("1.5rem"), true);
    assert.equal(isAllowedStyleValue("bold"), true);
    assert.equal(isAllowedStyleValue("#ff0000"), true);
    assert.equal(isAllowedStyleValue("rgb(255, 0, 0)"), true);
    assert.equal(isAllowedStyleValue("calc(100% - 20px)"), true);
  });

  await t.test("T-CSS-06: Semicolon delimiter injection rejected", () => {
    assert.equal(isAllowedStyleValue("red; background-color: blue"), false);
    assert.equal(isAllowedStyleValue("12px; display: none;"), false);
  });

  await t.test("T-CSS-07: CSS escape semicolon injection decoded & rejected", () => {
    assert.equal(isAllowedStyleValue("red\\3b  background-color: blue"), false);
    assert.equal(isAllowedStyleValue("12px\\3b display: none"), false);
  });

  await t.test("T-CSS-08: Curly brace injection rejected", () => {
    assert.equal(isAllowedStyleValue("red } body { color: green }"), false);
    assert.equal(isAllowedStyleValue("10px { overflow: hidden }"), false);
  });

  await t.test("T-CSS-09: CSS escape brace injection decoded & rejected", () => {
    assert.equal(isAllowedStyleValue("red\\7d body { color: green }"), false);
  });

  await t.test("T-CSS-10: @import rules rejected in dynamic styles", () => {
    assert.equal(isAllowedStyleValue("@import url('evil.css')"), false);
    assert.equal(isAllowedStyleValue("@import 'https://evil.com/style.css'"), false);
  });

  await t.test("T-CSS-11: url() and image-set() blocked in dynamic styles (AGENTS.md Part V)", () => {
    assert.equal(isAllowedStyleValue("url('https://evil.com/leak')"), false);
    assert.equal(isAllowedStyleValue("url(javascript:alert(1))"), false);
    assert.equal(isAllowedStyleValue("image-set('img1.png' 1x, 'img2.png' 2x)"), false);
  });

  await t.test("T-CSS-12: expression() and -moz-binding blocked", () => {
    assert.equal(isAllowedStyleValue("expression(alert(1))"), false);
    assert.equal(isAllowedStyleValue("-moz-binding: url(test.xml)"), false);
  });

  await t.test("decodeCssEscapes utility decodes hex and character escapes", () => {
    assert.equal(decodeCssEscapes("red\\3b  blue"), "red; blue");
    assert.equal(decodeCssEscapes("color: red\\7d"), "color: red}");
    assert.equal(decodeCssEscapes("foo\\22 bar"), 'foo"bar');
    assert.equal(decodeCssEscapes("safe-value"), "safe-value");
  });
});

