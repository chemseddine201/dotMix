import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dot,
  get,
  set,
  unset,
  has,
  pick,
  omit,
  merge,
  cloneDeep,
  isEqual,
  isEmpty,
  isPlainObject,
  groupBy,
  keyBy,
  orderBy,
  chunk,
  uniq,
  uniqBy,
  flattenDeep,
  camelCase,
  kebabCase,
  snakeCase,
  pascalCase,
  slugify,
  debounce,
  throttle,
  once,
  memoize,
  pipe
} from "mix-helpers/data";

describe("mix-helpers/data: dot namespace & pure data/function utilities", () => {
  it("1. Object paths: get, set, unset, has, pick, omit, and prototype pollution protection", () => {
    const obj = { user: { profile: { name: "Alice", tags: ["admin", "dev"] } } };

    // get
    assert.strictEqual(get(obj, "user.profile.name"), "Alice");
    assert.strictEqual(dot.get(obj, "user.profile.tags[1]"), "dev");
    assert.strictEqual(get(obj, "user.profile.age", 30), 30);
    assert.strictEqual(get(obj, ["user", "profile", "tags", 0]), "admin");

    // set
    const target = {};
    set(target, "a.b[0].c", 42);
    assert.strictEqual(target.a.b[0].c, 42);

    // prototype pollution prevention
    const malicious = {};
    set(malicious, "__proto__.polluted", "yes");
    set(malicious, "constructor.prototype.polluted", "yes");
    assert.strictEqual(malicious.polluted, undefined);
    assert.strictEqual({}.polluted, undefined);

    // has & unset
    assert.strictEqual(has(target, "a.b[0].c"), true);
    assert.strictEqual(has(target, "a.b[0].d"), false);
    unset(target, "a.b[0].c");
    assert.strictEqual(has(target, "a.b[0].c"), false);

    // pick & omit
    const source = { id: 1, name: "Bob", role: "editor", secret: "xyz" };
    assert.deepStrictEqual(pick(source, ["id", "name"]), { id: 1, name: "Bob" });
    assert.deepStrictEqual(omit(source, ["secret", "role"]), { id: 1, name: "Bob" });

    // merge
    const merged = merge({ a: 1, b: { c: 2 } }, { b: { d: 3 }, e: 4 });
    assert.deepStrictEqual(merged, { a: 1, b: { c: 2, d: 3 }, e: 4 });
  });

  it("2. Deep value & Lang: cloneDeep, isEqual, isEmpty, isPlainObject, and circular refs", () => {
    // cloneDeep with circular reference and rich types
    const original = {
      num: 123,
      str: "hello",
      date: new Date("2026-01-01T00:00:00Z"),
      reg: /abc/gi,
      set: new Set([1, 2, 3]),
      map: new Map([["key", "val"]]),
      arr: [{ x: 1 }]
    };
    original.self = original;

    const cloned = cloneDeep(original);
    assert.notStrictEqual(cloned, original);
    assert.strictEqual(cloned.self, cloned);
    assert.strictEqual(cloned.date.getTime(), original.date.getTime());
    assert.notStrictEqual(cloned.date, original.date);
    assert.deepStrictEqual(Array.from(cloned.set), [1, 2, 3]);
    assert.strictEqual(cloned.map.get("key"), "val");

    // isEqual
    assert.strictEqual(isEqual(original, cloned), true);
    assert.strictEqual(isEqual({ a: 1, b: [2] }, { a: 1, b: [2] }), true);
    assert.strictEqual(isEqual({ a: 1, b: [2] }, { a: 1, b: [3] }), false);

    // isEmpty & isPlainObject
    assert.strictEqual(isEmpty([]), true);
    assert.strictEqual(isEmpty({}), true);
    assert.strictEqual(isEmpty(new Set()), true);
    assert.strictEqual(isEmpty(""), true);
    assert.strictEqual(isEmpty([1]), false);
    assert.strictEqual(isEmpty({ a: 1 }), false);

    assert.strictEqual(isPlainObject({}), true);
    assert.strictEqual(isPlainObject(Object.create(null)), true);
    assert.strictEqual(isPlainObject(new Date()), false);
    assert.strictEqual(isPlainObject([]), false);
  });

  it("3. Collections: groupBy, keyBy, orderBy, chunk, uniq, uniqBy, flattenDeep", () => {
    const items = [
      { id: 1, category: "fruit", name: "banana", price: 2 },
      { id: 2, category: "fruit", name: "apple", price: 3 },
      { id: 3, category: "vegetable", name: "carrot", price: 1 },
      { id: 4, category: "fruit", name: "cherry", price: 5 }
    ];

    // groupBy
    const grouped = groupBy(items, "category");
    assert.strictEqual(grouped.fruit.length, 3);
    assert.strictEqual(grouped.vegetable.length, 1);

    // keyBy
    const keyed = keyBy(items, "id");
    assert.strictEqual(keyed[2].name, "apple");

    // orderBy
    const sorted = orderBy(items, ["category", "price"], ["asc", "desc"]);
    assert.strictEqual(sorted[0].name, "cherry"); // fruit price 5
    assert.strictEqual(sorted[1].name, "apple");  // fruit price 3
    assert.strictEqual(sorted[2].name, "banana"); // fruit price 2
    assert.strictEqual(sorted[3].name, "carrot"); // vegetable price 1

    // chunk & uniq & uniqBy
    assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepStrictEqual(uniq([1, 2, 2, 3, 1]), [1, 2, 3]);
    assert.deepStrictEqual(
      uniqBy([{ id: 1 }, { id: 2 }, { id: 1 }], "id"),
      [{ id: 1 }, { id: 2 }]
    );

    // flattenDeep
    assert.deepStrictEqual(flattenDeep([1, [2, [3, [4]], 5]]), [1, 2, 3, 4, 5]);
  });

  it("4. String transforms: camelCase, kebabCase, snakeCase, pascalCase, slugify", () => {
    assert.strictEqual(camelCase("Hello World_foo-bar"), "helloWorldFooBar");
    assert.strictEqual(kebabCase("XMLHttpRequest_parser"), "xml-http-request-parser");
    assert.strictEqual(snakeCase("dotMix Framework"), "dot_mix_framework");
    assert.strictEqual(pascalCase("reactive-component"), "ReactiveComponent");
    assert.strictEqual(slugify("dotMix: The Compiler-Native Framework!"), "dotmix-the-compiler-native-framework");
  });

  it("5. Function control: debounce, throttle, once, memoize, pipe", async () => {
    // once
    let calls = 0;
    const initOnce = once(() => ++calls);
    assert.strictEqual(initOnce(), 1);
    assert.strictEqual(initOnce(), 1);
    assert.strictEqual(calls, 1);

    // memoize
    const square = memoize((n) => n * n);
    assert.strictEqual(square(4), 16);
    assert.strictEqual(square(4), 16);

    // pipe
    const pipeline = pipe(
      (n) => n + 2,
      (n) => n * 3,
      (n) => `Total: ${n}`
    );
    assert.strictEqual(pipeline(5), "Total: 21");

    // debounce with flush and cancel
    let debouncedVal = 0;
    const fn = debounce((v) => { debouncedVal = v; }, 50);
    fn(10);
    fn(20);
    assert.strictEqual(debouncedVal, 0);
    fn.flush();
    assert.strictEqual(debouncedVal, 20);

    // throttle
    let throttledCount = 0;
    const thr = throttle(() => { throttledCount++; }, 30);
    thr();
    thr();
    thr();
    assert.strictEqual(throttledCount, 1);
  });
});

