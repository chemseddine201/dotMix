/**
 * mix-helpers/datetime — Immutable DateTime Class, Token Formatter & Parser
 */

import {
  type DateUnit,
  MONTH_NAMES,
  MONTH_SHORT,
  DAY_NAMES,
  DAY_SHORT,
  normalizeUnit,
  pad,
  getZonedParts,
} from "./types.js";

export function parseWithFormat(str: string, format: string): Date {
  const tokenRegex = /YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|A|a/g;
  let s = str;
  let f = format;

  const values: Record<string, number> = {
    year: new Date().getFullYear(),
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  };

  const matches = f.match(tokenRegex);
  if (!matches) {
    return new Date(str);
  }

  for (const token of matches) {
    const idx = f.indexOf(token);
    if (idx > 0) {
      s = s.slice(idx);
      f = f.slice(idx);
    }
    f = f.slice(token.length);

    let numChars = token.length;
    if (token === "M" || token === "D" || token === "H" || token === "h" || token === "m" || token === "s") {
      const matchNum = s.match(/^\d{1,2}/);
      if (matchNum) numChars = matchNum[0].length;
    } else if (token === "YYYY") {
      numChars = 4;
    } else if (token === "YY") {
      numChars = 2;
    } else if (token === "SSS") {
      numChars = 3;
    }

    const valStr = s.slice(0, numChars);
    s = s.slice(numChars);
    const parsedNum = parseInt(valStr, 10);

    if (token.startsWith("Y")) {
      values.year = token === "YY" ? 2000 + parsedNum : parsedNum;
    } else if (token.startsWith("M")) {
      values.month = parsedNum;
    } else if (token.startsWith("D")) {
      values.day = parsedNum;
    } else if (token.startsWith("H") || token.startsWith("h")) {
      values.hour = parsedNum;
    } else if (token.startsWith("m")) {
      values.minute = parsedNum;
    } else if (token.startsWith("s")) {
      values.second = parsedNum;
    } else if (token === "SSS") {
      values.millisecond = parsedNum;
    }
  }

  return new Date(
    Date.UTC(
      values.year!,
      values.month! - 1,
      values.day!,
      values.hour!,
      values.minute!,
      values.second!,
      values.millisecond!
    )
  );
}

export const parseFormatString = parseWithFormat;

export class DateTime {
  readonly _d: Date;
  readonly _utc: boolean;
  readonly _timezone?: string | undefined;

  constructor(
    input?: Date | string | number | DateTime,
    format?: string,
    isUtc = false,
    timezone?: string | undefined
  ) {
    this._utc = isUtc;
    this._timezone = timezone;

    if (input instanceof DateTime) {
      this._d = new Date(input._d.getTime());
      this._utc = isUtc || input._utc;
      this._timezone = timezone ?? input._timezone;
    } else if (format && typeof input === "string") {
      this._d = parseWithFormat(input, format);
      this._utc = true;
    } else if (input instanceof Date) {
      this._d = new Date(input.getTime());
    } else if (typeof input === "number") {
      this._d = new Date(input);
    } else if (typeof input === "string") {
      this._d = new Date(input);
    } else {
      this._d = new Date();
    }
  }

  isValid(): boolean {
    return !Number.isNaN(this._d.getTime());
  }

  utc(): DateTime {
    return new DateTime(this._d, undefined, true);
  }

  local(): DateTime {
    return new DateTime(this._d, undefined, false);
  }

  tz(timezone: string): DateTime {
    return new DateTime(this._d, undefined, false, timezone);
  }

  year(): number {
    return this._utc ? this._d.getUTCFullYear() : this._d.getFullYear();
  }

  month(): number {
    return (this._utc ? this._d.getUTCMonth() : this._d.getMonth()) + 1;
  }

  date(): number {
    return this._utc ? this._d.getUTCDate() : this._d.getDate();
  }

  day(): number {
    return this._utc ? this._d.getUTCDay() : this._d.getDay();
  }

  hour(): number {
    return this._utc ? this._d.getUTCHours() : this._d.getHours();
  }

  minute(): number {
    return this._utc ? this._d.getUTCMinutes() : this._d.getMinutes();
  }

  second(): number {
    return this._utc ? this._d.getUTCSeconds() : this._d.getSeconds();
  }

  millisecond(): number {
    return this._utc ? this._d.getUTCMilliseconds() : this._d.getMilliseconds();
  }

  valueOf(): number {
    return this._d.getTime();
  }

  unix(): number {
    return Math.floor(this._d.getTime() / 1000);
  }

  toDate(): Date {
    return new Date(this._d.getTime());
  }

  toISOString(): string {
    return this._d.toISOString();
  }

