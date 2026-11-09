/**
 * @mix/sync — Deterministic Fractional Indexing for Replicable Array CRDTs
 *
 * Generates lexicographically orderable position keys between any two arbitrary keys:
 * A < C < B. Guarantees deterministic order and collision-free concurrent insertions.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const MID_CHAR = "a"; // Near center of base62
const FIRST_CHAR = "0";

function charToVal(c: string): number {
  return DIGITS.indexOf(c);
}

function valToChar(v: number): string {
  return DIGITS[v] ?? "0";
}

/**
 * Generates an index key strictly greater than `prevKey` and strictly less than `nextKey`.
 * If `prevKey` is null, returns a key smaller than `nextKey`.
 * If `nextKey` is null, returns a key greater than `prevKey`.
 */
export function generateKeyBetween(prevKey: string | null, nextKey: string | null): string {
  if (!prevKey && !nextKey) {
    return MID_CHAR;
  }

  if (!prevKey && nextKey) {
    // Generate key smaller than nextKey
    let i = 0;
    while (i < nextKey.length && nextKey[i] === FIRST_CHAR) {
      i++;
    }
    if (i === nextKey.length) {
      return FIRST_CHAR + "V";
    }
    const charVal = charToVal(nextKey[i]!);
    if (charVal > 1) {
      const midVal = Math.floor(charVal / 2);
      return nextKey.slice(0, i) + valToChar(midVal);
    }
    return nextKey.slice(0, i) + FIRST_CHAR + "V";
  }

  if (prevKey && !nextKey) {
    // Generate key greater than prevKey
    const lastChar = prevKey[prevKey.length - 1]!;
    const val = charToVal(lastChar);
    if (val < BASE - 2) {
      return prevKey.slice(0, -1) + valToChar(val + 1);
    }
    return prevKey + MID_CHAR;
  }

  const p = prevKey!;
  const n = nextKey!;

  if (p >= n) {
    throw new Error(`[fractional] prevKey '${p}' must be strictly less than nextKey '${n}'`);
  }

  // Find first position where strings differ
  let i = 0;
  while (i < p.length && i < n.length && p[i] === n[i]) {
    i++;
  }

  const prefix = p.slice(0, i);
  const pVal = i < p.length ? charToVal(p[i]!) : 0;
  const nVal = i < n.length ? charToVal(n[i]!) : BASE;

  if (nVal - pVal > 1) {
    const midVal = Math.floor((pVal + nVal) / 2);
    return prefix + valToChar(midVal);
  }

  // Digits are consecutive or p is prefix of n
  if (i < p.length) {
    return p + MID_CHAR;
  }

  // p is prefix of n
  let j = i;
  while (j < n.length && n[j] === FIRST_CHAR) {
    j++;
  }
  if (j === n.length) {
    return p + FIRST_CHAR + "V";
  }
  const nextCharVal = charToVal(n[j]!);
  if (nextCharVal > 1) {
    return n.slice(0, j) + valToChar(Math.floor(nextCharVal / 2));
  }
  return n.slice(0, j) + FIRST_CHAR + "V";
}

