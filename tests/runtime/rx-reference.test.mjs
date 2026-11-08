import test from "node:test";
import assert from "node:assert/strict";

import {
  signal,
  computed,
  createEffect as effect,
  read,
  write,
  flushSync as flush,
  untrack,
  getFlushErrors as errors
} from "../../packages/runtime/dist/core/index.js";

test("Phase 1A / Appendix C Reference Prototype Tests (12/12)", async (t) => {
  await t.test("diamond: d computed exactly once, never stale (T-RX-01)", () => {
    const a = signal(1);
    const b = computed(() => read(a) * 2);
    const c = computed(() => read(a) * 3);
    const seen = [];
    const d = computed(() => {
      const v = read(b) + read(c);
      seen.push(v);
      return v;
    });
    const out = [];
    effect(() => out.push(read(d)));
    flush();
    assert.deepEqual(out, [5]);

    d.runs = 0;
    seen.length = 0;
    write(a, 2);
    flush();
    assert.equal(d.runs, 1);
    assert.deepEqual(seen, [10]);
    assert.deepEqual(out, [5, 10]);
  });

  await t.test("double diamond a->(b,c)->d->(e,f)->g (T-RX-02)", () => {
    const a = signal(1);
    const b = computed(() => read(a) + 1);
    const c = computed(() => read(a) + 2);
    const d = computed(() => read(b) + read(c));
    const e = computed(() => read(d) + 1);
    const f = computed(() => read(d) + 2);
    const g = computed(() => read(e) + read(f));
    const out = [];
    effect(() => out.push(read(g)));
    flush();
    write(a, 5);
    flush();
    assert.deepEqual(out, [2 * (1 + 1 + 1 + 2) + 3, 2 * (6 + 7) + 3]);
    assert.equal(g.runs, 2);
    assert.equal(d.runs, 2);
  });

  await t.test("equality cutoff: unchanged computed does not rerun effect (T-RX-03)", () => {
    const a = signal(1);
    const parity = computed(() => read(a) % 2);
    let runs = 0;
    effect(() => {
      read(parity);
      runs++;
    });
    flush();
    write(a, 3);
    flush();
    assert.equal(runs, 1);
  });

  await t.test("conditional deps are dropped (T-RX-04)", () => {
    const flag = signal(true);
    const x = signal(1);
    const y = signal(2);
    const c = computed(() => (read(flag) ? read(x) : read(y)));
    effect(() => read(c));
    flush();
    write(flag, false);
    flush();
    const before = c.runs;
    write(x, 100);
    flush();
    assert.equal(c.runs, before);
    assert.equal(x.observers?.size ?? 0, 0);
  });

  await t.test("self-mutating effect converges (no lost update) (T-RX-05)", () => {
    const count = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      const v = read(count);
      if (v < 5) write(count, v + 1);
    });
    flush();
    assert.equal(count.value, 5);
    assert.equal(runs, 6);
    assert.equal(errors().length, 0);
  });

  await t.test("first-read-then-write in same run is not lost (T-RX-06)", () => {
    const s = signal(0);
    const gate = signal(false);
    effect(() => {
      if (read(gate)) {
        const v = read(s);
        if (v < 3) write(s, v + 1);
      }
    });
    flush();
    write(gate, true);
    flush();
    assert.equal(s.value, 3);
  });

  await t.test("write through a computed during effect run triggers revalidation (T-RX-07)", () => {
    const s = signal(1);
    const dbl = computed(() => read(s) * 2);
    const out = [];
    effect(() => {
      const v = read(dbl);
      out.push(v);
      if (v < 8) write(s, read(s) * 2);
    });
    flush();
    assert.deepEqual(out, [2, 4, 8]);
  });

  await t.test("unconditional self-increment -> MIX_RT_EFFECT_LOOP, flush terminates (T-RX-08)", () => {
    const count = signal(0);
    effect(() => write(count, read(count) + 1));
    flush();
    const errs = errors();
    assert.ok(errs.some((e) => e.code === "MIX_RT_EFFECT_LOOP"));
  });

  await t.test("mutual effect loop -> MIX_RT_EFFECT_LOOP (T-RX-09)", () => {
    const a = signal(0);
    const b = signal(0);
    effect(() => write(a, read(b) + 1));
    effect(() => write(b, read(a) + 1));
    flush();
    const errs = errors();
    assert.ok(errs.some((e) => e.code === "MIX_RT_EFFECT_LOOP"));
  });

  await t.test("write inside computed throws (cached error rethrown on read) (T-RX-10)", () => {
    const s = signal(0);
    const bad = computed(() => {
      write(s, 1);
      return 1;
    });
    assert.throws(() => read(bad), /MIX_RT_WRITE_IN_COMPUTED/);
    assert.throws(() => untrack(() => read(bad)), /MIX_RT_WRITE_IN_COMPUTED/);
  });

  await t.test("cycle detection (T-RX-11)", () => {
    let c2;
    const c1 = computed(() => read(c2) + 1);
    c2 = computed(() => read(c1) + 1);
    assert.throws(() => read(c1), /MIX_RT_CYCLE/);
  });

  await t.test("computed error is cached then recovers when source changes (T-RX-12)", () => {
    const s = signal(0);
    const c = computed(() => {
      if (read(s) === 0) throw new Error("boom");
      return read(s);
    });
    assert.throws(() => read(c), /boom/);
    const runs = c.runs;
    assert.throws(() => read(c), /boom/);
    assert.equal(c.runs, runs);
    write(s, 2);
    assert.equal(read(c), 2);
  });
});
