import test from "node:test";
import assert from "node:assert/strict";

import {
  signal,
  createEffect,
  read,
  write,
  batch,
  flushSync,
  disposeNode
} from "../../packages/runtime/dist/core/index.js";

test("Phase 1A / §9.1 Conformance Tests (T-RX-13..17)", async (t) => {
  await t.test("batch coalesces multiple writes into a single effect run (T-RX-13)", () => {
    const s1 = signal(0);
    const s2 = signal(0);
    const s3 = signal(0);
    let runs = 0;

    createEffect(() => {
      read(s1);
      read(s2);
      read(s3);
      runs++;
    });
    flushSync();
    assert.equal(runs, 1);

    batch(() => {
      write(s1, 1);
      write(s2, 2);
      write(s3, 3);
    });

    flushSync();
    assert.equal(runs, 2, "Effect should run exactly once for all 3 batched writes");
    assert.equal(read(s1), 1);
    assert.equal(read(s2), 2);
    assert.equal(read(s3), 3);
  });

  await t.test("nested batch defers flush until outermost batch exits (R-RX-12)", () => {
    const s = signal(0);
    let runs = 0;

    createEffect(() => {
      read(s);
      runs++;
    });
    flushSync();
    assert.equal(runs, 1);

    batch(() => {
      write(s, 10);
      batch(() => {
        write(s, 20);
      });
      // Outer batch has not finished yet
      assert.equal(runs, 1, "Effect must not run before outermost batch exits");
    });

    flushSync();
    assert.equal(runs, 2);
    assert.equal(read(s), 20);
  });

  await t.test("equals: false propagates updates even for identical values (T-RX-16)", () => {
    const s = signal(42, false); // equals: false
    let runs = 0;

    createEffect(() => {
      read(s);
      runs++;
    });
    flushSync();
    assert.equal(runs, 1);

    write(s, 42); // Same value!
    flushSync();
    assert.equal(runs, 2, "With equals: false, write of identical value must trigger observers");
  });

  await t.test("disposed effect in queue is skipped and does not run (T-RX-17)", () => {
    const s = signal(1);
    let runs = 0;

    const e = createEffect(() => {
      read(s);
      runs++;
    });
    flushSync();
    assert.equal(runs, 1);

    write(s, 2); // Queues effect
    disposeNode(e); // Dispose before flush occurs
    flushSync();

    assert.equal(runs, 1, "Disposed effect in queue must not run");
  });
});
