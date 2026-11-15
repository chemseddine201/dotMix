import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAMES,
  createMockIDBFactory,
  openDatabase,
} from "../../../packages/sync/dist/storage/idb-schema.js";

describe("T-33.5 / Schema v2 & Non-Destructive Upgrade", () => {
  it("creates all 13 object stores in a fresh database at DB_VERSION=2", async () => {
    const factory = createMockIDBFactory();
    const db = await openDatabase(DB_NAME, DB_VERSION, factory);

    assert.equal(db.version, 2);
    assert.equal(db.objectStoreNames.length, 13);

    for (const name of STORE_NAMES) {
      assert.equal(
        db.objectStoreNames.contains(name),
        true,
        `Expected store ${name} to be created`
      );
    }
  });

  it("non-destructively upgrades from v1 preserving snapshots and mutation_log", async () => {
    const factory = createMockIDBFactory();

    // 1. Initialize v1 database with legacy stores and records
    const v1Req = factory.open(DB_NAME, 1);
    await new Promise((resolve, reject) => {
      v1Req.onupgradeneeded = () => {
        const db = v1Req.result;
        db.createObjectStore("snapshots");
        db.createObjectStore("mutation_log");
      };
      v1Req.onsuccess = resolve;
      v1Req.onerror = reject;
    });

    const v1Db = v1Req.result;
    const v1Tx = v1Db.transaction(["snapshots", "mutation_log"], "readwrite");
    v1Tx.objectStore("snapshots").put({ snapId: "snap-1", state: "legacy-data" }, "snap-1");
    v1Tx.objectStore("mutation_log").put({ idStr: "mut-1", op: "insert" }, "mut-1");

    await new Promise((resolve) => {
      v1Tx.oncomplete = resolve;
    });
    v1Db.close();

    // 2. Open at v2: upgrades non-destructively
    const v2Db = await openDatabase(DB_NAME, 2, factory);

    assert.equal(v2Db.version, 2);
    // Preserves legacy mutation_log store
    assert.equal(v2Db.objectStoreNames.contains("mutation_log"), true);
    // Preserves snapshots store
    assert.equal(v2Db.objectStoreNames.contains("snapshots"), true);

    // Verifies all 13 v2 stores now exist
    for (const name of STORE_NAMES) {
      assert.equal(
        v2Db.objectStoreNames.contains(name),
        true,
        `Expected store ${name} to exist in v2`
      );
    }

    // Verify existing v1 records are preserved
    const checkTx = v2Db.transaction(["snapshots", "mutation_log"], "readonly");
    const snapReq = checkTx.objectStore("snapshots").get("snap-1");
    const mutReq = checkTx.objectStore("mutation_log").get("mut-1");

    await new Promise((resolve) => {
      checkTx.oncomplete = resolve;
    });

    assert.deepEqual(snapReq.result, { snapId: "snap-1", state: "legacy-data" });
    assert.deepEqual(mutReq.result, { idStr: "mut-1", op: "insert" });
  });
});
