/**
 * mix-helpers/web — dotMix Web, Query, Crypto/IDs, EventBus, Formatters & Storage
 *
 * 100% zero external dependencies. Prototype-pollution protected.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function parseQuery(queryString: string): Record<string, any> {
  const result: Record<string, any> = {};
  if (!queryString) return result;

  const clean = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  if (!clean) return result;

  const pairs = clean.split("&");
  for (const pair of pairs) {
    if (!pair) continue;
    const eqIdx = pair.indexOf("=");
    const rawKey = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair;
    const rawVal = eqIdx >= 0 ? pair.slice(eqIdx + 1) : "";

    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    const val = decodeURIComponent(rawVal.replace(/\+/g, " "));

    // Check bracket syntax: e.g. filter[category]=books or tags[] or tags
    const match = key.match(/^([^[]+)\[(.*)\]$/);
    if (match) {
      const rootKey = match[1]!;
      const subKey = match[2]!;
      if (PROTOTYPE_POLLUTION_KEYS.has(rootKey) || PROTOTYPE_POLLUTION_KEYS.has(subKey)) {
        continue;
      }

      if (subKey === "") {
        // array e.g. tags[]=a
        if (!Array.isArray(result[rootKey])) {
          result[rootKey] = result[rootKey] !== undefined ? [result[rootKey]] : [];
        }
        result[rootKey].push(val);
      } else {
        // object e.g. filter[category]=books
        if (!result[rootKey] || typeof result[rootKey] !== "object" || Array.isArray(result[rootKey])) {
          result[rootKey] = {};
        }
        result[rootKey][subKey] = val;
      }
    } else {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (result[key] !== undefined) {
        if (!Array.isArray(result[key])) {
          result[key] = [result[key]];
        }
        result[key].push(val);
      } else {
        result[key] = val;
      }
    }
  }

  return result;
}

export function stringifyQuery(
  obj: Record<string, any>,
  options: { arrayFormat?: "repeat" | "brackets" | "comma"; skipNulls?: boolean } = {}
): string {
  if (!obj || typeof obj !== "object") return "";
  const arrayFormat = options.arrayFormat ?? "repeat";
  const skipNulls = options.skipNulls ?? true;
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    if (value === undefined || (skipNulls && value === null)) continue;

    const encKey = encodeURIComponent(key);

    if (Array.isArray(value)) {
      if (arrayFormat === "comma") {
        parts.push(`${encKey}=${encodeURIComponent(value.join(","))}`);
      } else if (arrayFormat === "brackets") {
        for (const item of value) {
          parts.push(`${encKey}%5B%5D=${encodeURIComponent(String(item))}`);
        }
      } else {
        for (const item of value) {
          parts.push(`${encKey}=${encodeURIComponent(String(item))}`);
        }
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [subKey, subVal] of Object.entries(value)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(subKey)) continue;
        parts.push(`${encKey}%5B${encodeURIComponent(subKey)}%5D=${encodeURIComponent(String(subVal))}`);
      }
    } else {
      parts.push(`${encKey}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.join("&");
}

export function uuidv4(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // Variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const NANO_ALPHABET = "useandom-26T1983_40STOpfunkgTYhMVIILecrvj";

export function nanoid(size = 21): string {
  const bytes = new Uint8Array(size);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let id = "";
  for (let i = 0; i < size; i++) {
    id += NANO_ALPHABET[bytes[i]! % NANO_ALPHABET.length];
  }
  return id;
}

export async function sha256(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (globalThis.crypto?.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback to node:crypto if available in Node environment
  try {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(data).digest("hex");
  } catch {
    throw new Error("Crypto environment does not support SHA-256");
  }
}

export function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

export interface EventBus<Events extends Record<string, any> = Record<string, any>> {
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void;
  once<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void;
  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void;
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
  clear(event?: keyof Events): void;
}

export function createEventBus<Events extends Record<string, any> = Record<string, any>>(): EventBus<Events> {
  const map = new Map<keyof Events, Set<(payload: any) => void>>();

  return {
    on(event, handler) {
      if (!map.has(event)) map.set(event, new Set());
      map.get(event)!.add(handler);
      return () => this.off(event, handler);
    },
    once(event, handler) {
      const wrapper = (payload: any) => {
        this.off(event, wrapper);
        handler(payload);
      };
      return this.on(event, wrapper);
    },
    off(event, handler) {
      map.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const handlers = map.get(event);
      if (handlers) {
        handlers.forEach((h) => h(payload));
      }
    },
    clear(event) {
      if (event !== undefined) {
        map.delete(event);
      } else {
        map.clear();
      }
    }
  };
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, options).format(n);
}

export function formatCurrency(n: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
}

export function formatPercent(n: number, decimals = 1, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes <= 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, BYTE_UNITS.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${Number(val.toFixed(decimals))} ${BYTE_UNITS[idx]}`;
}

export interface StorageOptions {
  prefix?: string;
  ttlMs?: number;
  driver?: "local" | "session" | "memory";
}

export interface StorageWrapper<T = any> {
  get(key: string): T | null;
  set(key: string, value: T, ttlMs?: number): void;
  remove(key: string): void;
  clear(): void;
}

export function createStorage<T = any>(options: StorageOptions = {}): StorageWrapper<T> {
  const prefix = options.prefix ?? "dotmix_";
  const defaultTtl = options.ttlMs;
  const memoryStore = new Map<string, string>();

  function getRaw(key: string): string | null {
    if (options.driver === "session" && typeof sessionStorage !== "undefined") {
      return sessionStorage.getItem(prefix + key);
    }
    if (typeof localStorage !== "undefined" && options.driver !== "memory") {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return memoryStore.get(prefix + key) ?? null;
      }
    }
    return memoryStore.get(prefix + key) ?? null;
  }

  function setRaw(key: string, val: string): void {
    if (options.driver === "session" && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(prefix + key, val);
      return;
    }
    if (typeof localStorage !== "undefined" && options.driver !== "memory") {
      try {
        localStorage.setItem(prefix + key, val);
        return;
      } catch {
        memoryStore.set(prefix + key, val);
        return;
      }
    }
    memoryStore.set(prefix + key, val);
  }

  function removeRaw(key: string): void {
    if (options.driver === "session" && typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(prefix + key);
      return;
    }
    if (typeof localStorage !== "undefined" && options.driver !== "memory") {
      try {
        localStorage.removeItem(prefix + key);
        return;
      } catch {
        memoryStore.delete(prefix + key);
        return;
      }
    }
    memoryStore.delete(prefix + key);
  }

  return {
    get(key: string): T | null {
      const raw = getRaw(key);
      if (!raw) return null;
      try {
        const item = JSON.parse(raw);
        if (item && typeof item === "object" && "value" in item) {
          if (item.expiresAt && Date.now() > item.expiresAt) {
            removeRaw(key);
            return null;
          }
          return item.value as T;
        }
        return item as T;
      } catch {
        return null;
      }
    },
    set(key: string, value: T, ttlMs?: number): void {
      const ttl = ttlMs ?? defaultTtl;
      const item = {
        value,
        expiresAt: ttl ? Date.now() + ttl : undefined
      };
      setRaw(key, JSON.stringify(item));
    },
    remove(key: string): void {
      removeRaw(key);
    },
    clear(): void {
      memoryStore.clear();
    }
  };
}

