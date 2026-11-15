/**
 * D-137 Canonicalization & Deterministic Serialization
 * (F-07, F-12, D-137 §3.3.1, Gate 33)
 *
 * Implements deterministic canonical JSON serialization, stable key sorting,
 * and key formatting with zero external dependencies.
 */

import { sha256Hex } from "./sha256.js";

const encoder = new TextEncoder();

export interface StructuredDot {
  readonly epochNumber: number;
  readonly replicaId: string;
  readonly sequence: number;
}

export function toOperationKey(collectionId: string, dot: StructuredDot): string {
  return `${collectionId}:${dot.epochNumber}:${dot.replicaId}:${dot.sequence}`;
}

export function toOriginStreamKey(epochNumber: number, replicaId: string): string {
  return `${epochNumber}:${replicaId}`;
}

export function toIncarnationId(dot: StructuredDot): string {
  return `${dot.epochNumber}:${dot.replicaId}:${dot.sequence}`;
}

/**
 * Deterministically serializes any JavaScript value to a canonical JSON string:
 * - Omits undefined object properties.
 * - Sorts object keys lexicographically (Unicode code point order).
 * - Rejects non-finite numbers (NaN, Infinity) with D137_NON_CANONICAL_VALUE.
 * - Serializes booleans, strings, arrays, objects deterministically.
 */
export function canonicalizeValue(sourceValue: unknown): string {
  if (sourceValue === null || sourceValue === undefined) return "null";
  const valueType = typeof sourceValue;
  if (valueType === "boolean") return sourceValue ? "true" : "false";
  if (valueType === "number") {
    if (!Number.isFinite(sourceValue as number)) {
      throw new Error("D137_NON_CANONICAL_VALUE: Non-finite number encountered");
    }
    return JSON.stringify(sourceValue);
  }
  if (valueType === "string") return JSON.stringify(sourceValue);
  if (Array.isArray(sourceValue)) {
    const serializedItems: string[] = [];
    for (let itemIndex = 0; itemIndex < sourceValue.length; itemIndex++) {
      serializedItems.push(canonicalizeValue(sourceValue[itemIndex]));
    }
    return `[${serializedItems.join(",")}]`;
  }
  if (valueType === "object") {
    const recordObject = sourceValue as Record<string, unknown>;
    const sortedPropertyKeys = Object.keys(recordObject)
      .filter((propertyKey) => recordObject[propertyKey] !== undefined)
      .sort();
    const serializedPairs: string[] = [];
    for (const propertyKey of sortedPropertyKeys) {
      serializedPairs.push(`${JSON.stringify(propertyKey)}:${canonicalizeValue(recordObject[propertyKey])}`);
    }
    return `{${serializedPairs.join(",")}}`;
  }
  throw new Error(`D137_NON_CANONICAL_VALUE: Unsupported value type: ${valueType}`);
}

/**
 * Computes exact UTF-8 byte length of a canonically serialized value.
 */
export function computeCanonicalByteSize(sourceValue: unknown): number {
  return encoder.encode(canonicalizeValue(sourceValue)).length;
}

export { sha256Hex };
