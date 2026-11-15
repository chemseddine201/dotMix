/**
 * D137-v33-reference: Canonicalization & Key Formatting
 */

import { createHash } from "node:crypto";
import type { CausalDot, CollectionId, IncarnationId, OperationKey, OriginStreamKey } from "./types.js";

export function toOperationKey(collectionId: CollectionId, dot: CausalDot): OperationKey {
  return `${collectionId}:${dot.epochNumber}:${dot.replicaId}:${dot.sequence}`;
}

export function toOriginStreamKey(epochNumber: number, replicaId: string): OriginStreamKey {
  return `${epochNumber}:${replicaId}`;
}

export function toIncarnationId(dot: CausalDot): IncarnationId {
  return `${dot.epochNumber}:${dot.replicaId}:${dot.sequence}`;
}

export function canonicalizeValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "null";
  const t = typeof val;
  if (t === "boolean") return val ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(val as number)) {
      throw new Error("D137_NON_CANONICAL_VALUE: Non-finite number encountered");
    }
    return JSON.stringify(val);
  }
  if (t === "string") return JSON.stringify(val);
  if (Array.isArray(val)) {
    return "[" + (val as unknown[]).map(canonicalizeValue).join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(val as Record<string, unknown>)
      .filter((k) => (val as Record<string, unknown>)[k] !== undefined)
      .sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalizeValue((val as Record<string, unknown>)[k])).join(",") + "}";
  }
  throw new Error(`D137_NON_CANONICAL_VALUE: Unsupported value type: ${t}`);
}

export function sha256Hex(utf8Str: string): string {
  return createHash("sha256").update(utf8Str, "utf8").digest("hex");
}
