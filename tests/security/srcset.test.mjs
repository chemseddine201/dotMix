import test from "node:test";
import assert from "node:assert/strict";

import {
  parseSrcset,
  validateSrcset,
  serializeSrcset
} from "../../packages/runtime/dist/security/index.js";

test("Phase 3 — WHATWG srcset Parsing & Validation (§6.2 / T-SRCSET-01..06)", async (t) => {
  await t.test("T-SRCSET-01: Standard candidates parsing with density & width descriptors", () => {
    // Density
    const dRes = parseSrcset("image-1x.jpg 1x, image-2x.jpg 2x");
    assert.equal(dRes.length, 2);
    assert.deepEqual(dRes[0], { url: "image-1x.jpg", density: 1 });
    assert.deepEqual(dRes[1], { url: "image-2x.jpg", density: 2 });

    // Width
    const wRes = parseSrcset("banner-400w.jpg 400w, banner-800w.jpg 800w");
    assert.equal(wRes.length, 2);
    assert.deepEqual(wRes[0], { url: "banner-400w.jpg", width: 400 });
    assert.deepEqual(wRes[1], { url: "banner-800w.jpg", width: 800 });
  });

  await t.test("T-SRCSET-02: URLs with commas inside query parameters", () => {
    const input = "https://example.com/cdn?format=jpg,webp&q=80 1x, fallback.jpg 2x";
    const candidates = parseSrcset(input);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].url, "https://example.com/cdn?format=jpg,webp&q=80");
    assert.equal(candidates[0].density, 1);
    assert.equal(candidates[1].url, "fallback.jpg");
    assert.equal(candidates[1].density, 2);
  });

  await t.test("T-SRCSET-03: Safe base64 data URLs containing commas", () => {
    const input = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg== 1x, fallback.jpg 2x";
    const candidates = parseSrcset(input);
    assert.equal(candidates.length, 2);
    assert.ok(candidates[0].url.startsWith("data:image/png;base64,"));
    assert.equal(candidates[0].density, 1);
    assert.equal(candidates[1].url, "fallback.jpg");
  });

  await t.test("T-SRCSET-04: Irregular whitespace, newlines, and tabs between candidates", () => {
    const input = "\n  image.jpg\t 1x\n , \timage-hd.jpg 2x  ";
    const candidates = parseSrcset(input);
    assert.equal(candidates.length, 2);
    assert.deepEqual(candidates[0], { url: "image.jpg", density: 1 });
    assert.deepEqual(candidates[1], { url: "image-hd.jpg", density: 2 });
  });

  await t.test("T-SRCSET-05: Error recovery from malformed descriptors skips bad candidate", () => {
    const input = "img1.jpg invalid-descriptor, img2.jpg 2x";
    const candidates = parseSrcset(input);
    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0], { url: "img2.jpg", density: 2 });
  });

  await t.test("T-SRCSET-06: Strict total rejection: validateSrcset rejects entire attribute if any URL is unsafe (R-SRCSET-02)", () => {
    // Valid srcset
    assert.equal(validateSrcset("hero-1x.jpg 1x, hero-2x.jpg 2x"), true);
    assert.equal(validateSrcset("/cdn/img.webp 400w, /cdn/img2.webp 800w"), true);

    // Unsafe URL: javascript: scheme
    assert.equal(
      validateSrcset("javascript:alert(1) 1x, hero-2x.jpg 2x"),
      false,
      "Entire srcset must be rejected if one candidate contains javascript:"
    );

    // Unsafe URL: data:image/svg+xml
    assert.equal(
      validateSrcset("data:image/svg+xml;utf8,<svg onload='alert(1)'></svg> 1x, hero-2x.jpg 2x"),
      false,
      "Entire srcset must be rejected if one candidate contains data:image/svg+xml"
    );

    // Empty candidates from totally malformed string
    assert.equal(validateSrcset("invalid-item invalid-descriptor"), false);
  });

  await t.test("serializeSrcset properly serializes candidates", () => {
    const candidates = [
      { url: "img-400w.jpg", width: 400 },
      { url: "img-800w.jpg", width: 800 }
    ];
    assert.equal(serializeSrcset(candidates), "img-400w.jpg 400w, img-800w.jpg 800w");
  });
});

