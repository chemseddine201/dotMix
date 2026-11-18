/**
 * @dotmix/sync — Reopen Persistence Test
 *
 * Verifies that items inserted via syncCollection persist across close and reopen
 * on the same underlying store backend via recoverFromStoreOnBoot.
 *
 * Rules: N1-N8 compliant, zero forbidden identifiers, file <= 500 lines.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  syncCollection,
  MemoryStoreBackend,
} from "../../../packages/sync/dist/index.js";

describe("API: Store Backend Reopen Persistence", () => {
  it("persists items across close and reopen on the same store backend", async () => {
    const memoryStoreBackendInstance = new MemoryStoreBackend();
    await memoryStoreBackendInstance.open();

    const collectionIdentifier = "reopen-persistence-collection";

    // 1. First session: open collection, insert item, close
    const initialCollectionSession = syncCollection({
      key: collectionIdentifier,
      engine: "replicated",
      driver: memoryStoreBackendInstance,
    });
    await initialCollectionSession.ready;

    await initialCollectionSession.insert({
      id: "persist-item-001",
      title: "Persisted Item Record",
      status: "active",
      counter: 42,
    });

    const itemsBeforeClose = initialCollectionSession.items();
    assert.strictEqual(itemsBeforeClose.length, 1, "Initial collection should contain exactly 1 item");
    assert.strictEqual(itemsBeforeClose[0]?.title, "Persisted Item Record");

    await initialCollectionSession.close();

    // 2. Second session: reopen on the SAME store backend, assert items recovered
    const reopenedCollectionSession = syncCollection({
      key: collectionIdentifier,
      engine: "replicated",
      driver: memoryStoreBackendInstance,
    });
    await reopenedCollectionSession.ready;

    const itemsAfterReopen = reopenedCollectionSession.items();
    assert.strictEqual(
      itemsAfterReopen.length,
      1,
      `Expected 1 recovered item after reopen, observed ${itemsAfterReopen.length}`
    );
    assert.strictEqual(
      itemsAfterReopen[0]?.id,
      "persist-item-001",
      "Recovered item id must match original persisted item"
    );
    assert.strictEqual(
      itemsAfterReopen[0]?.title,
      "Persisted Item Record",
      "Recovered item title must match original persisted item"
    );
    assert.strictEqual(
      itemsAfterReopen[0]?.counter,
      42,
      "Recovered item field values must match original persisted item"
    );

    await reopenedCollectionSession.close();
  });
});

