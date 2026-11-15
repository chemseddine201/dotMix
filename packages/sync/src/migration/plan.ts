/**
 * @dotmix/sync — Production v1 -> v2 Migration Plan Builder (Gate 34 / T-34.3)
 *
 * Extracts legacy snapshots and mutations into an immutable migration plan.
 * Zero external dependencies.
 */

import { sha256 } from "../protocol/sha256.js";
import type {
  LegacyV1EntryPayload,
  LegacyV1MutationRecord,
  V1MigrationPlan,
} from "./types.js";

export function computeDigestHex(payloadString: string): string {
  const digestBytes = sha256(payloadString);
  let hexString = "";
  for (let index = 0; index < digestBytes.length; index++) {
    const singleByte = digestBytes[index];
    if (singleByte !== undefined) {
      hexString += singleByte.toString(16).padStart(2, "0");
    }
  }
  return hexString;
}

export function buildV1MigrationPlan(
  collectionId: string,
  rawSnapshot: readonly LegacyV1EntryPayload[] | { value: readonly LegacyV1EntryPayload[] } | undefined,
  rawMutations: readonly LegacyV1MutationRecord[] | undefined
): V1MigrationPlan {
  let entriesList: readonly LegacyV1EntryPayload[] = [];
  if (Array.isArray(rawSnapshot)) {
    entriesList = rawSnapshot;
  } else if (
    rawSnapshot &&
    typeof rawSnapshot === "object" &&
    "value" in rawSnapshot &&
    Array.isArray(rawSnapshot.value)
  ) {
    entriesList = rawSnapshot.value;
  }

  const activeEntries: LegacyV1EntryPayload[] = [];
  const deletedEntries: LegacyV1EntryPayload[] = [];

  for (const singleEntry of entriesList) {
    if (singleEntry.deleted === true) {
      deletedEntries.push(singleEntry);
    } else {
      activeEntries.push(singleEntry);
    }
  }

  const pendingMutations = (rawMutations ?? []).filter(
    (mutationCandidate) =>
      mutationCandidate.storeKey === collectionId &&
      (mutationCandidate.state === "pending" || mutationCandidate.state === undefined)
  );

  return {
    collectionId,
    activeEntries,
    deletedEntries,
    pendingMutations,
  };
}
