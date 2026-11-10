/**
 * mix-helpers/data — Deep Object Merging, Cloning & Structural Equality
 *
 * 100% zero external dependencies. Prototype-pollution protected.
 */

import { PROTOTYPE_POLLUTION_KEYS } from "./path.js";

export function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (val === null || typeof val !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
}

export function merge<T extends object>(target: T, ...sources: unknown[]): T {
  if (!target || typeof target !== "object") return target;
  const tgtRecord = target as Record<PropertyKey, unknown>;
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const srcRecord = source as Record<PropertyKey, unknown>;
    for (const key of Object.keys(srcRecord)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      const srcVal = srcRecord[key];
      const tgtVal = tgtRecord[key];
      if (isPlainObject(srcVal)) {
        if (!isPlainObject(tgtVal)) {
          tgtRecord[key] = {};
        }
        merge(tgtRecord[key] as Record<PropertyKey, unknown>, srcVal);
      } else {
        tgtRecord[key] = srcVal;
      }
    }
  }
  return target;
}

export function defaults<T extends object>(target: T, ...sources: unknown[]): T {
  if (!target || typeof target !== "object") return target;
  const tgtRecord = target as Record<PropertyKey, unknown>;
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const srcRecord = source as Record<PropertyKey, unknown>;
    for (const key of Object.keys(srcRecord)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (tgtRecord[key] === undefined) {
        tgtRecord[key] = srcRecord[key];
      }
    }
  }
  return target;
}

export function defaultsDeep<T extends object>(target: T, ...sources: unknown[]): T {
  if (!target || typeof target !== "object") return target;
  const tgtRecord = target as Record<PropertyKey, unknown>;
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const srcRecord = source as Record<PropertyKey, unknown>;
    for (const key of Object.keys(srcRecord)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      const srcVal = srcRecord[key];
      const tgtVal = tgtRecord[key];
      if (tgtVal === undefined) {
        tgtRecord[key] = cloneDeep(srcVal);
      } else if (isPlainObject(tgtVal) && isPlainObject(srcVal)) {
        defaultsDeep(tgtVal, srcVal);
      }
    }
  }
  return target;
}

export function cloneDeep<T>(value: T, hash = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const objVal = value as object;
  if (hash.has(objVal)) return hash.get(objVal) as T;

  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as unknown as T;
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>();
    hash.set(objVal, copy);
    value.forEach((v) => copy.add(cloneDeep(v, hash)));
    return copy as unknown as T;
  }
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    hash.set(objVal, copy);
    value.forEach((v, k) => copy.set(cloneDeep(k, hash), cloneDeep(v, hash)));
    return copy as unknown as T;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const typedSlice = (value as unknown as { slice: () => unknown }).slice();
    return typedSlice as T;
  }

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    hash.set(objVal, copy);
    for (let i = 0; i < value.length; i++) {
      copy[i] = cloneDeep(value[i], hash);
    }
    return copy as unknown as T;
  }

  const copy = Object.create(Object.getPrototypeOf(value) as object | null) as Record<PropertyKey, unknown>;
  hash.set(objVal, copy);
  const srcRecord = value as Record<PropertyKey, unknown>;
  for (const key of Object.keys(srcRecord)) {
    if (!PROTOTYPE_POLLUTION_KEYS.has(key)) {
      copy[key] = cloneDeep(srcRecord[key], hash);
    }
  }
  return copy as T;
}

export function isEqual(a: unknown, b: unknown, hash = new WeakMap<object, unknown>()): boolean {
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

  const recA = a as Record<PropertyKey, unknown>;
  const recB = b as Record<PropertyKey, unknown>;
  const keysA = Object.keys(recA).filter((k) => !PROTOTYPE_POLLUTION_KEYS.has(k));
  const keysB = Object.keys(recB).filter((k) => !PROTOTYPE_POLLUTION_KEYS.has(k));
  if (keysA.length !== keysB.length) return false;

  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(recB, k) || !isEqual(recA[k], recB[k], hash)) {
      return false;
    }
  }
  return true;
}
