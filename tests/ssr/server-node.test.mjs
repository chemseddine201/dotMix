import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import { compileToSsr } from "../../packages/compiler-ssr/dist/index.js";
import * as MixRuntime from "../../packages/runtime/dist/index.js";

describe("Gate 29 (T-29.4): @mix/server-node Streaming SSR, Error-Recovery Boundaries & CSP Nonce Support", () => {
  it("1. Streams SSR HTML over HTTP with per-request CSP nonce header, hydrates in happy-dom with 0 mismatches, and honors nonce in injectStylesheet", async () => {
    const serverNode = await import("../../packages/server-node/dist/index.js");
    assert.strictEqual(typeof serverNode.createSsrServer, "function");

    const source = `<script>
  const count = signal(5);
  function inc() {
    count.set(count() + 1);
  }
</script>
<style>
  .ssr-card { color: #2563eb; }
</style>
<div class="ssr-card">
  <span class="count-val">{count()}</span>
  <button class="btn-inc" @click={inc}>Increment</button>
</div>
`;

    const ast = parse(source, { filename: "CounterCard.mix" });
    const desc = analyze(ast, { filename: "CounterCard.mix", source });
    const ssrOut = compileToSsr(desc, { includeHydrationMarkers: true });
    const csrOut = generate(desc, { filename: "CounterCard.mix" });

    // Evaluate SSR renderToString & renderToStream
    const ssrExec = ssrOut.code
      .replace(/import\s+[^\n]+\n/g, "")
      .replace(/export\s+(async\s+)?function/g, "$1function")
      .replace(/export\s+const\s+/g, "const ");
    const ssrFactory = new Function(
      "signal",
      "computed",
      `${ssrExec}\nreturn { renderToString, renderToStream };`
    );
    const { renderToString, renderToStream } = ssrFactory(MixRuntime.signal, MixRuntime.computed);

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
    const csrFactory = new Function("__MixRuntime", `${csrExec}\nreturn { CounterCard };`);
    const { CounterCard } = csrFactory(MixRuntime);

    const ssrServer = await serverNode.createSsrServer({
      port: 0,
      styles: [{ id: "CounterCard.mix", css: ssrOut.css }],
      render: () => renderToStream({})
    });

    const win = new Window({ url: ssrServer.url });
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Element = win.Element;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.Node = win.Node;
    globalThis.Comment = win.Comment;
    globalThis.Text = win.Text;

    try {
      const res = await globalThis.fetch(`${ssrServer.url}/`);
      assert.strictEqual(res.status, 200);

      // Verify Content-Security-Policy header contains a cryptographic nonce
      const cspHeader = res.headers.get("content-security-policy") ?? "";
      const nonceMatch = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(cspHeader);
      assert.ok(nonceMatch, `Expected Content-Security-Policy header with 'nonce-...', got: ${cspHeader}`);
      const nonce = nonceMatch[1];

      const html = await res.text();
      assert.ok(
        html.includes(`nonce="${nonce}"`),
        `Streamed HTML <style>/<meta> must carry nonce="${nonce}", got:\n${html}`
      );
      assert.ok(
        html.includes('<span class="count-val"'),
        `Streamed HTML must contain rendered component markup, got:\n${html}`
      );

      // Load streamed HTML into happy-dom and hydrate CounterCard without mismatch
      win.document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>\s*/i, "");
      const appContainer = win.document.getElementById("app");
      assert.ok(appContainer, "#app container must exist in streamed HTML");

      const preHydrateSpan = appContainer.querySelector(".count-val");
      assert.strictEqual(preHydrateSpan.textContent, "5");

      const handle = MixRuntime.hydrate(CounterCard, appContainer);

      // Exact DOM node identity preserved (zero mismatch)
      const postHydrateSpan = appContainer.querySelector(".count-val");
      assert.strictEqual(postHydrateSpan, preHydrateSpan, "Hydration must preserve DOM node identity");

      // Click hydrated button -> reactive signal updates DOM to 6
      appContainer.querySelector(".btn-inc").click();
      assert.strictEqual(postHydrateSpan.textContent, "6");

      // Verify injectStylesheet honors the active CSP nonce
      const dynStyle = MixRuntime.injectStylesheet("dynamic-chunk", ".dyn { opacity: 1; }");
      assert.ok(dynStyle, "injectStylesheet must create <style> element");
      assert.strictEqual(
        dynStyle.getAttribute("nonce"),
        nonce,
        "injectStylesheet must automatically attach the CSP nonce from the SSR document"
      );

      handle.unmount();
    } finally {
      MixRuntime.setCspNonce(null);
      win.close();
      await ssrServer.close();
      assert.ok(renderToString);
    }
  });

  it("2. Error-recovery boundary catches throwing async stream chunks and renders fallback HTML without crashing HTTP stream", async () => {
    const serverNode = await import("../../packages/server-node/dist/index.js");

    async function* failingStream() {
      yield '<div class="shell-header">Header OK</div>';
      throw new Error("Database connection dropped mid-stream");
    }

    const ssrServer = await serverNode.createSsrServer({
      port: 0,
      render: () => failingStream(),
      errorFallback: (err) =>
        `<div class="ssr-error-boundary" data-error="true">Recovered: ${err instanceof Error ? err.message : String(err)}</div>`
    });

    try {
      const res = await globalThis.fetch(`${ssrServer.url}/broken`);
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('<div class="shell-header">Header OK</div>'));
      assert.ok(
        html.includes('class="ssr-error-boundary"') && html.includes("Database connection dropped mid-stream"),
        `Expected error-recovery boundary markup in streamed HTML, got:\n${html}`
      );
      assert.ok(html.includes("</html>"), "Stream must still close </html> cleanly after boundary recovery");
    } finally {
      await ssrServer.close();
    }
  });
});
