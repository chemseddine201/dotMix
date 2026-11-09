/**
 * Gate 20 (D-123): Data Router Loaders, Actions, Lazy Splitting & Prefetching Suite
 *
 * Verifies:
 * 1. Route `loader` execution with `useLoaderData`
 * 2. Rapid navigation cancels stale in-flight loader via `CancellationToken`
 * 3. Route `action` execution with `useSubmit` and `useActionData`, triggering loader revalidation
 * 4. Lazy route code-splitting (`lazy: () => Promise.resolve(...)`)
 * 5. `<Link prefetch="intent">` pre-warming on hover
 * 6. `useHead` reactive document title & meta tags
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { mount } from "../../packages/runtime/dist/index.js";
import {
  createMemoryRouter,
  RouterProvider,
  Outlet,
  Link,
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
  useHead
} from "../../packages/router/dist/index.js";

describe("Gate 20: Data Router Loaders, Actions, Lazy Splitting & Prefetching (@mix/router)", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
  });

  test("1. Route loader executes on navigation and provides data via useLoaderData", async () => {
    const router = createMemoryRouter({
      initialEntries: ["/"],
      routes: [
        {
          path: "/",
          element: () => {
            const h1 = document.createElement("h1");
            h1.textContent = "Home";
            return h1;
          }
        },
        {
          path: "/users/:id",
          id: "user-detail",
          loader: async ({ params }) => {
            return { id: params.id, name: `User ${params.id}`, role: "Admin" };
          },
          element: () => {
            const data = useLoaderData();
            const div = document.createElement("div");
            div.id = "user-profile";
            div.textContent = `${data?.name} (${data?.role})`;
            return div;
          }
        }
      ]
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    mount(() => {
      return RouterProvider({
        router,
        children: () => Outlet()
      });
    }, host);

    assert.ok(host.querySelector("h1"));

    // Navigate to /users/42
    await router.push("/users/42");

    // Profile rendered with loader data
    const profile = host.querySelector("#user-profile");
    assert.ok(profile);
    assert.strictEqual(profile.textContent, "User 42 (Admin)");
  });

  test("2. Rapid navigation cancels stale in-flight loader via CancellationToken", async () => {
    let slowLoaderCancelled = false;

    const router = createMemoryRouter({
      initialEntries: ["/"],
      routes: [
        {
          path: "/",
          element: () => document.createElement("div")
        },
        {
          path: "/slow",
          loader: async ({ cancellationToken }) => {
            cancellationToken.onCancelled(() => {
              slowLoaderCancelled = true;
            });
            await new Promise((resolve) => globalThis.setTimeout(resolve, 80));
            return { speed: "slow" };
          },
          element: () => document.createElement("div")
        },
        {
          path: "/fast",
          loader: async () => {
            return { speed: "fast" };
          },
          element: () => {
            const data = useLoaderData();
            const span = document.createElement("span");
            span.id = "fast-content";
            span.textContent = data?.speed || "";
            return span;
          }
        }
      ]
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    mount(() => {
      return RouterProvider({
        router,
        children: () => Outlet()
      });
    }, host);

    // Rapidly trigger navigation: /slow then immediately /fast
    const p1 = router.push("/slow");
    const p2 = router.push("/fast");

    await Promise.all([p1, p2]);

    assert.strictEqual(slowLoaderCancelled, true, "Slow loader must be cancelled by rapid navigation");
    assert.strictEqual(router.currentRoute().pathname, "/fast");
    assert.ok(host.querySelector("#fast-content"));
    assert.strictEqual(host.querySelector("#fast-content").textContent, "fast");
  });

  test("3. Route action execution with useSubmit, useActionData and automatic loader revalidation", async () => {
    let tasks = ["Task 1", "Task 2"];
    let loaderCallCount = 0;

    const router = createMemoryRouter({
      initialEntries: ["/"],
      routes: [
        {
          path: "/",
          element: () => document.createElement("div")
        },
        {
          path: "/tasks",
          loader: async () => {
            loaderCallCount++;
            return { tasks: [...tasks] };
          },
          action: async ({ request }) => {
            const payload = request.body;
            tasks.push(payload.title);
            return { success: true, added: payload.title };
          },
          element: () => {
            const data = useLoaderData();
            const actionResult = useActionData();
            const nav = useNavigation();
            const submit = useSubmit();

            const container = document.createElement("div");
            container.id = "tasks-container";

            const countSpan = document.createElement("span");
            countSpan.id = "task-count";
            countSpan.textContent = String(data?.tasks?.length || 0);
            container.appendChild(countSpan);

            const statusSpan = document.createElement("span");
            statusSpan.id = "nav-state";
            statusSpan.textContent = nav.state;
            container.appendChild(statusSpan);

            if (actionResult?.success) {
              const badge = document.createElement("div");
              badge.id = "success-badge";
              badge.textContent = `Added: ${actionResult.added}`;
              container.appendChild(badge);
            }

            const btn = document.createElement("button");
            btn.id = "add-btn";
            btn.addEventListener("click", () => {
              void submit({ title: "Task 3" });
            });
            container.appendChild(btn);

            return container;
          }
        }
      ]
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    mount(() => {
      return RouterProvider({
        router,
        children: () => Outlet()
      });
    }, host);

    // Navigate to /tasks
    await router.push("/tasks");

    assert.strictEqual(loaderCallCount, 1);
    assert.strictEqual(host.querySelector("#task-count").textContent, "2");

    // Click submit button
    const btn = host.querySelector("#add-btn");
    btn.click();

    // Wait for submission and revalidation tick
    await new Promise((resolve) => globalThis.setTimeout(resolve, 30));

    // Loader revalidated automatically
    assert.strictEqual(loaderCallCount, 2, "Loader should automatically revalidate after action submission");
    assert.strictEqual(host.querySelector("#task-count").textContent, "3");
    assert.ok(host.querySelector("#success-badge"));
    assert.strictEqual(host.querySelector("#success-badge").textContent, "Added: Task 3");
  });

  test("4. Lazy route code-splitting loads component and loader dynamically", async () => {
    let lazyCalled = false;

    const router = createMemoryRouter({
      initialEntries: ["/"],
      routes: [
        {
          path: "/",
          element: () => document.createElement("div")
        },
        {
          path: "/lazy",
          lazy: async () => {
            lazyCalled = true;
            return {
              loader: async () => ({ message: "Lazy loaded data" }),
              Component: () => {
                const data = useLoaderData();
                const div = document.createElement("div");
                div.id = "lazy-node";
                div.textContent = data?.message || "";
                return div;
              }
            };
          }
        }
      ]
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    mount(() => {
      return RouterProvider({
        router,
        children: () => Outlet()
      });
    }, host);

    assert.strictEqual(lazyCalled, false);

    // Navigate to /lazy
    await router.push("/lazy");

    assert.strictEqual(lazyCalled, true);
    const lazyNode = host.querySelector("#lazy-node");
    assert.ok(lazyNode);
    assert.strictEqual(lazyNode.textContent, "Lazy loaded data");
  });

  test("5. Link with prefetch='intent' pre-warms route loader on hover", async () => {
    let prefetchExecuted = false;

    const router = createMemoryRouter({
      initialEntries: ["/"],
      routes: [
        {
          path: "/",
          element: () => document.createElement("div")
        },
        {
          path: "/target",
          loader: async () => {
            prefetchExecuted = true;
            return { ready: true };
          },
          element: () => document.createElement("div")
        }
      ]
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    mount(() => {
      return RouterProvider({
        router,
        children: () => {
          return Link({
            to: "/target",
            prefetch: "intent",
            children: "Hover me"
          });
        }
      });
    }, host);

    const link = host.querySelector("a");
    assert.ok(link);
    assert.strictEqual(prefetchExecuted, false);

    // Simulate mouseenter (intent to navigate)
    link.dispatchEvent(new win.MouseEvent("mouseenter"));

    await new Promise((resolve) => globalThis.setTimeout(resolve, 20));

    assert.strictEqual(prefetchExecuted, true, "Hovering link with prefetch='intent' should trigger route prefetch");
  });

  test("6. useHead updates document title and meta tags", () => {
    useHead({
      title: "Dashboard - Mix",
      meta: [
        { name: "description", content: "Mix Framework Executive Dashboard" },
        { name: "theme-color", content: "#0f172a" }
      ]
    });

    assert.strictEqual(document.title, "Dashboard - Mix");
    const desc = document.querySelector('meta[name="description"]');
    assert.ok(desc);
    assert.strictEqual(desc.getAttribute("content"), "Mix Framework Executive Dashboard");

    const theme = document.querySelector('meta[name="theme-color"]');
    assert.ok(theme);
    assert.strictEqual(theme.getAttribute("content"), "#0f172a");
  });
});
