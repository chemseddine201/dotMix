import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  revalidateFencingAndMembership,
  runTx1LocalAllocation,
  runTx2RemoteDrain,
} from "../../../packages/sync/dist/storage/idb-tx.js";
import { MemoryStoreBackend } from "../../../packages/sync/dist/storage/memory-backend.js";

describe("T-33.6 / Fencing and Revalidation Invariants (AUD-D1..AUD-D4)", () => {
  it("AUD-D1: rejects operation if author signing key is revoked", async () => {
    const meta = {
      epochNumber: 1,
      revokedKeyIds: ["key:bad-actor:v1", "key:compromised:v1"],
      epochMemberBindings: {
        "replica-A": { authorKeyId: "key:A:v1" },
        "replica-B": { authorKeyId: "key:compromised:v1" },
      },
    };

    const check = revalidateFencingAndMembership(meta, {
      authorKeyId: "key:compromised:v1",
      authorReplicaId: "replica-B",
      expectedEpochNumber: 1,
    });

    assert.equal(check.ok, false);
    assert.equal(check.code, "D137_KEY_REVOKED");

    // Enforce inside write transaction
    const backend = new MemoryStoreBackend();
    await backend.open();

    await assert.rejects(
      async () => {
        await runTx2RemoteDrain(backend, async (tx) => {
          const validation = revalidateFencingAndMembership(meta, {
            authorKeyId: "key:compromised:v1",
            authorReplicaId: "replica-B",
            expectedEpochNumber: 1,
          });
          if (!validation.ok) {
            tx.abort();
            throw new Error(`REJECTED: ${validation.code}`);
          }
          await tx.put("entries_state", "item1", { data: "corrupted" });
        });
      },
      /REJECTED: D137_KEY_REVOKED/
    );

    // Verify nothing became durable
    await runTx1LocalAllocation(backend, async (tx) => {
      const val = await tx.get("entries_state", "item1");
      assert.equal(val, undefined);
    });

    await backend.close();
  });

  it("AUD-D2: rejects operation if epoch transitioned during verification", async () => {
    const meta = {
      epochNumber: 2, // Current epoch moved to 2
      revokedKeyIds: [],
    };

    const check = revalidateFencingAndMembership(meta, {
      expectedEpochNumber: 1, // Op was signed in epoch 1
    });

    assert.equal(check.ok, false);
    assert.equal(check.code, "D137_EPOCH_MISMATCH");

    const backend = new MemoryStoreBackend();
    await backend.open();

    await assert.rejects(
      async () => {
        await runTx2RemoteDrain(backend, async (tx) => {
          const validation = revalidateFencingAndMembership(meta, { expectedEpochNumber: 1 });
          if (!validation.ok) {
            tx.abort();
            throw new Error(`REJECTED: ${validation.code}`);
          }
        });
      },
      /REJECTED: D137_EPOCH_MISMATCH/
    );

    await backend.close();
  });

  it("AUD-D3: rejects operation if author removed from membership or key rotated", async () => {
    const meta = {
      epochNumber: 1,
      epochMemberBindings: {
        "replica-A": { authorKeyId: "key:A:v2" }, // Rotated to v2!
      },
    };

    // Stale op verified against old v1 key binding
    const checkRotated = revalidateFencingAndMembership(meta, {
      authorReplicaId: "replica-A",
      authorKeyId: "key:A:v1",
    });
    assert.equal(checkRotated.ok, false);
    assert.equal(checkRotated.code, "D137_MEMBER_KEY_SUPERSEDED");

    // Removed member
    const checkRemoved = revalidateFencingAndMembership(meta, {
      authorReplicaId: "replica-X",
      authorKeyId: "key:X:v1",
    });
    assert.equal(checkRemoved.ok, false);
    assert.equal(checkRemoved.code, "D137_MEMBER_KEY_SUPERSEDED");
  });

  it("AUD-D4: rejects local write if tab lease was taken over during local signing", async () => {
    const meta = {
      leaseHolderTabId: "tab-new-primary",
      leaseFencingTerm: 2,
    };

    // Stale tab write with term 1
    const checkStale = revalidateFencingAndMembership(meta, {
      tabId: "tab-old-primary",
      leaseFencingTerm: 1,
    });

    assert.equal(checkStale.ok, false);
    assert.equal(checkStale.code, "D137_FENCE_FAILED");

    const backend = new MemoryStoreBackend();
    await backend.open();

    await assert.rejects(
      async () => {
        await runTx1LocalAllocation(backend, async (tx) => {
          const validation = revalidateFencingAndMembership(meta, {
            tabId: "tab-old-primary",
            leaseFencingTerm: 1,
          });
          if (!validation.ok) {
            tx.abort();
            throw new Error(`REJECTED: ${validation.code}`);
          }
          await tx.put("entries_state", "stale-item", { value: "invalid" });
        });
      },
      /REJECTED: D137_FENCE_FAILED/
    );

    // Verify nothing became durable
    await runTx1LocalAllocation(backend, async (tx) => {
      const val = await tx.get("entries_state", "stale-item");
      assert.equal(val, undefined);
    });

    await backend.close();
  });
});
