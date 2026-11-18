/* global document, window */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

describe("mix:hmr-applied event contract", () => {
  it("fires mix:hmr-applied once on window with inserted nodes already in the DOM", async () => {
    const browserWindow = new Window();
    globalThis.window = browserWindow;
    globalThis.document = browserWindow.document;
    globalThis.CustomEvent = browserWindow.CustomEvent;

    const { mountComponent, createRoot, hmrSwapComponent } =
      await import("../../packages/runtime/dist/index.js");

    const moduleId = "/src/components/Banner.tix";

    function createBanner(text) {
      function Banner() {
        const root = document.createElement("div");
        root.className = "banner-root";
        const title = document.createElement("h1");
        title.textContent = text;
        root.appendChild(title);
        return root;
      }
      Banner.__mix_hmr_id = moduleId;
      return Banner;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);

    createRoot(() => {
      mountComponent(createBanner("Initial Title"), {}, container);
    });

    assert.equal(container.textContent, "Initial Title");

    let eventFiredCount = 0;
    let receivedDetail = null;
    let domSawUpdateDuringEvent = false;

    window.addEventListener("mix:hmr-applied", (event) => {
      eventFiredCount++;
      receivedDetail = event.detail;
      // Assert DOM is already updated when event fires
      domSawUpdateDuringEvent =
        container.textContent === "Updated Title" &&
        container.contains(event.detail.nodes[0]);
    });

    const swapResult = hmrSwapComponent(moduleId, createBanner("Updated Title"));
    assert.equal(swapResult, true);
    assert.equal(eventFiredCount, 1, "mix:hmr-applied must fire exactly once");
    assert.ok(receivedDetail, "event detail must be provided");
    assert.equal(receivedDetail.moduleId, moduleId);
    assert.equal(receivedDetail.nodes.length, 1);
    assert.equal(domSawUpdateDuringEvent, true, "DOM must be updated before event fires");
  });

  it("does not fire mix:hmr-applied when component setup throws", async () => {
    const browserWindow = new Window();
    globalThis.window = browserWindow;
    globalThis.document = browserWindow.document;
    globalThis.CustomEvent = browserWindow.CustomEvent;

    const { mountComponent, createRoot, hmrSwapComponent } =
      await import("../../packages/runtime/dist/index.js");

    const moduleId = "/src/components/Crashable.tix";

    function GoodComponent() {
      const el = document.createElement("div");
      el.textContent = "Good";
      return el;
    }
    GoodComponent.__mix_hmr_id = moduleId;

    function CrashingComponent() {
      throw new Error("Deliberate setup crash");
    }
    CrashingComponent.__mix_hmr_id = moduleId;

    const container = document.createElement("div");
    document.body.appendChild(container);

    createRoot(() => {
      mountComponent(GoodComponent, {}, container);
    });

    let eventFired = false;
    window.addEventListener("mix:hmr-applied", () => {
      eventFired = true;
    });

    const swapResult = hmrSwapComponent(moduleId, CrashingComponent);
    assert.equal(swapResult, false, "Swap must fail if component throws");
    assert.equal(eventFired, false, "mix:hmr-applied must not fire when swap fails");
    assert.equal(container.textContent, "Good", "Prior DOM must be preserved");
  });

  it("does not fire mix:hmr-applied when module has no mounted instances", async () => {
    const browserWindow = new Window();
    globalThis.window = browserWindow;
    globalThis.document = browserWindow.document;
    globalThis.CustomEvent = browserWindow.CustomEvent;

    const { hmrSwapComponent } = await import("../../packages/runtime/dist/index.js");

    const moduleId = "/src/components/Unmounted.tix";
    function UnmountedComponent() {
      return document.createElement("div");
    }
    UnmountedComponent.__mix_hmr_id = moduleId;

    let eventFired = false;
    window.addEventListener("mix:hmr-applied", () => {
      eventFired = true;
    });

    const swapResult = hmrSwapComponent(moduleId, UnmountedComponent);
    assert.equal(swapResult, true);
    assert.equal(eventFired, false, "mix:hmr-applied must not fire when no instances are mounted");
  });
});