  format(pattern = "YYYY-MM-DDTHH:mm:ss.SSSZ"): string {
    if (!this.isValid()) return "Invalid Date";

    let Y: number, M: number, D: number, d: number, H: number, m: number, s: number, ms: number;

    if (this._timezone) {
      const zp = getZonedParts(this._d, this._timezone);
      Y = zp.year;
      M = zp.month;
      D = zp.day;
      H = zp.hour;
      m = zp.minute;
      s = zp.second;
      ms = zp.millisecond;
      d = zp.weekday;
    } else if (this._utc) {
      Y = this._d.getUTCFullYear();
      M = this._d.getUTCMonth() + 1;
      D = this._d.getUTCDate();
      d = this._d.getUTCDay();
      H = this._d.getUTCHours();
      m = this._d.getUTCMinutes();
      s = this._d.getUTCSeconds();
      ms = this._d.getUTCMilliseconds();
    } else {
      Y = this._d.getFullYear();
      M = this._d.getMonth() + 1;
      D = this._d.getDate();
      d = this._d.getDay();
      H = this._d.getHours();
      m = this._d.getMinutes();
      s = this._d.getSeconds();
      ms = this._d.getMilliseconds();
    }

    const h12 = H % 12 === 0 ? 12 : H % 12;

    const literals: string[] = [];
    const withPlaceholders = pattern.replace(/\[([^\]]+)\]/g, (_, lit: string) => {
      literals.push(lit);
      return `__DOTMIX_LIT_${literals.length - 1}__`;
    });

    const replaced = withPlaceholders
      .replace(/\bYYYY\b/g, String(Y))
      .replace(/\bYY\b/g, String(Y).slice(-2))
      .replace(/\bMMMM\b/g, MONTH_NAMES[M - 1] || "")
      .replace(/\bMMM\b/g, MONTH_SHORT[M - 1] || "")
      .replace(/\bMM\b/g, pad(M))
      .replace(/\bM\b/g, String(M))
      .replace(/\bDD\b/g, pad(D))
      .replace(/\bD\b/g, String(D))
      .replace(/\bdddd\b/g, DAY_NAMES[d] || "")
      .replace(/\bddd\b/g, DAY_SHORT[d] || "")
      .replace(/\bHH\b/g, pad(H))
      .replace(/\bH\b/g, String(H))
      .replace(/\bhh\b/g, pad(h12))
      .replace(/\bh\b/g, String(h12))
      .replace(/\bmm\b/g, pad(m))
      .replace(/\bm\b/g, String(m))
      .replace(/\bss\b/g, pad(s))
      .replace(/\bs\b/g, String(s))
      .replace(/\bSSS\b/g, pad(ms, 3))
      .replace(/\bA\b/g, H >= 12 ? "PM" : "AM")
      .replace(/\ba\b/g, H >= 12 ? "pm" : "am");

