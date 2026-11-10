/**
 * mix-helpers/data — Safe Deep Path Access & Object Projection Utilities
 *
 * 100% zero external dependencies. Prototype-pollution protected.
 */

export const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function toPath(path: string | readonly (string | number)[]): (string | number)[] {
  if (Array.isArray(path)) return [...path];
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

export function get<T = unknown>(
  obj: unknown,
  path: string | readonly (string | number)[],
  defaultValue?: T
): T {
  if (obj === null || obj === undefined) return defaultValue as T;
  const segments = toPath(path);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return defaultValue as T;
    }
    current = (current as Record<PropertyKey, unknown>)[seg];
  }
  return current === undefined ? (defaultValue as T) : (current as T);
}

export function set<T = unknown>(
  obj: T,
  path: string | readonly (string | number)[],
  value: unknown
): T {
  if (obj === null || typeof obj !== "object") return obj;
  const segments = toPath(path);
  let current: Record<PropertyKey, unknown> = obj as Record<PropertyKey, unknown>;
  for (let i = 0; i < segments.length; i++) {
    const key = segments[i]!;
    if (typeof key === "string" && PROTOTYPE_POLLUTION_KEYS.has(key)) {
      // Prototype-pollution guard: reject manipulation of __proto__, constructor, prototype
      return obj;
    }
    if (i === segments.length - 1) {
      current[key] = value;
    } else {
      const nextVal = current[key];
      if (nextVal === null || typeof nextVal !== "object") {
        const nextKey = segments[i + 1]!;
        current[key] = typeof nextKey === "number" ? [] : {};
      }
      current = current[key] as Record<PropertyKey, unknown>;
    }
  }
  return obj;
}

export function unset(obj: unknown, path: string | readonly (string | number)[]): boolean {
  if (obj === null || typeof obj !== "object") return false;
  const segments = toPath(path);
  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]!;
    if (typeof key === "string" && PROTOTYPE_POLLUTION_KEYS.has(key)) return false;
    if (current === null || typeof current !== "object") return false;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  const lastKey = segments[segments.length - 1];
  if (
    lastKey !== undefined &&
    current !== null &&
    typeof current === "object" &&
    !PROTOTYPE_POLLUTION_KEYS.has(String(lastKey))
  ) {
    if (Array.isArray(current) && typeof lastKey === "number") {
      current.splice(lastKey, 1);
      return true;
    }
    return delete (current as Record<PropertyKey, unknown>)[lastKey];
  }
  return false;
}

export function has(obj: unknown, path: string | readonly (string | number)[]): boolean {
  if (obj === null || obj === undefined) return false;
  const segments = toPath(path);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || typeof current !== "object") return false;
    if (typeof seg === "string" && PROTOTYPE_POLLUTION_KEYS.has(seg)) return false;
    if (!(seg in current)) return false;
    current = (current as Record<PropertyKey, unknown>)[seg];
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
  const result: Record<PropertyKey, unknown> = {};
  if (!obj || typeof obj !== "object") return result as Omit<T, K>;
  const keySet = new Set<PropertyKey>(keys as readonly PropertyKey[]);
  for (const key of Object.keys(obj)) {
    if (!keySet.has(key) && !PROTOTYPE_POLLUTION_KEYS.has(key)) {
      result[key] = (obj as Record<PropertyKey, unknown>)[key];
    }
  }
  return result as Omit<T, K>;
}
