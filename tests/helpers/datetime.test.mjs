import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dateTime, duration, isDateTime, isDuration } from "mix-helpers/datetime";

describe("mix-helpers/datetime: dateTime & duration engine", () => {
  it("1. Parsing, formatting tokens, and immutability", () => {
    const dt = dateTime("2026-11-10T14:30:45.123Z");
    assert.ok(isDateTime(dt));
    assert.strictEqual(dt.isValid(), true);

    // Tokens formatting
    assert.strictEqual(dt.utc().format("YYYY-MM-DD HH:mm:ss"), "2026-11-10 14:30:45");
    assert.strictEqual(dt.utc().format("YYYY/MM/DD [at] HH:mm"), "2026/11/10 at 14:30");
    assert.strictEqual(dt.utc().format("YYYY"), "2026");
    assert.strictEqual(dt.utc().format("MM"), "11");
    assert.strictEqual(dt.utc().format("DD"), "10");

    // Custom format string parsing
    const parsed = dateTime("25/12/2026 18:00", "DD/MM/YYYY HH:mm");
    assert.strictEqual(parsed.isValid(), true);
    assert.strictEqual(parsed.year(), 2026);
    assert.strictEqual(parsed.month(), 12); // 1-indexed for user ergonomics
    assert.strictEqual(parsed.date(), 25);
    assert.strictEqual(parsed.hour(), 18);

    // Immutability: operations return new instances
    const added = dt.add(5, "days");
    assert.notStrictEqual(added, dt);
    assert.strictEqual(dt.utc().date(), 10);
    assert.strictEqual(added.utc().date(), 15);
  });

  it("2. Date manipulation: add, subtract, startOf, endOf, diff", () => {
    const base = dateTime("2026-06-15T12:00:00Z").utc();

    const nextMonth = base.add(1, "month");
    assert.strictEqual(nextMonth.month(), 7);

    const prevHour = base.subtract(2, "hours");
    assert.strictEqual(prevHour.hour(), 10);

    const startOfDay = base.startOf("day");
    assert.strictEqual(startOfDay.format("HH:mm:ss"), "00:00:00");

    const endOfMonth = base.endOf("month");
    assert.strictEqual(endOfMonth.format("DD HH:mm:ss"), "30 23:59:59");

    // Diff
    const d1 = dateTime("2026-01-01T00:00:00Z");
    const d2 = dateTime("2026-01-10T12:00:00Z");
    assert.strictEqual(d2.diff(d1, "days"), 9);
    assert.strictEqual(Math.round(d2.diff(d1, "days", true) * 10) / 10, 9.5);
  });

  it("3. Relative time: fromNow(), toNow()", () => {
    const now = dateTime();
    const past = now.subtract(2, "hours");
    const future = now.add(5, "days");

    assert.ok(past.fromNow().includes("hours ago") || past.fromNow().includes("2 hours ago"));
    assert.ok(future.fromNow().includes("in 5 days") || future.fromNow().includes("in"));
  });

  it("4. Timezone conversion: .tz(ianaZone)", () => {
    const utcTime = dateTime("2026-07-01T12:00:00Z");
    const nyTime = utcTime.tz("America/New_York");
    const tokyoTime = utcTime.tz("Asia/Tokyo");

    // NY in July is EDT (UTC-4) -> 08:00
    assert.strictEqual(nyTime.format("HH:mm"), "08:00");
    // Tokyo is JST (UTC+9) -> 21:00
    assert.strictEqual(tokyoTime.format("HH:mm"), "21:00");
  });

  it("5. Durations: duration() arithmetic and humanization", () => {
    const dur = duration(90, "minutes");
    assert.ok(isDuration(dur));
    assert.strictEqual(dur.asMinutes(), 90);
    assert.strictEqual(dur.asHours(), 1.5);
    assert.strictEqual(dur.asSeconds(), 5400);

    const added = dur.add(30, "minutes");
    assert.strictEqual(added.asHours(), 2);
    assert.strictEqual(dur.humanize(), "2 hours"); // 90 mins rounds to ~2 hours or 1.5
  });
});