    return replaced.replace(/__DOTMIX_LIT_(\d+)__/g, (_, idx: string) => literals[Number(idx)] || "");
  }

  add(val: number, unit: DateUnit): DateTime {
    const copy = new Date(this._d.getTime());
    const u = normalizeUnit(unit);
    if (u === "ms") copy.setUTCMilliseconds(copy.getUTCMilliseconds() + val);
    else if (u === "s") copy.setUTCSeconds(copy.getUTCSeconds() + val);
    else if (u === "m") copy.setUTCMinutes(copy.getUTCMinutes() + val);
    else if (u === "h") copy.setUTCHours(copy.getUTCHours() + val);
    else if (u === "d") copy.setUTCDate(copy.getUTCDate() + val);
    else if (u === "w") copy.setUTCDate(copy.getUTCDate() + val * 7);
    else if (u === "M") copy.setUTCMonth(copy.getUTCMonth() + val);
    else if (u === "y") copy.setUTCFullYear(copy.getUTCFullYear() + val);
    return new DateTime(copy, undefined, this._utc, this._timezone);
  }

  subtract(val: number, unit: DateUnit): DateTime {
    return this.add(-val, unit);
  }

  startOf(unit: DateUnit): DateTime {
    const copy = new Date(this._d.getTime());
    const u = normalizeUnit(unit);
    const isUtc = this._utc;

    if (u === "y") {
      if (isUtc) {
        copy.setUTCMonth(0, 1);
        copy.setUTCHours(0, 0, 0, 0);
      } else {
        copy.setMonth(0, 1);
        copy.setHours(0, 0, 0, 0);
      }
    } else if (u === "M") {
      if (isUtc) {
        copy.setUTCDate(1);
        copy.setUTCHours(0, 0, 0, 0);
      } else {
        copy.setDate(1);
        copy.setHours(0, 0, 0, 0);
      }
    } else if (u === "d") {
      if (isUtc) {
        copy.setUTCHours(0, 0, 0, 0);
      } else {
        copy.setHours(0, 0, 0, 0);
      }
    } else if (u === "h") {
      if (isUtc) {
        copy.setUTCMinutes(0, 0, 0);
      } else {
        copy.setMinutes(0, 0, 0);
      }
    } else if (u === "m") {
      if (isUtc) {
        copy.setUTCSeconds(0, 0);
      } else {
        copy.setSeconds(0, 0);
      }
    } else if (u === "s") {
      if (isUtc) {
        copy.setUTCMilliseconds(0);
      } else {
        copy.setMilliseconds(0);
      }
    }
    return new DateTime(copy, undefined, this._utc, this._timezone);
  }

  endOf(unit: DateUnit): DateTime {
    const copy = new Date(this._d.getTime());
    const u = normalizeUnit(unit);
    const isUtc = this._utc;

    if (u === "y") {
      if (isUtc) {
        copy.setUTCMonth(11, 31);
        copy.setUTCHours(23, 59, 59, 999);
      } else {
        copy.setMonth(11, 31);
        copy.setHours(23, 59, 59, 999);
      }
    } else if (u === "M") {
      if (isUtc) {
        copy.setUTCMonth(copy.getUTCMonth() + 1, 0);
        copy.setUTCHours(23, 59, 59, 999);
      } else {
        copy.setMonth(copy.getMonth() + 1, 0);
        copy.setHours(23, 59, 59, 999);
      }
    } else if (u === "d") {
      if (isUtc) {
        copy.setUTCHours(23, 59, 59, 999);
      } else {
        copy.setHours(23, 59, 59, 999);
      }
    } else if (u === "h") {
      if (isUtc) {
        copy.setUTCMinutes(59, 59, 999);
      } else {
        copy.setMinutes(59, 59, 999);
      }
    } else if (u === "m") {
      if (isUtc) {
        copy.setUTCSeconds(59, 999);
      } else {
        copy.setSeconds(59, 999);
      }
    }
    return new DateTime(copy, undefined, this._utc, this._timezone);
  }

  diff(other: DateTime | Date | string | number, unit: DateUnit = "ms", precise = false): number {
    const otherMs = other instanceof DateTime ? other._d.getTime() : new Date(other).getTime();
    const diffMs = this._d.getTime() - otherMs;
    const u = normalizeUnit(unit);

    let divisor = 1;
    if (u === "s") divisor = 1000;
    else if (u === "m") divisor = 60 * 1000;
    else if (u === "h") divisor = 60 * 60 * 1000;
    else if (u === "d") divisor = 24 * 60 * 60 * 1000;
    else if (u === "w") divisor = 7 * 24 * 60 * 60 * 1000;
    else if (u === "M") divisor = 30.4375 * 24 * 60 * 60 * 1000;
    else if (u === "y") divisor = 365.25 * 24 * 60 * 60 * 1000;

    const res = diffMs / divisor;
    return precise ? res : Math.trunc(res);
  }

  fromNow(withoutSuffix = false): string {
    const diffMs = Date.now() - this._d.getTime();
    const isPast = diffMs >= 0;
    const absSec = Math.floor(Math.abs(diffMs) / 1000);

    let str = "";
    if (absSec < 45) str = "a few seconds";
    else if (absSec < 90) str = "a minute";
    else if (absSec < 45 * 60) str = `${Math.round(absSec / 60)} minutes`;
    else if (absSec < 90 * 60) str = "an hour";
    else if (absSec < 24 * 3600) str = `${Math.round(absSec / 3600)} hours`;
    else if (absSec < 48 * 3600) str = "a day";
    else if (absSec < 30 * 86400) str = `${Math.round(absSec / 86400)} days`;
    else if (absSec < 365 * 86400) str = `${Math.round(absSec / (30 * 86400))} months`;
    else str = `${Math.round(absSec / (365 * 86400))} years`;

    if (withoutSuffix) return str;
    return isPast ? `${str} ago` : `in ${str}`;
  }

  toNow(withoutSuffix = false): string {
    return this.fromNow(withoutSuffix);
  }

  isBefore(other: DateTime | Date | string | number): boolean {
    const otherMs = other instanceof DateTime ? other._d.getTime() : new Date(other).getTime();
    return this._d.getTime() < otherMs;
  }

  isAfter(other: DateTime | Date | string | number): boolean {
    const otherMs = other instanceof DateTime ? other._d.getTime() : new Date(other).getTime();
    return this._d.getTime() > otherMs;
  }

  isSame(other: DateTime | Date | string | number): boolean {
    const otherMs = other instanceof DateTime ? other._d.getTime() : new Date(other).getTime();
    return this._d.getTime() === otherMs;
  }
}

export type DateTimeInstance = DateTime;

export function dateTime(input?: Date | string | number | DateTime, format?: string): DateTime {
  return new DateTime(input, format);
}

export function isDateTime(val: unknown): val is DateTime {
  return val instanceof DateTime;
}
