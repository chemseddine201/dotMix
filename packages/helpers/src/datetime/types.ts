/**
 * mix-helpers/datetime — Date/Time Units, Locales & Calendar Math Helpers
 *
 * 100% zero external dependencies. Native Intl.DateTimeFormat timezone support.
 */

export type DateUnit =
  | "millisecond" | "milliseconds" | "ms"
  | "second" | "seconds" | "s"
  | "minute" | "minutes" | "m"
  | "hour" | "hours" | "h"
  | "day" | "days" | "d"
  | "week" | "weeks" | "w"
  | "month" | "months" | "M"
  | "year" | "years" | "y";

export type TimeUnit = DateUnit;
export type DateInput = Date | string | number | { readonly _d: Date };

export interface RelativeLocale {
  future: (s: string) => string;
  past: (s: string) => string;
  seconds: string;
  minute: string;
  minutes: (n: number) => string;
  hour: string;
  hours: (n: number) => string;
  day: string;
  days: (n: number) => string;
  month: string;
  months: (n: number) => string;
  year: string;
  years: (n: number) => string;
}

export interface DateTimeOptions {
  format?: string | undefined;
  utc?: boolean | undefined;
  timezone?: string | undefined;
  locale?: string | undefined;
}

export const EN_LOCALE: RelativeLocale = {
  future: (s) => `in ${s}`,
  past: (s) => `${s} ago`,
  seconds: "a few seconds",
  minute: "a minute",
  minutes: (n) => `${n} minutes`,
  hour: "an hour",
  hours: (n) => `${n} hours`,
  day: "a day",
  days: (n) => `${n} days`,
  month: "a month",
  months: (n) => `${n} months`,
  year: "a year",
  years: (n) => `${n} years`,
};

export const AR_LOCALE: RelativeLocale = {
  future: (s) => `خلال ${s}`,
  past: (s) => `منذ ${s}`,
  seconds: "بضع ثوان",
  minute: "دقيقة",
  minutes: (n) => `${n} دقائق`,
  hour: "ساعة",
  hours: (n) => `${n} ساعات`,
  day: "يوم",
  days: (n) => `${n} أيام`,
  month: "شهر",
  months: (n) => `${n} أشهر`,
  year: "سنة",
  years: (n) => `${n} سنوات`,
};

export const LOCALES: Record<string, RelativeLocale> = {
  en: EN_LOCALE,
  ar: AR_LOCALE,
};

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function normalizeUnit(unit: DateUnit): "ms" | "s" | "m" | "h" | "d" | "w" | "M" | "y" {
  switch (unit) {
    case "millisecond": case "milliseconds": case "ms": return "ms";
    case "second": case "seconds": case "s": return "s";
    case "minute": case "minutes": case "m": return "m";
    case "hour": case "hours": case "h": return "h";
    case "day": case "days": case "d": return "d";
    case "week": case "weeks": case "w": return "w";
    case "month": case "months": case "M": return "M";
    case "year": case "years": case "y": return "y";
    default: return "ms";
  }
}

export function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month1Indexed: number): number {
  return new Date(Date.UTC(year, month1Indexed, 0)).getUTCDate();
}

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  weekday: number;
}

export function getZonedParts(date: Date, timeZone: string): ZonedDateParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const getP = (type: string): string => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : "0";
  };

  return {
    year: parseInt(getP("year"), 10),
    month: parseInt(getP("month"), 10),
    day: parseInt(getP("day"), 10),
    hour: parseInt(getP("hour"), 10) % 24,
    minute: parseInt(getP("minute"), 10),
    second: parseInt(getP("second"), 10),
    millisecond: date.getUTCMilliseconds(),
    weekday: date.getDay(),
  };
}

export function zonedPartsToEpoch(parts: Omit<ZonedDateParts, "weekday">): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
}
