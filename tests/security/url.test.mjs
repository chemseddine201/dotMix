import test from "node:test";
import assert from "node:assert/strict";

import {
  isAllowedUrl,
  assertAllowedUrl
} from "../../packages/runtime/dist/security/index.js";

import {
  configureRuntime,
  MixError
} from "../../packages/runtime/dist/core/index.js";

test("Phase 3 — URL Policy (§6.1 / T-URL-01..06)", async (t) => {
  t.beforeEach(() => {
    configureRuntime({
      onSecurityViolation: () => {},
      onWarning: () => {}
    });
  });

  await t.test("T-URL-01: Safe navigation schemes allowed in navigation context", () => {
    assert.equal(isAllowedUrl("https://example.com/page", "navigation"), true);
    assert.equal(isAllowedUrl("http://example.com/page", "navigation"), true);
    assert.equal(isAllowedUrl("mailto:support@mix.dev", "navigation"), true);
    assert.equal(isAllowedUrl("tel:+1234567890", "navigation"), true);
    assert.equal(isAllowedUrl("sms:+1234567890", "navigation"), true);

    // mailto / tel are NOT allowed in media or resource
    assert.equal(isAllowedUrl("mailto:support@mix.dev", "media"), false);
    assert.equal(isAllowedUrl("tel:+1234567890", "resource"), false);
  });

  await t.test("T-URL-02: Relative paths allowed across all contexts", () => {
    const relativeUrls = [
      "/assets/hero.jpg",
      "./avatar.png",
      "../images/logo.webp",
      "banner.avif",
      "?query=param",
      "#heading-1",
      "path/to/resource"
    ];

    for (const url of relativeUrls) {
      assert.equal(isAllowedUrl(url, "navigation"), true, `navigation: ${url}`);
      assert.equal(isAllowedUrl(url, "media"), true, `media: ${url}`);
      assert.equal(isAllowedUrl(url, "resource"), true, `resource: ${url}`);
    }
  });

  await t.test("T-URL-03: javascript: and vbscript: strictly blocked in ALL contexts", () => {
    const dangerous = [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(document.cookie)",
      "javascript:/*--></script>",
      "vbscript:msgbox(1)",
      "VBSCRIPT:runEvil()"
    ];

    for (const url of dangerous) {
      assert.equal(isAllowedUrl(url, "navigation"), false, `navigation blocked: ${url}`);
      assert.equal(isAllowedUrl(url, "media"), false, `media blocked: ${url}`);
      assert.equal(isAllowedUrl(url, "resource"), false, `resource blocked: ${url}`);
    }
  });

  await t.test("T-URL-04: Obfuscated schemes with tabs/newlines normalized by WHATWG parser and blocked", () => {
    assert.equal(isAllowedUrl("java\tscript:alert(1)", "navigation"), false);
    assert.equal(isAllowedUrl("java\nscript:alert(1)", "navigation"), false);
    assert.equal(isAllowedUrl("java\rscript:alert(1)", "navigation"), false);
    assert.equal(isAllowedUrl(" vb\tscript:alert(1) ", "navigation"), false);
  });

  await t.test("T-URL-05: data:image/svg+xml strictly blocked in ALL contexts including media", () => {
    const svgData = "data:image/svg+xml;utf8,<svg onload='alert(1)'></svg>";
    assert.equal(isAllowedUrl(svgData, "media"), false, "data:image/svg+xml must be blocked in media");
    assert.equal(isAllowedUrl(svgData, "navigation"), false, "data:image/svg+xml must be blocked in navigation");
    assert.equal(isAllowedUrl(svgData, "resource"), false, "data:image/svg+xml must be blocked in resource");
  });

  await t.test("T-URL-06: Safe image data: URLs allowed in media, blocked in navigation & resource", () => {
    const pngData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const jpegData = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const webpData = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

    assert.equal(isAllowedUrl(pngData, "media"), true);
    assert.equal(isAllowedUrl(jpegData, "media"), true);
    assert.equal(isAllowedUrl(webpData, "media"), true);

    // Blocked in navigation to prevent data-URI phishing/XSS
    assert.equal(isAllowedUrl(pngData, "navigation"), false);
    assert.equal(isAllowedUrl(pngData, "resource"), false);
  });

  await t.test("assertAllowedUrl: throws MIX_SEC_UNSAFE_URL in __DEV__, calls onSecurityViolation in prod", () => {
    // 1. Safe URL returns true
    assert.equal(assertAllowedUrl("https://mix.dev", "navigation", "href"), true);

    // 2. Unsafe URL in __DEV__ throws MixError
    assert.throws(
      () => assertAllowedUrl("javascript:exploit()", "navigation", "href"),
      (err) => err instanceof MixError && err.code === "MIX_SEC_UNSAFE_URL"
    );

    // 3. In production mode (simulate __DEV__ = false)
    let violation = null;
    configureRuntime({
      onSecurityViolation: (v) => {
        violation = v;
      }
    });

    const origDev = globalThis.__DEV__;
    try {
      globalThis.__DEV__ = false;
      const allowed = assertAllowedUrl("javascript:exploit()", "navigation", "href");
      assert.equal(allowed, false, "Should return false in production");
      assert.ok(violation, "Should emit security violation event in production");
      assert.equal(violation.code, "MIX_SEC_UNSAFE_URL");
      assert.equal(violation.attribute, "href");
      assert.equal(violation.value, "javascript:exploit()");
    } finally {
      globalThis.__DEV__ = origDev;
    }
  });
});
