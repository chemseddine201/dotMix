/**
 * Gate 13 Test Suite — Server-Side Rendering (@mix/compiler-ssr) & Surgical Hydration (hydrate() — D-116)
 *
 * Verifies:
 * 1. Ahead-of-time SSR code generation (renderToString, renderToStream) with hydration markers
 * 2. Scoped CSS data-mix attribute injection in SSR HTML
 * 3. XSS prevention in SSR attributes, text, and serializeState()
 * 4. Surgical client hydration: event listeners and reactive effects bind to existing DOM nodes
 * 5. Preservation of exact DOM node references without recreation or DOM thrashing
 * 6. Hydration mismatch detection and recovery with MIX_SSR_HYDRATION_MISMATCH diagnostic
 */

/* global document */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { compileCss } from "../../packages/compiler-css/dist/index.js";
import { compileToSsr, serializeState } from "../../packages/compiler-ssr/dist/index.js";
import {
  signal,
  createEffect,
  createElement,
  createTextNode,
  insertNode,
  setText,
  addEventListener,
  hydrate,
} from "../../packages/runtime/dist/index.js";

function evalSsr(code) {
  const transformed = code
    .replace(/export function (\w+)/g, "exports.$1 = function $1")
    .replace(/export const (\w+)\s*=/g, "exports.$1 =");
  const fn = new Function("exports", transformed);
  const exports = {};
  fn(exports);
  return exports;
}

describe("Gate 13: Ahead-of-Time SSR & Surgical Hydration (D-116)", () => {
  test("1. compileToSsr generates renderToString and renderToStream with hydration markers", () => {
    const source = `
<script>
  let name = "World";
  let count = 42;
</script>

<div class="greeting">
  <h1>Hello, {name}!</h1>
  <p>Count is {count}</p>
</div>
`;

    const parsed = parse(source, { filename: "Greeting.mix" });
    const semantic = analyze(parsed, { filename: "Greeting.mix", source });
    const ssrResult = compileToSsr(semantic);

    assert.ok(ssrResult.code.includes("export function renderToString"));
    assert.ok(ssrResult.code.includes("export function renderToStream"));
    assert.ok(ssrResult.code.includes("<!--mix:t:0-->"));
    assert.ok(ssrResult.code.includes("<!--/mix:t:0-->"));

    const mod = evalSsr(ssrResult.code);
    const html = mod.renderToString({ name: "World", count: 42 });
    assert.ok(html.includes('<div class="greeting">'));
    assert.ok(html.includes("Hello, <!--mix:t:0-->World<!--/mix:t:0-->!"));
  });

  test("2. SSR Scoped CSS injection and HTML entity / XSS sanitization", () => {
    const source = `
<script>
  let maliciousText = "<script>alert('xss')<\\/script>";
  let evilUrl = "javascript:alert(1)";
</script>

<style>
  .danger { color: red; }
</style>

<div class="danger">
  <span class="user-content">{maliciousText}</span>
  <a href={evilUrl}>Click Me</a>
</div>
`;

    const parsed = parse(source, { filename: "Danger.mix" });
    const semantic = analyze(parsed, { filename: "Danger.mix", source });
    const cssResult = compileCss(parsed.style.content, { filename: "Danger.mix" });
    const ssrResult = compileToSsr(semantic, cssResult);

    assert.ok(ssrResult.css.includes(cssResult.scopeAttribute));
    assert.ok(ssrResult.code.includes(cssResult.scopeAttribute), "SSR code should include scoped CSS attribute");

    // Execute generated SSR renderToString
    const exports = evalSsr(ssrResult.code);
    const html = exports.renderToString();

    // Verify XSS prevention
    assert.ok(!html.includes("<script>alert"), "Malicious script tags must be escaped in SSR text");
    assert.ok(html.includes("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"));
    assert.ok(!html.includes('href="javascript:'), "Unsafe javascript: protocol must be sanitized in SSR attributes");
    assert.ok(html.includes('href="about:blank"'));
  });

  test("3. serializeState securely serializes data preventing script tag breakout", () => {
    const state = {
      user: "Admin",
      bio: "</script><script>alert('pwned')</script>",
      unicode: "\u2028\u2029",
    };

    const serialized = serializeState(state);
    assert.ok(!serialized.includes("</script>"), "serializeState must escape forward slashes / angle brackets");
    assert.ok(serialized.includes("\\u003c/script\\u003e"));
    assert.ok(!serialized.includes("\u2028"));
  });

  test("4. Surgical Hydration preserves exact DOM node references and activates event listeners", () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    // Simulate server-rendered HTML inside container
    const container = document.createElement("div");
    container.innerHTML = `<div class="counter"><button id="btn">Clicks: <!--mix:t:0-->0<!--/mix:t:0--></button></div>`;
    document.body.appendChild(container);

    const originalButton = container.querySelector("#btn");
    const originalTextNode = originalButton.childNodes[2]; // The '0' text node between comments
    assert.ok(originalButton, "Original server-rendered button exists");
    assert.strictEqual(originalTextNode.textContent, "0");

    // Component function compiling to runtime primitives
    const count = signal(0);
    let clicked = false;

    const Component = () => {
      const elDiv = createElement("div");
      const btn = createElement("button");
      btn.id = "btn";

      const prefixText = createTextNode("Clicks: ");
      const countText = createTextNode(count());

      insertNode(btn, prefixText);
      insertNode(btn, countText);

      addEventListener(btn, "click", () => {
        clicked = true;
        count.set((c) => c + 1);
      });

      createEffect(() => {
        setText(countText, count());
      });

      insertNode(elDiv, btn);
      insertNode(container, elDiv);
    };

    // Hydrate container!
    const unmount = hydrate(Component, container);

    const hydratedButton = container.querySelector("#btn");
    assert.strictEqual(hydratedButton, originalButton, "Hydration MUST preserve exact original button instance");
    assert.strictEqual(hydratedButton.childNodes[2], originalTextNode, "Hydration MUST preserve exact original text node");

    // Click button to verify event listener and reactive effect
    hydratedButton.dispatchEvent(new window.MouseEvent("click", { button: 0, bubbles: true }));

    assert.strictEqual(clicked, true, "Event listener must be active after hydration");
    assert.strictEqual(count(), 1, "Signal must increment");
    assert.strictEqual(originalTextNode.textContent, "1", "Existing text node must reactively update to '1'");

    unmount();
  });

  test("5. Hydration mismatch detection and diagnostic reporting", () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    // Server rendered <span>, but client component expects <div>
    const container = document.createElement("div");
    container.innerHTML = `<span>Server rendered span</span>`;
    document.body.appendChild(container);

    let recordedMismatch = null;

    const ComponentWithDiv = () => {
      const elDiv = createElement("div");
      const text = createTextNode("Client expected div");
      insertNode(elDiv, text);
      insertNode(container, elDiv);
    };

    hydrate(ComponentWithDiv, container, {
      onMismatch: (mismatch) => {
        recordedMismatch = mismatch;
      },
    });

    assert.ok(recordedMismatch, "Mismatch callback must be invoked on divergent DOM structure");
    assert.strictEqual(recordedMismatch.expected, "div");
    assert.strictEqual(recordedMismatch.actual, "span");
  });
});
