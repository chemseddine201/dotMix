import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runTx1LocalAllocation,
} from "../../../packages/sync/dist/storage/idb-tx.js";
import { MemoryStoreBackend } from "../../../packages/sync/dist/storage/memory-backend.js";

describe(" Risk D-2 / Transaction Abort Consistency", () => {
  it("aborts the main write transaction midway and proves recovery restores a consistent state", async () => {
    const backend = new MemoryStoreBackend();
    await backend.open();

    // 1. Establish consistent baseline state
    await runTx1LocalAllocation(backend, async (tx) => {
      await tx.put("entries_state", "account:1", { balance: 500 });
      await tx.put("entries_state", "account:2", { balance: 300 });
      await tx.put("mutation_journal", "op:1", { kind: "init", delta: 800 });
      await tx.put("operation_digests", "op:1", { hash: "baseline-digest" });
    });

    // Verify baseline
    await runTx1LocalAllocation(backend, async (tx) => {
      const a1 = await tx.get("entries_state", "account:1");
      const a2 = await tx.get("entries_state", "account:2");
      assert.deepEqual(a1, { balance: 500 });
      assert.deepEqual(a2, { balance: 300 });
    });

    // 2. Set crash injection hook to trigger midway through the write transaction
    // After mutating account:1 and writing mutation_journal, crash on account:2
    backend.setCrashInjectionHook((store, op, key) => {
      if (store === "entries_state" && op === "put" && key === "account:2") {
        return true; // Crash injected!
      }
      return false;
    });

    // 3. Attempt multi-step transfer transaction that mutates multiple stores
    await assert.rejects(
      async () => {
        await runTx1LocalAllocation(backend, async (tx) => {
          // Debit account 1: 500 -> 400
          await tx.put("entries_state", "account:1", { balance: 400 });
          // Write journal record
          await tx.put("mutation_journal", "op:2", { kind: "transfer", from: "1", to: "2", amt: 100 });
          // Write digest
          await tx.put("operation_digests", "op:2", { hash: "transfer-digest" });
          // Credit account 2: 300 -> 400 (This triggers the crash hook and aborts midway)
          await tx.put("entries_state", "account:2", { balance: 400 });
        });
      },
      (err) => {
        assert(err.message.includes("CRASH_INJECTED"));
        return true;
      }
    );

    backend.clearCrashInjectionHook();

    // 4. Verify ACID recovery restores the exact consistent baseline state:
    // - account:1 was NOT debited (rolled back from 400 to 500)
    // - account:2 was NOT credited (remains 300)
    // - op:2 was NOT written to mutation_journal (remains only op:1)
    // - op:2 was NOT written to operation_digests
    await runTx1LocalAllocation(backend, async (tx) => {
      const a1 = await tx.get("entries_state", "account:1");
      const a2 = await tx.get("entries_state", "account:2");
      const journalOp2 = await tx.get("mutation_journal", "op:2");
      const digestOp2 = await tx.get("operation_digests", "op:2");

      assert.deepEqual(a1, { balance: 500 }, "account:1 must be rolled back to 500");
      assert.deepEqual(a2, { balance: 300 }, "account:2 must remain 300");
      assert.equal(journalOp2, undefined, "op:2 must not exist in mutation_journal");
      assert.equal(digestOp2, undefined, "op:2 must not exist in operation_digests");
    });

    await backend.close();
  });
});
