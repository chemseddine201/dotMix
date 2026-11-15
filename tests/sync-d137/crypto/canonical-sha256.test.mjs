/* global Buffer */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex, sha256 } from "../../../packages/sync/dist/protocol/sha256.js";
import {
  canonicalizeValue,
  computeCanonicalByteSize,
  toOperationKey,
  toOriginStreamKey,
  toIncarnationId,
} from "../../../packages/sync/dist/protocol/canonical.js";
import { canonicalizeValue as refCanonicalizeValue } from "../../../tools/d137-reference/dist/canonicalization.js";

describe("T-33.1: Canonical JSON & Pure-TS Synchronous SHA-256", () => {
  describe("NIST FIPS 180-4 Test Vectors", () => {
    it("vector 1: empty string", () => {
      const digest = sha256Hex("");
      assert.equal(digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
      assert.equal(Buffer.from(sha256("")).toString("hex"), digest);
    });

    it("vector 2: 'abc'", () => {
      const digest = sha256Hex("abc");
      assert.equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });

    it("vector 3: 56-byte string", () => {
      const msg = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
      const digest = sha256Hex(msg);
      assert.equal(digest, "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    });

    it("vector 4: multi-block 112-byte string", () => {
      const msg = "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";
      const digest = sha256Hex(msg);
      assert.equal(digest, "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
    });
  });

  describe("Differential Oracle vs node:crypto", () => {
    it("matches node:crypto over boundary lengths (0..65536)", () => {
      const boundaryLengths = [0, 1, 2, 55, 56, 63, 64, 65, 127, 128, 255, 256, 1024, 65536];
      for (const len of boundaryLengths) {
        const buf = Buffer.alloc(len, 0x61); // 'a'
        const expected = createHash("sha256").update(buf).digest("hex");
        const actual = sha256Hex(buf);
        assert.equal(actual, expected, `Mismatch at boundary length ${len}`);
      }
    });

    it("matches node:crypto over 1,000 pseudo-random payloads", () => {
      let seed = 1337;
      function nextRand() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      }

      for (let i = 0; i < 1000; i++) {
        const len = Math.floor(nextRand() * 500);
        const bytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) {
          bytes[j] = Math.floor(nextRand() * 256);
        }
        const expected = createHash("sha256").update(bytes).digest("hex");
        const actual = sha256Hex(bytes);
        assert.equal(actual, expected, `Mismatch at random iteration ${i}`);
      }
    });
  });

  describe("Canonical JSON Serialization & Formatting", () => {
    it("formats structured keys deterministically", () => {
      const dot = { epochNumber: 3, replicaId: "rep-alpha", sequence: 42 };
      assert.equal(toOperationKey("col_users", dot), "col_users:3:rep-alpha:42");
      assert.equal(toOriginStreamKey(3, "rep-alpha"), "3:rep-alpha");
      assert.equal(toIncarnationId(dot), "3:rep-alpha:42");
    });

    it("sorts object keys lexicographically and omits undefined", () => {
      const sample = {
        z: 1,
        a: "hello",
        m: true,
        ignored: undefined,
        nested: { b: 2, a: 1 },
      };
      const canonical = canonicalizeValue(sample);
      assert.equal(canonical, '{"a":"hello","m":true,"nested":{"a":1,"b":2},"z":1}');
      assert.equal(computeCanonicalByteSize(sample), Buffer.byteLength(canonical, "utf8"));
    });

    it("rejects non-finite numbers with D137_NON_CANONICAL_VALUE", () => {
      assert.throws(() => canonicalizeValue({ val: NaN }), /D137_NON_CANONICAL_VALUE/);
      assert.throws(() => canonicalizeValue({ val: Infinity }), /D137_NON_CANONICAL_VALUE/);
      assert.throws(() => canonicalizeValue({ val: -Infinity }), /D137_NON_CANONICAL_VALUE/);
    });

    it("matches Gate 32 reference canonicalization byte-for-byte", () => {
      const testCases = [
        null,
        true,
        false,
        0,
        -42,
        3.14159,
        "",
        "Hello World! 🚀",
        [],
        [1, 2, "three", { x: true, y: null }],
        { z: [1, 2], b: "test", a: { k2: 2, k1: 1, undef: undefined } },
      ];

      for (const tc of testCases) {
        const prod = canonicalizeValue(tc);
        const ref = refCanonicalizeValue(tc);
        assert.equal(prod, ref);
      }
    });
  });
});
