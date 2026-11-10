import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import {
  setSanitizerProvider,
  createTrustedHtml,
  setTrustedHtml
} from "../../packages/runtime/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

function setupDom() {
  const win = new Window({ url: "http://localhost/" });
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Element = win.Element;
  globalThis.Node = win.Node;
  return win;
}

describe("Gate 28 (T-28.5): Production Sanitizer (@mix/sanitizer-dompurify) & XSS Vector Verification", () => {
  it("1. Neutralizes <img onerror>, <svg onload>, javascript:/vbscript:/data:text/html URLs, active tags, and unsafe inline styles", async () => {
    const win = setupDom();
    try {
      const { createDomPurifySanitizer } = await import(
        "../../packages/sanitizer-dompurify/dist/index.js"
      );

      const sanitizer = createDomPurifySanitizer();
      setSanitizerProvider(sanitizer);

      const vectors = [
        {
          name: "<img onerror>",
          input: '<p>Hello <img src="https://example.com/a.png" onerror="alert(1)" onload="evil()"></p>',
          mustContain: ["<p>", "<img", 'src="https://example.com/a.png"'],
          mustNotContain: ["onerror", "onload", "alert(1)", "evil()"]
        },
        {
          name: "<svg onload> and <script> inside svg",
          input: '<svg onload="alert(1)"><script>alert(2)</script><circle cx="5" cy="5" r="4"></circle></svg>',
          mustContain: [],
          mustNotContain: ["onload", "alert(1)", "<script", "alert(2)"]
        },
        {
          name: "javascript: and data:text/html URLs in <a href>",
          input: '<a href="javascript:alert(1)">Bad1</a><a href="  JaVaScRiPt:alert(2)">Bad2</a><a href="data:text/html,<script>alert(3)</script>">Bad3</a><a href="https://mix.dev/docs">Safe</a>',
          mustContain: ['href="https://mix.dev/docs"', "Safe"],
          mustNotContain: ["javascript:", "JaVaScRiPt:", "data:text/html", "alert(1)", "alert(2)", "alert(3)"]
        },
        {
          name: "Active tags (<iframe>, <object>, <embed>, <script>)",
          input: '<div><strong>Clean</strong><script>steal()</script><iframe src="https://evil.com"></iframe><object data="x"></object><embed src="y"></div>',
          mustContain: ["<div>", "<strong>Clean</strong>"],
          mustNotContain: ["<script", "steal()", "<iframe", "<object", "<embed"]
        },
        {
          name: "Unsafe CSS expression() / javascript: url in style attribute",
          input: '<span style="color: red; background-image: url(javascript:alert(1))">Styled</span>',
          mustContain: ["Styled"],
          mustNotContain: ["javascript:", "alert(1)"]
        }
      ];

      for (const vec of vectors) {
        const trusted = createTrustedHtml(vec.input);
        const host = globalThis.document.createElement("div");
        setTrustedHtml(host, trusted);
        const out = host.innerHTML;

        for (const req of vec.mustContain) {
          assert.ok(
            out.includes(req),
            `[${vec.name}] Expected sanitized output to contain '${req}', got: ${out}`
          );
        }
        for (const forbidden of vec.mustNotContain) {
          assert.strictEqual(
            out.toLowerCase().includes(forbidden.toLowerCase()),
            false,
            `[${vec.name}] Expected sanitized output NOT to contain '${forbidden}', got: ${out}`
          );
        }
      }
    } finally {
      setSanitizerProvider(null);
      win.close();
    }
  });

  it("2. Showcase MasterApp.mix and index.html use @mix/sanitizer-dompurify instead of a naive <script> regex", () => {
    const masterApp = fs.readFileSync(
      path.join(rootDir, "examples/showcase/src/MasterApp.mix"),
      "utf-8"
    );
    const indexHtml = fs.readFileSync(
      path.join(rootDir, "examples/showcase/index.html"),
      "utf-8"
    );

    assert.strictEqual(
      masterApp.includes("replace(/<script"),
      false,
      "MasterApp.mix must not use the naive regex sanitizer"
    );
    assert.ok(
      masterApp.includes("@mix/sanitizer-dompurify"),
      "MasterApp.mix must import and configure @mix/sanitizer-dompurify"
    );

    assert.strictEqual(
      indexHtml.includes("replace(/<script"),
      false,
      "examples/showcase/index.html must not use the naive regex sanitizer"
    );
    assert.ok(
      indexHtml.includes("sanitizer-dompurify"),
      "examples/showcase/index.html must use @mix/sanitizer-dompurify"
    );
  });
});

