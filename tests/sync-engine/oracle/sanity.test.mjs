import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReplicationEngine as RefEngine } from "../../../tools/sync-reference/dist/engine.js";
import { ReplicationEngine as ProdEngine, visibleDigest, entriesDigest } from "../../../packages/sync/dist/protocol/index.js";

describe("Sanity check imports", () => {
  it("Both engines import successfully", () => {
    assert.equal(typeof RefEngine, "function");
    assert.equal(typeof ProdEngine, "function");
    assert.equal(typeof visibleDigest, "function");
    assert.equal(typeof entriesDigest, "function");
  });
});

