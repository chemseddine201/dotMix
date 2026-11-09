import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  signal,
  computed,
  createEffect,
  onCleanup,
  mount,
  createElement,
  insertNode,
  setText,
  mountComponent
} from "../../packages/runtime/dist/index.js";
import {
  defineAbility,
  PermissionProvider,
  Can
} from "../../packages/runtime/dist/permissions/index.js";

function withDom(fn) {
  const window = new Window({ url: "http://localhost:3000/" });
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNode = globalThis.Node;
  const prevElement = globalThis.Element;
  const prevHTMLElement = globalThis.HTMLElement;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;

  try {
    return fn(window.document);
  } finally {
    window.close();
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.Node = prevNode;
    globalThis.Element = prevElement;
    globalThis.HTMLElement = prevHTMLElement;
  }
}

describe("Gate 28 (T-28.1): Reactive <Can> DOM Swapping, Owner Disposal & Sibling Identity", () => {
  test("1. Swaps DOM in place between children and fallback when role signal flips and disposes inactive branch owner", () => {
    withDom((document) => {
      const container = document.createElement("div");
      document.body.appendChild(container);

      const role = signal("viewer");
      const ability = computed(() =>
        defineAbility((can) => {
          can("read", "Post");
          if (role() === "admin") {
            can("delete", "Post");
          }
        })
      );

      let childBranchCleanups = 0;
      let childEffectRuns = 0;
      const tick = signal(0);

      function App() {
        return PermissionProvider({
          ability,
          children: () => {
            const wrap = createElement("section");
            const before = createElement("header");
            setText(before, "Before");
            insertNode(wrap, before);

            mountComponent(
              Can,
              {
                I: "delete",
                a: "Post",
                fallback: () => {
                  const fb = createElement("span");
                  fb.className = "fallback-badge";
                  setText(fb, "Read Only");
                  return [fb];
                },
                children: () => {
                  createEffect(() => {
                    void tick();
                    childEffectRuns++;
                  });
                  onCleanup(() => {
                    childBranchCleanups++;
                  });
                  const btn = createElement("button");
                  btn.className = "delete-btn";
                  setText(btn, "Delete Post");
                  return [btn];
                }
              },
              wrap
            );

            const after = createElement("footer");
            setText(after, "After");
            insertNode(wrap, after);
            return wrap;
          }
        });
      }

      const mounted = mount(App, container);
      const section = container.querySelector("section");
      const beforeEl = section.querySelector("header");
      const afterEl = section.querySelector("footer");

      // Initially viewer: fallback is in DOM, delete-btn is NOT in DOM, child effect has NOT run
      assert.strictEqual(Boolean(section.querySelector(".fallback-badge")), true, "Expected .fallback-badge in DOM for viewer");
      assert.strictEqual(Boolean(section.querySelector(".delete-btn")), false, "Expected no .delete-btn for viewer");
      assert.strictEqual(childEffectRuns, 0, "Inactive child branch must not execute its effects");

      // Upgrade role to admin: DOM swaps to .delete-btn
      role.set("admin");
      assert.strictEqual(Boolean(section.querySelector(".delete-btn")), true, "Expected .delete-btn in DOM after role upgrade to admin");
      assert.strictEqual(Boolean(section.querySelector(".fallback-badge")), false, "Expected .fallback-badge removed");
      assert.strictEqual(childEffectRuns, 1, "Active child branch effect should run once on mount");

      // Downgrade role back to viewer: DOM swaps back to .fallback-badge and disposes child owner
      role.set("viewer");
      assert.strictEqual(Boolean(section.querySelector(".fallback-badge")), true, "Expected .fallback-badge restored on downgrade");
      assert.strictEqual(Boolean(section.querySelector(".delete-btn")), false, "Expected .delete-btn removed on downgrade");
      assert.strictEqual(childBranchCleanups, 1, "Expected inactive child branch owner cleanup to run");

      // Updating `tick` while child branch is disposed must NOT trigger child effect
      tick.set(1);
      assert.strictEqual(childEffectRuns, 1, "Disposed child branch effect must not re-run");

      // Sibling DOM node identity must be preserved across swaps
      assert.strictEqual(section.firstElementChild === beforeEl, true, "Leading sibling identity preserved");
      assert.strictEqual(section.lastElementChild === afterEl, true, "Trailing sibling identity preserved");

      mounted.unmount();
    });
  });

  test("2. Swaps DOM in place when subject signal changes on <Can I='update' this={article}>", () => {
    withDom((document) => {
      const container = document.createElement("div");
      document.body.appendChild(container);

      const currentUserId = signal(10);
      const articleOwnerId = signal(10);

      const ability = computed(() => {
        const uid = currentUserId();
        return defineAbility((can) => {
          can("update", "Article", { ownerId: uid });
        });
      });

      const article = computed(() => ({
        __subjectType: "Article",
        ownerId: articleOwnerId()
      }));

      function App() {
        return PermissionProvider({
          ability,
          children: () => {
            const div = createElement("div");
            mountComponent(
              Can,
              {
                I: "update",
                get this() {
                  return article();
                },
                fallback: "Locked",
                children: () => {
                  const b = createElement("button");
                  b.className = "edit-article";
                  setText(b, "Edit Article");
                  return [b];
                }
              },
              div
            );
            return div;
          }
        });
      }

      const mounted = mount(App, container);
      assert.strictEqual(Boolean(container.querySelector(".edit-article")), true, "Owner 10 can edit article owned by 10");

      // Change article owner to 99 -> swaps to "Locked"
      articleOwnerId.set(99);
      assert.strictEqual(Boolean(container.querySelector(".edit-article")), false, "Cannot edit article owned by 99");
      assert.strictEqual(container.textContent.includes("Locked"), true, "Fallback text 'Locked' rendered");

      // Change currentUserId to 99 -> swaps back to .edit-article
      currentUserId.set(99);
      assert.strictEqual(Boolean(container.querySelector(".edit-article")), true, "User 99 can edit article owned by 99");

      mounted.unmount();
    });
  });
});
