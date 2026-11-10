/**
 * mix-helpers/data — Type Predicates & Numeric Aggregation Utilities
 */

import { type Iteratee, resolveIteratee } from "./collection.js";

export function isEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "boolean" || typeof val === "number") return true;
  if (typeof val === "string" || Array.isArray(val)) return val.length === 0;
  if (val instanceof Map || val instanceof Set) return val.size === 0;
  if (typeof val === "object") return Object.keys(val).length === 0;
  return true;
}

export function isNil(val: unknown): val is null | undefined {
  return val === null || val === undefined;
}

export function isNumber(val: unknown): val is number {
  return typeof val === "number" && !Number.isNaN(val);
}

export function isString(val: unknown): val is string {
  return typeof val === "string";
}

export function isBoolean(val: unknown): val is boolean {
  return typeof val === "boolean";
}

export function isFunction(val: unknown): val is (...args: never[]) => unknown {
  return typeof val === "function";
}

export function isDate(val: unknown): val is Date {
  return val instanceof Date && !Number.isNaN(val.getTime());
}

export function isRegExp(val: unknown): val is RegExp {
  return val instanceof RegExp;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function sumBy<T>(arr: readonly T[], iteratee?: Iteratee<T, number>): number {
  const fn = iteratee ? resolveIteratee(iteratee) : (x: T) => Number(x);
  let sum = 0;
  for (const item of arr) {
    sum += Number(fn(item)) || 0;
  }
  return sum;
}

export function meanBy<T>(arr: readonly T[], iteratee?: Iteratee<T, number>): number {
  if (arr.length === 0) return Number.NaN;
  return sumBy(arr, iteratee) / arr.length;
}

export function minBy<T>(arr: readonly T[], iteratee?: Iteratee<T, number>): T | undefined {
  if (arr.length === 0) return undefined;
  const fn = iteratee ? resolveIteratee(iteratee) : (x: T) => Number(x);
  let best = arr[0]!;
  let bestVal = fn(best);
  for (let i = 1; i < arr.length; i++) {
    const val = fn(arr[i]!);
    if (val < bestVal) {
      bestVal = val;
      best = arr[i]!;
    }
  }
  return best;
}

export function maxBy<T>(arr: readonly T[], iteratee?: Iteratee<T, number>): T | undefined {
  if (arr.length === 0) return undefined;
  const fn = iteratee ? resolveIteratee(iteratee) : (x: T) => Number(x);
  let best = arr[0]!;
  let bestVal = fn(best);
  for (let i = 1; i < arr.length; i++) {
    const val = fn(arr[i]!);
    if (val > bestVal) {
      bestVal = val;
      best = arr[i]!;
    }
  }
  return best;
}

export function range(start: number, end?: number, step?: number): number[] {
  let s = start;
  let e = end;
  if (e === undefined) {
    e = start;
    s = 0;
  }
  const st = step ?? (s < e ? 1 : -1);
  if (st === 0) return [];
  const result: number[] = [];
  if (st > 0) {
    for (let i = s; i < e; i += st) {
      result.push(i);
    }
  } else {
    for (let i = s; i > e; i += st) {
      result.push(i);
    }
  }
  return result;
}

export function randomInt(min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}
