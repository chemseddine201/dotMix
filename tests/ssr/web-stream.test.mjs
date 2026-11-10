import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { compileToSsr } from "../../packages/compiler-ssr/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import * as MixRuntime from "../../packages/runtime/dist/index.js";
import {
  createWebResponse,
  createEdgeHandler
} from "../../packages/stream/dist/index.js";

describe("WinterCG / Edge Web Standards Streaming SSR (@mix/stream)", () => {
  it("1. Streams SSR HTML via Web Standard Response & ReadableStream with per-request CSP nonce and hydrates in happy-dom", async () => {
    const source = `<script>
  const count = signal(42);
  function inc() {
    count.set(count() + 1);
  }
</script>
<style>
  .edge-card { color: #10b981; }
</style>
<div class="edge-card">
  <span class="count-val">{count()}</span>
  <button class="btn-inc" @click={inc}>Increment</button>
</div>
`;

    const ast = parse(source, { filename: "EdgeCard.mix" });
    const desc = analyze(ast, { filename: "EdgeCard.mix", source });
    const ssrOut = compileToSsr(desc, { includeHydrationMarkers: true });
    const csrOut = generate(desc, { filename: "EdgeCard.mix" });

    // Evaluate SSR renderToStream
    const ssrExec = ssrOut.code
      .replace(/import\s+[^\n]+\n/g, "")
      .replace(/export\s+(async\s+)?function/g, "$1function")
      .replace(/export\s+const\s+/g, "const ");
    const ssrFactory = new Function(
      "signal",
      "computed",
      `${ssrExec}\nreturn { renderToString, renderToStream };`
    );
    const { renderToStream } = ssrFactory(MixRuntime.signal, MixRuntime.computed);

    // Evaluate CSR component
    const csrExec = csrOut.code
      .replace(/import\s+\{([^}]+)\}\s+from\s+["']@mix\/runtime["'];?/g, (_, list) => {
        const bindings = list
          .split(",")
          .map((s) => s.trim().replace(/\s+as\s+/g, ": "))
          .join(", ");
        return `const { ${bindings} } = __MixRuntime;`;
      })
      .replace(/export\s+default\s+[A-Za-z0-9_$]+;?/g, "")
      .replace(/export\s+function\s+([A-Za-z0-9_$]+)/g, "function $1");
    const csrFactory = new Function("__MixRuntime", `${csrExec}\nreturn { EdgeCard };`);
    const { EdgeCard } = csrFactory(MixRuntime);

    const handler = createEdgeHandler({
      title: "Edge Worker SSR",
      styles: [{ id: "EdgeCard.mix", css: ssrOut.css }],
      state: { user: "edge-tester" },
      render: () => renderToStream({})
    });

    const request = new globalThis.Request("https://edge.mix.internal/dashboard");
    const response = await handler(request);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("content-type"), "text/html; charset=utf-8");

    const csp = response.headers.get("content-security-policy") ?? "";
    const nonceMatch = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp);
    assert.ok(nonceMatch, `Expected CSP header with nonce, got: ${csp}`);
    const nonce = nonceMatch[1];

    const html = await response.text();
    assert.ok(html.includes(`nonce="${nonce}"`), "Streamed HTML must contain CSP nonce");
    assert.ok(html.includes('class="edge-card"'), "Streamed HTML must contain component markup");
    assert.ok(html.includes('"edge-tester"'), "Streamed HTML must contain serialized safe state");

    // Hydrate in happy-dom
    const win = new Window({ url: "https://edge.mix.internal/dashboard" });
    win.document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>\s*/i, "");

    const appContainer = win.document.getElementById("app");
    assert.ok(appContainer, "#app container must exist");

    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Element = win.Element;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.Node = win.Node;
    globalThis.Comment = win.Comment;
    globalThis.Text = win.Text;

    try {
      const handle = MixRuntime.hydrate(
        () => EdgeCard({}),
        appContainer
      );
      assert.ok(handle, "Hydration should succeed cleanly");

      const countSpan = win.document.querySelector(".count-val");
      assert.strictEqual(countSpan?.textContent, "42");
    } finally {
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.Element;
      delete globalThis.HTMLElement;
      delete globalThis.Node;
      delete globalThis.Comment;
      delete globalThis.Text;
    }
  });

  it("2. Mid-stream error in Web Stream triggers error-recovery boundary without crashing Response", async () => {
    async function* throwingGenerator() {
      yield "<p>First chunk ok</p>";
      throw new Error("Mid-stream edge worker crash!");
    }

    let recordedError = null;
    const response = createWebResponse(new globalThis.Request("https://edge.mix.internal/"), {
      title: "Resilient Edge App",
      render: () => throwingGenerator(),
      onError: (err) => {
        recordedError = err;
      }
    });

    assert.strictEqual(response.status, 200);
    const html = await response.text();

    assert.ok(recordedError !== null, "onError callback must be fired");
    assert.ok(html.includes("First chunk ok"), "Should contain first chunk before crash");
    assert.ok(
      html.includes('data-mix-ssr-error="true"'),
      "Should contain error recovery boundary fallback HTML"
    );
    assert.ok(
      html.includes("Mid-stream edge worker crash!"),
      "Fallback should display error message"
    );
    assert.ok(html.includes("</html>"), "Stream should close with valid tail HTML");
  });
});
