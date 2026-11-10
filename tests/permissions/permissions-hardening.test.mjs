import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  signal,
  computed,
  createRoot
} from "../../packages/runtime/dist/index.js";
import {
  defineAbility,
  subject,
  PermissionProvider,
  useAbility
} from "../../packages/runtime/dist/permissions/index.js";

describe("Gate 28 (T-28.3): Permissions Hardening (Subject Detection, Branded Signals, Async Guard, Memoized Proxy)", () => {
  it("1. constructor.name subject detection emits a warning and is disabled when strictSubjects: true", () => {
    class Invoice {
      constructor(id) {
        this.id = id;
      }
    }

    const warnings = [];
    const origWarn = globalThis.console.warn;
    globalThis.console.warn = (...args) => {
      warnings.push(args.join(" "));
    };

    try {
      const laxAbility = defineAbility((can) => {
        can("read", "Invoice");
      });

      const untaggedInvoice = new Invoice(101);
      assert.strictEqual(laxAbility.can("read", untaggedInvoice), true);
      assert.ok(
        warnings.some((w) => w.includes("constructor.name") || w.includes("Invoice")),
        `Expected a dev warning when relying on constructor.name, got: ${JSON.stringify(warnings)}`
      );

      // With strictSubjects: true, constructor.name fallback must be disabled
      const strictAbility = defineAbility(
        (can) => {
          can("read", "Invoice");
        },
        { strictSubjects: true }
      );

      assert.strictEqual(
        strictAbility.can("read", untaggedInvoice),
        false,
        "strictSubjects: true must reject untagged class instances relying on constructor.name"
      );

      const taggedInvoice = subject("Invoice", new Invoice(102));
      assert.strictEqual(
        strictAbility.can("read", taggedInvoice),
        true,
        "strictSubjects: true must allow explicitly tagged subject('Invoice', obj) instances"
      );
    } finally {
      globalThis.console.warn = origWarn;
    }
  });

  it("2. Object conditions unwrap ONLY branded signals/computeds and never invoke arbitrary subject methods", () => {
    let sideEffectMethodCalled = false;
    const ownerSignal = signal("u-1");
    const statusComputed = computed(() => "draft");

    const doc = subject("Document", {
      ownerId: ownerSignal,
      status: statusComputed,
      destroy() {
        sideEffectMethodCalled = true;
        return "expected-secret";
      }
    });

    const ability = defineAbility((can) => {
      can("update", "Document", {
        ownerId: "u-1",
        status: "draft"
      });
      can("delete", "Document", {
        destroy: "expected-secret"
      });
    });

    // Branded signal and computed properties must unwrap and match
    assert.strictEqual(ability.can("update", doc), true);
    ownerSignal.set("u-2");
    assert.strictEqual(ability.can("update", doc), false);

    // Arbitrary method on subject must NEVER be invoked during condition matching
    assert.strictEqual(
      ability.can("delete", doc),
      false,
      "Condition matching must not invoke unbranded methods on subject objects"
    );
    assert.strictEqual(
      sideEffectMethodCalled,
      false,
      "Arbitrary subject method destroy() must never be executed by ability.can()"
    );
  });

  it("3. Synchronous ability.can() throws MIX_ERR_ASYNC_RULE_IN_SYNC_CHECK when hitting an async rule predicate", async () => {
    const ability = defineAbility((can) => {
      can("approve", "Expense", async (expense) => {
        return expense.amount < 1000;
      });
    });

    const item = subject("Expense", { amount: 500 });

    assert.throws(
      () => {
        ability.can("approve", item);
      },
      (err) => {
        assert.strictEqual(err.code, "MIX_ERR_ASYNC_RULE_IN_SYNC_CHECK");
        return true;
      },
      "Synchronous ability.can() must throw MIX_ERR_ASYNC_RULE_IN_SYNC_CHECK on async predicate"
    );

    // Verify canAsync() works properly on the same rule
    const allowedAsync = await ability.canAsync("approve", item);
    assert.strictEqual(allowedAsync, true);
  });

  it("4. useAbility() returns a memoized proxy per PermissionProvider context", () => {
    const abilitySig = signal(
      defineAbility((can) => {
        can("read", "Dashboard");
      })
    );

    createRoot((dispose) => {
      let firstHookResult;
      let secondHookResult;

      PermissionProvider({
        ability: abilitySig,
        children: () => {
          firstHookResult = useAbility();
          secondHookResult = useAbility();
        }
      });

      assert.ok(firstHookResult, "useAbility() must return an ability object");
      assert.strictEqual(
        firstHookResult,
        secondHookResult,
        "useAbility() must return the exact same memoized proxy instance within the same context"
      );

      dispose();
    });
  });
});

