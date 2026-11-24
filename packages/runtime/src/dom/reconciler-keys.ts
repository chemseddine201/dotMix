import { MixError, DiagnosticCodes } from "../errors.js";
import { reportWarning } from "../core/index.js";

export type KeyMode = "explicit" | "implicit";

export interface KeyedEachLocation {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly collection?: string;
  readonly keyExpr?: string;
  readonly itemIdent?: string;
  readonly indexIdent?: string | null;
}

export interface KeyedEachOptions {
  readonly mode?: KeyMode;
  readonly loc?: KeyedEachLocation;
}

export interface DuplicateKeyTracker {
  readonly duplicateTokens: Map<unknown, Map<number, symbol>>;
  warnedDuplicate: boolean;
}

export function isValidPrimitiveKey(v: unknown): v is string | number | symbol {
  return typeof v === "string" || typeof v === "symbol" || (typeof v === "number" && Number.isFinite(v));
}

export function resolveImplicitKey(item: unknown): unknown {
  if (item !== null && (typeof item === "object" || typeof item === "function")) {
    const r = item as Record<string, unknown>;
    if ("id" in r && isValidPrimitiveKey(r.id)) return r.id;
    if ("key" in r && isValidPrimitiveKey(r.key)) return r.key;
  }
  return item;
}

function previewKey(v: unknown): string {
  let s: string;
  if (v === null || v === undefined || typeof v === "symbol") s = String(v);
  else if (typeof v === "function") s = `[Function ${(v as { name?: string }).name || "anonymous"}]`;
  else if (typeof v === "object") {
    try { s = JSON.stringify(v) ?? "{}"; }
    catch { s = `{${Object.keys(v as Record<string, unknown>).slice(0, 4).join(", ")}}`; }
  } else s = typeof v === "string" ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

function fmtEach(loc: KeyedEachLocation): string {
  return `{each (${loc.itemIdent ?? "item"}${loc.indexIdent ? `, ${loc.indexIdent}` : ""}${loc.keyExpr ? `, ${loc.keyExpr}` : ""}) in ${loc.collection ?? "list"}}`;
}

function fixHint(v: unknown, loc: KeyedEachLocation): string {
  const item = loc.itemIdent ?? "item";
  const idx = loc.indexIdent ? `, ${loc.indexIdent}` : "";
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    const f = ["id", "key", "slug", "href", "name", "title", ...Object.keys(r)].find((k) => Object.prototype.hasOwnProperty.call(r, k) && isValidPrimitiveKey(r[k]));
    if (f) return ` Fix: use a unique field, e.g. {each (${item}${idx}, ${item}.${f}) in ${loc.collection ?? "list"}}.`;
  }
  return " Fix: use a unique string, finite number or symbol, or omit the explicit key.";
}

export function normalizeSameValueZeroKey(rawKey: unknown, index: number, mode: KeyMode = "explicit", loc?: KeyedEachLocation): unknown {
  if (typeof rawKey === "number" && Object.is(rawKey, -0)) return 0;
  if (mode === "implicit") return rawKey;
  if (!isValidPrimitiveKey(rawKey)) {
    const pv = previewKey(rawKey);
    const kind = rawKey === null ? "null" : rawKey === undefined ? "undefined" : typeof rawKey === "number" ? (Number.isNaN(rawKey) ? "NaN" : "non-finite") : Array.isArray(rawKey) ? "an array" : typeof rawKey === "object" ? "an object" : `a ${typeof rawKey}`;
    const msg = loc
      ? `${loc.file ?? "<unknown>"}:${loc.line ?? 1}:${loc.column ?? 1} — ${fmtEach(loc)}: key at index ${index} is ${kind} (${pv}). Keys must be strings, finite numbers or symbols.${fixHint(rawKey, loc)}`
      : `Invalid key at index ${index}.`;
    throw new MixError(DiagnosticCodes.MIX_ERR_INVALID_KEY, msg, loc ? { loc, index, keyPreview: pv } : { index });
  }
  return rawKey;
}

export function resolveIncomingKeys<T>(
  items: readonly T[],
  keyFn: ((item: T, index: number) => unknown) | null | undefined,
  mode: KeyMode,
  tracker: DuplicateKeyTracker,
  loc?: KeyedEachLocation
): { seenKeys: Map<unknown, number>; incomingKeys: unknown[] } {
  const seenKeys = new Map<unknown, number>();
  const incomingKeys = new Array<unknown>(items.length);

  if (mode === "explicit") {
    const fn = keyFn ?? ((item: T) => item);
    for (let i = 0; i < items.length; i++) {
      const key = normalizeSameValueZeroKey(fn(items[i]!, i), i, "explicit", loc);
      const first = seenKeys.get(key);
      if (first !== undefined) {
        const pv = previewKey(key);
        const msg = loc
          ? `${loc.file ?? "<unknown>"}:${loc.line ?? 1}:${loc.column ?? 1} — ${fmtEach(loc)}: duplicate key ${pv} at index ${i} (first seen at index ${first}). Collection update atomically rejected.`
          : `Duplicate key at index ${i} (first seen at index ${first}).`;
        throw new MixError(DiagnosticCodes.MIX_ERR_DUPLICATE_KEY, msg, loc ? { loc, index: i, firstSeenIdx: first, keyPreview: pv } : { index: i, firstSeenIdx: first });
      }
      seenKeys.set(key, i);
      incomingKeys[i] = key;
    }
    return { seenKeys, incomingKeys };
  }

  const fn = keyFn ?? ((item: T) => resolveImplicitKey(item));
  const counts = new Map<unknown, number>();
  for (let i = 0; i < items.length; i++) {
    const base = normalizeSameValueZeroKey(fn(items[i]!, i), i, "implicit", loc);
    const occ = counts.get(base) ?? 0;
    counts.set(base, occ + 1);
    let eff = base;
    if (occ > 0) {
      let byOcc = tracker.duplicateTokens.get(base);
      if (!byOcc) { byOcc = new Map(); tracker.duplicateTokens.set(base, byOcc); }
      let sym = byOcc.get(occ);
      if (!sym) { sym = Symbol(`mix:dup:${occ}`); byOcc.set(occ, sym); }
      eff = sym;
      if (!tracker.warnedDuplicate && loc) {
        tracker.warnedDuplicate = true;
        reportWarning(DiagnosticCodes.MIX_WARN_IMPLICIT_DUPLICATE_KEY, `${loc.file ?? "<unknown>"}:${loc.line ?? 1}:${loc.column ?? 1} — Duplicate key ${previewKey(base)} at index ${i} in ${fmtEach(loc)}. Add an explicit unique key.`, loc);
      }
    }
    seenKeys.set(eff, i);
    incomingKeys[i] = eff;
  }

  // F2: prune synthetic duplicate tokens whose base key is no longer duplicated or no longer in the list
  for (const [baseKey, byOcc] of tracker.duplicateTokens) {
    const occCount = counts.get(baseKey) ?? 0;
    if (occCount <= 1) {
      tracker.duplicateTokens.delete(baseKey);
    } else {
      for (const occ of byOcc.keys()) {
        if (occ >= occCount) byOcc.delete(occ);
      }
    }
  }

  return { seenKeys, incomingKeys };
}
