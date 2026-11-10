/**
 * mix-helpers/data — Array & Collection Transformation Utilities
 */

export type Iteratee<T, R = unknown> = PropertyKey | ((item: T) => R);

export function resolveIteratee<T, R = unknown>(iteratee: Iteratee<T, R>): (item: T) => R {
  if (typeof iteratee === "function") {
    return iteratee;
  }
  return (item: T) => {
    if (item !== null && item !== undefined && typeof item === "object") {
      return (item as Record<PropertyKey, unknown>)[iteratee] as R;
    }
    return undefined as R;
  };
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

export function uniqBy<T>(arr: readonly T[], iteratee: Iteratee<T>): T[] {
  const seen = new Set<unknown>();
  const result: T[] = [];
  const fn = resolveIteratee(iteratee);
  for (const item of arr) {
    const key = fn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export function flatten<T = unknown>(arr: readonly unknown[]): T[] {
  return arr.flat(1) as T[];
}

export function flattenDeep<T = unknown>(arr: readonly unknown[]): T[] {
  return arr.flat(Infinity) as T[];
}

export function groupBy<T>(
  arr: readonly T[],
  iteratee: Iteratee<T, string | number>
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  const fn = resolveIteratee(iteratee);
  for (const item of arr) {
    const key = String(fn(item));
    if (!result[key]) result[key] = [];
    result[key]!.push(item);
  }
  return result;
}

export function keyBy<T>(
  arr: readonly T[],
  iteratee: Iteratee<T, string | number>
): Record<string, T> {
  const result: Record<string, T> = {};
  const fn = resolveIteratee(iteratee);
  for (const item of arr) {
    const key = String(fn(item));
    result[key] = item;
  }
  return result;
}

export function countBy<T>(
  arr: readonly T[],
  iteratee: Iteratee<T, string | number>
): Record<string, number> {
  const result: Record<string, number> = {};
  const fn = resolveIteratee(iteratee);
  for (const item of arr) {
    const key = String(fn(item));
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

export function orderBy<T>(
  arr: readonly T[],
  iteratees: readonly Iteratee<T>[],
  orders: readonly ("asc" | "desc")[] = []
): T[] {
  const copy = [...arr];
  const fns = iteratees.map((it) => resolveIteratee(it));
  return copy.sort((a, b) => {
    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i]!;
      const order = orders[i] || "asc";
      const valA = fn(a) as string | number;
      const valB = fn(b) as string | number;
      if (valA !== valB) {
        const cmp = valA > valB ? 1 : -1;
        return order === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
}

export function sortBy<T>(arr: readonly T[], iteratee: Iteratee<T>): T[] {
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

export function zip<T>(...arrays: (readonly T[])[]): T[][] {
  if (arrays.length === 0) return [];
  const maxLen = Math.max(...arrays.map((a) => a.length));
  const result: T[][] = [];
  for (let i = 0; i < maxLen; i++) {
    result.push(arrays.map((a) => a[i] as T));
  }
  return result;
}
