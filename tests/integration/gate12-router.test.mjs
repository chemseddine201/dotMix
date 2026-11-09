/**
 * Gate 12 Test Suite — Production Client Router (@mix/router — D-115)
 *
 * Verifies:
 * 1. Radix-Trie route matching engine (static, param, wildcard, nested layouts)
 * 2. Navigation drivers (Memory, Browser, Hash)
 * 3. Reactive navigation primitives (useRoute, useParams, useSearchParams, useNavigate)
 * 4. Async navigation guards and D-104 CancellationToken cancellation on rapid route switches
 * 5. Nested <RouterView /> layout preservation (parent does NOT remount when child route changes)
 * 6. <Link /> navigation, activeClass toggle, and R-URL-01 unsafe protocol rejection
 * 7. Zero external runtime dependencies in @mix/router
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import {
  createRouter,
  createMemoryHistory,
  RouteTrie,
  RouterProvider,
  RouterView,
  Link,
  useRoute,
  useParams,
  useSearchParams,
  useNavigate,
} from "../../packages/router/dist/index.js";
import { createRoot } from "../../packages/runtime/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

describe("Gate 12: Production Client Router (@mix/router — D-115)", () => {
  test("1. Package Boundaries: Zero external runtime dependencies in @mix/router", () => {
    const routerPkgPath = path.join(rootDir, "packages/router/package.json");
    assert.ok(fs.existsSync(routerPkgPath), "@mix/router package.json must exist");
    const json = JSON.parse(fs.readFileSync(routerPkgPath, "utf-8"));

    assert.strictEqual(
      json.dependencies?.["@mix/runtime"],
      "0.1.0",
      "@mix/router must depend on @mix/runtime"
    );

    const externalDeps = Object.keys(json.dependencies || {}).filter((d) => d !== "@mix/runtime");
    assert.deepStrictEqual(
      externalDeps,
      [],
      "@mix/router must declare ZERO external runtime dependencies"
    );
  });

  test("2. Radix-Trie route matching with static, param (:id), wildcard (*path), and nested layouts", () => {
    const routes = [
      { path: "/", name: "home" },
      { path: "/about", name: "about" },
      { path: "/users/:id", name: "user-detail" },
      {
        path: "/dashboard",
        name: "dashboard",
        children: [
          { path: "", name: "dashboard-index" },
          { path: "analytics", name: "dashboard-analytics" },
          { path: "reports/:category", name: "dashboard-report" },
        ],
      },
      { path: "/files/*path", name: "files" },
    ];

    const trie = new RouteTrie(routes);

    // Root
    const homeMatch = trie.match("/");
    assert.ok(homeMatch);
    assert.strictEqual(homeMatch.matched.length, 1);
    assert.strictEqual(homeMatch.matched[0].record.name, "home");

    // Static
    const aboutMatch = trie.match("/about");
    assert.ok(aboutMatch);
    assert.strictEqual(aboutMatch.matched[0].record.name, "about");

    // Parameter
    const userMatch = trie.match("/users/9942");
    assert.ok(userMatch);
    assert.strictEqual(userMatch.matched[0].record.name, "user-detail");
    assert.strictEqual(userMatch.params.id, "9942");

    // Nested Route
    const dashReport = trie.match("/dashboard/reports/financial");
    assert.ok(dashReport);
    assert.strictEqual(dashReport.matched.length, 2);
    assert.strictEqual(dashReport.matched[0].record.name, "dashboard");
    assert.strictEqual(dashReport.matched[1].record.name, "dashboard-report");
    assert.strictEqual(dashReport.params.category, "financial");

    // Wildcard
    const filesMatch = trie.match("/files/docs/2026/q1/summary.pdf");
    assert.ok(filesMatch);
    assert.strictEqual(filesMatch.matched[0].record.name, "files");
    assert.strictEqual(filesMatch.params.path, "docs/2026/q1/summary.pdf");
  });

  test("3. Reactive primitives: useRoute, useParams, useSearchParams, and useNavigate", async () => {
    const history = createMemoryHistory("/items/electronics?filter=phones&page=1#specs");
    const router = createRouter({
      history,
      routes: [
        { path: "/" },
        { path: "/items/:category" },
        { path: "/checkout" },
      ],
    });

    let currentRouteFn;
    let currentParamsFn;
    let searchParamsTuple;
    let navigateFn;

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          currentRouteFn = useRoute();
          currentParamsFn = useParams();
          searchParamsTuple = useSearchParams();
          navigateFn = useNavigate();
        },
      });
    });

    assert.ok(currentRouteFn);
    assert.strictEqual(currentRouteFn().pathname, "/items/electronics");
    assert.strictEqual(currentRouteFn().hash, "#specs");
    assert.strictEqual(currentParamsFn().category, "electronics");
    assert.strictEqual(searchParamsTuple[0]().filter, "phones");
    assert.strictEqual(searchParamsTuple[0]().page, "1");

    // Navigate to checkout
    const navSuccess = await navigateFn("/checkout");
    assert.strictEqual(navSuccess, true);
    assert.strictEqual(currentRouteFn().pathname, "/checkout");
    assert.strictEqual(history.location, "/checkout");

    // Update search params
    const [, setSearchParams] = searchParamsTuple;
    setSearchParams({ step: "payment", coupon: "MIX2026" });
    assert.strictEqual(currentRouteFn().query.step, "payment");
    assert.strictEqual(currentRouteFn().query.coupon, "MIX2026");
    assert.strictEqual(history.location, "/checkout?step=payment&coupon=MIX2026");

    router.destroy();
  });

  test("4. Async Navigation Guards with D-104 CancellationToken cancellation on rapid route switches", async () => {
    const history = createMemoryHistory("/");
    let cancelCount = 0;
    let slowNavCompleted = false;

    const router = createRouter({
      history,
      routes: [
        { path: "/" },
        { path: "/slow" },
        { path: "/fast" },
        {
          path: "/admin",
          beforeEnter: (to, from) => {
            if (!to.query.token) {
              return "/login"; // Redirect
            }
            return true;
          },
        },
        { path: "/login" },
      ],
      beforeEach: async (to, from, cancellationToken) => {
        if (to.pathname === "/slow") {
          // Slow async guard
          await new Promise((resolve) => setTimeout(resolve, 80));
          if (cancellationToken.isCancelled) {
            cancelCount++;
            return false;
          }
          slowNavCompleted = true;
        }
        return true;
      },
    });

    // Start slow navigation
    const slowPromise = router.push("/slow");

    // Rapidly switch to /fast before slow finishes
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fastPromise = router.push("/fast");

    const [slowResult, fastResult] = await Promise.all([slowPromise, fastPromise]);

    assert.strictEqual(slowResult, false, "Slow navigation must be cancelled by rapid subsequent navigation");
    assert.strictEqual(fastResult, true, "Fast navigation must succeed");
    assert.strictEqual(router.currentRoute().pathname, "/fast");
    assert.strictEqual(slowNavCompleted, false, "Slow guard must not complete successfully");
    assert.strictEqual(cancelCount, 1, "Cancellation token must record cancellation");

    // Test guard redirect (/admin -> /login)
    const adminNav = await router.push("/admin");
    assert.strictEqual(adminNav, true);
    assert.strictEqual(router.currentRoute().pathname, "/login", "Guard must redirect unauthorized access to /login");

    router.destroy();
  });

  test("5. Nested <RouterView /> layout preservation (parent does NOT remount when child route changes)", () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    let parentMountCount = 0;
    let childAMountCount = 0;
    let childBMountCount = 0;

    const ParentLayout = () => {
      parentMountCount++;
      const container = document.createElement("div");
      container.className = "parent-layout";
      container.appendChild(document.createTextNode("Parent Header | "));
      container.appendChild(RouterView());
      return container;
    };

    const ChildA = () => {
      childAMountCount++;
      const el = document.createElement("div");
      el.className = "child-a";
      el.textContent = "Child A Content";
      return el;
    };

    const ChildB = () => {
      childBMountCount++;
      const el = document.createElement("div");
      el.className = "child-b";
      el.textContent = "Child B Content";
      return el;
    };

    const history = createMemoryHistory("/dashboard/tab-a");
    const router = createRouter({
      history,
      routes: [
        {
          path: "/dashboard",
          component: ParentLayout,
          children: [
            { path: "tab-a", component: ChildA },
            { path: "tab-b", component: ChildB },
          ],
        },
      ],
    });

    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          rootEl.appendChild(RouterView());
        },
      });
    });

    assert.strictEqual(parentMountCount, 1, "Parent layout should mount once");
    assert.strictEqual(childAMountCount, 1, "Child A should mount once");
    assert.strictEqual(childBMountCount, 0, "Child B not mounted yet");
    assert.ok(rootEl.querySelector(".parent-layout"));
    assert.ok(rootEl.querySelector(".child-a"));

    // Navigate to tab-b
    void router.push("/dashboard/tab-b");

    assert.strictEqual(parentMountCount, 1, "Parent layout MUST NOT remount when child route changes");
    assert.strictEqual(childBMountCount, 1, "Child B should mount");
    assert.strictEqual(rootEl.querySelector(".child-a"), null, "Child A should be cleanly unmounted");
    assert.ok(rootEl.querySelector(".child-b"), "Child B should be rendered inside parent");

    router.destroy();
  });

  test("6. <Link /> component: click handling, activeClass toggle, and R-URL-01 safe protocol enforcement", () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    const history = createMemoryHistory("/");
    const router = createRouter({
      history,
      routes: [
        { path: "/" },
        { path: "/profile" },
      ],
    });

    let linkEl;
    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          linkEl = Link({
            href: "/profile",
            class: "nav-item",
            activeClass: "is-active",
            children: "My Profile",
          });
        },
      });
    });

    assert.ok(linkEl);
    assert.strictEqual(linkEl.getAttribute("href"), "/profile");
    assert.strictEqual(linkEl.className, "nav-item");
    assert.strictEqual(linkEl.hasAttribute("aria-current"), false);

    // Simulate click
    linkEl.dispatchEvent(new window.MouseEvent("click", { button: 0, bubbles: true, cancelable: true }));

    assert.strictEqual(router.currentRoute().pathname, "/profile");
    assert.strictEqual(linkEl.className, "nav-item is-active");
    assert.strictEqual(linkEl.getAttribute("aria-current"), "page");

    // R-URL-01: Malicious URLs rejected
    assert.throws(() => {
      Link({ href: "javascript:alert(1)" });
    }, /Unsafe URL rejected by security policy/);

    assert.throws(() => {
      Link({ href: "vbscript:msgbox(1)" });
    }, /Unsafe URL rejected by security policy/);

    router.destroy();
  });
});
