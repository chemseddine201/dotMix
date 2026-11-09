/**
 * Gate 18 (D-121): Resilient Resumable Island Streaming & Progressive Hydration Suite
 *
 * Verifies:
 * 1. `formatIslandMarkup`: encodes signed resume tokens and inline metadata manifests
 * 2. `renderToResilientStream`: streams HTML islands progressively with sub-island timeout containment
 * 3. Dropped island simulation: microservice timeout drops only the affected island with a recovery token
 * 4. Client `resilientHydrate`: single O(N) pass attaches surgical listeners without VDOM replay
 * 5. Autonomous recovery: client detects dropped chunks and fetches the recovered chunk in the background
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  formatIslandMarkup,
  renderToResilientStream,
  parseIslandManifest,
  resilientHydrate
} from "../../packages/stream/dist/index.js";

describe("Gate 18: Resilient Streaming & Progressive Hydration (@mix/stream)", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
  });

  test("1. formatIslandMarkup embeds valid data-manifest and signed resume token", () => {
    const markup = formatIslandMarkup(
      "island-metrics",
      "MetricCard",
      "<strong>42 ops/s</strong>",
      { value: 42 },
      "ready",
      "tok_abc123"
    );

    assert.ok(markup.includes('id="island-metrics"'));
    assert.ok(markup.includes('data-component="MetricCard"'));
    assert.ok(markup.includes('data-status="ready"'));
    assert.ok(markup.includes("tok_abc123"));

    const div = document.createElement("div");
    div.innerHTML = markup;
    const islandEl = div.querySelector("mix-island");
    assert.ok(islandEl);

    const manifest = parseIslandManifest(islandEl);
    assert.ok(manifest);
    assert.strictEqual(manifest.id, "island-metrics");
    assert.strictEqual(manifest.componentName, "MetricCard");
    assert.strictEqual(manifest.resumeToken, "tok_abc123");
    assert.strictEqual(manifest.state.value, 42);
  });

  test("2. renderToResilientStream streams islands and contains sub-island timeouts", async () => {
    const islands = [
      {
        id: "header",
        componentName: "Header",
        render: () => "<h1>Dashboard</h1>",
        state: { title: "Dashboard" }
      },
      {
        id: "slow-analytics",
        componentName: "Analytics",
        render: () => new Promise((resolve) => globalThis.setTimeout(() => resolve("<div>Chart Data</div>"), 200)),
        state: { range: "24h" }
      },
      {
        id: "footer",
        componentName: "Footer",
        render: () => "<footer>Copyright 2026</footer>",
        state: {}
      }
    ];

    const dropped = [];
    const chunks = [];

    // Set islandTimeoutMs = 50ms so slow-analytics times out while header and footer stream uninterrupted
    for await (const chunk of renderToResilientStream(islands, {
      islandTimeoutMs: 50,
      onChunkDropped: (id) => dropped.push(id)
    })) {
      chunks.push(chunk);
    }

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(dropped.length, 1);
    assert.strictEqual(dropped[0], "slow-analytics");

    // Header succeeded
    assert.ok(chunks[0].includes('data-status="ready"'));
    assert.ok(chunks[0].includes("<h1>Dashboard</h1>"));

    // Slow analytics was contained with status="failed" and fallback placeholder
    assert.ok(chunks[1].includes('data-status="failed"'));
    assert.ok(chunks[1].includes("Recovering Analytics..."));

    // Sibling footer streamed successfully without being aborted by slow-analytics!
    assert.ok(chunks[2].includes('data-status="ready"'));
    assert.ok(chunks[2].includes("<footer>Copyright 2026</footer>"));
  });

  test("3. Client resilientHydrate attaches surgical listeners and recovers dropped chunks", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    container.innerHTML = `
      ${formatIslandMarkup("isl-1", "Counter", "<button>Count: 1</button>", { count: 1 }, "ready")}
      ${formatIslandMarkup("isl-2", "Status", '<div class="mix-island-placeholder">Loading...</div>', { status: "pending" }, "failed", "tok_xyz")}
    `;

    // Mock background chunk recovery fetch
    globalThis.fetch = async (url) => {
      assert.ok(url.includes("island=isl-2"));
      return {
        ok: true,
        text: async () => '<span class="status-badge">Recovered Live Telemetry</span>'
      };
    };

    let counterClicks = 0;
    const registry = {
      Counter: (props) => {
        const btn = document.createElement("button");
        btn.textContent = `Count: ${props.count}`;
        btn.addEventListener("click", () => {
          counterClicks++;
        });
        return btn;
      },
      Status: () => {
        const span = document.createElement("span");
        span.className = "status-badge";
        span.textContent = "Recovered Live Telemetry";
        return span;
      }
    };

    const res = await resilientHydrate(container, registry);
    assert.strictEqual(res.islandCount, 2);
    assert.strictEqual(res.recoveredCount, 1);

    // Island 2 was autonomously recovered from failed placeholder
    const isl2 = container.querySelector("#isl-2");
    assert.strictEqual(isl2.getAttribute("data-status"), "ready");
    assert.ok(isl2.querySelector(".status-badge"));

    // Island 1 click listener was surgically attached
    const btn = container.querySelector("#isl-1 button");
    btn.click();
    assert.strictEqual(counterClicks, 1);

    res.unmountAll();
  });
});
