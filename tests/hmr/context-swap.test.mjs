/* global document */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

describe("HMR hot swap keeps the contexts of the replaced instance", () => {
  it("a swapped component still reads a context provided above it (e.g. RouterContext)", async () => {
    const browserWindow = new Window();
    globalThis.window = browserWindow;
    globalThis.document = browserWindow.document;

    const { createContext, setContext, useContext, mountComponent, createRoot, hmrSwapComponent } =
      await import("../../packages/runtime/dist/index.js");

    const RouterLikeContext = createContext(null);
    const moduleId = "/src/components/RouteLabel.tix";

    function createRouteLabel(versionLabel) {
      function RouteLabel() {
        const routerName = useContext(RouterLikeContext);
        if (!routerName) {
          throw new Error("useRouter() called outside of a RouterProvider/RouterContext");
        }
        const labelElement = document.createElement("span");
        labelElement.textContent = `${versionLabel}:${routerName}`;
        return labelElement;
      }
      RouteLabel.__mix_hmr_id = moduleId;
      return RouteLabel;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    createRoot(() => {
      setContext(RouterLikeContext, "hash-router");
      mountComponent(createRouteLabel("first"), {}, container);
    });
    assert.equal(container.textContent, "first:hash-router");

    const swapSucceeded = hmrSwapComponent(moduleId, createRouteLabel("edited"));

    assert.equal(swapSucceeded, true, "the swap must not lose the parent's context");
    assert.equal(container.textContent, "edited:hash-router");
  });
});
