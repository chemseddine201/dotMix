import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { buildShowcase } from "../../examples/showcase/build.mjs";
import {
  mount,
  setSanitizerProvider,
  renderKeyedList
} from "../../packages/runtime/dist/index.js";

describe("Gate 9: Hardening, Performance Baseline, and Real Showcase Compilation & Execution", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
    setSanitizerProvider({
      sanitizeHtml(raw) {
        return raw.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
      }
    });
  });

  it("compiles TypeSafeCard.tix and App.mix through the real compiler and executes all interactive features", async () => {
    const artifacts = buildShowcase();
    assert.equal(artifacts.has("TypeSafeCard.tix"), true);
    assert.equal(artifacts.has("App.mix"), true);

    const appArtifact = artifacts.get("App.mix");
    // Verify R-RS-03 import extension rewrite (.tix -> .tix.js)
    assert.ok(appArtifact.codegen.js.includes("./TypeSafeCard.tix.js"));

    const appModuleUrl = pathToFileURL(appArtifact.jsPath).href;
    const AppMod = await import(appModuleUrl);
    const App = AppMod.default;

    const container = document.createElement("div");
    document.body.appendChild(container);

    const mounted = mount(App, container);

    // 1. Verify TrustedHTML banner sanitized <script> tag while preserving <em>
    const banner = container.querySelector(".trusted-banner");
    assert.equal(banner.innerHTML, "<em>Active Count: 1</em>");

    // 2. Verify initial Diamond Reactivity readout (count=1 -> left=2, right=11, sum=13)
    const readout = container.querySelector(".diamond-readout");
    assert.equal(readout.textContent, "Count: 1 | Left: 2 | Right: 11 | Sum: 13");

    // 3. Verify WHATWG srcset with data: URL comma and query string comma
    const heroImg = container.querySelector("img.responsive-hero");
    assert.ok(heroImg !== null);
    assert.ok(heroImg.getAttribute("srcset").includes("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA 1x"));
    assert.ok(heroImg.getAttribute("srcset").includes("https://cdn.example.com/img?fmt=webp,avif 2x"));

    // 4. Verify child .tix component (<TypeSafeCard />) mounted and receives reactive priority prop
    const tixCard = container.querySelector("article.tix-card");
    assert.ok(tixCard !== null);
    assert.equal(tixCard.getAttribute("data-priority"), "1");
    assert.equal(tixCard.querySelector(".badge-pill").textContent, "Verified .tix Child");
    assert.equal(tixCard.querySelector(".priority-val").textContent, "P1");

    // 5. Click Increment and verify glitch-free diamond update, TrustedHTML update, and child .tix prop update
    container.querySelector("button.inc-btn").click();
    assert.equal(readout.textContent, "Count: 2 | Left: 4 | Right: 12 | Sum: 16");
    assert.equal(banner.innerHTML, "<em>Active Count: 2</em>");
    assert.equal(tixCard.getAttribute("data-priority"), "2");
    assert.equal(tixCard.querySelector(".priority-val").textContent, "P2");

    // 6. Verify keyed {#each} list rotation preserves DOM node identity via LIS reconciliation
    const initialRows = [...container.querySelectorAll("li.task-row")];
    assert.equal(initialRows.length, 3);
    container.querySelector("button.rotate-btn").click();
    const rotatedRows = [...container.querySelectorAll("li.task-row")];
    assert.equal(rotatedRows[0], initialRows[1]);
    assert.equal(rotatedRows[1], initialRows[2]);
    assert.equal(rotatedRows[2], initialRows[0]);
    assert.deepEqual(
      rotatedRows.map((r) => r.textContent),
      [
        "0: Semantic & Tix (Gate 3)",
        "1: Reactive Kernel (Gate 4)",
        "2: Lexer & Parser (Gate 2)"
      ]
    );

    // 7. Toggle {#if} conditional branch
    container.querySelector("button.toggle-btn").click();
    assert.equal(container.querySelector(".details-panel"), null);
    assert.equal(container.querySelector(".details-collapsed").textContent, "Details hidden");

    mounted.unmount();
  });

  it("meets performance baseline for 500-item LIS keyed reconciliation", () => {
    const listParent = document.createElement("ul");
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: `item-${i}`,
      label: `Row ${i}`
    }));

    const startMount = globalThis.performance.now();
    renderKeyedList(
      listParent,
      items,
      (x) => x.id,
      (x) => {
        const li = document.createElement("li");
        li.textContent = x.label;
        return li;
      }
    );
    const shuffled = [...items.slice(250), ...items.slice(0, 250)];
    renderKeyedList(
      listParent,
      shuffled,
      (x) => x.id,
      (x) => {
        const li = document.createElement("li");
        li.textContent = x.label;
        return li;
      }
    );
    const elapsedMs = globalThis.performance.now() - startMount;
    assert.equal(listParent.querySelectorAll("li").length, 500);
    assert.ok(elapsedMs < 500, `Expected 500-item mount+shuffle < 500ms, got ${elapsedMs}ms`);
  });
});
