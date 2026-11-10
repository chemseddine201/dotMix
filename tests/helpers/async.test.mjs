import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asyncFlow,
  parallel,
  series,
  waterfall,
  mapLimit,
  retry,
  timeout,
  sleep,
  createQueue,
  createMutex
} from "mix-helpers/async";

describe("mix-helpers/async: asyncFlow & concurrency orchestration", () => {
  it("1. parallel, series, waterfall, and mapLimit", async () => {
    // parallel with concurrency limit
    let active = 0;
    let maxActive = 0;
    const task = (id, ms) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(ms);
      active--;
      return id;
    };

    const parallelRes = await parallel(
      [task(1, 30), task(2, 30), task(3, 30), task(4, 30)],
      2 // limit concurrency to 2
    );
    assert.deepStrictEqual(parallelRes, [1, 2, 3, 4]);
    assert.strictEqual(maxActive, 2);

    // series
    const order = [];
    const seriesRes = await series([
      async () => { await sleep(20); order.push("A"); return "A"; },
      async () => { await sleep(10); order.push("B"); return "B"; },
      async () => { order.push("C"); return "C"; }
    ]);
    assert.deepStrictEqual(seriesRes, ["A", "B", "C"]);
    assert.deepStrictEqual(order, ["A", "B", "C"]);

    // waterfall
    const waterfallRes = await waterfall([
      async () => 5,
      async (n) => n * 2,
      async (n) => `Value: ${n}`
    ]);
    assert.strictEqual(waterfallRes, "Value: 10");

    // mapLimit
    const mapped = await mapLimit([1, 2, 3, 4, 5], 2, async (num) => {
      await sleep(10);
      return num * 10;
    });
    assert.deepStrictEqual(mapped, [10, 20, 30, 40, 50]);
  });

  it("2. retry and timeout", async () => {
    let attempts = 0;
    const flaky = async () => {
      attempts++;
      if (attempts < 3) throw new Error("Temporary failure");
      return "Success";
    };

    const res = await retry(flaky, { retries: 3, delayMs: 10 });
    assert.strictEqual(res, "Success");
    assert.strictEqual(attempts, 3);

    // timeout
    await assert.rejects(
      () => timeout(sleep(100), 20, "Operation timed out"),
      /Operation timed out/
    );
  });

  it("3. createQueue priority worker queue", async () => {
    const executed = [];
    const queue = createQueue(async (task) => {
      await sleep(15);
      executed.push(task);
      return task;
    }, 1);

    queue.push("task-1", 10);
    queue.push("task-2", 10);
    queue.push("task-vip", 100); // higher priority

    await queue.drain();
    // task-1 starts immediately, task-vip has priority over task-2
    assert.deepStrictEqual(executed, ["task-1", "task-vip", "task-2"]);
  });

  it("4. createMutex mutual exclusion", async () => {
    const mutex = createMutex();
    let balance = 0;

    const deposit = async (amount) => {
      return mutex.runExclusive(async () => {
        const current = balance;
        await sleep(15);
        balance = current + amount;
      });
    };

    await Promise.all([deposit(100), deposit(50), deposit(25)]);
    assert.strictEqual(balance, 175);
  });
});
