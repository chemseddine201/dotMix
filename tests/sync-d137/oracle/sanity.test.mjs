import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { D137Engine as RefEngine } from "../../../tools/d137-reference/dist/engine.js";
import { D137Engine as ProdEngine, visibleDigest, entriesDigest } from "../../../packages/sync/dist/protocol/index.js";

describe("Sanity check imports", () => {
  it("Both engines import successfully", () => {
    assert.equal(typeof RefEngine, "function");
    assert.equal(typeof ProdEngine, "function");
    assert.equal(typeof visibleDigest, "function");
    assert.equal(typeof entriesDigest, "function");
  });
});

