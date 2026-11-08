import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

import {
  signal,
  computed,
  createEffect,
  createRoot,
  batch,
  onCleanup,
  flushQueue,
  createCancellationToken,
  createResource,
  reconcileKeyed,
  setSanitizerProvider,
  renderTrustedHtml,
  MixSecurityError,
  createElement,
  createTextNode,
  setAttribute,
  removeAttribute,
  setStyleProperty,
  addEventListener
} from "../../packages/runtime/dist/index.js";

test("Phase 3 Runtime & DOM Integration", async (t) => {
  // Setup DOM environment
  const window = new Window();
  globalThis.document = window.document;
  globalThis.window = window;

  // 1. Computed / Memoization
  await t.test("computed evaluates lazily and memoizes values", () => {
    const a = signal(2);
    const b = signal(3);
    let evalCount = 0;

    const sum = computed(() => {
      evalCount++;
      return a() + b();
    });

    // Lazy: not evaluated until read
    assert.equal(evalCount, 0);

    // Initial read
    assert.equal(sum(), 5);
    assert.equal(evalCount, 1);

    // Repeated read memoizes (zero extra evaluations)
    assert.equal(sum(), 5);
    assert.equal(evalCount, 1);

    // Dependency update
    a.set(10);
    // Not re-evaluated until read
    assert.equal(evalCount, 1);

    // Pull after update
    assert.equal(sum(), 13);
    assert.equal(evalCount, 2);
  });

  // 2. Batching updates
  await t.test("batch coalesces multiple signal updates into a single scheduler flush", () => {
    const first = signal("John");
    const last = signal("Doe");
    let effectRuns = 0;
    let observed = "";

    createRoot((dispose) => {
      createEffect(() => {
        observed = `${first()} ${last()}`;
        effectRuns++;
      });

      assert.equal(effectRuns, 1);
      assert.equal(observed, "John Doe");

      // Batched update
      batch(() => {
        first.set("Jane");
        last.set("Smith");
        // Within batch, effect has NOT run yet
        assert.equal(effectRuns, 1);
      });

      // After batch ends, effect runs exactly once
      assert.equal(effectRuns, 2);
      assert.equal(observed, "Jane Smith");

      dispose();
    });
  });

  // 3. Platform-Neutral Cancellation and Resource Management (D-104)
  await t.test("CancellationToken and stale generation rejection in createResource", async () => {
    let resolveFirst;
    let resolveSecond;

    let callCount = 0;
    let resource;
    let disposeRoot;

    createRoot((dispose) => {
      disposeRoot = dispose;
      resource = createResource(async (token) => {
        callCount++;
        if (callCount === 1) {
          return new Promise((res) => {
            resolveFirst = () => {
              res("Result 1");
            };
          });
        } else {
          return new Promise((res) => {
            resolveSecond = () => {
              res("Result 2");
            };
          });
        }
      });

      // Refetch triggers second request and cancels first token
      resource.refetch();

      // Resolve first (stale) request
      resolveFirst();
    });

    // Stale resolution should be discarded
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(resource.data(), undefined);

    // Resolve second (latest) request
    resolveSecond();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(resource.data(), "Result 2");

    // Dispose root owner cancels active tokens
    disposeRoot();
  });

  // 4. Keyed List Reconciliation with Duplicate Handling (D-110)
  await t.test("reconcileKeyed handles unique keys, first-occurrence duplicate policy, and disposal", () => {
    const container = createElement("div");
    const anchor = createTextNode("");
    container.appendChild(anchor);

    let disposedKeys = [];

    // Initial list: items A, B, C
    reconcileKeyed(
      container,
      anchor,
      ["A", "B", "C"],
      (item) => item,
      (itemSignal, indexSignal, owner) => {
        const span = createElement("span");
        span.textContent = itemSignal();
        owner.cleanups.push(() => {
          disposedKeys.push(itemSignal());
        });
        return span;
      }
    );

    assert.equal(container.children.length, 3);
    assert.equal(container.children[0].textContent, "A");
    assert.equal(container.children[1].textContent, "B");
    assert.equal(container.children[2].textContent, "C");

    // Update list: B, D (A and C removed)
    reconcileKeyed(
      container,
      anchor,
      ["B", "D"],
      (item) => item,
      (itemSignal, indexSignal, owner) => {
        const span = createElement("span");
        span.textContent = itemSignal();
        owner.cleanups.push(() => {
          disposedKeys.push(itemSignal());
        });
        return span;
      }
    );

    assert.equal(container.children.length, 2);
    assert.equal(container.children[0].textContent, "B");
    assert.equal(container.children[1].textContent, "D");
    assert.ok(disposedKeys.includes("A"));
    assert.ok(disposedKeys.includes("C"));

    // Duplicate key policy (D-110): list contains duplicate "X"
    reconcileKeyed(
      container,
      anchor,
      ["X", "Y", "X"], // "X" appears twice!
      (item) => item,
      (itemSignal, indexSignal, owner) => {
        const span = createElement("span");
        span.textContent = itemSignal();
        return span;
      }
    );

    // First "X" and "Y" are rendered; duplicate "X" is omitted
    assert.equal(container.children.length, 2);
    assert.equal(container.children[0].textContent, "X");
    assert.equal(container.children[1].textContent, "Y");
  });

  // 5. Trusted HTML Sanitizer Boundary (D-109)
  await t.test("renderTrustedHtml enforces SanitizerProvider security boundary (D-109)", () => {
    // 1. Without provider -> throws MixSecurityError
    assert.throws(
      () => renderTrustedHtml("<script>alert(1)</script>"),
      (err) => err instanceof MixSecurityError && err.message.includes("without a registered SanitizerProvider")
    );

    // 2. Register valid provider
    setSanitizerProvider({
      sanitizeHtml(raw) {
        return raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
      }
    });

    const safe = renderTrustedHtml("<b>Hello</b><script>bad()</script>");
    assert.equal(safe, "<b>Hello</b>");
  });

  // 6. Direct DOM Adapter APIs
  await t.test("DOM adapter sets attributes, styles, and events directly", () => {
    const el = createElement("div");
    setAttribute(el, "id", "test-el");
    assert.equal(el.getAttribute("id"), "test-el");

    removeAttribute(el, "id");
    assert.equal(el.getAttribute("id"), null);

    setStyleProperty(el, "color", "blue");
    assert.equal(el.style.getPropertyValue("color"), "blue");

    let clicked = false;
    const removeListener = addEventListener(el, "click", () => {
      clicked = true;
    });

    el.dispatchEvent(new window.Event("click"));
    assert.equal(clicked, true);

    removeListener();
  });
});
