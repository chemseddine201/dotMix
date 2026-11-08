import test from "node:test";
import assert from "node:assert/strict";

import {
  createRoot,
  getOwner,
  runWithOwner,
  onCleanup,
  onError,
  createContext,
  useContext,
  setContext,
  routeError,
  signal,
  computed,
  createEffect,
  flushSync,
  read,
  configureRuntime,
  ComputationState,
  OwnerState,
  MixError
} from "../../packages/runtime/dist/core/index.js";

test("Phase 2 — Owner & Lifecycle Tests (§2.5 / T-OW-01..05)", async (t) => {
  t.beforeEach(() => {
    // Reset runtime configuration before each test
    configureRuntime({
      onUncaughtError: (_err) => {
        // default no-op for tests unless overridden
      },
      onWarning: (_w) => {}
    });
  });

  await t.test("T-OW-01: createRoot with detachedParent null is isolated from outer scope", () => {
    let outerDispose;
    let innerDispose;
    let innerRanCleanup = false;
    let innerOwnerRef;

    createRoot((dispose) => {
      outerDispose = dispose;

      // Create isolated root inside outer root
      createRoot((isolatedDispose) => {
        innerDispose = isolatedDispose;
        innerOwnerRef = getOwner();
        assert.equal(innerOwnerRef.parent, null, "Isolated root must have null parent");

        onCleanup(() => {
          innerRanCleanup = true;
        });
      }, null);
    });

    // Disposing outer root must NOT dispose the isolated root
    outerDispose();
    assert.equal(innerRanCleanup, false, "Disposing outer scope must not dispose isolated inner root");
    assert.equal(innerOwnerRef.ownerState, OwnerState.ACTIVE, "Isolated root must remain ACTIVE");

    // Explicitly disposing the inner root must run its cleanups
    innerDispose();
    assert.equal(innerRanCleanup, true, "Explicitly disposing inner root runs its cleanup");
    assert.equal(innerOwnerRef.ownerState, OwnerState.DISPOSED, "Inner root transitions to DISPOSED");
  });

  await t.test("T-OW-02: createRoot with explicit detachedParent inherits context & error routing only", () => {
    const TestCtx = createContext("default-val");
    let caughtError = null;
    let outerDispose;
    let innerDispose;
    let innerCleanupRan = false;
    let resolvedCtxValue = null;

    createRoot((dispose) => {
      outerDispose = dispose;
      const parentOwner = getOwner();
      setContext(TestCtx, "inherited-val");

      onError((err) => {
        caughtError = err;
        return true; // handled
      });

      // Child root with detachedParent = parentOwner
      createRoot((childDispose) => {
        innerDispose = childDispose;
        resolvedCtxValue = useContext(TestCtx);

        onCleanup(() => {
          innerCleanupRan = true;
        });

        // Trigger error routing from inner root
        routeError(getOwner(), new Error("error-from-inner-root"));
      }, parentOwner);

      // Verify child root is NOT added to parent's children
      if (parentOwner.children) {
        assert.equal(parentOwner.children.size, 0, "Detached child root must NOT be added to parent.children");
      }
    });

    // 1. Context was inherited
    assert.equal(resolvedCtxValue, "inherited-val", "Should inherit context from detachedParent");

    // 2. Error routing routed to detachedParent
    assert.ok(caughtError, "Error should route upward to detachedParent's onError handler");
    assert.equal(caughtError.message, "error-from-inner-root");

    // 3. Disposing parent does NOT dispose the detached root
    outerDispose();
    assert.equal(innerCleanupRan, false, "Parent disposal must not trigger detached root cleanup");

    // 4. Detached root disposes independently
    innerDispose();
    assert.equal(innerCleanupRan, true, "Detached root cleanup runs upon explicit disposal");
  });

  await t.test("T-OW-03: Disposal order: reverse order of children, then LIFO scopeCleanups", () => {
    const order = [];

    createRoot((dispose) => {
      onCleanup(() => order.push("cleanup-1"));
      onCleanup(() => order.push("cleanup-2"));

      // Child 1
      createEffect(() => {
        onCleanup(() => order.push("child-1-cleanup"));
      });

      // Child 2
      createEffect(() => {
        onCleanup(() => order.push("child-2-cleanup"));
      });

      flushSync();

      // Trigger disposal
      dispose();
    });

    // Children in reverse order of creation: child-2 then child-1
    // Then scopeCleanups in LIFO: cleanup-2 then cleanup-1
    assert.deepEqual(
      order,
      ["child-2-cleanup", "child-1-cleanup", "cleanup-2", "cleanup-1"],
      "Disposal must execute children in reverse creation order, then cleanups in LIFO"
    );
  });

  await t.test("T-OW-04: Cleanups continue even if some throw; errors collected in AggregateError", () => {
    let routedError = null;
    const executed = [];

    createRoot((dispose) => {
      onError((err) => {
        routedError = err;
        return true; // handled
      });

      createRoot((innerDispose) => {
        onCleanup(() => {
          executed.push("cleanup-1");
          throw new Error("error-1");
        });
        onCleanup(() => {
          executed.push("cleanup-2");
        });
        onCleanup(() => {
          executed.push("cleanup-3");
          throw new Error("error-3");
        });

        innerDispose();
      });

      dispose();
    });

    // All cleanups must execute regardless of exceptions
    assert.deepEqual(executed, ["cleanup-3", "cleanup-2", "cleanup-1"]);

    // Errors must be aggregated into AggregateError
    assert.ok(routedError instanceof AggregateError, "Multiple cleanup errors must be wrapped in AggregateError");
    assert.equal(routedError.errors.length, 2);
    assert.equal(routedError.errors[0].message, "error-3");
    assert.equal(routedError.errors[1].message, "error-1");
  });

  await t.test("T-OW-05: Error routing walks parent chain; onError handling stops propagation; throwing handler continues with MIX_RT_ERROR_HANDLER_FAILED", () => {
    let uncaught = null;
    configureRuntime({
      onUncaughtError: (err) => {
        uncaught = err;
      }
    });

    // Scenario A: Handled cleanly stops propagation
    let handledA = false;
    createRoot(() => {
      onError((err) => {
        if (err.message === "handled-test") {
          handledA = true;
          return true; // handled
        }
        return false;
      });

      createRoot(() => {
        routeError(getOwner(), new Error("handled-test"));
      });
    });

    assert.equal(handledA, true);
    assert.equal(uncaught, null, "Handled error must not reach onUncaughtError");

    // Scenario B: Throwing handler wraps into MIX_RT_ERROR_HANDLER_FAILED and continues upward
    let outerCaught = null;
    createRoot(() => {
      onError((err) => {
        outerCaught = err;
        return true; // handled at outer root
      });

      createRoot(() => {
        onError(() => {
          throw new Error("handler-exploded");
        });

        createRoot(() => {
          routeError(getOwner(), new Error("original-error"));
        });
      });
    });

    assert.ok(outerCaught instanceof MixError);
    assert.equal(outerCaught.code, "MIX_RT_ERROR_HANDLER_FAILED");
    assert.equal(outerCaught.cause.message, "original-error");

    // Scenario C: Completely unhandled error reaches onUncaughtError
    uncaught = null;
    createRoot((dispose) => {
      routeError(getOwner(), new Error("escaped-error"));
      dispose();
    }, null);

    assert.ok(uncaught);
    assert.equal(uncaught.message, "escaped-error");
  });

  await t.test("R-OW-06: onCleanup outside an owner triggers MIX_RT_NO_OWNER warning", () => {
    let warning = null;
    configureRuntime({
      onWarning: (w) => {
        warning = w;
      }
    });

    onCleanup(() => {});
    assert.ok(warning, "Warning must be emitted when onCleanup is called outside owner");
    assert.equal(warning.code, "MIX_RT_NO_OWNER");
  });

  await t.test("R-OW-07: Computed auto-disposes and disconnects from sources on owner disposal", () => {
    const count = signal(10);
    let comp;

    createRoot((dispose) => {
      comp = computed(() => read(count) * 2);
      assert.equal(read(comp), 20);

      // Verify comp is subscribed to count
      assert.equal(count.observers.size, 1);

      dispose();
    });

    // After owner disposal, computed should be unlinked from sources
    assert.equal(count.observers.size, 0, "Computed observer must be disconnected on owner disposal");
    assert.equal(comp.state, ComputationState.DISPOSED);
  });

  await t.test("R-OW-08: Creating an Effect or onCleanup inside computed throws MIX_RT_OWNER_IN_COMPUTED", () => {
    assert.throws(
      () => {
        const c = computed(() => {
          createEffect(() => {});
          return 42;
        });
        read(c);
      },
      (err) => err instanceof MixError && err.code === "MIX_RT_OWNER_IN_COMPUTED"
    );

    assert.throws(
      () => {
        const c = computed(() => {
          onCleanup(() => {});
          return 42;
        });
        read(c);
      },
      (err) => err instanceof MixError && err.code === "MIX_RT_OWNER_IN_COMPUTED"
    );
  });

  await t.test("R-OW-09: createContext and useContext use unique Symbol keys and climb parent chain", () => {
    const CtxA = createContext("default-A");
    const CtxB = createContext("default-B");

    assert.equal(typeof CtxA.id, "symbol");
    assert.equal(typeof CtxB.id, "symbol");
    assert.notEqual(CtxA.id, CtxB.id);

    createRoot(() => {
      setContext(CtxA, "custom-A");

      createRoot(() => {
        // Inherits CtxA from parent, CtxB falls back to default
        assert.equal(useContext(CtxA), "custom-A");
        assert.equal(useContext(CtxB), "default-B");

        // Overrides CtxA in child
        setContext(CtxA, "override-A");
        assert.equal(useContext(CtxA), "override-A");
      });

      // Outer remains custom-A
      assert.equal(useContext(CtxA), "custom-A");
    });
  });

  await t.test("runWithOwner temporarily binds owner scope and executes fn", () => {
    let captured = null;
    createRoot(() => {
      const owner = getOwner();
      runWithOwner(null, () => {
        assert.equal(getOwner(), null);
      });
      runWithOwner(owner, () => {
        captured = getOwner();
      });
      assert.equal(captured, owner);
    });
  });
});
