/**
 * mix-helpers/data — dotMix Pure Data & Function Utilities (`dot` namespace)
 *
 * 100% zero external dependencies. Prototype-pollution protected.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function toPath(path: string | readonly (string | number)[]): (string | number)[] {
  if (Array.isArray(path)) return path;
  if (typeof path !== "string") return [];
  const parts: (string | number)[] = [];
  const regex = /[^.[\]]+|\[(?:(-?\d+)|(["'])(.*?)\2)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    if (match[1] !== undefined) {
      parts.push(parseInt(match[1], 10));
    } else if (match[3] !== undefined) {
      parts.push(match[3]);
    } else {
      const seg = match[0];
      const num = Number(seg);
      if (!Number.isNaN(num) && seg.trim() !== "") {
        parts.push(num);
      } else {
        parts.push(seg);
      }
    }
  }
  return parts;
}

export function get<T = any>(obj: any, path: string | readonly (string | number)[], defaultValue?: T): T {
  if (obj === null || obj === undefined) return defaultValue as T;
  const segments = toPath(path);
  let current: any = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return defaultValue as T;
    }
    current = current[seg];
  }
  return current === undefined ? (defaultValue as T) : (current as T);
}

export function set<T = any>(obj: any, path: string | readonly (string | number)[], value: any): T {
  if (obj === null || typeof obj !== "object") return obj;
  const segments = toPath(path);
  let current: any = obj;
  for (let i = 0; i < segments.length; i++) {
    const key = segments[i]!;
    if (typeof key === "string" && PROTOTYPE_POLLUTION_KEYS.has(key)) {
      // Prototype-pollution guard: reject manipulation of __proto__, constructor, prototype
      return obj;
    }
    if (i === segments.length - 1) {
      current[key] = value;
    } else {
      if (current[key] === null || typeof current[key] !== "object") {
        const nextKey = segments[i + 1]!;
        current[key] = typeof nextKey === "number" ? [] : {};
      }
      current = current[key];
    }
  }
  return obj;
}

export function unset(obj: any, path: string | readonly (string | number)[]): boolean {
  if (obj === null || typeof obj !== "object") return false;
  const segments = toPath(path);
  let current: any = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]!;
    if (typeof key === "string" && PROTOTYPE_POLLUTION_KEYS.has(key)) return false;
    if (current === null || typeof current !== "object") return false;
    current = current[key];
  }
  const lastKey = segments[segments.length - 1];
  if (lastKey !== undefined && current && typeof current === "object" && !PROTOTYPE_POLLUTION_KEYS.has(String(lastKey))) {
    if (Array.isArray(current) && typeof lastKey === "number") {
      current.splice(lastKey, 1);
      return true;
    }
    return delete current[lastKey];
  }
  return false;
}

export function has(obj: any, path: string | readonly (string | number)[]): boolean {
  if (obj === null || obj === undefined) return false;
  const segments = toPath(path);
  let current: any = obj;
  for (const seg of segments) {
    if (current === null || typeof current !== "object") return false;
    if (typeof seg === "string" && PROTOTYPE_POLLUTION_KEYS.has(seg)) return false;
    if (!(seg in current)) return false;
    current = current[seg];
  }
  return true;
}

export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  if (!obj || typeof obj !== "object") return result;
  for (const key of keys) {
    if (key in obj && !PROTOTYPE_POLLUTION_KEYS.has(String(key))) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const result = {} as any;
  if (!obj || typeof obj !== "object") return result;
  const keySet = new Set<any>(keys);
  for (const key of Object.keys(obj)) {
    if (!keySet.has(key) && !PROTOTYPE_POLLUTION_KEYS.has(key)) {
      result[key] = (obj as any)[key];
    }
  }
  return result;
}

export function merge<T extends object>(target: T, ...sources: any[]): T {
  if (!target || typeof target !== "object") return target;
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of Object.keys(source)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      const srcVal = source[key];
      const tgtVal = (target as any)[key];
      if (isPlainObject(srcVal)) {
        if (!isPlainObject(tgtVal)) {
          (target as any)[key] = {};
        }
        merge((target as any)[key], srcVal);
      } else {
        (target as any)[key] = srcVal;
      }
    }
  }
  return target;
}

export function defaults<T extends object>(target: T, ...sources: any[]): T {
  if (!target || typeof target !== "object") return target;
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of Object.keys(source)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if ((target as any)[key] === undefined) {
        (target as any)[key] = source[key];
      }
    }
  }
  return target;
}

export function defaultsDeep<T extends object>(target: T, ...sources: any[]): T {
  if (!target || typeof target !== "object") return target;
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of Object.keys(source)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      const srcVal = source[key];
      const tgtVal = (target as any)[key];
      if (tgtVal === undefined) {
        (target as any)[key] = cloneDeep(srcVal);
      } else if (isPlainObject(tgtVal) && isPlainObject(srcVal)) {
        defaultsDeep(tgtVal, srcVal);
      }
    }
  }
  return target;
}

export function cloneDeep<T>(value: T, hash = new WeakMap<any, any>()): T {
  if (value === null || typeof value !== "object") return value;
  if (hash.has(value as any)) return hash.get(value as any);

  if (value instanceof Date) {
    return new Date(value.getTime()) as any;
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as any;
  }
  if (value instanceof Set) {
    const copy = new Set();
    hash.set(value as any, copy);
    value.forEach((v) => copy.add(cloneDeep(v, hash)));
    return copy as any;
  }
  if (value instanceof Map) {
    const copy = new Map();
    hash.set(value as any, copy);
    value.forEach((v, k) => copy.set(cloneDeep(k, hash), cloneDeep(v, hash)));
    return copy as any;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return (value as any).slice();
  }

  if (Array.isArray(value)) {
    const copy: any[] = [];
    hash.set(value, copy);
    for (let i = 0; i < value.length; i++) {
      copy[i] = cloneDeep(value[i], hash);
    }
    return copy as any;
  }

  const copy = Object.create(Object.getPrototypeOf(value));
  hash.set(value, copy);
  for (const key of Object.keys(value)) {
    if (!PROTOTYPE_POLLUTION_KEYS.has(key)) {
      copy[key] = cloneDeep((value as any)[key], hash);
    }
  }
  return copy as T;
}

export function isEqual(a: any, b: any, hash = new WeakMap<any, any>()): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") {
    return false;
  }
  if (hash.has(a) && hash.get(a) === b) return true;
  hash.set(a, b);

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) {
      let found = false;
      for (const bv of b) {
        if (isEqual(v, bv, hash)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !isEqual(v, b.get(k), hash)) return false;
    }
    return true;
  }

  const keysA = Object.keys(a).filter((k) => !PROTOTYPE_POLLUTION_KEYS.has(k));
  const keysB = Object.keys(b).filter((k) => !PROTOTYPE_POLLUTION_KEYS.has(k));
  if (keysA.length !== keysB.length) return false;

  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !isEqual(a[k], b[k], hash)) {
      return false;
    }
  }
  return true;
}

export function isEmpty(val: any): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "boolean" || typeof val === "number") return true;
  if (typeof val === "string" || Array.isArray(val)) return val.length === 0;
  if (val instanceof Map || val instanceof Set) return val.size === 0;
  if (typeof val === "object") return Object.keys(val).length === 0;
  return true;
}

export function isPlainObject(val: any): val is Record<string, any> {
  if (val === null || typeof val !== "object") return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
}

export function isNil(val: any): val is null | undefined {
  return val === null || val === undefined;
}

export function isNumber(val: any): val is number {
  return typeof val === "number" && !Number.isNaN(val);
}

export function isString(val: any): val is string {
  return typeof val === "string";
}

export function isBoolean(val: any): val is boolean {
  return typeof val === "boolean";
}

export function isFunction(val: any): val is (...args: any[]) => any {
  return typeof val === "function";
}

export function isDate(val: any): val is Date {
  return val instanceof Date && !Number.isNaN(val.getTime());
}

export function isRegExp(val: any): val is RegExp {
  return val instanceof RegExp;
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const s = Math.max(1, Math.floor(size));
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += s) {
    result.push(arr.slice(i, i + s));
  }
  return result;
}

export function compact<T>(arr: readonly (T | null | undefined | false | 0 | "")[]): T[] {
  return arr.filter(Boolean) as T[];
}

export function uniq<T>(arr: readonly T[]): T[] {
  return Array.from(new Set(arr));
}

export function uniqBy<T>(arr: readonly T[], iteratee: string | ((item: T) => any)): T[] {
  const seen = new Set();
  const result: T[] = [];
  const fn = typeof iteratee === "function" ? iteratee : (item: any) => item[iteratee];
  for (const item of arr) {
    const key = fn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export function flatten<T>(arr: readonly any[]): T[] {
  return arr.flat(1) as T[];
}

export function flattenDeep<T>(arr: readonly any[]): T[] {
  return arr.flat(Infinity) as T[];
}

export function groupBy<T>(
  arr: readonly T[],
  iteratee: string | ((item: T) => string | number)
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  const fn = typeof iteratee === "function" ? iteratee : (item: any) => item[iteratee];
  for (const item of arr) {
    const key = String(fn(item));
    if (!result[key]) result[key] = [];
    result[key]!.push(item);
  }
  return result;
}

export function keyBy<T>(
  arr: readonly T[],
  iteratee: string | ((item: T) => string | number)
): Record<string, T> {
  const result: Record<string, T> = {};
  const fn = typeof iteratee === "function" ? iteratee : (item: any) => item[iteratee];
  for (const item of arr) {
    const key = String(fn(item));
    result[key] = item;
  }
  return result;
}

export function countBy<T>(
  arr: readonly T[],
  iteratee: string | ((item: T) => string | number)
): Record<string, number> {
  const result: Record<string, number> = {};
  const fn = typeof iteratee === "function" ? iteratee : (item: any) => item[iteratee];
  for (const item of arr) {
    const key = String(fn(item));
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

export function orderBy<T>(
  arr: readonly T[],
  iteratees: (string | ((item: T) => any))[],
  orders: ("asc" | "desc")[] = []
): T[] {
  const copy = [...arr];
  return copy.sort((a, b) => {
    for (let i = 0; i < iteratees.length; i++) {
      const it = iteratees[i]!;
      const order = orders[i] || "asc";
      const valA = typeof it === "function" ? it(a) : (a as any)[it];
      const valB = typeof it === "function" ? it(b) : (b as any)[it];
      if (valA !== valB) {
        const cmp = valA > valB ? 1 : -1;
        return order === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
}

export function sortBy<T>(arr: readonly T[], iteratee: string | ((item: T) => any)): T[] {
  return orderBy(arr, [iteratee], ["asc"]);
}

export function partition<T>(arr: readonly T[], predicate: (item: T) => boolean): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const item of arr) {
    if (predicate(item)) {
      pass.push(item);
    } else {
      fail.push(item);
    }
  }
  return [pass, fail];
}

export function difference<T>(arr: readonly T[], ...exclude: (readonly T[])[]): T[] {
  const excludeSet = new Set(exclude.flat());
  return arr.filter((x) => !excludeSet.has(x));
}

export function intersection<T>(...arrays: (readonly T[])[]): T[] {
  if (arrays.length === 0) return [];
  const first = arrays[0]!;
  return first.filter((item) => arrays.every((arr) => arr.includes(item)));
}

export function words(str: string): string[] {
  if (!str) return [];
  const matches = str.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|[0-9]+/g);
  return matches || [];
}

export function camelCase(str: string): string {
  const w = words(str);
  if (w.length === 0) return "";
  return (
    w[0]!.toLowerCase() +
    w
      .slice(1)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("")
  );
}

export function kebabCase(str: string): string {
  return words(str)
    .map((word) => word.toLowerCase())
    .join("-");
}

export function snakeCase(str: string): string {
  return words(str)
    .map((word) => word.toLowerCase())
    .join("_");
}

export function pascalCase(str: string): string {
  return words(str)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(str: string, options: { length?: number; omission?: string } = {}): string {
  const len = options.length ?? 30;
  const omission = options.omission ?? "...";
  if (str.length <= len) return str;
  return str.slice(0, Math.max(0, len - omission.length)) + omission;
}

export interface DebouncedFunction<F extends (...args: any[]) => any> {
  (...args: Parameters<F>): void;
  cancel(): void;
  flush(): void;
  pending(): boolean;
}

export function debounce<F extends (...args: any[]) => any>(
  fn: F,
  waitMs: number,
  options: { leading?: boolean; trailing?: boolean; maxWait?: number } = {}
): DebouncedFunction<F> {
  const leading = options.leading ?? false;
  const trailing = options.trailing ?? true;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<F> | null = null;
  let lastCallTime: number | null = null;

  function invoke() {
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
    timerId = null;
  }

  const debounced = function (...args: Parameters<F>) {
    lastArgs = args;
    const now = Date.now();
    const isFirstCall = lastCallTime === null;
    lastCallTime = now;

    if (isFirstCall && leading) {
      invoke();
      return;
    }

    if (timerId !== null) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(() => {
      if (trailing) {
        invoke();
      } else {
        lastArgs = null;
        timerId = null;
      }
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    lastArgs = null;
    lastCallTime = null;
  };

  debounced.flush = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      invoke();
    }
  };

  debounced.pending = () => timerId !== null;

  return debounced as DebouncedFunction<F>;
}

export function throttle<F extends (...args: any[]) => any>(
  fn: F,
  waitMs: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): DebouncedFunction<F> {
  return debounce(fn, waitMs, {
    leading: options.leading ?? true,
    trailing: options.trailing ?? true,
    maxWait: waitMs
  });
}

export function once<F extends (...args: any[]) => any>(fn: F): F {
  let called = false;
  let result: any;
  return function (...args: Parameters<F>) {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  } as F;
}

export function memoize<F extends (...args: any[]) => any>(
  fn: F,
  resolver?: (...args: Parameters<F>) => any
): F & { cache: Map<any, any> } {
  const cache = new Map<any, any>();
  const memoized = function (...args: Parameters<F>) {
    const key = resolver ? resolver(...args) : args[0];
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
  memoized.cache = cache;
  return memoized as any;
}

export function pipe(...fns: ((arg: any) => any)[]): (input: any) => any {
  return (input: any) => fns.reduce((acc, fn) => fn(acc), input);
}

export function compose(...fns: ((arg: any) => any)[]): (input: any) => any {
  return (input: any) => fns.reduceRight((acc, fn) => fn(acc), input);
}

export const dot = {
  get,
  set,
  unset,
  has,
  pick,
  omit,
  merge,
  defaults,
  defaultsDeep,
  cloneDeep,
  isEqual,
  isEmpty,
  isPlainObject,
  isNil,
  isNumber,
  isString,
  isBoolean,
  isFunction,
  isDate,
  isRegExp,
  chunk,
  compact,
  uniq,
  uniqBy,
  flatten,
  flattenDeep,
  groupBy,
  keyBy,
  countBy,
  orderBy,
  sortBy,
  partition,
  difference,
  intersection,
  words,
  camelCase,
  kebabCase,
  snakeCase,
  pascalCase,
  slugify,
  truncate,
  debounce,
  throttle,
  once,
  memoize,
  pipe,
  compose
};

