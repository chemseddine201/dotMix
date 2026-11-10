/**
 * Gate 25: Native Fine-Grained Permissions Engine (@mix/runtime/permissions & @mix/router)
 *
 * Verifies:
 * 1. Core RBAC/ABAC ability definitions, last-rule-wins semantics, and explicit cannot() overrides.
 * 2. Signal-aware dynamic ABAC predicates tracking reactive subject state without manual update calls.
 * 3. Declarative <Can> component with fine-grained DOM gating and fallback switching.
 * 4. Granular field-level permissions (e.g. can update title but cannot update status).
 * 5. Async ability evaluation with CancellationToken abort support.
 * 6. Deep router permission guards evaluating access before data loaders execute.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  signal,
  createMemo,
  createRoot,
  createCancellationSource
} from "../../packages/runtime/dist/core/index.js";
import {
  defineAbility,
  createAbility,
  subject,
  useAbility,
  PermissionProvider,
  Can
} from "../../packages/runtime/dist/permissions/index.js";
import { createRouter, createMemoryHistory } from "../../packages/router/dist/index.js";

describe("Gate 25: Native Fine-Grained Permissions Engine (@mix/runtime/permissions)", () => {
  test("1. Core RBAC/ABAC definitions, wildcards, and explicit cannot overrides", () => {
    const ability = defineAbility((can, cannot) => {
      // Super admin can manage all
      can("manage", "all");
      // Explicit restriction: cannot delete audit logs
      cannot("delete", "AuditLog");
      // Guest-like restriction: cannot export system configs
      cannot("export", "SystemConfig");
    });

    // Also test direct createAbility constructor
    const emptyAbility = createAbility([]);
    assert.strictEqual(emptyAbility.can("read", "Article"), false);

    assert.strictEqual(ability.can("read", "Article"), true);
    assert.strictEqual(ability.can("update", "Article"), true);
    assert.strictEqual(ability.can("delete", "Article"), true);

    // cannot() overrides manage all
    assert.strictEqual(ability.can("delete", "AuditLog"), false);
    assert.strictEqual(ability.cannot("delete", "AuditLog"), true);
    assert.strictEqual(ability.can("export", "SystemConfig"), false);
    assert.strictEqual(ability.can("read", "SystemConfig"), true);
  });

  test("2. Signal-aware dynamic ABAC predicates tracking reactive subject state (Gap 2)", () => {
    createRoot(() => {
      const activeUser = { id: 42, role: "editor" };

      const ability = defineAbility((can) => {
        can("read", "Article");
        can("update", "Article", (art) => {
          // Dynamic condition reading signals or plain properties
          const authorId = typeof art.authorId === "function" ? art.authorId() : art.authorId;
          const isLocked = typeof art.isLocked === "function" ? art.isLocked() : art.isLocked;
          return authorId === activeUser.id && !isLocked;
        });
      });

      // Reactive subject with fine-grained signals!
      const article = {
        title: signal("First Post"),
        authorId: signal(42),
        isLocked: signal(false)
      };

      const trackedArticle = subject("Article", article);

      // Memo tracking permission status
      const canEditMemo = createMemo(() => ability.can("update", trackedArticle));

      // 1. Initial state: author matches, not locked -> true
      assert.strictEqual(canEditMemo(), true);

      // 2. Lock the article -> memo updates to false automatically with 0ms delay!
      article.isLocked.set(true);
      assert.strictEqual(canEditMemo(), false);

      // 3. Unlock the article -> flips back to true automatically
      article.isLocked.set(false);
      assert.strictEqual(canEditMemo(), true);

      // 4. Change author -> flips to false automatically
      article.authorId.set(999);
      assert.strictEqual(canEditMemo(), false);
    });
  });

  test("3. Declarative <Can> component with fine-grained DOM gating (Gap 1)", () => {
    const win = new Window({ url: "http://localhost:3000/" });
    const prevDoc = globalThis.document;
    const prevNode = globalThis.Node;
    globalThis.document = win.document;
    globalThis.Node = win.Node;

    try {
      const container = win.document.createElement("div");
      win.document.body.appendChild(container);

      createRoot(() => {
        const user = signal({ role: "viewer" });

        // Ability updates reactively based on user role
        const ability = createMemo(() => {
          return defineAbility((can) => {
            if (user().role === "admin") {
              can("manage", "all");
            } else if (user().role === "editor") {
              can("read", "Post");
              can("create", "Post");
              can("update", "Post");
            } else {
              can("read", "Post");
            }
          });
        });

        // Wrap in PermissionProvider and mount <Can> into live DOM
        PermissionProvider({
          ability,
          children: () => {
            const appAbility = useAbility();

            const editGate = Can({
              I: "update",
              a: "Post",
              fallback: () => {
                const span = win.document.createElement("span");
                span.setAttribute("data-state", "denied");
                span.textContent = "READ_ONLY";
                return span;
              },
              children: () => {
                const btn = win.document.createElement("button");
                btn.setAttribute("data-state", "allowed");
                btn.textContent = "EDIT_ALLOWED";
                return btn;
              }
            });

            container.appendChild(editGate);

            // Initially viewer -> fallback mounted in live DOM
            assert.strictEqual(container.textContent, "READ_ONLY");
            assert.ok(container.querySelector('[data-state="denied"]'));
            assert.strictEqual(container.querySelector('[data-state="allowed"]'), null);

            // Elevate to editor -> DOM updates in place to allowed branch
            user.set({ role: "editor" });
            assert.strictEqual(appAbility.can("update", "Post"), true);
            assert.strictEqual(appAbility.can("delete", "Post"), false);
            assert.strictEqual(container.textContent, "EDIT_ALLOWED");
            assert.ok(container.querySelector('[data-state="allowed"]'));
            assert.strictEqual(container.querySelector('[data-state="denied"]'), null);

            // Elevate to admin -> still allowed
            user.set({ role: "admin" });
            assert.strictEqual(appAbility.can("delete", "Post"), true);
            assert.strictEqual(container.textContent, "EDIT_ALLOWED");

            // Downgrade back to viewer -> DOM swaps back to fallback
            user.set({ role: "viewer" });
            assert.strictEqual(container.textContent, "READ_ONLY");
            assert.ok(container.querySelector('[data-state="denied"]'));
          }
        });
      });
    } finally {
      globalThis.document = prevDoc;
      globalThis.Node = prevNode;
    }
  });

  test("4. Granular field-level permissions (Gap 5)", () => {
    const ability = defineAbility((can, cannot) => {
      // Authors can update title and tags, but NOT status or featured
      can("update", "Document", ["title", "tags"]);
      cannot("update", "Document", ["status", "featured"]);
    });

    const doc = subject("Document", {
      title: "Quarterly Report",
      status: "published",
      tags: ["finance", "2026"]
    });

    // Allowed fields
    assert.strictEqual(ability.can("update", doc, "title"), true);
    assert.strictEqual(ability.can("update", doc, "tags"), true);

    // Disallowed fields
    assert.strictEqual(ability.can("update", doc, "status"), false);
    assert.strictEqual(ability.can("update", doc, "featured"), false);
    assert.strictEqual(ability.cannot("update", doc, "status"), true);
  });

  test("5. Async ability evaluation with CancellationToken abort support (Gap 3)", async () => {
    const ability = defineAbility((can) => {
      // Async rule checking remote verification or biometric session
      can("transfer", "Account", async (acc) => {
        await new Promise((r) => globalThis.setTimeout(r, 20));
        return acc.balance >= 100;
      });
    });

    const acc = subject("Account", { balance: 500 });

    // 1. Successful async check
    const allowed = await ability.canAsync("transfer", acc);
    assert.strictEqual(allowed, true);

    // 2. Cancellation token abort mid-flight
    const source = createCancellationSource(null);
    const inFlightPromise = ability.canAsync("transfer", acc, undefined, source.token);

    // Cancel token immediately
    source.cancel("SWITCHED_TAB");

    await assert.rejects(
      async () => {
        await inFlightPromise;
      },
      (err) => err === "SWITCHED_TAB" || String(err).includes("SWITCHED_TAB")
    );
  });

  test("6. Deep router permission guards evaluating access before data loaders (Gap 4)", async () => {
    let adminLoaderExecuted = false;

    const currentRole = signal("user");
    const ability = createMemo(() => {
      return defineAbility((can) => {
        can("read", "Home");
        if (currentRole() === "admin") {
          can("manage", "AdminPanel");
        }
      });
    });

    const history = createMemoryHistory("/");
    const router = createRouter({
      history,
      ability,
      routes: [
        {
          path: "/",
          component: "HomeView"
        },
        {
          path: "/admin",
          component: "AdminView",
          permissions: {
            action: "manage",
            subject: "AdminPanel",
            redirectTo: "/unauthorized"
          },
          loader: async () => {
            adminLoaderExecuted = true;
            return { sensitiveKey: "SECRET_99" };
          }
        },
        {
          path: "/unauthorized",
          component: "UnauthorizedView"
        }
      ]
    });

    // 1. Attempt navigation to /admin as regular "user"
    assert.strictEqual(router.currentRoute().pathname, "/");
    await router.push("/admin");

    // Must be redirected to /unauthorized instantly!
    assert.strictEqual(router.currentRoute().pathname, "/unauthorized");
    // Loader MUST NOT have executed!
    assert.strictEqual(adminLoaderExecuted, false, "Admin loader must not execute when unauthorized");

    // 2. Elevate user to "admin"
    currentRole.set("admin");

    // 3. Navigate to /admin as "admin"
    const success = await router.push("/admin");
    assert.strictEqual(success, true);
    assert.strictEqual(router.currentRoute().pathname, "/admin");
    assert.strictEqual(adminLoaderExecuted, true, "Admin loader must execute when authorized");
  });
});
