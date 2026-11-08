import test from "node:test";
import assert from "node:assert/strict";

import {
  createCancellationTokenSource,
  neverCancelledToken,
  configureRuntime,
  MixError
} from "../../packages/runtime/dist/core/index.js";

import {
  toAbortSignal,
  fromAbortSignal
} from "../../packages/runtime/dist/platform/index.js";

test("Phase 2 — Cancellation Tests (§3 / T-CX-01..06)", async (t) => {
  t.beforeEach(() => {
    configureRuntime({
      onUncaughtError: (_err) => {},
      onWarning: (_w) => {}
    });
  });

  await t.test("T-CX-01: abort() is idempotent; calling twice does not change reason or recall listeners", () => {
    const source = createCancellationTokenSource();
    let calls = 0;
    let receivedReason = null;

    source.token.subscribe((r) => {
      calls++;
      receivedReason = r;
    });

    assert.equal(source.token.aborted, false);

    // First abort
    source.abort("custom-reason");
    assert.equal(source.token.aborted, true);
    assert.equal(calls, 1);
    assert.equal(receivedReason, "custom-reason");
    assert.equal(source.token.reason, "custom-reason");

    // Second abort with different reason — must do nothing
    source.abort("different-reason");
    assert.equal(calls, 1, "Listeners must not be called again");
    assert.equal(source.token.reason, "custom-reason", "Reason must remain unchanged");
  });

  await t.test("R-CX-02: Default reason when abort() called with no argument", () => {
    const source = createCancellationTokenSource();
    source.abort();

    assert.equal(source.token.aborted, true);
    assert.ok(source.token.reason instanceof MixError);
    assert.equal(source.token.reason.code, "MIX_RT_ABORTED");
  });

  await t.test("T-CX-02: subscribe after abort calls listener immediately & synchronously", () => {
    const source = createCancellationTokenSource();
    source.abort("early-abort");

    let called = false;
    let reason = null;

    const unsub = source.token.subscribe((r) => {
      called = true;
      reason = r;
    });

    assert.equal(called, true, "Listener must be called immediately and synchronously");
    assert.equal(reason, "early-abort");

    // Unsubscribe after abort is a safe no-op
    assert.doesNotThrow(() => {
      unsub();
      unsub();
    });
  });

  await t.test("T-CX-03: Throwing listener does not abort dispatch; errors routed to onUncaughtError", () => {
    const source = createCancellationTokenSource();
    const uncaughtErrors = [];

    configureRuntime({
      onUncaughtError: (err) => {
        uncaughtErrors.push(err);
      }
    });

    const calls = [];

    source.token.subscribe(() => {
      calls.push("listener-1");
      throw new Error("listener-1-failed");
    });

    source.token.subscribe(() => {
      calls.push("listener-2");
    });

    source.token.subscribe(() => {
      calls.push("listener-3");
      throw new Error("listener-3-failed");
    });

    source.abort("test-abort");

    // All listeners must be called
    assert.deepEqual(calls, ["listener-1", "listener-2", "listener-3"]);

    // Thrown errors must reach onUncaughtError after dispatch completes
    assert.equal(uncaughtErrors.length, 2);
    assert.equal(uncaughtErrors[0].message, "listener-1-failed");
    assert.equal(uncaughtErrors[1].message, "listener-3-failed");
  });

  await t.test("T-CX-04: Listener unsubscribed during dispatch before its turn is NOT called", () => {
    const source = createCancellationTokenSource();
    const calls = [];
    let unsub2;

    source.token.subscribe(() => {
      calls.push("listener-1");
      // Unsubscribe listener-2 before its turn arrives
      unsub2();
    });

    unsub2 = source.token.subscribe(() => {
      calls.push("listener-2");
    });

    source.token.subscribe(() => {
      calls.push("listener-3");
    });

    source.abort();

    assert.deepEqual(calls, ["listener-1", "listener-3"], "Unsubscribed listener-2 must not be invoked");
  });

  await t.test("T-CX-05: Unsubscribe is idempotent", () => {
    const source = createCancellationTokenSource();
    let calls = 0;

    const unsub = source.token.subscribe(() => {
      calls++;
    });

    // Calling unsub multiple times must be safe
    unsub();
    unsub();
    unsub();

    source.abort();
    assert.equal(calls, 0);
  });

  await t.test("T-CX-06: Bidirectional conversion toAbortSignal & fromAbortSignal", () => {
    // 1. CancellationToken -> AbortSignal
    const source = createCancellationTokenSource();
    const signal = toAbortSignal(source.token);

    assert.ok(signal instanceof AbortSignal, "Must produce an AbortSignal instance");
    assert.equal(signal.aborted, false);

    // WeakMap caching: same token produces identical signal
    const signalCached = toAbortSignal(source.token);
    assert.equal(signal, signalCached, "toAbortSignal must be cached via WeakMap");

    // Reverse conversion: fromAbortSignal on that signal produces the original token!
    const backToToken = fromAbortSignal(signal);
    assert.equal(backToToken, source.token, "fromAbortSignal(toAbortSignal(token)) must preserve identity");

    // Aborting source aborts signal synchronously
    source.abort("network-cancelled");
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason, "network-cancelled");

    // Already aborted token produces already aborted signal
    const source2 = createCancellationTokenSource();
    source2.abort("pre-aborted");
    const signal2 = toAbortSignal(source2.token);
    assert.equal(signal2.aborted, true);
    assert.equal(signal2.reason, "pre-aborted");

    // 2. AbortSignal -> CancellationToken
    const controller = new AbortController();
    const tokenFromSig = fromAbortSignal(controller.signal);

    assert.equal(tokenFromSig.aborted, false);

    // WeakMap caching
    const tokenCached = fromAbortSignal(controller.signal);
    assert.equal(tokenFromSig, tokenCached, "fromAbortSignal must be cached via WeakMap");

    // Reverse conversion preserves identity
    const backToSignal = toAbortSignal(tokenFromSig);
    assert.equal(backToSignal, controller.signal, "toAbortSignal(fromAbortSignal(signal)) must preserve identity");

    // Aborting controller aborts token
    controller.abort("abort-from-controller");
    assert.equal(tokenFromSig.aborted, true);
    assert.equal(tokenFromSig.reason, "abort-from-controller");
  });

  await t.test("neverCancelledToken contract", () => {
    assert.equal(neverCancelledToken.aborted, false);
    assert.equal(neverCancelledToken.reason, undefined);

    assert.doesNotThrow(() => {
      neverCancelledToken.throwIfAborted();
    });

    const unsub = neverCancelledToken.subscribe(() => {
      assert.fail("neverCancelledToken listeners must never be called");
    });
    assert.equal(typeof unsub, "function");
    unsub();
  });

  await t.test("throwIfAborted contract", () => {
    const source = createCancellationTokenSource();
    assert.doesNotThrow(() => {
      source.token.throwIfAborted();
    });

    const customErr = new Error("aborted-error");
    source.abort(customErr);

    assert.throws(
      () => {
        source.token.throwIfAborted();
      },
      (err) => err === customErr
    );
  });
});
