import test from "node:test";
import assert from "node:assert/strict";

import {
  signal,
  createEffect,
  createRoot,
  onCleanup,
  flushQueue,
  Owner,
  ReactiveCycleError,
  defaultSchedulerOptions
} from "../../packages/runtime/dist/index.js";

test("D-101: Deferred Rerun, Deduplication, and Non-Nested Execution", () => {
  const count = signal(0);
  const log = [];

  createRoot((dispose) => {
    createEffect(() => {
      const val = count();
      log.push(`run:${val}`);

      // Self-trigger write during run
      if (val === 1) {
        // This should not run recursively; it sets pendingRerun = true
        count.set(2);
        log.push("after-set");
      }
    });

    // Initial run
    assert.deepEqual(log, ["run:0"]);

    // Write triggering deferred rerun
    count.set(1);
    flushQueue();

    // Verification:
    // "run:1" runs to completion, writes 2 (setting pendingRerun), logs "after-set",
    // then non-nested rerun runs with "run:2"
    assert.deepEqual(log, ["run:0", "run:1", "after-set", "run:2"]);

    dispose();
  });
});

test("D-101: Runaway Cycle Detection throws ReactiveCycleError", () => {
  assert.throws(
    () => {
      createRoot((dispose) => {
        const loopSignal = signal(0);
        createEffect(() => {
          // Infinite loop: effect unconditionally mutates its own dependency
          loopSignal.set(loopSignal() + 1);
        });
        dispose();
      });
    },
    (err) => {
      return (
        err instanceof ReactiveCycleError &&
        err.message.includes("Exceeded maximum effect iterations")
      );
    }
  );
});

test("D-102: Owner Teardown Decoupling & Computation Disposal", () => {
  const count = signal(10);
  let runCount = 0;
  let cleanedUp = false;

  let disposeRoot;
  createRoot((dispose) => {
    disposeRoot = dispose;

    createEffect(() => {
      count();
      runCount++;
    });

    onCleanup(() => {
      cleanedUp = true;
    });
  });

  assert.equal(runCount, 1);
  assert.equal(cleanedUp, false);

  // Trigger update before disposal
  count.set(20);
  flushQueue();
  assert.equal(runCount, 2);

  // Dispose root
  disposeRoot();
  assert.equal(cleanedUp, true);

  // Subsequent writes must NOT execute disposed computations
  count.set(30);
  flushQueue();
  assert.equal(runCount, 2); // Unchanged
});

test("D-103: createRoot with detachedParent", () => {
  const parentOwner = new Owner(null);
  let rootCleanedUp = false;

  const disposeChild = createRoot((dispose) => {
    onCleanup(() => {
      rootCleanedUp = true;
    });
    return dispose;
  }, parentOwner);

  // Disposing parentOwner does NOT automatically dispose detached root
  parentOwner.dispose();
  assert.equal(rootCleanedUp, false, "Detached root should not be disposed by parentOwner");

  // Disposing child root directly cleans it up
  disposeChild();
  assert.equal(rootCleanedUp, true, "Detached root disposes on explicit dispose call");
});

