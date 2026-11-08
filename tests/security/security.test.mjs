import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

import {
  isSafeUrl,
  parseSrcset,
  serializeSrcset,
  setSafeSrcset,
  decodeCssEscapes,
  validateCssPropertyName,
  validateCssPropertyValue,
  setSafeStyleProperty,
  setStyleProperty,
  renderTrustedHtml,
  setTrustedHtml,
  setSanitizerProvider,
  getSanitizerProvider,
  getOrCreateTrustedTypesPolicy,
  resetTrustedTypesPolicy,
  MixSecurityError
} from "../../packages/runtime/dist/index.js";

import { compileCss } from "../../packages/compiler-css/dist/index.js";

test("Phase 4 Security Conformance Suite", async (t) => {

  // --- 1. WHATWG srcset Parsing Algorithm Conformance (D-107) ---
  await t.test("D-107: WHATWG srcset parser and test vectors", async (st) => {
    // 1.1 Basic candidates with density
    await st.test("Parses basic candidates with density descriptors", () => {
      const input = "image-1x.jpg 1x, image-2x.jpg 2x";
      const candidates = parseSrcset(input);
      assert.equal(candidates.length, 2);
      assert.deepEqual(candidates[0], { url: "image-1x.jpg", density: 1 });
      assert.deepEqual(candidates[1], { url: "image-2x.jpg", density: 2 });
    });

    // 1.2 Width descriptors
    await st.test("Parses candidates with width descriptors", () => {
      const input = "banner-400w.jpg 400w, banner-800w.jpg 800w";
      const candidates = parseSrcset(input);
      assert.equal(candidates.length, 2);
      assert.deepEqual(candidates[0], { url: "banner-400w.jpg", width: 400 });
      assert.deepEqual(candidates[1], { url: "banner-800w.jpg", width: 800 });
    });

    // 1.3 Data URLs containing commas
    await st.test("Parses SVG data URLs containing commas without premature splitting", () => {
      const input = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect fill='red'/></svg> 1x, image-2x.jpg 2x";
      const candidates = parseSrcset(input);
      assert.equal(candidates.length, 2);
      assert.equal(candidates[0].url, "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect fill='red'/></svg>");
      assert.equal(candidates[0].density, 1);
      assert.deepEqual(candidates[1], { url: "image-2x.jpg", density: 2 });
    });

    // 1.4 Base64 data URLs with commas
    await st.test("Parses base64 data URLs containing commas", () => {
      const input = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg== 1x, fallback.jpg 2x";
      const candidates = parseSrcset(input);
      assert.equal(candidates.length, 2);
      assert.ok(candidates[0].url.startsWith("data:image/png;base64,"));
      assert.equal(candidates[0].density, 1);
      assert.deepEqual(candidates[1], { url: "fallback.jpg", density: 2 });
    });

    // 1.5 Query strings with commas
    await st.test("Parses URLs containing commas in query strings", () => {
      const input = "https://example.com/cdn?format=jpg,webp&q=80 1x";
      const candidates = parseSrcset(input);
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].url, "https://example.com/cdn?format=jpg,webp&q=80");
      assert.equal(candidates[0].density, 1);
    });

    // 1.6 Irregular whitespace, newlines, and tabs
    await st.test("Handles irregular whitespace, newlines, and tabs", () => {
      const input = "\n  image.jpg\t 1x\n , \timage-hd.jpg 2x  ";
      const candidates = parseSrcset(input);
      assert.equal(candidates.length, 2);
      assert.deepEqual(candidates[0], { url: "image.jpg", density: 1 });
      assert.deepEqual(candidates[1], { url: "image-hd.jpg", density: 2 });
    });

    // 1.7 Malformed descriptor error recovery
    await st.test("Discards malformed candidate and recovers subsequent valid candidates", () => {
      const input = "img1.jpg invalid-descriptor, img2.jpg 2x";
      const candidates = parseSrcset(input);
      assert.equal(candidates.length, 1);
      assert.deepEqual(candidates[0], { url: "img2.jpg", density: 2 });
    });

    // 1.8 Duplicate and conflicting descriptors
    await st.test("Discards candidates with duplicate or conflicting descriptors", () => {
      const duplicateDensity = "img1.jpg 1x 2x, img2.jpg 1x";
      const res1 = parseSrcset(duplicateDensity);
      assert.equal(res1.length, 1);
      assert.equal(res1[0].url, "img2.jpg");

      const bothWidthAndDensity = "img1.jpg 400w 2x, img2.jpg 800w";
      const res2 = parseSrcset(bothWidthAndDensity);
      assert.equal(res2.length, 1);
      assert.equal(res2[0].url, "img2.jpg");

      const zeroWidth = "img1.jpg 0w, img2.jpg 400w";
      const res3 = parseSrcset(zeroWidth);
      assert.equal(res3.length, 1);
      assert.equal(res3[0].url, "img2.jpg");
    });

    // 1.9 Dangerous URL rejection in srcset
    await st.test("Omits candidates with dangerous URL schemes", () => {
      const input = "javascript:alert(1) 1x, valid.jpg 2x, vbscript:evil() 1x";
      const candidates = parseSrcset(input);
      assert.equal(candidates.length, 1);
      assert.deepEqual(candidates[0], { url: "valid.jpg", density: 2 });
    });

    // 1.10 Serialization and DOM setSafeSrcset
    await st.test("serializeSrcset and setSafeSrcset DOM helper", () => {
      const window = new Window();
      const img = window.document.createElement("img");

      setSafeSrcset(img, "hero-400w.jpg 400w, hero-800w.jpg 800w");
      assert.equal(img.getAttribute("srcset"), "hero-400w.jpg 400w, hero-800w.jpg 800w");

      // With dangerous candidate filtered
      setSafeSrcset(img, "javascript:exploit() 1x, hero-2x.jpg 2x");
      assert.equal(img.getAttribute("srcset"), "hero-2x.jpg 2x");

      // Empty / completely invalid removes attribute
      setSafeSrcset(img, "invalid-only invalid-desc");
      assert.equal(img.getAttribute("srcset"), null);
    });
  });

  // --- 2. CSS Validation & Injection Prevention (D-108) ---
  await t.test("D-108: CSS Validation and Injection Prevention", async (st) => {
    // 2.1 CSS Escape Sequence Decoding
    await st.test("decodeCssEscapes decodes hex and character escapes", () => {
      assert.equal(decodeCssEscapes("red\\3b  blue"), "red; blue");
      assert.equal(decodeCssEscapes("color: red\\7d"), "color: red}");
      assert.equal(decodeCssEscapes("foo\\22 bar"), 'foo"bar');
      assert.equal(decodeCssEscapes("font\\: bold"), "font: bold");
      assert.equal(decodeCssEscapes("safe-value"), "safe-value");
    });

    // 2.2 CSS Property Name Validation
    await st.test("validateCssPropertyName enforces strict identifier grammar", () => {
      assert.equal(validateCssPropertyName("color"), true);
      assert.equal(validateCssPropertyName("background-color"), true);
      assert.equal(validateCssPropertyName("border-radius"), true);
      assert.equal(validateCssPropertyName("--custom-variable"), true);
      assert.equal(validateCssPropertyName("--theme-color-1"), true);

      // Injections and invalid names
      assert.equal(validateCssPropertyName("color; background"), false);
      assert.equal(validateCssPropertyName("property: value"), false);
      assert.equal(validateCssPropertyName("width{100}"), false);
      assert.equal(validateCssPropertyName("font\\3b"), false);
      assert.equal(validateCssPropertyName(""), false);
      assert.equal(validateCssPropertyName("   "), false);
      assert.equal(validateCssPropertyName("123invalid"), false);
    });

    // 2.3 CSS Property Value Validation
    await st.test("validateCssPropertyValue detects delimiter and URL injection", () => {
      assert.equal(validateCssPropertyValue("blue"), true);
      assert.equal(validateCssPropertyValue("12px 24px"), true);
      assert.equal(validateCssPropertyValue("calc(100% - 20px)"), true);
      assert.equal(validateCssPropertyValue('url("https://example.com/bg.png")'), true);
      assert.equal(validateCssPropertyValue("url('/assets/bg.svg')"), true);
      assert.equal(validateCssPropertyValue("url(data:image/png;base64,iVBORw...)"), true);

      // Semicolon injection
      assert.equal(validateCssPropertyValue("red; background-color: blue"), false);
      // CSS escape sequence semicolon injection
      assert.equal(validateCssPropertyValue("red\\3b  background-color: blue"), false);
      // CSS escape sequence brace injection
      assert.equal(validateCssPropertyValue("red\\7d  body { display: none; }"), false);
      // Literal brace injection
      assert.equal(validateCssPropertyValue("red } body { color: green; }"), false);

      // Dangerous URL schemes
      assert.equal(validateCssPropertyValue('url("javascript:alert(1)")'), false);
      assert.equal(validateCssPropertyValue("url('vbscript:msgbox(1)')"), false);
      assert.equal(validateCssPropertyValue("url(data:text/html;base64,PHNjcmlwdD5...)"), false);
      assert.equal(validateCssPropertyValue("url(data:application/javascript,alert(1))"), false);

      // Legacy script execution
      assert.equal(validateCssPropertyValue("expression(alert(1))"), false);
      assert.equal(validateCssPropertyValue("-moz-binding: url(test.xml)"), false);
    });

    // 2.4 Safe Style Property Application
    await st.test("setSafeStyleProperty applies safe styles and throws on violation", () => {
      const window = new Window();
      const div = window.document.createElement("div");

      // Safe application
      setSafeStyleProperty(div, "color", "red");
      assert.equal(div.style.getPropertyValue("color"), "red");

      setSafeStyleProperty(div, "--theme-color", "#ffffff");
      assert.equal(div.style.getPropertyValue("--theme-color"), "#ffffff");

      // Invalid property name throws MixSecurityError
      assert.throws(
        () => setSafeStyleProperty(div, "color; background", "blue"),
        MixSecurityError
      );

      // Semicolon injection throws MixSecurityError
      assert.throws(
        () => setSafeStyleProperty(div, "color", "red; background: blue"),
        MixSecurityError
      );

      // Escape sequence injection throws MixSecurityError
      assert.throws(
        () => setSafeStyleProperty(div, "color", "red\\3b background: blue"),
        MixSecurityError
      );

      // Dangerous URL throws MixSecurityError
      assert.throws(
        () => setSafeStyleProperty(div, "background-image", 'url("javascript:alert(1)")'),
        MixSecurityError
      );
    });

    // 2.5 Compile-time CSS validation in @mix/compiler-css
    await st.test("compileCss enforces syntax, at-rules, and safe declarations", () => {
      // Forbidden at-rules
      const importRes = compileCss("@import 'evil.css'; .btn { color: red; }");
      assert.ok(importRes.errors.some((e) => e.includes("MIX_ERR_CSS_FORBIDDEN_IMPORT")));

      const charsetRes = compileCss("@charset 'UTF-8'; .btn { color: red; }");
      assert.ok(charsetRes.errors.some((e) => e.includes("MIX_ERR_CSS_FORBIDDEN_CHARSET")));

      // Unbalanced braces
      const unbalancedRes = compileCss(".btn { color: red;");
      assert.ok(unbalancedRes.errors.some((e) => e.includes("MIX_ERR_CSS_SYNTAX")));

      // Unsafe declaration (e.g. javascript: URL in static CSS)
      const unsafeRes = compileCss(".btn { background: url(javascript:alert(1)); }");
      assert.ok(unsafeRes.errors.some((e) => e.includes("MIX_ERR_CSS_UNSAFE_DECLARATION")));

      // Valid CSS
      const validRes = compileCss(".btn { color: green; }");
      assert.equal(validRes.errors.length, 0);
    });
  });

  // --- 3. Trusted HTML Boundary & Sanitizer Provider (D-109) ---
  await t.test("D-109: Trusted HTML Boundary and Sanitizer Provider", async (st) => {
    // 3.1 Raw HTML without provider throws MixSecurityError
    await st.test("Evaluating raw HTML without SanitizerProvider throws MixSecurityError", () => {
      setSanitizerProvider(null);
      assert.equal(getSanitizerProvider(), null);

      assert.throws(
        () => renderTrustedHtml("<p>Hello</p>"),
        MixSecurityError
      );

      const window = new Window();
      const div = window.document.createElement("div");
      assert.throws(
        () => setTrustedHtml(div, "<script>alert(1)</script>"),
        MixSecurityError
      );
    });

    // 3.2 Registered SanitizerProvider sanitizes input
    await st.test("Registered SanitizerProvider sanitizes and applies HTML", () => {
      const mockSanitizer = {
        sanitizeHtml(raw, context) {
          // Simple test sanitizer: strip script tags
          return raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
        }
      };

      setSanitizerProvider(mockSanitizer);
      assert.equal(getSanitizerProvider(), mockSanitizer);

      const clean = renderTrustedHtml("<b>Bold</b><script>alert(1)</script>");
      assert.equal(clean, "<b>Bold</b>");

      const window = new Window();
      const div = window.document.createElement("div");
      setTrustedHtml(div, "<b>Safe</b><script>alert('xss')</script>");
      assert.equal(div.innerHTML, "<b>Safe</b>");

      setSanitizerProvider(null); // Cleanup
    });

    // 3.3 Native W3C Trusted Types Policy Integration
    await st.test("Integrates with native window.trustedTypes when available", () => {
      resetTrustedTypesPolicy();

      let policyCreatedName = "";
      let policyCreateHtmlCalled = false;

      // Mock window.trustedTypes
      globalThis.window = {
        trustedTypes: {
          createPolicy(name, rules) {
            policyCreatedName = name;
            return {
              createHTML(input) {
                policyCreateHtmlCalled = true;
                const sanitized = rules.createHTML(input);
                return {
                  toString() { return sanitized; },
                  type: "TrustedHTML"
                };
              }
            };
          }
        }
      };

      const mockSanitizer = {
        sanitizeHtml(raw) {
          return raw.replace(/<script[^>]*>.*?<\/script>/gi, "");
        }
      };
      setSanitizerProvider(mockSanitizer);

      const policy = getOrCreateTrustedTypesPolicy();
      assert.ok(policy, "Should create Trusted Types policy");
      assert.equal(policyCreatedName, "mix-framework#html");

      const div = { innerHTML: null };
      setTrustedHtml(div, "<div>Content</div>");
      assert.equal(policyCreateHtmlCalled, true);
      assert.ok(div.innerHTML && div.innerHTML.type === "TrustedHTML");

      // Teardown
      resetTrustedTypesPolicy();
      setSanitizerProvider(null);
      delete globalThis.window;
    });
  });

});

