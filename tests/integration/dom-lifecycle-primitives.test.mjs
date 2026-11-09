/**
 * Gate 19 (D-122): DOM Visual & Lifecycle Primitives Suite
 *
 * Verifies:
 * 1. `Teleport` / `createPortal`: mounts children into target container (body/selector) with context inheritance,
 *    moves back in-place when disabled, and cleans up on unmount.
 * 2. `KeepAlive` / `createKeepAlive`: retains live signals and DOM nodes across activeKey switches in an offscreen
 *    fragment, restores instantly without re-rendering, enforces LRU cache eviction when max is reached,
 *    and disposes all owners on parent cleanup.
 * 3. `Transition` / `createTransition`: applies enter-from/enter-active/enter-to and leave-from/leave-active/leave-to
 *    classes, delays DOM removal until leave animation completes, and invokes callbacks.
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  signal,
  createContext,
  provideContext,
  useContext,
  mount,
  Teleport,
  createPortal,
  KeepAlive,
  Transition
} from "../../packages/runtime/dist/index.js";

describe("Gate 19: DOM Visual & Lifecycle Primitives (@mix/runtime/dom)", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
    globalThis.requestAnimationFrame = (cb) => {
      cb(0);
      return 0;
    };
  });

  test("1. Teleport mounts children into target container and preserves Context API", () => {
    const modalRoot = document.createElement("div");
    modalRoot.id = "modal-root";
    document.body.appendChild(modalRoot);

    const ThemeContext = createContext("light");
    const container = document.createElement("div");
    document.body.appendChild(container);

    let observedTheme = "";
    let buttonClicks = 0;

    const res = mount(() => {
      provideContext(ThemeContext, "dark");

      return Teleport({
        to: "#modal-root",
        children: () => {
          const theme = useContext(ThemeContext);
          observedTheme = theme;
          const btn = document.createElement("button");
          btn.className = "modal-btn";
          btn.textContent = `Theme: ${theme}`;
          btn.addEventListener("click", () => {
            buttonClicks++;
          });
          return btn;
        }
      });
    }, container);

    // Modal button was teleported into #modal-root
    const modalBtn = modalRoot.querySelector(".modal-btn");
    assert.ok(modalBtn, "Button should be teleported into #modal-root");
    assert.strictEqual(observedTheme, "dark", "Teleported child should inherit context from logical parent");
    assert.strictEqual(container.querySelector(".modal-btn"), null, "Button should not be in local container");

    // Event listeners work
    modalBtn.click();
    assert.strictEqual(buttonClicks, 1);

    // Unmount removes teleported node
    res.unmount();
    assert.strictEqual(modalRoot.querySelector(".modal-btn"), null, "Teleported node should be removed on unmount");
  });

  test("2. Teleport moves children in-place when disabled toggles", async () => {
    const target = document.createElement("div");
    target.id = "target";
    document.body.appendChild(target);

    const host = document.createElement("div");
    document.body.appendChild(host);

    const isDisabled = signal(false);

    mount(() => {
      return createPortal(
        () => {
          const span = document.createElement("span");
          span.id = "teleported-span";
          span.textContent = "Hello Portal";
          return span;
        },
        target,
        { disabled: () => isDisabled() }
      );
    }, host);

    // Initially in target
    assert.ok(target.querySelector("#teleported-span"));
    assert.strictEqual(host.querySelector("#teleported-span"), null);

    // Toggle disabled to true -> moves into host before marker
    isDisabled.set(true);
    assert.strictEqual(target.querySelector("#teleported-span"), null);
    assert.ok(host.querySelector("#teleported-span"));

    // Toggle back to false -> moves back to target
    isDisabled.set(false);
    assert.ok(target.querySelector("#teleported-span"));
    assert.strictEqual(host.querySelector("#teleported-span"), null);
  });

  test("3. KeepAlive retains live signals and DOM state across switches and enforces LRU cache", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const currentTab = signal("tabA");
    const counterA = signal(10);
    const counterB = signal(20);
    const counterC = signal(30);

    let renderCountA = 0;
    let renderCountB = 0;
    let renderCountC = 0;

    const res = mount(() => {
      return KeepAlive({
        activeKey: () => currentTab(),
        max: 2, // Maximum 2 cached entries
        render: (key) => {
          const div = document.createElement("div");
          div.id = `view-${key}`;
          if (key === "tabA") {
            renderCountA++;
            div.textContent = `A:${counterA()}`;
          } else if (key === "tabB") {
            renderCountB++;
            div.textContent = `B:${counterB()}`;
          } else if (key === "tabC") {
            renderCountC++;
            div.textContent = `C:${counterC()}`;
          }
          return div;
        }
      });
    }, host);

    // Initially Tab A is rendered
    assert.ok(host.querySelector("#view-tabA"));
    assert.strictEqual(renderCountA, 1);

    // Switch to Tab B
    currentTab.set("tabB");
    assert.ok(host.querySelector("#view-tabB"));
    assert.strictEqual(host.querySelector("#view-tabA"), null);
    assert.strictEqual(renderCountB, 1);

    // Switch back to Tab A: should restore from cache WITHOUT re-calling render
    currentTab.set("tabA");
    assert.ok(host.querySelector("#view-tabA"));
    assert.strictEqual(host.querySelector("#view-tabB"), null);
    assert.strictEqual(renderCountA, 1, "Tab A should be restored from cache without re-rendering");

    // Switch to Tab C: Tab C added, LRU evicted is Tab B (since Tab A was just accessed)
    currentTab.set("tabC");
    assert.ok(host.querySelector("#view-tabC"));
    assert.strictEqual(renderCountC, 1);

    // Switch back to Tab A: Tab A is still in cache!
    currentTab.set("tabA");
    assert.strictEqual(renderCountA, 1, "Tab A should still be cached");

    // Switch to Tab B: Tab B was evicted by LRU so it should re-render
    currentTab.set("tabB");
    assert.strictEqual(renderCountB, 2, "Tab B was evicted and should re-render");

    res.unmount();
    assert.strictEqual(host.querySelector("#view-tabB"), null);
  });

  test("4. Transition applies lifecycle CSS classes and delays removal until transition finishes", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const isVisible = signal(true);
    let beforeEnterCalled = false;
    let afterLeaveCalled = false;

    mount(() => {
      return Transition({
        name: "fade",
        show: () => isVisible(),
        durationMs: 50,
        onBeforeEnter: () => {
          beforeEnterCalled = true;
        },
        onAfterLeave: () => {
          afterLeaveCalled = true;
        },
        children: () => {
          const card = document.createElement("div");
          card.id = "animated-card";
          card.textContent = "Fade Card";
          return card;
        }
      });
    }, host);

    const card = host.querySelector("#animated-card");
    assert.ok(card);
    assert.strictEqual(beforeEnterCalled, true);

    // Trigger leave transition
    isVisible.set(false);

    // Card should still be in DOM immediately during leave transition
    assert.ok(card.classList.contains("fade-leave-active") || card.classList.contains("fade-leave-to"));
    assert.ok(host.querySelector("#animated-card"), "Card should remain in DOM while animating out");

    // Wait for durationMs (50ms)
    await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

    // Now card should be physically removed from DOM and callback fired
    assert.strictEqual(host.querySelector("#animated-card"), null);
    assert.strictEqual(afterLeaveCalled, true);
  });
});
