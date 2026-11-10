/**
 * mix-helpers/datetime — Immutable Duration Arithmetic & Humanization
 */

import { type DateUnit, normalizeUnit } from "./types.js";

export class Duration {
  readonly _ms: number;

  constructor(value: number, unit: DateUnit = "ms") {
    const u = normalizeUnit(unit);
    let ms = value;
    if (u === "s") ms = value * 1000;
    else if (u === "m") ms = value * 60 * 1000;
    else if (u === "h") ms = value * 60 * 60 * 1000;
    else if (u === "d") ms = value * 24 * 60 * 60 * 1000;
    else if (u === "w") ms = value * 7 * 24 * 60 * 60 * 1000;
    else if (u === "M") ms = value * 30.4375 * 24 * 60 * 60 * 1000;
    else if (u === "y") ms = value * 365.25 * 24 * 60 * 60 * 1000;
    this._ms = ms;
  }

  asMilliseconds(): number { return this._ms; }
  asSeconds(): number { return this._ms / 1000; }
  asMinutes(): number { return this._ms / (60 * 1000); }
  asHours(): number { return this._ms / (60 * 60 * 1000); }
  asDays(): number { return this._ms / (24 * 60 * 60 * 1000); }
  asMonths(): number { return this._ms / (30.4375 * 24 * 60 * 60 * 1000); }
  asYears(): number { return this._ms / (365.25 * 24 * 60 * 60 * 1000); }

  add(val: number, unit: DateUnit): Duration {
    const other = new Duration(val, unit);
    return new Duration(this._ms + other._ms, "ms");
  }

  subtract(val: number, unit: DateUnit): Duration {
    const other = new Duration(val, unit);
    return new Duration(this._ms - other._ms, "ms");
  }

  humanize(): string {
    const sec = Math.abs(this.asSeconds());
    if (sec < 45) return "a few seconds";
    if (sec < 90) return "a minute";
    if (sec < 45 * 60) return `${Math.round(sec / 60)} minutes`;
    if (sec < 90 * 60) return "an hour";
    if (sec < 24 * 3600) return `${Math.round(sec / 3600)} hours`;
    if (sec < 48 * 3600) return "a day";
    if (sec < 30 * 86400) return `${Math.round(sec / 86400)} days`;
    if (sec < 365 * 86400) return `${Math.round(sec / (30 * 86400))} months`;
    return `${Math.round(sec / (365 * 86400))} years`;
  }
}

export type DurationInstance = Duration;

export function duration(value: number, unit?: DateUnit): Duration {
  return new Duration(value, unit);
}

export function isDuration(val: unknown): val is Duration {
  return val instanceof Duration;
}
