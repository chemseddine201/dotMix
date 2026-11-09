import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { defineAppAbility } from "../../src/permissions/abilities.js";

describe("Application Permission Capabilities", () => {
  test("Guest has read-only access to PublicContent", () => {
    const ability = defineAppAbility(null);
    assert.strictEqual(ability.can("read", "PublicContent"), true);
    assert.strictEqual(ability.can("read", "Task"), false);
  });

  test("User can read and create tasks", () => {
    const user = { id: 1, name: "Alice", roles: ["user"] };
    const ability = defineAppAbility(user);
    assert.strictEqual(ability.can("read", "Task"), true);
    assert.strictEqual(ability.can("create", "Task"), true);
    assert.strictEqual(ability.can("delete", "Task"), false);
  });

  test("Admin can manage all resources", () => {
    const admin = { id: 99, name: "Admin", roles: ["admin"] };
    const ability = defineAppAbility(admin);
    assert.strictEqual(ability.can("manage", "all"), true);
    assert.strictEqual(ability.can("delete", "Task"), true);
  });
});

