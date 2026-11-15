// Link and NavLink must follow a reactive `to` prop. Compiled components pass props as getters
// (`get to() { ... }`), so a component that stays mounted while its target changes (a page pager
// in a persistent layout) must update the href, the click target and the active state.

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createMemoryRouter, RouterProvider, Link, NavLink } from "../../node_modules/@dotmix/router/dist/index.js";
import { createRoot, signal } from "../../node_modules/@dotmix/runtime/dist/index.js";

function mountLink(component, routePaths, linkProps) {
  const router = createMemoryRouter(routePaths.map((routePath) => ({ path: routePath })));
  let anchor;
  createRoot(() => {
    RouterProvider({
      router,
      children: () => {
        anchor = component(linkProps);
      },
    });
  });
  return { router, anchor };
}

describe("Link and NavLink with a reactive `to` prop", () => {
  beforeEach(() => {
    const browserWindow = new Window();
    globalThis.window = browserWindow;
    globalThis.document = browserWindow.document;
  });

  test("Link updates its href and navigates to the current target", async () => {
    const target = signal("/first");
    const { router, anchor } = mountLink(Link, ["/", "/first", "/second"], {
      get to() {
        return target();
      },
      class: "pager-next",
      children: "Next",
    });
    assert.equal(anchor.getAttribute("href"), "/first");

    target.set("/second");
    assert.equal(anchor.getAttribute("href"), "/second");
    anchor.click();
    await Promise.resolve();
    assert.equal(router.currentRoute().pathname, "/second");
  });

  test("Link active class follows the current target", async () => {
    const target = signal("/first");
    const { router, anchor } = mountLink(Link, ["/", "/first", "/second"], {
      get to() {
        return target();
      },
      class: "nav-item",
      children: "Item",
    });
    await router.push("/second");
    assert.equal(anchor.getAttribute("aria-current"), null);

    target.set("/second");
    assert.equal(anchor.getAttribute("aria-current"), "page");
    assert.equal(anchor.className, "nav-item active");
  });

  test("NavLink updates its href, click target and active state", async () => {
    const target = signal("/first");
    const { router, anchor } = mountLink(NavLink, ["/", "/first", "/second"], {
      get to() {
        return target();
      },
      children: "Item",
    });
    await router.push("/first");
    assert.equal(anchor.getAttribute("aria-current"), "page");

    target.set("/second");
    assert.equal(anchor.getAttribute("href"), "/second");
    assert.equal(anchor.getAttribute("aria-current"), null);
    anchor.click();
    await Promise.resolve();
    assert.equal(router.currentRoute().pathname, "/second");
    assert.equal(anchor.getAttribute("aria-current"), "page");
  });

  test("an unsafe target is still rejected", () => {
    assert.throws(() =>
      mountLink(Link, ["/"], {
        to: "javascript:alert(1)",
        children: "Bad",
      })
    );
  });
});
