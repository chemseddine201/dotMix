import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

import { createRouter } from "../../packages/router/dist/index.js";
import { createEffect, createRoot } from "../../packages/runtime/dist/index.js";

test("Phase 6: @mix/router Reactive Client-Side Router", async (t) => {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.window = window;

  await t.test("createRouter initializes currentPath and reactive updates", () => {
    const router = createRouter({
      initialPath: "/home",
      routes: [
        { path: "/home" },
        { path: "/about" },
        { path: "/dashboard" }
      ]
    });

    assert.equal(router.currentPath(), "/home");
    assert.equal(router.matches("/home"), true);
    assert.equal(router.matches("/about"), false);

    let observedPath = "";
    createRoot(() => {
      createEffect(() => {
        observedPath = router.currentPath();
      });
    });

    assert.equal(observedPath, "/home");

    // Navigate to /about
    router.navigate("/about");
    assert.equal(router.currentPath(), "/about");
    assert.equal(router.matches("/about"), true);
    assert.equal(router.matches("/home"), false);
  });
});

