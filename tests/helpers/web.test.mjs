import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseQuery,
  stringifyQuery,
  uuidv4,
  nanoid,
  sha256,
  fnv1a,
  createEventBus,
  formatNumber,
  formatCurrency,
  formatBytes,
  clamp,
  createStorage
} from "mix-helpers/web";

describe("mix-helpers/web: query, crypto/IDs, typed event bus, formatters, storage", () => {
  it("1. parseQuery and stringifyQuery with array support and prototype pollution protection", () => {
    const qs = "page=2&filter[category]=books&tags=fiction&tags=sci-fi&__proto__[polluted]=true";
    const parsed = parseQuery(qs);

    assert.strictEqual(parsed.page, "2");
    assert.strictEqual(parsed.filter.category, "books");
    assert.deepStrictEqual(parsed.tags, ["fiction", "sci-fi"]);
    assert.strictEqual(parsed.polluted, undefined);
    assert.strictEqual({}.polluted, undefined);

    const stringified = stringifyQuery({ page: 2, tags: ["a", "b"] });
    assert.ok(stringified.includes("page=2"));
    assert.ok(stringified.includes("tags=a") || stringified.includes("tags%5B%5D=a"));
  });

  it("2. uuidv4, nanoid, sha256, fnv1a", async () => {
    const id = uuidv4();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const nano = nanoid(12);
    assert.strictEqual(nano.length, 12);

    const hash = await sha256("hello dotMix");
    assert.strictEqual(typeof hash, "string");
    assert.strictEqual(hash.length, 64); // SHA-256 hex string

    const fastHash = fnv1a("hello dotMix");
    assert.strictEqual(typeof fastHash, "number");
  });

  it("3. createEventBus typed pub/sub", () => {
    const bus = createEventBus();
    let receivedPayload = null;
    let oncePayload = null;

    const unsubscribe = bus.on("user:login", (payload) => {
      receivedPayload = payload;
    });

    bus.once("user:login", (payload) => {
      oncePayload = payload;
    });

    bus.emit("user:login", { id: 42, name: "Alice" });
    assert.deepStrictEqual(receivedPayload, { id: 42, name: "Alice" });
    assert.deepStrictEqual(oncePayload, { id: 42, name: "Alice" });

    // Second emit: once should not trigger again
    oncePayload = null;
    bus.emit("user:login", { id: 43, name: "Bob" });
    assert.deepStrictEqual(receivedPayload, { id: 43, name: "Bob" });
    assert.strictEqual(oncePayload, null);

    unsubscribe();
    bus.emit("user:login", { id: 44, name: "Charlie" });
    assert.deepStrictEqual(receivedPayload, { id: 43, name: "Bob" });
  });

  it("4. formatters: formatNumber, formatCurrency, formatBytes, clamp", () => {
    assert.strictEqual(clamp(15, 0, 10), 10);
    assert.strictEqual(clamp(-5, 0, 10), 0);
    assert.strictEqual(clamp(7, 0, 10), 7);

    assert.strictEqual(formatBytes(1024), "1 KB");
    assert.strictEqual(formatBytes(1048576 * 2.5), "2.5 MB");

    const curr = formatCurrency(1234.5, "USD", "en-US");
    assert.ok(curr.includes("1,234.50") || curr.includes("$1,234.50"));
  });

  it("5. createStorage with TTL expiration", async () => {
    const storage = createStorage({ prefix: "dotmix_test_", ttlMs: 50 });
    storage.set("token", "secret-value");

    assert.strictEqual(storage.get("token"), "secret-value");

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(storage.get("token"), null);
  });
});
