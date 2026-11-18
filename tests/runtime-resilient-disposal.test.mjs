/**
 * Permanent Regression Test Suite: Resilient Runtime Owner Disposal (FINDING-RUNTIME-01)
 *
 * Verifies:
 * 1. Three cleanups in LIFO order; middle cleanup throws; all three execute
 * 2. Multiple cleanups throw; all cleanups execute; all errors are preserved in AggregateError
 * 3. Child owner throws during disposal; sibling children and parent cleanups still execute
 * 4. Nested child-owner tree with errors at multiple depths disposes all nodes
 * 5. Repeated disposeOwner() call is idempotent and does not re-run callbacks
 * 6. Re-entrant disposal call from within a cleanup does not corrupt state or re-run
 * 7. Normal disposal without errors preserves exact LIFO order and does not throw
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  createRoot,
  onCleanup,
  createEffect
} from "../node_modules/@dotmix/runtime/dist/index.js";

describe(": Resilient Runtime Owner Disposal (FINDING-RUNTIME-01)", () => {
  test("1. Three cleanups in LIFO order: middle throws, all three execute", () => {
    const executed = [];
    let caughtError = null;

    try {
      createRoot((dispose) => {
        onCleanup(() => executed.push("cleanup-1"));
        onCleanup(() => {
          executed.push("cleanup-2");
          throw new Error("Deliberate failure in cleanup-2");
        });
        onCleanup(() => executed.push("cleanup-3"));

        dispose();
      });
    } catch (err) {
      caughtError = err;
    }

    // Must be in reverse registration order (LIFO: 3, 2, 1)
    assert.deepStrictEqual(executed, ["cleanup-3", "cleanup-2", "cleanup-1"], "All 3 cleanups must execute in LIFO order despite error");
    assert.ok(caughtError, "Error must be rethrown after all cleanups finish");
    assert.ok(caughtError instanceof AggregateError, "Error should be AggregateError");
    assert.strictEqual(caughtError.errors.length, 1);
    assert.strictEqual(caughtError.errors[0].message, "Deliberate failure in cleanup-2");
  });

  test("2. Multiple cleanups throw: all cleanups execute, all errors preserved in AggregateError", () => {
    const executed = [];
    let caughtError = null;

    try {
      createRoot((dispose) => {
        onCleanup(() => {
          executed.push("c1");
          throw new Error("Error in c1");
        });
        onCleanup(() => executed.push("c2"));
        onCleanup(() => {
          executed.push("c3");
          throw new Error("Error in c3");
        });

        dispose();
      });
    } catch (err) {
      caughtError = err;
    }

    assert.deepStrictEqual(executed, ["c3", "c2", "c1"]);
    assert.ok(caughtError instanceof AggregateError);
    assert.strictEqual(caughtError.errors.length, 2);
    assert.strictEqual(caughtError.errors[0].message, "Error in c3");
    assert.strictEqual(caughtError.errors[1].message, "Error in c1");
  });

  test("3. Child owner throws during disposal: sibling child and parent cleanups still execute", () => {
    const executed = [];
    let caughtError = null;

    try {
      createRoot((disposeParent) => {
        // Child 1 (attached via createEffect)
        createEffect(() => {
          onCleanup(() => {
            executed.push("child1-cleanup");
            throw new Error("Child 1 exploded");
          });
        });

        // Child 2 (attached via createEffect)
        createEffect(() => {
          onCleanup(() => executed.push("child2-cleanup"));
        });

        onCleanup(() => executed.push("parent-cleanup"));

        disposeParent();
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(executed.includes("child1-cleanup"));
    assert.ok(executed.includes("child2-cleanup"), "Sibling child2 must execute even though child1 threw");
    assert.ok(executed.includes("parent-cleanup"), "Parent cleanup must execute even though child1 threw");
    assert.ok(caughtError instanceof AggregateError);
    assert.strictEqual(caughtError.errors.length, 1);
    assert.strictEqual(caughtError.errors[0].message, "Child 1 exploded");
  });

  test("4. Multi-level nested tree with errors at multiple depths executes all teardowns", () => {
    const executed = [];
    let caughtError = null;

    try {
      createRoot((disposeRoot) => {
        // Depth 1 - A
        createEffect(() => {
          // Depth 2 - A1
          createEffect(() => {
            onCleanup(() => {
              executed.push("deep-A1");
              throw new Error("Error at deep-A1");
            });
          });
          onCleanup(() => executed.push("mid-A"));
        });

        // Depth 1 - B
        createEffect(() => {
          onCleanup(() => {
            executed.push("mid-B");
            throw new Error("Error at mid-B");
          });
        });

        onCleanup(() => executed.push("root-cleanup"));

        disposeRoot();
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(executed.includes("deep-A1"));
    assert.ok(executed.includes("mid-A"));
    assert.ok(executed.includes("mid-B"));
    assert.ok(executed.includes("root-cleanup"));
    assert.ok(caughtError instanceof AggregateError);
    assert.strictEqual(caughtError.errors.length, 2);
  });

  test("5. Repeated disposeOwner() call is idempotent and does not re-run callbacks", () => {
    let runCount = 0;
    createRoot((dispose) => {
      onCleanup(() => runCount++);
      dispose();
      dispose(); // second call
      dispose(); // third call
    });

    assert.strictEqual(runCount, 1, "Cleanup callback must only execute once");
  });

  test("6. Re-entrant disposal call from within a cleanup does not corrupt state or re-run", () => {
    let runCount = 0;
    createRoot((dispose) => {
      onCleanup(() => {
        runCount++;
        dispose(); // Re-entrant call while disposal is in progress
      });
      dispose();
    });

    assert.strictEqual(runCount, 1, "Re-entrant call must be a no-op");
  });

  test("7. Normal disposal without errors preserves exact LIFO order and does not throw", () => {
    const executed = [];
    createRoot((dispose) => {
      onCleanup(() => executed.push("first-registered"));
      onCleanup(() => executed.push("second-registered"));
      onCleanup(() => executed.push("third-registered"));
      dispose();
    });

    assert.deepStrictEqual(executed, [
      "third-registered",
      "second-registered",
      "first-registered"
    ]);
  });
});
