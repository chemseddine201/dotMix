import test from "node:test";
import assert from "node:assert/strict";
import {
  registerHmrInstance,
  applyHmrUpdate,
  resetHmrRegistry,
  createTrampoline
} from "../../packages/runtime/dist/hmr/index.js";
import { signal } from "../../packages/runtime/dist/core/index.js";

test("Phase 7 — HMR Subsystem (§8 / T-HMR-01..03)", async (t) => {

  t.afterEach(() => {
    resetHmrRegistry();
  });

  await t.test("T-HMR-01: Trampolines preserve function reference identity across method updates", () => {
    const scope = {
      greet: () => "v1"
    };

    const trampoline = createTrampoline(scope, "greet");

    // Calling trampoline invokes initial version
    assert.equal(trampoline(), "v1");

    // Updating method on scope
    scope.greet = () => "v2";

    // Same trampoline function instance returns updated value
    assert.equal(trampoline(), "v2");
  });

  await t.test("T-HMR-02: Matching signature preserves live reactive state and applies new methods", () => {
    // 1. Initial component record
    const countSignal = signal(5);
    const scope = {
      count: countSignal,
      increment: null
    };

    let renderOutput = "";
    const recordV1 = {
      id: "Counter.mix",
      signature: "sig_count_num",
      methods: (s) => ({
        increment: () => {
          s.count.value += 1;
        }
      }),
      render: (s) => {
        renderOutput = `Count: ${s.count.value}`;
      }
    };

    let remountCalled = false;
    let disposeCalled = false;

    const instance = registerHmrInstance(
      recordV1,
      scope,
      () => { remountCalled = true; },
      () => { disposeCalled = true; }
    );

    recordV1.render(scope);
    assert.equal(renderOutput, "Count: 5");

    // Capture stable trampoline
    const incTrampoline = instance.trampoline("increment");
    incTrampoline();
    assert.equal(countSignal.value, 6);

    // 2. Updated component record with MATCHING signature but different increment (+10)
    const recordV2 = {
      id: "Counter.mix",
      signature: "sig_count_num", // Matching signature
      methods: (s) => ({
        increment: () => {
          s.count.value += 10;
        }
      }),
      render: (s) => {
        renderOutput = `Updated Count: ${s.count.value}`;
      }
    };

    applyHmrUpdate(recordV2);

    // Assert: No remount, no disposal
    assert.equal(remountCalled, false, "Must not remount on matching signature");
    assert.equal(disposeCalled, false, "Must not dispose on matching signature");

    // Assert: Live signal state is preserved
    assert.equal(countSignal.value, 6, "Live signal value preserved");

    // Assert: Render output was re-executed with the preserved live state
    assert.equal(renderOutput, "Updated Count: 6");

    // Assert: Calling the SAME trampoline reference executes updated implementation (+10)
    incTrampoline();
    assert.equal(countSignal.value, 16, "Updated method executed");

    recordV2.render(scope);
    assert.equal(renderOutput, "Updated Count: 16");
  });

  await t.test("T-HMR-03: Mismatched signature triggers full component remount", () => {
    const scope = {
      title: "Initial"
    };

    const recordV1 = {
      id: "Header.mix",
      signature: "sig_v1_title_only",
      methods: () => ({}),
      render: () => {}
    };

    let remountTriggered = false;
    let receivedNextRecord = null;

    registerHmrInstance(
      recordV1,
      scope,
      (next) => {
        remountTriggered = true;
        receivedNextRecord = next;
      },
      () => {}
    );

    // Apply update with DIFFERENT signature (e.g. added new prop/signal)
    const recordV2 = {
      id: "Header.mix",
      signature: "sig_v2_title_and_subtitle", // Changed signature
      methods: () => ({}),
      render: () => {}
    };

    applyHmrUpdate(recordV2);

    assert.equal(remountTriggered, true, "Full remount must be triggered on signature mismatch");
    assert.equal(receivedNextRecord, recordV2);
  });
});
