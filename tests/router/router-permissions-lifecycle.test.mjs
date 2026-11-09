import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { signal, computed } from "../../packages/runtime/dist/index.js";
import { defineAbility } from "../../packages/runtime/dist/permissions/index.js";
import { createMemoryRouter } from "../../packages/router/dist/index.js";

describe("Gate 28 (T-28.2): Router Permission Enforcement on Initial Load, Ability Change & Popstate", () => {
  test("1. Creating a router at /admin without permission redirects immediately and never calls the protected route loader", async () => {
    let adminLoaderCalled = false;
    const guestAbility = defineAbility((can) => {
      can("read", "Public");
    });

    const router = createMemoryRouter({
      initialPath: "/admin",
      ability: guestAbility,
      routes: [
        { path: "/", component: () => "Home" },
        {
          path: "/admin",
          component: () => "Admin",
          permissions: {
            action: "manage",
            subject: "AdminPanel",
            redirectTo: "/unauthorized"
          },
          loader: async () => {
            adminLoaderCalled = true;
            return { secret: 42 };
          }
        },
        { path: "/unauthorized", component: () => "Unauthorized" }
      ]
    });

    assert.strictEqual(
      router.currentRoute().pathname,
      "/unauthorized",
      "Initial load on unauthorized /admin must redirect to /unauthorized"
    );
    assert.strictEqual(
      router.history.location,
      "/unauthorized",
      "Router history location must be replaced with /unauthorized"
    );
    assert.strictEqual(
      adminLoaderCalled,
      false,
      "Protected route loader must never be invoked when permission check fails"
    );
    router.destroy();
  });

  test("2. Downgrading the reactive ability signal while on /admin automatically redirects away from the protected route", async () => {
    const role = signal("admin");
    const ability = computed(() =>
      defineAbility((can) => {
        can("read", "Public");
        if (role() === "admin") {
          can("manage", "AdminPanel");
        }
      })
    );

    const router = createMemoryRouter({
      initialPath: "/admin",
      ability,
      routes: [
        { path: "/", component: () => "Home" },
        {
          path: "/admin",
          component: () => "Admin",
          permissions: {
            action: "manage",
            subject: "AdminPanel",
            redirectTo: "/unauthorized"
          }
        },
        { path: "/unauthorized", component: () => "Unauthorized" }
      ]
    });

    assert.strictEqual(router.currentRoute().pathname, "/admin", "Admin starts on /admin");

    // Downgrade role signal while currently on /admin
    role.set("viewer");

    assert.strictEqual(
      router.currentRoute().pathname,
      "/unauthorized",
      "Downgrading ability while on /admin must automatically redirect to /unauthorized"
    );
    assert.strictEqual(router.history.location, "/unauthorized");
    router.destroy();
  });

  test("3. Popstate (history.back) onto a protected route enforces permission guards and redirects without running loader", async () => {
    let adminLoaderCalls = 0;
    const role = signal("admin");
    const ability = computed(() =>
      defineAbility((can) => {
        can("read", "Public");
        if (role() === "admin") {
          can("manage", "AdminPanel");
        }
      })
    );

    const router = createMemoryRouter({
      initialPath: "/",
      ability,
      routes: [
        { path: "/", component: () => "Home" },
        {
          path: "/admin",
          component: () => "Admin",
          permissions: {
            action: "manage",
            subject: "AdminPanel",
            redirectTo: "/unauthorized"
          },
          loader: () => {
            adminLoaderCalls++;
            return {};
          }
        },
        { path: "/unauthorized", component: () => "Unauthorized" }
      ]
    });

    await router.push("/admin");
    assert.strictEqual(router.currentRoute().pathname, "/admin");
    assert.strictEqual(adminLoaderCalls, 1);

    await router.push("/");
    assert.strictEqual(router.currentRoute().pathname, "/");

    // Downgrade role to viewer while on /, then navigate back to /admin via history.back() (popstate)
    role.set("viewer");
    router.back();

    assert.strictEqual(
      router.currentRoute().pathname,
      "/unauthorized",
      "Popstate onto /admin without permission must redirect to /unauthorized"
    );
    assert.strictEqual(
      adminLoaderCalls,
      1,
      "Protected route loader must not run on unauthorized popstate"
    );

    // Also verify popstate onto a protected route WITHOUT redirectTo restores history.location to previous route
    const routerNoRedirect = createMemoryRouter({
      initialPath: "/",
      ability: defineAbility((can) => {
        can("read", "Public");
      }),
      routes: [
        { path: "/", component: () => "Home" },
        {
          path: "/secret",
          component: () => "Secret",
          permissions: {
            action: "manage",
            subject: "SecretPanel"
          }
        }
      ]
    });
    // Simulate browser history jumping to /secret (e.g. external popstate)
    routerNoRedirect.history.push("/secret");
    assert.strictEqual(
      routerNoRedirect.currentRoute().pathname,
      "/",
      "Unauthorized popstate without redirectTo must keep currentRoute on /"
    );
    assert.strictEqual(
      routerNoRedirect.history.location,
      "/",
      "Unauthorized popstate without redirectTo must restore history.location to /"
    );
    routerNoRedirect.destroy();
    router.destroy();
  });
});
