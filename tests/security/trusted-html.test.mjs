import test from "node:test";
import assert from "node:assert/strict";

import {
  createTrustedHtml,
  isTrustedHtml
} from "../../packages/runtime/dist/security/index.js";

import {
  configureRuntime,
  MixError
} from "../../packages/runtime/dist/core/index.js";

test("Phase 3 — Trusted HTML & WeakSet Registry (§6.4 / T-HTML-01..04)", async (t) => {
  t.beforeEach(() => {
    configureRuntime({
      onWarning: () => {},
      onUncaughtError: () => {}
    });
  });

  await t.test("T-HTML-01: createTrustedHtml sanitizes dirty HTML and is verified by isTrustedHtml", () => {
    const mockSanitizer = (dirty) => dirty.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

    const trusted = createTrustedHtml("<div><p>Safe content</p></div>", mockSanitizer);

    assert.equal(typeof trusted, "object");
    assert.equal(Object.isFrozen(trusted), true, "Result must be frozen");
    assert.equal(trusted.html, "<div><p>Safe content</p></div>");

    // isTrustedHtml checks against private WeakSet
    assert.equal(isTrustedHtml(trusted), true);
  });

  await t.test("T-HTML-02: createTrustedHtml without a sanitizer function throws MIX_SEC_MISSING_SANITIZER", () => {
    assert.throws(
      () => createTrustedHtml("<div>content</div>", null),
      (err) => err instanceof MixError && err.code === "MIX_SEC_MISSING_SANITIZER"
    );

    assert.throws(
      () => createTrustedHtml("<div>content</div>", undefined),
      (err) => err instanceof MixError && err.code === "MIX_SEC_MISSING_SANITIZER"
    );
  });

  await t.test("T-HTML-03: In __DEV__, canary test detects suspicious sanitizer and emits MIX_SEC_SANITIZER_SUSPICIOUS warning", () => {
    let warning = null;
    configureRuntime({
      onWarning: (w) => {
        warning = w;
      }
    });

    // Incompetent sanitizer that fails to strip onerror
    const badSanitizer = (dirty) => dirty;

    createTrustedHtml("<div>hello</div>", badSanitizer);

    assert.ok(warning, "Canary check must emit warning on bad sanitizer");
    assert.equal(warning.code, "MIX_SEC_SANITIZER_SUSPICIOUS");
  });

  await t.test("T-HTML-04: In __DEV__, forged frozen object with html string outside registry throws MIX_SEC_FOREIGN_TRUSTED_HTML", () => {
    // An attacker tries to forge the shape of TrustedHtmlValue
    const forged = Object.freeze({ html: "<img src=x onerror=alert(1)>" });

    assert.throws(
      () => isTrustedHtml(forged),
      (err) => err instanceof MixError && err.code === "MIX_SEC_FOREIGN_TRUSTED_HTML"
    );

    // Non-frozen object or arbitrary objects simply return false
    assert.equal(isTrustedHtml({ html: "unfrozen" }), false);
    assert.equal(isTrustedHtml("plain string"), false);
    assert.equal(isTrustedHtml(null), false);
    assert.equal(isTrustedHtml(123), false);
  });
});
