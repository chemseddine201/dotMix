import test from "node:test";
import assert from "node:assert/strict";
import {
  signal,
  computed,
  createEffect,
  batch,
  createRoot,
  onCleanup,
  createContext,
  setContext,
  getContext,
  getCurrentOwner,
  configureScheduler,
  ReactiveCycleError,
  createCancellationSource,
  createResource,
  OwnerState
} from "../../packages/runtime/dist/core/index.js";
import { toAbortSignal, fromAbortSignal } from "../../packages/runtime/dist/platform/index.js";
import { MixError, DiagnosticCodes } from "../../packages/runtime/dist/errors.js";

test("Gate 4 (T-RX-01..04): Diamond dependency graph evaluates Glitch-Free with single effect run and lazy validation break", () => {
  const log = [];
  let cRuns = 0;

  createRoot(dispose => {
    const a = signal(1);
    const b = computed(() => a() * 2);
    const c = computed(() => {
      cRuns++;
      return a() * 3;
    });
    const d = computed(() => `${b()}-${c()}`);

    createEffect(() => {
      log.push(d());
    });

    assert.deepStrictEqual(log, ["2-3"]);
    assert.strictEqual(cRuns, 1);

    a.set(2);
    // Effect runs exactly once for the diamond update, never observing intermediate '4-3'
    assert.deepStrictEqual(log, ["2-3", "4-6"]);
    assert.strictEqual(cRuns, 2);

    dispose();
  });
});

test("Gate 4 (D-101, T-RX-05..07): Effect writes trigger non-nested deferred rerun and coalesce multiple writes", () => {
  const trace = [];

  createRoot(dispose => {
    const count = signal(0);
    const step = signal(1);

    createEffect(() => {
      const c = count();
      const s = step();
      trace.push(`start:${c}:${s}`);
      if (c === 0) {
        // Write to both dependencies during RUNNING: must NOT recurse synchronously,
        // and must coalesce into a single deferred rerun after 'end:0:1'!
        count.set(1);
        step.set(10);
      }
      trace.push(`end:${c}:${s}`);
    });

    assert.deepStrictEqual(trace, [
      "start:0:1",
      "end:0:1",
      "start:1:10",
      "end:1:10"
    ]);

    dispose();
  });
});

test("Gate 4 (R-RX-05): Immediate subscription on first read catches write later in the same effect run", () => {
  const runs = [];

  createRoot(dispose => {
    const gate = signal(true);
    const dynamicSig = signal(0);

    createEffect(() => {
      if (gate()) {
        const val = dynamicSig();
        runs.push(val);
        if (val === 0) {
          // Because R-RX-05 subscribes dynamicSig immediately on read, this write schedules a rerun!
          dynamicSig.set(42);
        }
      }
    });

    assert.deepStrictEqual(runs, [0, 42]);
    dispose();
  });
});

test("Gate 4 (D-101, R-RX-06, I-5): Runaway cycle ceiling throws ReactiveCycleError while preserving sibling queue, and Computed write is forbidden", () => {
  configureScheduler({ maxEffectIterations: 25 });
  try {
    createRoot(dispose => {
      const a = signal(0);
      const b = signal(0);
      let siblingRan = false;

      createEffect(() => {
        if (b() > 0) {
          siblingRan = true;
        }
      });

      assert.throws(
        () => {
          batch(() => {
            b.set(1);
            createEffect(() => {
              a.set(a() + 1);
            });
          });
        },
        err => err instanceof ReactiveCycleError && err.code === DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE
      );

      assert.strictEqual(siblingRan, true, "Sibling effect in queue must still execute when another effect hits cycle ceiling");

      // I-5: Writing to a Signal inside a Computed must throw
      const badMemo = computed(() => {
        a.set(999);
        return a();
      });
      assert.throws(
        () => badMemo(),
        err => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE
      );

      dispose();
    });
  } finally {
    configureScheduler({ maxEffectIterations: 1000 });
  }
});

