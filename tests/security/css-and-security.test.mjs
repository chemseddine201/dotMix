import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { compileCss, computeScopeHash } from "../../packages/compiler-css/dist/index.js";
import {
  DiagnosticCodes,
  MixError,
  setSanitizerProvider,
  getSanitizerProvider,
  createTrustedHtml,
  isTrustedHtml,
  setTrustedHtml,
  isSafeUrl,
  validateSafeUrl,
  setSafeUrlAttribute,
  parseSrcsetCandidates,
  setSafeSrcset,
  decodeCssEscapes,
  setSafeStyleProperty,
  setSafeStyleObject
} from "../../packages/runtime/dist/index.js";

describe("Gate 6: Scoped CSS Compilation & Runtime Security Boundaries", () => {
  let document;

  beforeEach(() => {
    const win = new Window();
    document = win.document;
    setSanitizerProvider(null);
  });

  describe("1. Scoped CSS Compiler (@mix/compiler-css — D-108, F-05)", () => {
    it("computes deterministic scope hashes and appends [data-mix-<hash>] to selectors", () => {
      const hash1 = computeScopeHash("Button.mix", ".btn { color: red; }");
      const hash2 = computeScopeHash("Button.mix", ".btn { color: red; }");
      assert.equal(hash1, hash2);
      assert.match(hash1, /^[0-9a-f]{6}$/);

      const res = compileCss(".btn { background-color: blue; }\n.card > span:hover { opacity: 0.8; }", {
        scopeHash: "c8f2a1"
      });
      assert.equal(res.scopeAttribute, "data-mix-c8f2a1");
      assert.ok(res.css.includes(".btn[data-mix-c8f2a1]"));
      assert.ok(res.css.includes(".card[data-mix-c8f2a1]>span[data-mix-c8f2a1]:hover"));
    });

    it("supports :global(...) and :deep(...) while rejecting :host (F-05)", () => {
      const res = compileCss(
        ":global(body.dark) .panel :deep(.child-item) { color: white; }",
        { scopeHash: "ab12cd" }
      );
      assert.ok(res.css.includes("body.dark"));
      assert.ok(!res.css.includes("body.dark[data-mix-ab12cd]"));
      assert.ok(res.css.includes(".panel[data-mix-ab12cd]"));
      assert.ok(res.css.includes(".child-item"));
      assert.ok(!res.css.includes(".child-item[data-mix-ab12cd]"));

      assert.throws(
        () => compileCss(":host { display: block; }", { scopeHash: "ab12cd" }),
        (err) => err.code === DiagnosticCodes.MIX_ERR_PARSE_SYNTAX
      );
    });

    it("rejects @import and @charset rules in component <style> blocks", () => {
      assert.throws(
        () => compileCss('@import url("https://evil.example/x.css"); .a { color: red; }'),
        (err) => err.code === DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_IMPORT
      );

      assert.throws(
        () => compileCss('@charset "UTF-8"; .a { color: red; }'),
        (err) => err.code === DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_CHARSET
      );
    });

    it("rejects unsafe url(...) schemes inside static <style> declarations", () => {
      assert.throws(
        () => compileCss(".box { background-image: url('javascript:alert(1)'); }"),
        (err) => err.code === DiagnosticCodes.MIX_SEC_UNSAFE_URL
      );

      assert.throws(
        () => compileCss(".box { background-image: url('data:image/svg+xml,<svg onload=alert(1)>'); }"),
        (err) => err.code === DiagnosticCodes.MIX_SEC_UNSAFE_URL
      );

      const safeUrlRes = compileCss(
        ".box { background-image: url('/assets/bg.png'); }",
        { scopeHash: "112233" }
      );
      assert.ok(safeUrlRes.css.includes("/assets/bg.png"));
    });
  });

  describe("2. Normative WHATWG srcset Parser & Validator (D-107)", () => {
    it("parses all mandatory spec/SECURITY.md §2.2 conformance test vectors", () => {
      // 1. Basic candidate with density
      const v1 = parseSrcsetCandidates("image-1x.jpg 1x, image-2x.jpg 2x");
      assert.deepEqual(v1, [
        { url: "image-1x.jpg", descriptor: "1x" },
        { url: "image-2x.jpg", descriptor: "2x" }
      ]);

      // 2. Candidates with width descriptors
      const v2 = parseSrcsetCandidates("banner-400w.jpg 400w, banner-800w.jpg 800w");
      assert.deepEqual(v2, [
        { url: "banner-400w.jpg", descriptor: "400w" },
        { url: "banner-800w.jpg", descriptor: "800w" }
      ]);

      // 3. Data URLs containing internal commas
      const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA";
      const v3 = parseSrcsetCandidates(`${dataUri} 1x, image-2x.jpg 2x`);
      assert.deepEqual(v3, [
        { url: dataUri, descriptor: "1x" },
        { url: "image-2x.jpg", descriptor: "2x" }
      ]);

      // 4. Query strings with commas
      const v4 = parseSrcsetCandidates("https://example.com/cdn?format=jpg,webp&q=80 1x");
      assert.deepEqual(v4, [
        { url: "https://example.com/cdn?format=jpg,webp&q=80", descriptor: "1x" }
      ]);

      // 5. Irregular whitespace
      const v5 = parseSrcsetCandidates("\n  image.jpg\t 1x\n , \timage-hd.jpg 2x  ");
      assert.deepEqual(v5, [
        { url: "image.jpg", descriptor: "1x" },
        { url: "image-hd.jpg", descriptor: "2x" }
      ]);

      // 6. Malformed descriptors: discards malformed candidate and recovers for subsequent candidates
      const v6 = parseSrcsetCandidates("img1.jpg invalid-descriptor, img2.jpg 2x");
      assert.deepEqual(v6, [{ url: "img2.jpg", descriptor: "2x" }]);
    });

    it("commits validated srcset to DOM element and blocks unsafe URL protocols", () => {
      const img = document.createElement("img");
      setSafeSrcset(img, "https://cdn.example.com/a,b.jpg 1x, /local/c.webp 2x");
      assert.equal(
        img.getAttribute("srcset"),
        "https://cdn.example.com/a,b.jpg 1x, /local/c.webp 2x"
      );

      assert.throws(
        () => setSafeSrcset(img, "img1.jpg 1x, javascript:alert(1) 2x"),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_UNSAFE_URL
      );
    });
  });

  describe("3. Safe URL Protocol Enforcement (R-URL-01)", () => {
    it("allows safe protocols and rejects javascript:, vbscript:, and scriptable data: URLs", () => {
      assert.equal(isSafeUrl("https://example.com/path"), true);
      assert.equal(isSafeUrl("/relative/path?x=1:2"), true);
      assert.equal(isSafeUrl("mailto:team@example.com"), true);
      assert.equal(isSafeUrl("data:image/png;base64,iVBORw0KGgo="), true);

      assert.equal(isSafeUrl("javascript:alert(1)"), false);
      assert.equal(isSafeUrl("  \tjava\nscript:alert(1)"), false);
      assert.equal(isSafeUrl("vbscript:msgbox(1)"), false);
      assert.equal(isSafeUrl("data:text/html,<script>alert(1)</script>"), false);
      assert.equal(isSafeUrl("data:image/svg+xml;utf8,<svg onload=alert(1)>"), false);

      const link = document.createElement("a");
      setSafeUrlAttribute(link, "href", "https://example.com");
      assert.equal(link.getAttribute("href"), "https://example.com");

      assert.throws(
        () => validateSafeUrl("javascript:void(0)"),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_UNSAFE_URL
      );
    });
  });

  describe("4. Dynamic CSS Property & Escape Validation (D-108, R-CSS-01..05)", () => {
    it("decodes CSS hex and character escapes before checking for delimiter or URL injection", () => {
      assert.equal(decodeCssEscapes("red\\3b color:blue"), "red;color:blue");
      assert.equal(decodeCssEscapes("10px\\7d body{display:none}"), "10px}body{display:none}");

      const div = document.createElement("div");

      // Hex-escaped semicolon breakout attempt
      assert.throws(
        () => setSafeStyleProperty(div, "color", "red\\3b background:url(https://evil.com)"),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_CSS_PROPERTY
      );

      // Hex-escaped closing brace breakout attempt
      assert.throws(
        () => setSafeStyleProperty(div, "width", "100px\\7d *{display:none}"),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_CSS_PROPERTY
      );

      // Hex-escaped javascript: URL inside url(...)
      assert.throws(
        () => setSafeStyleProperty(div, "backgroundImage", "url(\\6a avascript:alert(1))"),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_UNSAFE_URL
      );

      // Invalid property name injection
      assert.throws(
        () => setSafeStyleProperty(div, "color;background", "red"),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_CSS_PROPERTY
      );

      // Valid standard and custom properties succeed
      setSafeStyleObject(div, {
        backgroundColor: "rgb(10, 20, 30)",
        "--theme-accent": "#ff0055"
      });
      assert.equal(div.style.getPropertyValue("background-color"), "rgb(10, 20, 30)");
      assert.equal(div.style.getPropertyValue("--theme-accent"), "#ff0055");
    });
  });

  describe("5. Trusted HTML & SanitizerProvider Boundary (D-109 / HAA-03)", () => {
    it("enforces root SanitizerProvider, WeakSet verification, context checks, and forbids caller callbacks", () => {
      // Without SanitizerProvider configured, createTrustedHtml throws
      assert.throws(
        () => createTrustedHtml("<b>Hello</b>"),
        (err) =>
          err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML
      );

      // Configure root SanitizerProvider
      setSanitizerProvider({
        sanitizeHtml(raw) {
          return raw.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
        }
      });
      assert.ok(getSanitizerProvider() !== null);

      // Prohibit caller-supplied sanitizer callback (HAA-03)
      assert.throws(
        () => createTrustedHtml("<b>Hi</b>", (() => "<b>Hi</b>")),
        (err) =>
          err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML
      );

      const trusted = createTrustedHtml("<b>Safe</b><script>alert(1)</script>");
      assert.equal(isTrustedHtml(trusted), true);
      assert.equal(trusted.toString(), "<b>Safe</b>");

      const div = document.createElement("div");
      setTrustedHtml(div, trusted);
      assert.equal(div.innerHTML, "<b>Safe</b>");

      // Forged object not in WeakSet is rejected
      const forged = { __mixTrustedHtml: true, html: "<img src=x onerror=alert(1)>" };
      assert.equal(isTrustedHtml(forged), false);
      assert.throws(
        () => setTrustedHtml(div, forged),
        (err) =>
          err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML
      );

      // Raw string is rejected
      assert.throws(
        () => setTrustedHtml(div, "<b>Raw</b>"),
        (err) =>
          err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_FOREIGN_TRUSTED_HTML
      );

      // Forbidden context elements (<script>, <iframe>, <object>, <embed>, <svg>) are rejected
      for (const tag of ["script", "iframe", "object", "embed", "svg", "style"]) {
        const forbiddenEl = document.createElement(tag);
        assert.throws(
          () => setTrustedHtml(forbiddenEl, trusted),
          (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_SEC_HTML_CONTEXT
        );
      }
    });
  });
});