test("Gate 4 (D-102, D-103, T-OW-01..05): Owner disposal unlinks computations/cleanups and detachedParent inherits context without auto-disposal", () => {
  const ThemeCtx = createContext("light");
  let detachedEffectRuns = 0;
  let childEffectRuns = 0;
  const cleanupsCalled = [];

  let disposeDetached;
  const s = signal(0);

  createRoot(disposeParent => {
    setContext(ThemeCtx, "dark");
    const parentOwner = getCurrentOwner();

    createEffect(() => {
      s();
      childEffectRuns++;
      onCleanup(() => cleanupsCalled.push("child-cleanup"));
    });

    // Create a detached root that inherits ThemeCtx from parentOwner
    createRoot(disposeInner => {
      disposeDetached = disposeInner;
      assert.strictEqual(getContext(ThemeCtx), "dark");
      createEffect(() => {
        s();
        detachedEffectRuns++;
        onCleanup(() => cleanupsCalled.push("detached-cleanup"));
      });
    }, parentOwner);

    assert.strictEqual(childEffectRuns, 1);
    assert.strictEqual(detachedEffectRuns, 1);

    // Disposing parent must dispose childEffect, but leave detachedRoot alive (D-103)!
    disposeParent();
    assert.strictEqual(parentOwner.ownerState, OwnerState.DISPOSED);
    assert.deepStrictEqual(cleanupsCalled, ["child-cleanup"]);
  });

  // Mutating s after parent disposal must ONLY trigger detachedEffect, not disposed childEffect!
  s.set(1);
  assert.strictEqual(childEffectRuns, 1);
  assert.strictEqual(detachedEffectRuns, 2);
  assert.deepStrictEqual(cleanupsCalled, ["child-cleanup", "detached-cleanup"]);

  disposeDetached();
  assert.deepStrictEqual(cleanupsCalled, ["child-cleanup", "detached-cleanup", "detached-cleanup"]);

  s.set(2);
  assert.strictEqual(detachedEffectRuns, 2);
});

test("Gate 4 (D-104, R-CX-01..09): CancellationToken, generation-checked createResource stale suppression, and AbortSignal bridges", async () => {
  const src = createCancellationSource(null);
  assert.strictEqual(src.token.isCancelled, false);
  assert.strictEqual(src.token.aborted, false);

  const abortSig = toAbortSignal(src.token);
  assert.strictEqual(abortSig, toAbortSignal(src.token), "toAbortSignal must be cached via WeakMap");
  assert.strictEqual(abortSig.aborted, false);

  let cancelCount = 0;
  const unsub = src.token.onCancelled(() => {
    cancelCount++;
  });
  unsub();
  unsub(); // R-CX-05 idempotent unsubscribe

  let keptReason = null;
  src.token.onCancelled(r => {
    keptReason = r;
  });

  src.cancel("USER_ABORT");
  src.cancel("SECOND_IGNORED"); // R-CX-03 idempotent cancel
  assert.strictEqual(cancelCount, 0);
  assert.strictEqual(keptReason, "USER_ABORT");
  assert.strictEqual(src.token.isCancelled, true);
  assert.strictEqual(abortSig.aborted, true);
  assert.throws(() => src.token.throwIfAborted(), /USER_ABORT/);

  // fromAbortSignal bridge
  const domCtrl = new globalThis.AbortController();
  const bridgedToken = fromAbortSignal(domCtrl.signal);
  assert.strictEqual(bridgedToken.isCancelled, false);
  domCtrl.abort("DOM_REASON");
  assert.strictEqual(bridgedToken.isCancelled, true);

  // Generation-checked createResource: stale request 1 resolves AFTER request 2 and must be ignored!
  let resolveFirst;
  let resolveSecond;
  let firstToken;

  let resource;
  createRoot(() => {
    resource = createResource(({ token, generation }) => {
      if (generation === 1) {
        firstToken = token;
        return new Promise(r => {
          resolveFirst = r;
        });
      }
      return new Promise(r => {
        resolveSecond = r;
      });
    }, "initial");
  });

  const p1 = resource.reload();
  assert.strictEqual(resource.loading(), true);
  assert.strictEqual(firstToken.isCancelled, false);

  // Start second request before first finishes -> supersedes first with MIX_RT_SUPERSEDED (R-CX-09)
  const p2 = resource.reload();
  assert.strictEqual(firstToken.isCancelled, true);
  assert.strictEqual(firstToken.reason, "MIX_RT_SUPERSEDED");

  // Resolve second request first, then resolve stale first request
  resolveSecond("fresh-data-gen-2");
  await p2;
  assert.strictEqual(resource.data(), "fresh-data-gen-2");
  assert.strictEqual(resource.loading(), false);

  resolveFirst("stale-data-gen-1");
  await p1;
  // Stale result from generation 1 must be completely suppressed!
  assert.strictEqual(resource.data(), "fresh-data-gen-2");
});
